import { GAME_CONFIG, getEffectiveMilestoneRound, getFinalRound, getMilestoneTarget, getNextMilestone } from "./config.js";
import { createShopCardPool, getCardById } from "./data.js";
import {
  drainPendingItemMessages,
  getBananaGenerationCardId,
  getItemActionOverrides,
  getItemFinalMultipliers,
  getItemRoundEndEffects,
  maybeDuplicateGeneratedCard,
  protectFirstDestruction,
  resolveItemActionEffects,
  resolveItemAfterActionEffects,
  resolveItemPostponeEffects,
  shouldEchoDrinkEffect,
} from "./items.js";
import { formatScore, safeAdd, safeMultiply, safeProduct } from "./numbers.js";
import { grantRoundGold, queueRoundGold } from "./economy.js";
import { recordCardAction } from "./statistics.js";
import {
  getFinalRemainingCard,
  getCurrentCard,
  getNextCard,
  getRemainingCardCount,
  getRemainingCards,
  getRemainingCardsInPlayOrder,
  getRoundCardsExcept,
  isCardPostponed,
  markCardsPostponed,
} from "./round-pile.js";

const ACTIONS = Object.freeze({ EAT: "eat", DISCARD: "discard" });

function sequenceFor(state, action) {
  return action === ACTIONS.EAT ? state.round.eat_sequence : state.round.discard_sequence;
}

function matchesTarget(rule, card) {
  const idMatches = !rule.target_id || rule.target_id === card.id || rule.target_id === card.card_id;
  const typeMatches = !rule.target_type || rule.target_type === card.type;
  const rarityMatches = !rule.target_rarity || rule.target_rarity === card.rarity;
  const edibilityMatches = !rule.target_edibility || rule.target_edibility === card.edibility;
  return idMatches && typeMatches && rarityMatches && edibilityMatches;
}

function matchesPosition(state, position) {
  if (position === "first") return state.round.actions.length === 0;
  if (position === "second") return state.round.actions.length === 1;
  if (position === "last") return getRemainingCardCount(state) === 0;
  if (position === "middle") return state.round.actions.length > 0 && getRemainingCardCount(state) > 0;
  return false;
}

function isWrongEdibilityAction(action, card) {
  return (card.edibility === "edible" && action === ACTIONS.DISCARD)
    || (card.edibility === "inedible" && action === ACTIONS.EAT);
}

function getDeckReductionTotal(state) {
  return (state.deck ?? []).reduce((total, card) => {
    const eatBase = card.base_eat_points ?? card.eat_points ?? 0;
    const discardBase = card.base_discard_points ?? card.discard_points ?? 0;
    return safeAdd(total,
      Math.max(0, eatBase - (card.eat_points ?? 0))
      + Math.max(0, discardBase - (card.discard_points ?? 0)));
  }, 0);
}

function getDeckReductionSnapshot(state) {
  const snapshot = new Map();
  for (const card of state.deck ?? []) {
    for (const stat of ["eat_points", "discard_points"]) {
      const baseStat = stat === "eat_points" ? "base_eat_points" : "base_discard_points";
      snapshot.set(`${card.uuid}:${stat}`, {
        card_uuid: card.uuid,
        stat,
        amount: Math.max(0, (card[baseStat] ?? card[stat] ?? 0) - (card[stat] ?? 0)),
      });
    }
  }
  return snapshot;
}

function getRuleFlatBonus(state, action, card) {
  return state.active_rules.reduce((total, rule) => {
    if (rule.scope !== "flat_bonus" || rule.action !== action || !matchesTarget(rule, card)) return total;
    return safeAdd(total, rule.bonus ?? 0);
  }, 0);
}

function consumeActionBuffs(state, action, card) {
  let multiplier = 1;
  let flatBonus = 0;
  let useBestSide = false;
  let useOppositeSide = false;

  for (const buff of state.round.buffs) {
    if (buff.kind === "until_action" && action === buff.stop_action) {
      buff.remaining = 0;
      continue;
    }
    if (buff.kind === "wrong_edibility_flat") {
      if (buff.remaining > 0 && isWrongEdibilityAction(action, card)) {
        flatBonus = safeAdd(flatBonus, buff.value ?? 0);
        buff.remaining -= 1;
      }
      continue;
    }
    const actionMatches = buff.action === "*" || buff.action === action;
    const typeMatches = !buff.target_type || buff.target_type === "*" || buff.target_type === card.type;
    const edibilityMatches = !buff.target_edibility || buff.target_edibility === card.edibility;
    if (buff.remaining <= 0 || !actionMatches || !typeMatches || !edibilityMatches) continue;

    if (buff.kind === "multiplier") multiplier = safeProduct(multiplier, buff.value);
    if (buff.kind === "flat") flatBonus = safeAdd(flatBonus, buff.value);
    if (buff.kind === "best_side") useBestSide = true;
    if (buff.kind === "opposite_side") useOppositeSide = true;
    if (buff.kind === "until_action") flatBonus = safeAdd(flatBonus, buff.value ?? 0);
    if (buff.kind === "wager") {
      const chosenSide = action === ACTIONS.EAT ? card.eat_points ?? 0 : card.discard_points ?? 0;
      if (chosenSide > 0) multiplier = safeProduct(multiplier, buff.multiplier ?? 1);
      else flatBonus = safeAdd(flatBonus, buff.failure_penalty ?? 0);
    }
    if (buff.kind === "choice") {
      if (action === buff.good_action) flatBonus = safeAdd(flatBonus, buff.good_bonus ?? 0);
      if (action === buff.bad_action) flatBonus = safeAdd(flatBonus, buff.bad_penalty ?? 0);
    }
    if (buff.kind === "unique_flat") {
      buff.seen_types ??= [];
      if (buff.seen_types.includes(card.type)) continue;
      buff.seen_types.push(card.type);
      flatBonus = safeAdd(flatBonus, buff.value);
    }
    if (buff.kind !== "until_action") buff.remaining -= 1;
  }

  state.round.buffs = state.round.buffs.filter((buff) => buff.remaining > 0);
  return {
    multiplier,
    flat_bonus: flatBonus,
    use_best_side: useBestSide,
    use_opposite_side: useOppositeSide,
  };
}

function addBuff(state, buff) {
  state.round.buffs.push({ ...buff });
}

function consumeOncePerRound(state, card, effect) {
  if (!effect.once_per_round) return true;
  const key = `card:${card.uuid}:${effect.kind}`;
  if (state.round.effect_trigger_counts[key]) return false;
  state.round.effect_trigger_counts[key] = 1;
  return true;
}

function removePermanentCard(state, cardUuid) {
  const index = state.deck.findIndex((item) => item.uuid === cardUuid);
  if (index < 0) return null;
  if (protectFirstDestruction(state, cardUuid)) return null;
  const removed = state.deck.splice(index, 1)[0];
  state.round.destroyed_count = (state.round.destroyed_count ?? 0) + 1;
  return removed;
}

function isStatLocked(card, stat) {
  return Boolean(card?.stats_locked) || card?.locked_stats?.includes(stat);
}

function syncPhysicalCard(state, cardUuid, values) {
  const copies = [
    state.deck.find((item) => item.uuid === cardUuid),
    ...state.round.draw_pile,
    ...state.round.spent_pile,
    ...(state.round.reserve_cards ?? []),
  ].filter((card) => card?.uuid === cardUuid);
  copies.forEach((copy) => Object.assign(copy, values));
  return copies[0] ?? null;
}

function lockPermanentCardStats(state, card, stats = ["eat_points", "discard_points"]) {
  const permanentCard = state.deck.find((item) => item.uuid === card.uuid);
  if (!permanentCard) return false;
  const lockedStats = [...new Set([...(permanentCard.locked_stats ?? []), ...stats])];
  syncPhysicalCard(state, card.uuid, {
    locked_stats: lockedStats,
    status_keywords: [...new Set([...(permanentCard.status_keywords ?? []), "锁定"])],
  });
  return true;
}

function growPermanentCard(state, card, stat, amount) {
  const growth = Math.max(0, amount ?? 0);
  if (growth === 0) return 0;
  const permanentCard = state.deck.find((item) => item.uuid === card.uuid);
  if (!permanentCard || isStatLocked(permanentCard, stat)) return 0;
  if (permanentCard) permanentCard[stat] = safeAdd(permanentCard[stat] ?? 0, growth);
  if (card !== permanentCard) card[stat] = safeAdd(card[stat] ?? 0, growth);
  state.round.grown_count = (state.round.grown_count ?? 0) + 1;
  return growth;
}

function changePermanentCard(state, card, stat, amount, limits = {}) {
  const pointChangeMultiplier = state.round.double_point_change_uuids?.includes(card.uuid) ? 2 : 1;
  const delta = Number(amount ?? 0) * pointChangeMultiplier;
  if (!Number.isFinite(delta) || delta === 0) return 0;
  const permanentCard = state.deck.find((item) => item.uuid === card.uuid);
  if (!permanentCard) return 0;
  if (isStatLocked(permanentCard, stat)) return 0;
  if (delta < 0 && state.round.protected_decrease_uuids?.includes(card.uuid)) return 0;
  const before = permanentCard[stat] ?? 0;
  const configuredMin = limits.min ?? -GAME_CONFIG.max_score;
  const configuredMax = limits.max ?? GAME_CONFIG.max_score;
  const effectiveMin = Math.min(configuredMin, before);
  const effectiveMax = Math.max(configuredMax, before);
  const next = Math.max(effectiveMin, Math.min(effectiveMax, safeAdd(before, delta)));
  permanentCard[stat] = next;
  const copies = [card, ...state.round.draw_pile, ...state.round.spent_pile, ...(state.round.reserve_cards ?? [])];
  copies.forEach((copy) => {
    if (copy?.uuid === card.uuid) copy[stat] = next;
  });
  if (next !== before) state.round.grown_count = (state.round.grown_count ?? 0) + 1;
  return next - before;
}

function setPermanentCardStat(state, card, stat, value, limits = {}) {
  const permanentCard = state.deck.find((item) => item.uuid === card.uuid);
  if (!permanentCard || isStatLocked(permanentCard, stat)) return 0;
  const before = permanentCard[stat] ?? 0;
  const requested = Number(value ?? before);
  if (!Number.isFinite(requested) || (requested < before && state.round.protected_decrease_uuids?.includes(card.uuid))) return 0;
  const next = Math.max(limits.min ?? -GAME_CONFIG.max_score, Math.min(limits.max ?? GAME_CONFIG.max_score, requested));
  syncPhysicalCard(state, card.uuid, { [stat]: next });
  if (next !== before) state.round.grown_count = (state.round.grown_count ?? 0) + 1;
  return next - before;
}

function removeRoundCard(state, cardUuid) {
  for (const pile of [state.round.draw_pile, state.round.spent_pile, state.round.reserve_cards ?? []]) {
    const index = pile.findIndex((item) => item.uuid === cardUuid);
    if (index >= 0) pile.splice(index, 1);
  }
}

function markRemainingPostponed(state, excludedUuid = null) {
  return markCardsPostponed(state, getRoundCardsExcept(state, excludedUuid));
}

function addCardScoreBonus(state, cardUuid, amount) {
  if (!cardUuid || !amount) return;
  state.round.card_score_bonuses ??= {};
  state.round.card_score_bonuses[cardUuid] = safeAdd(state.round.card_score_bonuses[cardUuid] ?? 0, amount);
}

function resetPermanentCardPoints(state, permanentCard) {
  const eat = permanentCard.base_eat_points ?? permanentCard.eat_points ?? 0;
  const discard = permanentCard.base_discard_points ?? permanentCard.discard_points ?? 0;
  if (!isStatLocked(permanentCard, "eat_points")) permanentCard.eat_points = eat;
  if (!isStatLocked(permanentCard, "discard_points")) permanentCard.discard_points = discard;
  [...state.round.draw_pile, ...state.round.spent_pile, ...(state.round.reserve_cards ?? [])].forEach((copy) => {
    if (copy.uuid !== permanentCard.uuid) return;
    if (!isStatLocked(permanentCard, "eat_points")) copy.eat_points = eat;
    if (!isStatLocked(permanentCard, "discard_points")) copy.discard_points = discard;
  });
}

function restoreReducedPermanentCardPoints(state, permanentCard) {
  const baseEat = permanentCard.base_eat_points ?? permanentCard.eat_points ?? 0;
  const baseDiscard = permanentCard.base_discard_points ?? permanentCard.discard_points ?? 0;
  const eatBlocked = isStatLocked(permanentCard, "eat_points") || permanentCard.non_purifiable_stats?.includes("eat_points");
  const discardBlocked = isStatLocked(permanentCard, "discard_points") || permanentCard.non_purifiable_stats?.includes("discard_points");
  const eat = eatBlocked ? permanentCard.eat_points ?? 0 : Math.max(permanentCard.eat_points ?? 0, baseEat);
  const discard = discardBlocked ? permanentCard.discard_points ?? 0 : Math.max(permanentCard.discard_points ?? 0, baseDiscard);
  const restored = (eat - (permanentCard.eat_points ?? 0)) + (discard - (permanentCard.discard_points ?? 0));
  permanentCard.eat_points = eat;
  permanentCard.discard_points = discard;
  [...state.round.draw_pile, ...state.round.spent_pile, ...(state.round.reserve_cards ?? [])].forEach((copy) => {
    if (copy.uuid !== permanentCard.uuid) return;
    copy.eat_points = eat;
    copy.discard_points = discard;
  });
  return restored;
}

function restoreLargestRandomReduction(state, random = Math.random) {
  const reductions = state.deck.flatMap((owned) => ["eat_points", "discard_points"].map((stat) => {
    const baseStat = stat === "eat_points" ? "base_eat_points" : "base_discard_points";
    const base = owned[baseStat] ?? owned[stat] ?? 0;
    const current = owned[stat] ?? 0;
    const blocked = isStatLocked(owned, stat) || owned.non_purifiable_stats?.includes(stat);
    return { owned, stat, amount: blocked ? 0 : Math.max(0, base - current), base };
  })).filter((candidate) => candidate.amount > 0);
  if (reductions.length === 0) return null;
  const largest = Math.max(...reductions.map((candidate) => candidate.amount));
  const candidates = reductions.filter((candidate) => candidate.amount === largest);
  const chosen = candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
  chosen.owned[chosen.stat] = chosen.base;
  [...state.round.draw_pile, ...state.round.spent_pile, ...(state.round.reserve_cards ?? [])].forEach((copy) => {
    if (copy.uuid === chosen.owned.uuid) copy[chosen.stat] = chosen.base;
  });
  return { name: chosen.owned.name, stat: chosen.stat, amount: chosen.amount };
}

function grantFirstDrinkItemGold(state) {
  for (const item of state.items.filter((owned) => owned.effect?.kind === "drink_first_gold")) {
    const key = `item:${item.id}:drink-gold`;
    if (state.round.effect_trigger_counts[key]) continue;
    state.round.effect_trigger_counts[key] = 1;
    queueRoundGold(state, item.name, item.effect.gold ?? 0, "item");
  }
}

function createGeneratedCard(state, sourceCard, template, options = {}) {
  if (!template || state.deck.length >= GAME_CONFIG.max_deck_size) return null;
  state.round.generated_count = (state.round.generated_count ?? 0) + 1;
  const uuid = `${template.id}-generated-${sourceCard.uuid}-${state.current_round}-${state.round.generated_count}`;
  const generated = {
    ...template,
    synergy_tags: [...(template.synergy_tags ?? [])],
    effect: options.no_effect ? null : template.effect ? { ...template.effect, keywords: [...(template.effect.keywords ?? [])] } : null,
    generated_from: sourceCard.id,
    generated_label: sourceCard.name,
    weakened: Boolean(options.weakened),
    status_keywords: options.weakened ? ["弱化"] : [],
    uuid,
  };
  if (Number.isFinite(options.eat_points)) {
    generated.eat_points = options.eat_points;
    generated.base_eat_points = options.eat_points;
  }
  if (Number.isFinite(options.discard_points)) {
    generated.discard_points = options.discard_points;
    generated.base_discard_points = options.discard_points;
  }
  state.deck.push(generated);
  maybeDuplicateGeneratedCard(state, generated);
  return generated;
}

function prepareImmediateEffect(state, action, card) {
  const effect = card.effect;
  if (!effect || action !== (effect.trigger_action ?? ACTIONS.EAT)) return { bonus: 0, detail: null };
  if (effect.kind === "absorb_debuff") {
    const negative = state.round.buffs.filter((buff) => buff.kind === "flat" && buff.value < 0);
    const raw = negative.reduce((total, buff) => safeAdd(total, Math.abs(buff.value) * buff.remaining), 0);
    const bonus = Math.min(effect.max_bonus ?? raw, raw);
    state.round.buffs = state.round.buffs.filter((buff) => !(buff.kind === "flat" && buff.value < 0));
    return { bonus, detail: bonus > 0 ? `${card.name}：净化并转化 +${bonus}` : `${card.name}：没有待净化负面蓄势` };
  }
  if (effect.kind === "reset_buffs_bonus") {
    const removed = state.round.buffs.length;
    const bonus = Math.min(effect.max_bonus ?? GAME_CONFIG.max_score, removed * (effect.bonus_per_buff ?? 0));
    state.round.buffs = [];
    return { bonus, detail: removed > 0 ? `${card.name}：净化 ${removed} 个蓄势，+${bonus}` : `${card.name}：没有待净化蓄势` };
  }
  return { bonus: 0, detail: null };
}

function markEffect(entry, card, detail = card.effect?.description) {
  const message = detail ?? card.name;
  entry.effect_triggered = entry.effect_triggered ? `${entry.effect_triggered} · ${message}` : message;
}

function applyCardEffect(state, action, card, entry, random = Math.random) {
  const effect = card.effect;
  if (!effect) return;

  if (effect.kind === "flat_action_bonus"
    && action === effect.trigger_action
    && consumeOncePerRound(state, card, effect)) {
    const bonus = effect.bonus ?? 0;
    entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
    markEffect(entry, card, `${card.name}：额外 +${bonus} 分`);
  }

  if (effect.kind === "first_discard_bonus" && action === ACTIONS.DISCARD) {
    const isFirstDiscard = !state.round.actions.some((previous) => previous.action === ACTIONS.DISCARD);
    if (isFirstDiscard) {
      const bonus = effect.bonus ?? 0;
      entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
      markEffect(entry, card, `${card.name}：本轮第一张弃牌，额外 +${bonus} 分`);
    }
  }

  if (effect.kind === "early_action_bonus" && action === effect.trigger_action) {
    const actionNumber = state.round.actions.length + 1;
    if (actionNumber <= (effect.action_limit ?? 3)) {
      const bonus = effect.bonus ?? 0;
      entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
      markEffect(entry, card, `${card.name}：第 ${actionNumber} 次行动，额外 +${bonus} 分`);
    }
  }

  if (effect.kind === "gain_delete_token_destroy" && action === effect.trigger_action) {
    const removed = state.deck.length > 1 ? removePermanentCard(state, card.uuid) : null;
    const echoedDestruction = Boolean(entry.item_drink_echo && entry.destroyed_self);
    if (removed || echoedDestruction) {
      const tokens = Math.max(1, effect.tokens ?? 1);
      state.delete_tokens = safeAdd(state.delete_tokens ?? 0, tokens);
      if (removed) entry.destroyed_self = true;
      markEffect(entry, card, `${card.name}：${removed ? "摧毁自身，" : "双层吸管复现效果，"}删牌标记 +${tokens}`);
    } else {
      markEffect(entry, card, `${card.name}：最后一张牌不会摧毁，也不会获得删牌标记`);
    }
  }

  if (effect.kind === "choice_score_or_delete_token") {
    if (action === ACTIONS.EAT) {
      const bonus = effect.eat_bonus ?? 0;
      entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
      markEffect(entry, card, `${card.name}：额外 +${bonus} 分`);
    } else if (action === ACTIONS.DISCARD) {
      const removed = state.deck.length > 1 ? removePermanentCard(state, card.uuid) : null;
      if (removed) {
        const tokens = Math.max(1, effect.tokens ?? 1);
        state.delete_tokens = safeAdd(state.delete_tokens ?? 0, tokens);
        entry.destroyed_self = true;
        markEffect(entry, card, `${card.name}：摧毁自身，删牌标记 +${tokens}`);
      }
    }
  }

  if (effect.kind === "destroy_self_score" && action === effect.trigger_action) {
    const bonus = effect.bonus ?? 0;
    entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
    const removed = state.deck.length > 1 ? removePermanentCard(state, card.uuid) : null;
    if (removed) entry.destroyed_self = true;
    markEffect(entry, card, `${card.name}：额外 +${bonus} 分${removed ? "，摧毁自身" : ""}`);
  }

  if (effect.kind === "fruit_history_bonus" && action === effect.trigger_action) {
    const count = state.round.actions.filter((previous) => previous.action === ACTIONS.EAT && previous.type === "水果").length;
    const bonus = Math.min(effect.max_bonus ?? GAME_CONFIG.max_score, count);
    entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
    markEffect(entry, card, `${card.name}：此前吃过 ${count} 张水果，额外 +${bonus}`);
  }

  if (effect.kind === "fruit_combo_forecast" && action === effect.trigger_action) {
    const combo = (state.round.fruit_combo ?? 0) + Math.max(1, effect.combo_gain ?? 1);
    state.round.fruit_combo = combo;
    state.round.best_fruit_combo = Math.max(state.round.best_fruit_combo ?? 0, combo);
    const bonus = Math.min(effect.max_bonus ?? GAME_CONFIG.max_score, combo * (effect.bonus_per_combo ?? 1));
    const forecast = getRemainingCardsInPlayOrder(state).slice(0, effect.count ?? 3);
    entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
    entry.fruit_combo = combo;
    entry.forecast_cards = forecast.map((item) => item.name);
    entry.effect_log = `${card.name}：水果连击 ×${combo}`;
    markEffect(entry, card, `${card.name}：水果连击 ×${combo}，预判 ${forecast.map((item) => item.name).join(" → ") || "无后续牌"}`);
  }

  if (effect.kind === "destroy_generate_many" && action === effect.trigger_action) {
    const removed = state.deck.length > 1 ? removePermanentCard(state, card.uuid) : null;
    let generated = 0;
    const template = getCardById(effect.card_id);
    for (let index = 0; index < (effect.count ?? 1); index += 1) {
      if (createGeneratedCard(state, card, template, {
        weakened: effect.generate_weakened,
        no_effect: effect.no_effect,
      })) generated += 1;
    }
    if (removed) entry.destroyed_self = true;
    const generatedLabel = `${effect.generate_weakened ? "【弱化】" : ""}${template?.name ?? "卡牌"}`;
    markEffect(entry, card, `${card.name}：${removed ? "摧毁自身，" : ""}生成 ${generated} 张${generatedLabel}`);
  }

  if (effect.kind === "early_time_bonus" && action === effect.trigger_action) {
    const elapsed = state.round.live_elapsed_ms ?? state.round.elapsed_ms ?? Number.POSITIVE_INFINITY;
    if (elapsed <= (effect.time_limit_ms ?? 0)) {
      entry.effect_bonus = safeAdd(entry.effect_bonus, effect.bonus ?? 0);
      markEffect(entry, card, `${card.name}：${(elapsed / 1000).toFixed(1)} 秒出餐，额外 +${effect.bonus ?? 0}`);
    }
  }

  if (effect.kind === "early_time_gold" && action === effect.trigger_action) {
    const elapsed = state.round.live_elapsed_ms ?? state.round.elapsed_ms ?? Number.POSITIVE_INFINITY;
    if (elapsed <= (effect.time_limit_ms ?? 0)) {
      const gold = Math.max(0, effect.gold ?? 0);
      grantRoundGold(state, entry, card.name, gold);
      markEffect(entry, card, `${card.name}：${(elapsed / 1000).toFixed(1)} 秒内吃下，金币 +${gold}`);
    }
  }

  if (effect.kind === "sour_takeout") {
    if (action === ACTIONS.EAT) {
      const eatChange = changePermanentCard(state, card, "eat_points", -(effect.eat_loss ?? 1), { min: -5 });
      const discardChange = changePermanentCard(state, card, "discard_points", effect.discard_gain ?? 1, { max: 12 });
      entry.permanent_change = { eat: eatChange, discard: discardChange };
      markEffect(entry, card, `${card.name}：吃分 ${eatChange} / 弃分 +${discardChange}`);
    } else if ((card.discard_points ?? 0) < (effect.generate_if_discard_below ?? 0)) {
      const generated = createGeneratedCard(state, card, getCardById("K005"));
      markEffect(entry, card, `${card.name}：弃分仍小于 0，${generated ? "生成 1 张发馊外卖" : "牌组已满，无法生成"}`);
    }
  }

  if (effect.kind === "spoiled_chicken_bucket") {
    if (action === ACTIONS.EAT) {
      const eatChange = changePermanentCard(state, card, "eat_points", -(effect.eat_loss ?? 1), { min: -5 });
      const discardChange = changePermanentCard(state, card, "discard_points", effect.discard_gain ?? 1, { max: 12 });
      entry.permanent_change = { eat: eatChange, discard: discardChange };
      markEffect(entry, card, `${card.name}：吃分 ${eatChange} / 弃分 +${discardChange}`);
    } else if ((card.discard_points ?? 0) < (effect.force_type_if_discard_below ?? 0)) {
      state.next_draft_forced_type = effect.forced_type ?? "快餐";
      markEffect(entry, card, `${card.name}：下次选牌必有 1 张${state.next_draft_forced_type}`);
    }
  }

  if (effect.kind === "sandwich_anorexia") {
    if (action === ACTIONS.EAT) {
      const eatChange = changePermanentCard(state, card, "eat_points", -(effect.eat_loss ?? 2), { min: -5 });
      const discardChange = changePermanentCard(state, card, "discard_points", effect.discard_gain ?? 2, { max: 12 });
      entry.permanent_change = { eat: eatChange, discard: discardChange };
    }
    const doubled = getRemainingCards(state).filter((remaining) => remaining.type === "快餐").map((remaining) => remaining.uuid);
    state.round.double_point_change_uuids = [...new Set([...(state.round.double_point_change_uuids ?? []), ...doubled])];
    markEffect(entry, card, `${card.name}：本轮剩余 ${doubled.length} 张快餐的点数变动值翻倍`);
  }

  if (effect.kind === "fast_food_anorexia_or_positive_count") {
    const remaining = getRemainingCards(state);
    if (action === ACTIONS.EAT) {
      const hasFastFood = remaining.some((candidate) => candidate.type === "快餐");
      if (hasFastFood) {
        const changes = state.deck
          .filter((owned) => owned.type === "快餐")
          .map((owned) => ({
            card_name: owned.name,
            eat: changePermanentCard(state, owned, "eat_points", -1, { min: -5 }),
            discard: changePermanentCard(state, owned, "discard_points", 1, { max: 12 }),
          }));
        entry.point_changes = changes.flatMap((change) => [
          { card_name: change.card_name, stat: "eat_points", amount: change.eat },
          { card_name: change.card_name, stat: "discard_points", amount: change.discard },
        ]).filter((change) => change.amount !== 0);
        markEffect(entry, card, `${card.name}：牌堆仍有快餐，${changes.length} 张快餐触发【厌食】`);
      } else {
        markEffect(entry, card, `${card.name}：牌堆中没有其他快餐，【厌食】未触发`);
      }
    }
    if (action === ACTIONS.DISCARD) {
      const positiveCount = remaining.filter((candidate) =>
        (candidate.eat_points ?? 0) > 0 && (candidate.discard_points ?? 0) > 0).length;
      entry.effect_bonus = safeAdd(entry.effect_bonus, positiveCount);
      markEffect(entry, card, `${card.name}：牌堆中 ${positiveCount} 张牌吃弃点数均为正，额外 +${positiveCount}`);
    }
  }

  if (effect.kind === "scale_degraded_fast_food" && action === effect.trigger_action) {
    const count = state.deck.filter((owned) => owned.uuid !== card.uuid
      && owned.type === "快餐"
      && (owned.eat_points ?? 0) < (owned.base_eat_points ?? owned.eat_points ?? 0)).length;
    const bonus = Math.min(effect.max_bonus ?? GAME_CONFIG.max_score, count * (effect.bonus_per_card ?? 1));
    entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
    markEffect(entry, card, `${card.name}：回收 ${count} 份厌食快餐，额外 +${bonus}`);
  }

  if (["bonus_if_degraded_fast_food_history", "bonus_if_degraded_history"].includes(effect.kind) && action === effect.trigger_action) {
    const found = state.round.actions.some((previous) => {
      const owned = state.deck.find((candidate) => candidate.uuid === previous.card_uuid);
      const eat = owned?.eat_points ?? previous.eat_points_at_action ?? 0;
      const base = owned?.base_eat_points ?? previous.base_eat_points ?? eat;
      return (effect.kind !== "bonus_if_degraded_fast_food_history" || previous.type === "快餐") && eat < base;
    });
    if (found) {
      entry.effect_bonus = safeAdd(entry.effect_bonus, effect.bonus ?? 0);
      markEffect(entry, card, `${card.name}：此前处理过吃分低于原值的牌，额外 +${effect.bonus ?? 0}`);
    }
  }

  if (effect.kind === "transfer_dessert_growth" && action === effect.trigger_action && consumeOncePerRound(state, card, effect)) {
    const desserts = state.deck.filter((owned) => owned.type === "甜点" && owned.uuid !== card.uuid);
    const amount = Math.max(1, effect.amount ?? 2);
    const sources = desserts.filter((owned) => !isStatLocked(owned, "eat_points")
      && (owned.eat_points ?? 0) - (owned.base_eat_points ?? owned.eat_points ?? 0) >= amount)
      .sort((a, b) => ((b.eat_points ?? 0) - (b.base_eat_points ?? b.eat_points ?? 0))
        - ((a.eat_points ?? 0) - (a.base_eat_points ?? a.eat_points ?? 0)));
    const source = sources[0];
    const target = desserts.filter((owned) => owned.uuid !== source?.uuid && !isStatLocked(owned, "eat_points"))
      .sort((a, b) => (a.eat_points ?? 0) - (b.eat_points ?? 0))[0];
    if (source && target) {
      changePermanentCard(state, source, "eat_points", -amount);
      changePermanentCard(state, target, "eat_points", amount);
      markEffect(entry, card, `${card.name}：把「${source.name}」的 ${amount} 点绿色吃分转移给「${target.name}」`);
    } else {
      markEffect(entry, card, `${card.name}：没有可转移的甜点成长`);
    }
  }

  if (["scale_by_reserve_type", "scale_by_pile_type"].includes(effect.kind) && action === effect.trigger_action) {
    const source = effect.kind === "scale_by_pile_type" ? getRemainingCards(state) : (state.round.reserve_cards ?? []);
    const count = source.filter((owned) => owned.type === effect.target_type && owned.uuid !== card.uuid).length;
    const bonus = Math.min(effect.max_bonus ?? GAME_CONFIG.max_score, count * (effect.multiplier ?? 1));
    entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
    markEffect(entry, card, `${card.name}：牌堆中有 ${count} 张${effect.target_type}，额外 +${bonus}`);
  }

  if (effect.kind === "forecast_tail_edibility" && action === effect.trigger_action) {
    const tail = getFinalRemainingCard(state);
    entry.forecast_cards = tail ? [tail.name] : [];
    const success = tail?.edibility === effect.target_edibility;
    if (success) entry.effect_bonus = safeAdd(entry.effect_bonus, effect.bonus ?? 0);
    markEffect(entry, card, `${card.name}：牌堆最后一张是「${tail?.name ?? "无"}」${success ? `，额外 +${effect.bonus ?? 0}` : "，条件未满足"}`);
  }

  if (effect.kind === "store_charges") {
    const permanent = state.deck.find((owned) => owned.uuid === card.uuid);
    if (permanent && action === ACTIONS.EAT) {
      const charges = Math.min(effect.max_charges ?? 3, (permanent.stored_charges ?? 0) + 1);
      syncPhysicalCard(state, card.uuid, { stored_charges: charges });
      markEffect(entry, card, `${card.name}：储存 ${charges}/${effect.max_charges ?? 3} 层`);
    }
    if (permanent && action === ACTIONS.DISCARD) {
      const charges = permanent.stored_charges ?? 0;
      const bonus = charges * (effect.bonus_per_charge ?? 0);
      entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
      syncPhysicalCard(state, card.uuid, { stored_charges: 0 });
      markEffect(entry, card, `${card.name}：兑现 ${charges} 层储存，额外 +${bonus}`);
    }
  }

  if (effect.kind === "speed_window_destroy" && action === effect.trigger_action && consumeOncePerRound(state, card, effect)) {
    state.round.speed_threshold_extension_ms = Math.max(
      state.round.speed_threshold_extension_ms ?? 0,
      effect.extension_ms ?? 0,
    );
    const removed = state.deck.length > 1 ? removePermanentCard(state, card.uuid) : null;
    if (removed) entry.destroyed_self = true;
    markEffect(entry, card, `${card.name}：限时金币窗口延长 ${(effect.extension_ms ?? 0) / 1000} 秒${removed ? "，摧毁自身" : ""}`);
  }

  if (effect.kind === "copy_last_fruit_destroy" && action === effect.trigger_action) {
    const fruitAction = [...state.round.actions].reverse().find((previous) => previous.action === ACTIONS.EAT && previous.type === "水果");
    const fruit = fruitAction ? state.deck.find((owned) => owned.uuid === fruitAction.card_uuid) ?? getCardById(fruitAction.card_id) : null;
    if (fruit) {
      const generated = createGeneratedCard(state, card, fruit, {
        weakened: true,
        no_effect: true,
        eat_points: fruit.eat_points,
        discard_points: fruit.discard_points,
      });
      const removed = generated && state.deck.length > 1 ? removePermanentCard(state, card.uuid) : null;
      if (removed) entry.destroyed_self = true;
      markEffect(entry, card, `${card.name}：复制「${fruit.name}」当前牌面并生成【弱化】牌${removed ? "，摧毁自身" : ""}`);
    } else {
      markEffect(entry, card, `${card.name}：本轮尚未吃过水果，未触发复制`);
    }
  }

  if (effect.kind === "fetch_reserve_animal" && action === effect.trigger_action) {
    const candidates = (state.round.reserve_cards ?? []).filter((owned) => owned.type === "动物");
    const fetched = candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
    if (fetched) {
      state.round.reserve_cards = state.round.reserve_cards.filter((owned) => owned.uuid !== fetched.uuid);
      state.round.reserve_count = state.round.reserve_cards.length;
      state.round.reserve_type_counts[fetched.type] = Math.max(0, (state.round.reserve_type_counts[fetched.type] ?? 1) - 1);
      state.round.draw_pile.unshift(fetched);
      state.round.action_budget = safeAdd(state.round.action_budget, 1);
      markEffect(entry, card, `${card.name}：将本轮未进入牌堆的「${fetched.name}」调到牌堆最后`);
    } else {
      markEffect(entry, card, `${card.name}：本轮未进入牌堆的牌中没有动物`);
    }
  }

  if (effect.kind === "imprint_previous_score" && action === effect.trigger_action) {
    const permanent = state.deck.find((owned) => owned.uuid === card.uuid);
    const previous = state.round.actions.at(-1);
    if (permanent && previous && !permanent.imprint_used) {
      const value = Math.max(effect.min ?? 1, Math.min(effect.max ?? 5, previous.points ?? 0));
      entry.effect_bonus = safeAdd(entry.effect_bonus, value - entry.printed_points);
      syncPhysicalCard(state, card.uuid, {
        discard_points: value,
        base_discard_points: value,
        imprint_used: true,
        locked_stats: [...new Set([...(permanent.locked_stats ?? []), "discard_points"])],
        status_keywords: [...new Set([...(permanent.status_keywords ?? []), "锁定"])],
      });
      entry.printed_points = value;
      markEffect(entry, card, `${card.name}：永久铭记上一张行动的 ${value} 分，弃分已锁定`);
    }
  }

  if (effect.kind === "force_weakest_shop_type" && action === effect.trigger_action && consumeOncePerRound(state, card, effect)) {
    const types = [...new Set(createShopCardPool().map((owned) => owned.type))];
    const counts = types.map((type) => ({ type, count: state.deck.filter((owned) => owned.type === type).length }));
    const minimum = Math.min(...counts.map((item) => item.count));
    const choices = counts.filter((item) => item.count === minimum);
    const chosen = choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
    state.round.forced_theme_type = chosen?.type ?? null;
    markEffect(entry, card, `${card.name}：下一间商店的同类货架锁定为「${chosen?.type ?? "随机"}」`);
  }

  if (effect.kind === "gather_unresolved_type" && action === effect.trigger_action) {
    const current = getCurrentCard(state);
    const unresolved = getRemainingCards(state);
    const gathered = unresolved.filter((owned) => owned.type === effect.target_type);
    const others = unresolved.filter((owned) => owned.type !== effect.target_type);
    state.round.draw_pile = [...others, ...gathered, current];
    markEffect(entry, card, `${card.name}：${gathered.length} 张${effect.target_type}被拉到牌堆顶部`);
  }

  if (effect.kind === "recall_tail" && action === effect.trigger_action) {
    if (state.round.draw_pile.length > 2) {
      const current = getCurrentCard(state);
      const unresolved = getRemainingCards(state);
      const tail = unresolved.shift();
      state.round.draw_pile = [...unresolved, tail, current];
      markEffect(entry, card, `${card.name}：末牌「${tail.name}」被调到下一张`);
    }
  }

  if (effect.kind === "destroy_neighbors" && action === effect.trigger_action) {
    let destroyed = 0;
    const names = [];
    const previous = state.round.actions.at(-1);
    if (previous && state.deck.length > 1) {
      const removed = removePermanentCard(state, previous.card_uuid);
      if (removed) { destroyed += 1; names.push(removed.name); }
    }
    const next = getNextCard(state);
    if (next && state.deck.length > 1) {
      const removed = removePermanentCard(state, next.uuid);
      if (removed) {
        destroyed += 1;
        names.push(removed.name);
        state.round.consume_next_uuid = next.uuid;
      }
    }
    const bonus = Math.min(effect.max_bonus ?? 8, destroyed * (effect.bonus_per_card ?? 4));
    entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
    markEffect(entry, card, `${card.name}：摧毁 ${names.join("、") || "0 张牌"}，额外 +${bonus}`);
  }

  if (effect.kind === "nebula_wager" && action === effect.trigger_action) {
    const since = state.round.nebula_unresolved_since?.[card.uuid] ?? 0;
    const waited = Math.max(0, state.round.actions.length - since);
    const bonus = Math.min(effect.max_bonus ?? 5, waited * (effect.bonus_per_action ?? 1));
    entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
    markEffect(entry, card, `${card.name}：遮蔽期间处理 ${waited} 张牌，额外 +${bonus}`);
  }

  if (effect.kind === "postpone_nebula") {
    const bonus = state.round.nebula_postpone_counts?.[card.uuid] ?? 0;
    entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
    if (bonus > 0) markEffect(entry, card, `${card.name}：遮蔽期间处理 ${bonus} 张牌，额外 +${bonus}`);
    if (state.round.nebula_postpone_counts) delete state.round.nebula_postpone_counts[card.uuid];
  }

  if (effect.kind === "scale_by_gold" && action === effect.trigger_action) {
    const bonus = Math.min(effect.max_bonus ?? GAME_CONFIG.max_score,
      Math.max(0, state.gold - (effect.threshold ?? 0)) * (effect.multiplier ?? 1));
    entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
    markEffect(entry, card, `${card.name}：当前 ${state.gold} 金币，额外 +${bonus}`);
  }

  if (["scale_by_reserve_unique_types", "scale_by_pile_unique_types"].includes(effect.kind) && action === effect.trigger_action) {
    const source = effect.kind === "scale_by_pile_unique_types" ? getRemainingCards(state) : (state.round.reserve_cards ?? []);
    const count = new Set(source.map((owned) => owned.type)).size;
    const bonus = Math.min(effect.max_bonus ?? GAME_CONFIG.max_score, count * (effect.multiplier ?? 1));
    entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
    markEffect(entry, card, `${card.name}：牌堆剩余牌有 ${count} 种类别，额外 +${bonus}`);
  }

  if (effect.kind === "scale_by_unique_deck_types" && action === effect.trigger_action) {
    const count = new Set(state.deck.map((owned) => owned.type)).size;
    const bonus = Math.min(effect.max_bonus ?? GAME_CONFIG.max_score, count * (effect.multiplier ?? 1));
    entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
    markEffect(entry, card, `${card.name}：牌库中有 ${count} 种类别，额外 +${bonus}`);
  }

  if (effect.kind === "prime_verdict" && action === effect.trigger_action) {
    state.round.verdicts.push({ card_uuid: card.uuid, card_name: card.name, penalty: effect.penalty ?? 3, success_bonus: effect.success_bonus ?? 5, resolved: false });
    markEffect(entry, card, `${card.name}：判词已蓄势；避开硬吃至轮末可 +${effect.success_bonus ?? 5}`);
  }

  if (effect.kind === "review_next_edibility" && action === effect.trigger_action) {
    const nextCard = getNextCard(state);
    if (!nextCard) {
      markEffect(entry, card, `${card.name}：餐盘中没有下一张牌`);
    } else if (nextCard.edibility === "edible") {
      const bonus = effect.edible_bonus ?? 3;
      addCardScoreBonus(state, nextCard.uuid, bonus);
      markEffect(entry, card, `${card.name}：下一张「${nextCard.name}」可食用，结算额外 +${bonus}`);
    } else {
      const change = changePermanentCard(state, nextCard, "discard_points", -(effect.inedible_discard_loss ?? 1));
      entry.point_changes = [...(entry.point_changes ?? []), { card_name: nextCard.name, stat: "discard_points", amount: change }];
      markEffect(entry, card, `${card.name}：下一张「${nextCard.name}」不可食用，弃点永久 ${change}`);
    }
  }

  if (effect.kind === "schedule_purify" && action === effect.trigger_action && consumeOncePerRound(state, card, effect)) {
    state.pending_round_start_purify = true;
    markEffect(entry, card, `${card.name}：已安排下一轮开场净化`);
  }

  if (effect.kind === "force_shop_price_four" && action === effect.trigger_action && consumeOncePerRound(state, card, effect)) {
    state.round.shop_force_price_four = true;
    state.round.shop_force_price_four_applied = false;
    markEffect(entry, card, `${card.name}：随后商店最贵的卡牌价格将降为 ${effect.price ?? 4}`);
  }

  if (effect.kind === "eat_reroll_or_discard_delete") {
    if (action === ACTIONS.EAT) {
      state.round.shop_free_rerolls = safeAdd(state.round.shop_free_rerolls ?? 0, 1);
      markEffect(entry, card, `${card.name}：随后商店免费刷新 +1`);
    } else if (action === ACTIONS.DISCARD) {
      const removed = state.deck.length > 1 ? removePermanentCard(state, card.uuid) : null;
      if (removed) {
        state.round.shop_free_removals = safeAdd(state.round.shop_free_removals ?? 0, 1);
        entry.destroyed_self = true;
      }
      markEffect(entry, card, removed
        ? `${card.name}：摧毁自身，随后商店免费删除 +1`
        : `${card.name}：最后一张牌不会摧毁，也未获得免费删除`);
    }
  }

  if (effect.kind === "buff_two_marked" && action === effect.trigger_action) {
    const marked = getRemainingCardsInPlayOrder(state)
      .filter((remaining) => isCardPostponed(state, remaining))
      .slice(0, effect.count ?? 2);
    marked.forEach((remaining) => addCardScoreBonus(state, remaining.uuid, effect.bonus ?? 1));
    markEffect(entry, card, `${card.name}：${marked.length} 张已后置牌结算额外 +${effect.bonus ?? 1}`);
  }

  if (effect.kind === "mark_all_protect_decrease" && action === effect.trigger_action) {
    const marked = markRemainingPostponed(state, card.uuid);
    state.round.protected_decrease_uuids = [...new Set([
      ...(state.round.protected_decrease_uuids ?? []),
      ...getRemainingCards(state).map((remaining) => remaining.uuid),
    ])];
    markEffect(entry, card, `${card.name}：剩余 ${marked.length} 张牌已标记后置，本轮牌面不会降低`);
  }

  if (effect.kind === "layaway" && action === effect.trigger_action) {
    state.round.shop_discount = safeAdd(state.round.shop_discount, effect.discount ?? 0);
    state.round.next_purchase_dormant = true;
    markEffect(entry, card, `${card.name}：下间商店卡价 -${effect.discount ?? 0}；首张购入牌下轮休眠`);
  }

  if (effect.kind === "lock_next_stats" && action === effect.trigger_action) {
    state.round.lock_next_stats_charges = safeAdd(state.round.lock_next_stats_charges, effect.charges ?? 1);
    markEffect(entry, card, `${card.name}：下一张处理牌的牌面将被永久锁定`);
  }

  if (effect.kind === "wrong_edibility_bonus" && entry.wrong_edibility) {
    const bonus = effect.bonus ?? 0;
    entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
    markEffect(entry, card, `${card.name}：硬吃成功，额外 +${bonus}`);
  }

  if (effect.kind === "wrong_edibility_streak" && entry.wrong_edibility) {
    const bonus = Math.min(effect.max_bonus ?? GAME_CONFIG.max_score,
      (state.round.wrong_edibility_streak ?? 0) * (effect.bonus_per_streak ?? 0));
    entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
    markEffect(entry, card, `${card.name}：硬吃连击 ×${state.round.wrong_edibility_streak}，额外 +${bonus}`);
  }

  if (effect.kind === "wrong_history_scale" && entry.wrong_edibility) {
    const previousWrong = Math.max(0, (state.round.wrong_edibility_count ?? 0) - 1);
    const bonus = Math.min(effect.max_bonus ?? GAME_CONFIG.max_score, previousWrong * (effect.multiplier ?? 1));
    entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
    markEffect(entry, card, `${card.name}：吞入 ${previousWrong} 次硬吃记录，额外 +${bonus}`);
  }

  if (effect.kind === "wrong_edibility_setup_destroy" && action === effect.trigger_action && entry.wrong_edibility) {
    addBuff(state, { kind: "wrong_edibility_flat", action: "*", remaining: 1, value: effect.bonus ?? 0, source: card.name });
    const removed = state.deck.length > 1 ? removePermanentCard(state, card.uuid) : null;
    if (removed) entry.destroyed_self = true;
    markEffect(entry, card, `${card.name}：下一次硬吃 +${effect.bonus ?? 0}${removed ? "，摧毁自身" : ""}`);
  }

  if (effect.kind === "fruit_combo" && action === ACTIONS.EAT) {
    const comboBefore = state.round.fruit_combo ?? 0;
    const combo = comboBefore + Math.max(1, effect.combo_gain ?? 1);
    state.round.fruit_combo = combo;
    state.round.best_fruit_combo = Math.max(state.round.best_fruit_combo ?? 0, combo);
    let bonus = Math.min(effect.max_bonus ?? GAME_CONFIG.max_score, combo * (effect.bonus_per_combo ?? 1));
    if (comboBefore === 0) bonus = safeAdd(bonus, effect.opener_bonus ?? 0);
    if (combo >= (effect.threshold ?? Number.POSITIVE_INFINITY)) bonus = safeAdd(bonus, effect.threshold_bonus ?? 0);
    if (combo >= (effect.double_at ?? Number.POSITIVE_INFINITY)) bonus = safeMultiply(bonus, 2);
    entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
    entry.fruit_combo = combo;
    entry.effect_log = `${card.name}：水果连击 ×${combo}`;
    if (combo >= (effect.grant_reroll_at ?? Number.POSITIVE_INFINITY)) {
      if ((effect.shop_free_rerolls ?? 0) > 0) {
        const rerolls = Math.max(1, effect.shop_free_rerolls);
        state.round.shop_free_rerolls = safeAdd(state.round.shop_free_rerolls ?? 0, rerolls);
        entry.shop_free_rerolls_gained = rerolls;
      } else {
        const tokens = Math.max(1, effect.reroll_tokens ?? 1);
        state.reroll_tokens = safeAdd(state.reroll_tokens ?? 0, tokens);
        entry.reroll_tokens_gained = tokens;
      }
    }

    const generationReady = combo >= (effect.generate_at ?? Number.POSITIVE_INFINITY);
    if (generationReady && consumeOncePerRound(state, card, effect)) {
      let template = effect.generate_card_id ? getCardById(getBananaGenerationCardId(state, effect.generate_card_id)) : null;
      if (!template && effect.generate_random_type) {
        const candidates = createShopCardPool().filter((candidate) => candidate.type === effect.generate_random_type);
        template = candidates[Math.floor(random() * candidates.length)] ?? null;
      }
      const generated = createGeneratedCard(state, card, template, { weakened: effect.generate_weakened });
      if (generated) entry.generated_card = generated.name;
    }
    if (combo >= (effect.grow_at ?? Number.POSITIVE_INFINITY)) {
      const growth = changePermanentCard(state, card, "eat_points", effect.grow_amount ?? 0);
      if (growth) entry.permanent_change = { stat: "eat_points", amount: growth };
    }
    markEffect(entry, card, `${card.name}：水果连击 ×${combo}，额外 +${bonus}${entry.reroll_tokens_gained ? `，刷新标记 +${entry.reroll_tokens_gained}` : ""}${entry.shop_free_rerolls_gained ? `，商店免费刷新 +${entry.shop_free_rerolls_gained}` : ""}${entry.generated_card ? `，生成「${entry.generated_card}」` : ""}`);
  }

  if (effect.kind === "fruit_combo_resume" && action === ACTIONS.EAT) {
    const current = state.round.fruit_combo ?? 0;
    const canResume = Boolean(state.round.fruit_combo_broken) && consumeOncePerRound(state, card, effect);
    const resumeBase = canResume
      ? Math.max(current, Math.min(effect.max_resume ?? 5, state.round.best_fruit_combo ?? 0))
      : current;
    const combo = resumeBase + Math.max(1, effect.combo_gain ?? 1);
    state.round.fruit_combo = combo;
    state.round.best_fruit_combo = Math.max(state.round.best_fruit_combo ?? 0, combo);
    const bonus = Math.min(effect.max_bonus ?? GAME_CONFIG.max_score, combo * (effect.bonus_per_combo ?? 1));
    entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
    entry.fruit_combo = combo;
    entry.effect_log = `${card.name}：水果连击修复`;
    markEffect(entry, card, canResume
      ? `${card.name}：从本轮最高连击恢复至 ×${combo}，额外 +${bonus}`
      : `${card.name}：水果连击 ×${combo}，额外 +${bonus}`);
  }

  if (effect.kind === "fruit_combo_discard_shield" && action === ACTIONS.EAT) {
    state.round.fruit_combo_discard_shield = true;
    grantFirstDrinkItemGold(state);
    const removed = state.deck.length > 1 ? removePermanentCard(state, card.uuid) : null;
    if (removed) entry.destroyed_self = true;
    markEffect(entry, card, `${card.name}：本轮弃牌不再中断水果连击${removed ? "，摧毁自身" : ""}`);
  }

  if (effect.kind === "fruit_combo_unbreakable" && action === ACTIONS.EAT) {
    state.round.fruit_combo_unbreakable = true;
    grantFirstDrinkItemGold(state);
    const removed = state.deck.length > 1 ? removePermanentCard(state, card.uuid) : null;
    if (removed) entry.destroyed_self = true;
    markEffect(entry, card, `${card.name}：本轮水果连击不会中断${removed ? "，摧毁自身" : ""}`);
  }

  if (["anorexia", "anorexia_postpone_drain"].includes(effect.kind)) {
    if (action === ACTIONS.EAT) {
      const requestedGold = Math.max(0, effect.eat_gold_cost ?? 0);
      const paidGold = Math.min(state.gold, requestedGold);
      const unpaidGold = requestedGold - paidGold;
      if (paidGold > 0) state.gold = safeAdd(state.gold, -paidGold);
      if (requestedGold > 0) {
        const penalty = unpaidGold * Math.max(0, effect.unpaid_score_penalty ?? 0);
        entry.effect_bonus = safeAdd(entry.effect_bonus, -penalty);
        entry.gold_change = -paidGold;
        entry.payment = { requested: requestedGold, paid: paidGold, penalty };
      }
      if (effect.extreme) {
        const removed = state.deck.length > 1 ? removePermanentCard(state, card.uuid) : null;
        markEffect(entry, card, removed ? `${card.name}：极端厌食，摧毁自身` : `${card.name}：最后一张牌不会摧毁`);
      } else {
        const doubled = state.round.double_fast_food_anorexia && effect.kind !== "double_anorexia" ? 2 : 1;
        const eatChange = changePermanentCard(state, card, "eat_points", -(effect.eat_loss ?? 1) * doubled, { min: -5 });
        const discardChange = changePermanentCard(state, card, "discard_points", (effect.discard_gain ?? 1) * doubled, { max: 12 });
        entry.permanent_change = { eat: eatChange, discard: discardChange };
        if (effect.buff_target_type) addBuff(state, {
          kind: "flat", action: ACTIONS.EAT, target_type: effect.buff_target_type,
          remaining: 1, value: effect.buff_add ?? 0, source: card.name,
        });
        const payment = requestedGold > 0
          ? `，支付 ${paidGold}/${requestedGold} 金币${unpaidGold > 0 ? `，缺额罚分 -${unpaidGold * (effect.unpaid_score_penalty ?? 0)}` : ""}`
          : "";
        markEffect(entry, card, `${card.name}：厌食，吃分 ${eatChange} / 弃分 +${discardChange}${payment}`);
      }
    }
    if (action === ACTIONS.DISCARD) {
      const lost = Math.max(0, (card.base_eat_points ?? card.eat_points ?? 0) - (card.eat_points ?? 0));
      const bonus = Math.floor(lost / Math.max(1, effect.discard_conversion_divisor ?? Number.POSITIVE_INFINITY));
      entry.effect_bonus = safeAdd(entry.effect_bonus, Number.isFinite(bonus) ? bonus : 0);
      const discardBonus = effect.discard_bonus ?? 0;
      entry.effect_bonus = safeAdd(entry.effect_bonus, discardBonus);
      if (bonus > 0 || discardBonus > 0) markEffect(entry, card, `${card.name}：厌食转化 +${bonus + discardBonus}`);
    }
  }

  if (effect.kind === "retention") {
    if (action === ACTIONS.DISCARD) {
      const previous = state.round.actions.at(-1);
      let amount = safeAdd(effect.retain ?? 0, state.items
        .filter((item) => item.effect?.kind === "retention_growth_bonus")
        .reduce((sum, item) => safeAdd(sum, item.effect.amount ?? 0), 0));
      if (previous?.type === effect.previous_type) amount = safeAdd(amount, effect.previous_retain_bonus ?? 0);
      if (isCardPostponed(state, card)) {
        amount = safeAdd(amount, effect.postponed_retain_bonus ?? 0);
        if ((effect.postponed_retain_bonus ?? 0) !== 0) {
          state.round.postpone_effect_triggers = safeAdd(state.round.postpone_effect_triggers ?? 0, 1);
        }
      }
      const change = changePermanentCard(state, card, "eat_points", amount, { max: effect.max_eat_points ?? 30 });
      entry.permanent_change = { stat: "eat_points", amount: change };
      markEffect(entry, card, `${card.name}：留存，吃分永久 +${change}`);
    }
    if (action === ACTIONS.EAT && entry.printed_points >= (effect.burst_threshold ?? Number.POSITIVE_INFINITY)) {
      const multiplier = Math.max(1, effect.burst_multiplier ?? 1);
      const burst = safeMultiply(entry.printed_points, multiplier - 1);
      const burstBonus = effect.burst_bonus ?? 0;
      entry.effect_bonus = safeAdd(entry.effect_bonus, safeAdd(burst, burstBonus));
      if ((effect.burst_delete_tokens ?? 0) > 0) {
        state.delete_tokens = safeAdd(state.delete_tokens ?? 0, effect.burst_delete_tokens);
      }
      if ((effect.burst_gold ?? 0) > 0) {
        grantRoundGold(state, entry, card.name, effect.burst_gold);
      }
      state.round.shop_discount = safeAdd(state.round.shop_discount ?? 0, effect.burst_discount ?? 0);
      if (effect.reset_after_eat) {
        const permanentCard = state.deck.find((item) => item.uuid === card.uuid);
        if (permanentCard) resetPermanentCardPoints(state, permanentCard);
      }
      if (effect.destroy_after_burst) {
        const removed = state.deck.length > 1 ? removePermanentCard(state, card.uuid) : null;
        if (removed) entry.destroyed_self = true;
      }
      markEffect(entry, card, `${card.name}：留存爆发 ×${multiplier}${burstBonus ? `，额外 +${burstBonus}` : ""}${effect.burst_delete_tokens ? `，删牌标记 +${effect.burst_delete_tokens}` : ""}${effect.burst_gold ? `，金币 +${effect.burst_gold}` : ""}${effect.burst_discount ? `，商店卡价 -${effect.burst_discount}` : ""}${effect.destroy_after_burst ? "，摧毁自身" : effect.reset_after_eat ? "，牌面重置" : ""}`);
    }
  }

  if (effect.kind === "slow_finish_gold_destroy" && action === effect.trigger_action) {
    state.round.slow_finish_rewards = safeAdd(state.round.slow_finish_rewards ?? 0, 1);
    const removed = state.deck.length > 1 ? removePermanentCard(state, card.uuid) : null;
    if (removed) entry.destroyed_self = true;
    markEffect(entry, card, `${card.name}：慢速结算奖励已记录${removed ? "，摧毁自身" : ""}`);
  }

  if (effect.kind === "copy_pile_dessert_destroy" && action === effect.trigger_action) {
    const desserts = getRemainingCards(state).filter((owned) => owned.type === "甜点");
    const dessert = desserts[Math.min(desserts.length - 1, Math.floor(random() * desserts.length))];
    if (dessert) {
      const generated = createGeneratedCard(state, card, dessert, {
        weakened: true,
        no_effect: true,
        eat_points: dessert.eat_points,
        discard_points: dessert.discard_points,
      });
      const removed = generated && state.deck.length > 1 ? removePermanentCard(state, card.uuid) : null;
      if (removed) entry.destroyed_self = true;
      markEffect(entry, card, `${card.name}：复制牌堆中的「${dessert.name}」并生成无效果【弱化】牌${removed ? "，摧毁自身" : ""}`);
    } else {
      markEffect(entry, card, `${card.name}：牌堆中没有甜点，不摧毁自身`);
    }
  }

  if (effect.kind === "drink_consume" && action === ACTIONS.EAT) {
    if (effect.cleanse_deck) state.deck.forEach((owned) => restoreReducedPermanentCardPoints(state, owned));
    queueRoundGold(state, card.name, effect.gold ?? 0);
    grantFirstDrinkItemGold(state);
    state.round.reshuffle_charges = safeAdd(state.round.reshuffle_charges, effect.reshuffle_charges ?? 0);
    if (effect.buff_add || effect.buff_multiplier) addBuff(state, {
      kind: effect.buff_multiplier ? "multiplier" : "flat",
      action: effect.buff_action ?? "*",
      target_type: effect.buff_target_type,
      remaining: 1,
      value: effect.buff_multiplier ?? effect.buff_add,
      source: card.name,
    });
    if (effect.generate_random_type) {
      const candidates = createShopCardPool().filter((candidate) => candidate.type === effect.generate_random_type);
      const template = candidates[Math.floor(random() * candidates.length)] ?? null;
      const generated = createGeneratedCard(state, card, template, { weakened: effect.generate_weakened });
      if (generated) entry.generated_card = generated.name;
    }
    const removed = state.deck.length > 1 ? removePermanentCard(state, card.uuid) : null;
    markEffect(entry, card, `${card.name}：${removed ? "摧毁自身" : "最后一张牌不会摧毁"}${effect.gold ? `，金币 +${effect.gold}` : ""}${entry.generated_card ? `，生成${effect.generate_weakened ? "【弱化】" : ""}「${entry.generated_card}」` : ""}`);
  }

  if (effect.kind === "generate_random" && action === effect.trigger_action && consumeOncePerRound(state, card, effect)) {
    const candidates = createShopCardPool().filter((candidate) => !effect.target_type || candidate.type === effect.target_type);
    const template = candidates[Math.floor(random() * candidates.length)] ?? null;
    const generated = createGeneratedCard(state, card, template, { weakened: effect.generate_weakened });
    markEffect(entry, card, generated ? `${card.name}：生成${effect.generate_weakened ? "【弱化】" : ""}「${generated.name}」` : `${card.name}：牌组已满`);
  }

  if (effect.kind === "discard_for_gold" && action === effect.trigger_action && consumeOncePerRound(state, card, effect)) {
    const gold = Math.max(0, effect.gold ?? 0);
    grantRoundGold(state, entry, card.name, gold);
    markEffect(entry, card, `${card.name}：牺牲分数，金币立即 +${gold}`);
  }

  if (effect.kind === "generate_by_decay" && action === effect.trigger_action && consumeOncePerRound(state, card, effect)) {
    const template = getCardById(effect.card_id);
    const generated = createGeneratedCard(state, card, template, { weakened: true });
    const decay = changePermanentCard(state, card, effect.decay_stat ?? "discard_points", -(effect.decay ?? 1));
    const permanent = state.deck.find((owned) => owned.uuid === card.uuid);
    const shouldDestroy = permanent && (permanent[effect.decay_stat ?? "discard_points"] ?? 0) <= (effect.destroy_at ?? 0);
    const removed = shouldDestroy && state.deck.length > 1 ? removePermanentCard(state, card.uuid) : null;
    entry.permanent_change = { stat: effect.decay_stat ?? "discard_points", amount: decay };
    if (generated) entry.generated_card = generated.name;
    markEffect(entry, card, `${card.name}：生成【弱化】「${generated?.name ?? "失败"}」，自身弃分 ${decay}${removed ? "，降到 0 并摧毁自身" : ""}`);
  }

  if (effect.kind === "drain_random_to_self" && action === effect.trigger_action && consumeOncePerRound(state, card, effect)) {
    const candidates = state.deck.filter((owned) => owned.uuid !== card.uuid && matchesTarget(effect, owned)
      && (owned[effect.target_stat] ?? 0) > (effect.target_min ?? -GAME_CONFIG.max_score));
    const target = candidates[Math.floor(random() * candidates.length)] ?? null;
    if (target) {
      const drained = -changePermanentCard(state, target, effect.target_stat, -(effect.target_loss ?? 1), { min: effect.target_min });
      const gained = changePermanentCard(state, card, effect.self_stat ?? "discard_points", Math.min(drained, effect.self_gain ?? drained));
      entry.point_changes = [
        { card_name: target.name, stat: effect.target_stat, amount: -drained },
        { card_name: card.name, stat: effect.self_stat ?? "discard_points", amount: gained },
      ];
      entry.permanent_change = { stat: effect.self_stat ?? "discard_points", amount: gained };
      markEffect(entry, card, `${card.name}：${target.name} 吃分 -${drained} → 自身弃分 +${gained}`);
    } else {
      markEffect(entry, card, `${card.name}：没有可降低的可食用牌`);
    }
  }

  if (effect.kind === "drain_pile_edible_to_self" && action === effect.trigger_action) {
    const targets = getRemainingCards(state).filter((owned) => owned.edibility === "edible");
    let changed = 0;
    const pointChanges = [];
    for (const target of targets) {
      const amount = changePermanentCard(state, target, "eat_points", -(effect.target_loss ?? 1));
      if (amount === 0) continue;
      changed += 1;
      pointChanges.push({ card_name: target.name, stat: "eat_points", amount });
    }
    const selfChange = changePermanentCard(state, card, "discard_points", effect.self_gain ?? 2);
    if (selfChange) pointChanges.push({ card_name: card.name, stat: "discard_points", amount: selfChange });
    entry.point_changes = pointChanges;
    entry.permanent_change = { stat: "discard_points", amount: selfChange };
    markEffect(entry, card, `${card.name}：${changed} 张可食用牌吃分永久 -1，自身弃分永久 +${selfChange}`);
  }

  if (effect.kind === "drain_type_to_self" && action === effect.trigger_action && consumeOncePerRound(state, card, effect)) {
    let drainedTotal = 0;
    const pointChanges = [];
    state.deck.filter((owned) => owned.uuid !== card.uuid && matchesTarget(effect, owned)).forEach((owned) => {
      const drained = -changePermanentCard(state, owned, effect.target_stat, -(effect.target_loss ?? 1), { min: effect.target_min });
      if (drained <= 0) return;
      drainedTotal = safeAdd(drainedTotal, drained);
      pointChanges.push({ card_name: owned.name, stat: effect.target_stat, amount: -drained });
    });
    const gained = changePermanentCard(state, card, effect.self_stat ?? "discard_points", Math.min(effect.max_self_gain ?? drainedTotal, drainedTotal));
    if (gained) pointChanges.push({ card_name: card.name, stat: effect.self_stat ?? "discard_points", amount: gained });
    entry.point_changes = pointChanges;
    entry.permanent_change = { stat: effect.self_stat ?? "discard_points", amount: gained };
    markEffect(entry, card, `${card.name}：水果共降低 ${drainedTotal} 点，自身弃分 +${gained}`);
  }

  if (effect.kind === "destroy_self_raise_rarity" && action === effect.trigger_action) {
    const removed = state.deck.length > 1 ? removePermanentCard(state, card.uuid) : null;
    if (removed) {
      state.rare_shop_weight_bonus = Math.max(0, (state.rare_shop_weight_bonus ?? 0) + (effect.rarity_bonus ?? 0.25));
      entry.destroyed_self = true;
    }
    markEffect(entry, card, removed
      ? `${card.name}：摧毁自身，稀有牌商店权重永久 +${Math.round((effect.rarity_bonus ?? 0.25) * 100)}%`
      : `${card.name}：最后一张牌不会摧毁`);
  }

  if (effect.kind === "discard_pay_for_reroll" && action === effect.trigger_action) {
    const paid = Math.min(state.gold, effect.gold_cost ?? 1);
    state.gold = safeAdd(state.gold, -paid);
    state.round.shop_free_rerolls = safeAdd(state.round.shop_free_rerolls ?? 0, effect.rerolls ?? 1);
    entry.gold_change = -paid;
    markEffect(entry, card, `${card.name}：金币 -${paid}，随后商店免费刷新 +${effect.rerolls ?? 1}`);
  }

  if (effect.kind === "swap_remaining_sides" && action === effect.trigger_action) {
    getRemainingCards(state).forEach((remaining) => {
      const eat = remaining.eat_points;
      const discard = remaining.discard_points;
      const protectedFromDecrease = state.round.protected_decrease_uuids?.includes(remaining.uuid);
      remaining.eat_points = protectedFromDecrease ? Math.max(eat, discard) : discard;
      remaining.discard_points = protectedFromDecrease ? Math.max(discard, eat) : eat;
    });
    markEffect(entry, card, `${card.name}：剩余餐盘吃点与弃点互换`);
  }

  if (effect.kind === "celestial_sun" && action === effect.trigger_action) {
    state.round.reshuffle_charges = safeAdd(state.round.reshuffle_charges, effect.charges ?? 1);
    const removed = state.deck.length > 1 ? removePermanentCard(state, card.uuid) : null;
    if (removed) entry.destroyed_self = true;
    markEffect(entry, card, `${card.name}：自动重洗 +${effect.charges ?? 1}${removed ? "，摧毁自身" : ""}`);
  }

  if (effect.kind === "bonus_if_postponed" && action === effect.trigger_action && isCardPostponed(state, card)) {
    entry.effect_bonus = safeAdd(entry.effect_bonus, effect.bonus ?? 0);
    state.round.postpone_effect_triggers = safeAdd(state.round.postpone_effect_triggers ?? 0, 1);
    markEffect(entry, card, `${card.name}：后置兑现 +${effect.bonus ?? 0}`);
  }

  if (effect.kind === "purify_one_if_postponed"
    && action === effect.trigger_action
    && isCardPostponed(state, card)) {
    const restored = restoreLargestRandomReduction(state, random);
    state.round.postpone_effect_triggers = safeAdd(state.round.postpone_effect_triggers ?? 0, 1);
    markEffect(entry, card, restored
      ? `${card.name}：净化「${restored.name}」${restored.stat === "eat_points" ? "吃点" : "弃点"}红色降幅 ${restored.amount}`
      : `${card.name}：已触发后置净化，但牌组没有红色降幅`);
  }

  if (effect.kind === "prime_reverse_postpone" && action === effect.trigger_action) {
    state.round.reverse_postpone_charges = 1;
    markEffect(entry, card, `${card.name}：下一次后置将餐盘末牌调到当前牌位`);
  }

  if (effect.kind === "prime_postpone_score" && action === effect.trigger_action) {
    const remaining = Math.max(0, 2 - (state.round.postpone_score_awarded ?? 0));
    state.round.postpone_score_charges = Math.max(state.round.postpone_score_charges ?? 0, remaining);
    markEffect(entry, card, `${card.name}：接下来 ${remaining} 次后置各 +1 分`);
  }

  if (effect.kind === "pause_timer" && action === effect.trigger_action) {
    state.round.timer_paused = true;
    markEffect(entry, card, `${card.name}：本轮计时冻结`);
  }

  if (effect.kind === "delay_milestone_destroy" && action === effect.trigger_action) {
    const baseRounds = Object.keys(GAME_CONFIG.milestone_targets).map(Number).sort((a, b) => a - b);
    const milestone = baseRounds.find((round) => round + (state.milestone_delays?.[round] ?? 0) >= state.current_round);
    if (milestone) {
      state.milestone_delays ??= {};
      state.milestone_delays[milestone] = safeAdd(state.milestone_delays[milestone] ?? 0, effect.delay ?? 1);
    }
    const removed = state.deck.length > 1 ? removePermanentCard(state, card.uuid) : null;
    if (removed) entry.destroyed_self = true;
    markEffect(entry, card, `${card.name}：第 ${milestone ?? "末"} 轮目标结算延后 ${effect.delay ?? 1} 轮${removed ? "，摧毁自身" : ""}`);
  }

  if (effect.kind === "buff_marked_remaining" && action === effect.trigger_action) {
    const marked = getRemainingCards(state)
      .filter((remaining) => isCardPostponed(state, remaining));
    marked.forEach((remaining) => addCardScoreBonus(state, remaining.uuid, effect.bonus ?? 2));
    markEffect(entry, card, `${card.name}：${marked.length} 张已后置牌本轮结算 +${effect.bonus ?? 2}`);
  }

  if (effect.kind === "destroy_marked_remaining" && action === effect.trigger_action) {
    const target = getRemainingCardsInPlayOrder(state)
      .find((remaining) => isCardPostponed(state, remaining));
    const removed = target && state.deck.length > 1 ? removePermanentCard(state, target.uuid) : null;
    if (removed) removeRoundCard(state, removed.uuid);
    markEffect(entry, card, removed ? `${card.name}：摧毁已后置牌「${removed.name}」` : `${card.name}：牌堆中没有可摧毁的已后置牌`);
  }

  if (effect.kind === "bank_interest" && action === effect.trigger_action && consumeOncePerRound(state, card, effect)) {
    const gold = Math.min(effect.max_gold ?? GAME_CONFIG.max_score, Math.floor(state.gold / Math.max(1, effect.divisor ?? 10)));
    queueRoundGold(state, card.name, gold);
    markEffect(entry, card, `${card.name}：存款利息 +${gold} 金币`);
  }

  if (effect.kind === "purify_deck" && action === effect.trigger_action) {
    const restored = state.deck.reduce((sum, owned) => safeAdd(sum, restoreReducedPermanentCardPoints(state, owned)), 0);
    markEffect(entry, card, `${card.name}：恢复 ${restored} 点红色降幅，绿色成长保留`);
  }

  if (effect.kind === "buff_deck_points" && action === effect.trigger_action && consumeOncePerRound(state, card, effect)) {
    let changed = 0;
    state.deck.filter((owned) => matchesTarget(effect, owned)).forEach((owned) => {
      changed += changePermanentCard(state, owned, effect.stat ?? "eat_points", effect.amount ?? 0) !== 0 ? 1 : 0;
    });
    markEffect(entry, card, `${card.name}：${changed} 张牌永久 +${effect.amount ?? 0}`);
  }

  if (effect.kind === "buff_next_action" && (effect.trigger_action === "*" || effect.trigger_action === action)) {
    const previous = state.round.actions.at(-1);
    const required = effect.requires_previous;
    if (required && (!previous || !matchesTarget(required, previous) || (required.action && previous.action !== required.action))) return;
    if (!consumeOncePerRound(state, card, effect)) return;
    addBuff(state, {
      kind: effect.modifier === "flat" ? "flat" : "multiplier",
      action: effect.action,
      target_type: effect.target_type,
      target_edibility: effect.target_edibility,
      remaining: effect.count,
      value: effect.modifier === "flat" ? effect.add : effect.multiplier,
      source: card.name,
    });
    markEffect(entry, card);
  }

  if (effect.kind === "buff_next_unique_types" && action === effect.trigger_action) {
    addBuff(state, {
      kind: "unique_flat",
      action: effect.action ?? "*",
      target_edibility: effect.target_edibility,
      remaining: effect.count ?? 1,
      seen_types: [],
      value: effect.add ?? 0,
      source: card.name,
    });
    markEffect(entry, card, `${card.name}：多类别蓄势已启动`);
  }

  if (effect.kind === "grant_best_side_next" && action === effect.trigger_action) {
    addBuff(state, { kind: "best_side", action: "*", remaining: 1, source: card.name });
    markEffect(entry, card, `${card.name}：后一张改用较高牌面分`);
  }

  if (effect.kind === "grant_opposite_side_next" && action === effect.trigger_action) {
    addBuff(state, { kind: "opposite_side", action: "*", remaining: 1, source: card.name });
    markEffect(entry, card, `${card.name}：后一张改用另一侧牌面分`);
  }

  if (effect.kind === "wager_next_action" && action === effect.trigger_action) {
    addBuff(state, {
      kind: "wager",
      action: "*",
      remaining: 1,
      multiplier: effect.multiplier ?? 1,
      failure_penalty: effect.failure_penalty ?? 0,
      source: card.name,
    });
    markEffect(entry, card, `${card.name}：后一张赌注已启动`);
  }

  if (effect.kind === "force_next_action_reward" && action === effect.trigger_action) {
    addBuff(state, {
      kind: "choice",
      action: "*",
      remaining: 1,
      good_action: effect.good_action,
      good_bonus: effect.good_bonus,
      bad_action: effect.bad_action,
      bad_penalty: effect.bad_penalty,
      source: card.name,
    });
    markEffect(entry, card, `${card.name}：后一张抉择已启动`);
  }

  if (effect.kind === "store_or_cashout") {
    const permanentCard = state.deck.find((item) => item.uuid === card.uuid);
    if (action === effect.store_action && permanentCard) {
      permanentCard.stored_score = Math.min(effect.max_stored ?? GAME_CONFIG.max_score, (permanentCard.stored_score ?? 0) + (effect.amount ?? 0));
      card.stored_score = permanentCard.stored_score;
      markEffect(entry, card, `${card.name}：储存 ${permanentCard.stored_score}/${effect.max_stored}`);
    }
    if (action === effect.cashout_action && permanentCard) {
      const stored = permanentCard.stored_score ?? 0;
      entry.effect_bonus = safeAdd(entry.effect_bonus, stored);
      permanentCard.stored_score = 0;
      card.stored_score = 0;
      if (stored > 0) {
        entry.effect_log = `${card.name}：储存兑现`;
        markEffect(entry, card, `${card.name}：兑现 +${stored}`);
      }
    }
  }

  if (effect.kind === "debuff_next_action" && action === ACTIONS.EAT) {
    addBuff(state, {
      kind: "flat",
      action: effect.action ?? "*",
      target_type: effect.target_type,
      target_edibility: effect.target_edibility,
      remaining: effect.count,
      value: effect.amount,
      source: card.name,
    });
    markEffect(entry, card);
  }

  if (effect.kind === "debuff_until_action" && action === effect.trigger_action) {
    addBuff(state, {
      kind: "until_action",
      action: effect.action ?? "*",
      target_type: effect.target_type,
      target_edibility: effect.target_edibility,
      stop_action: effect.stop_action,
      remaining: 1,
      value: effect.amount ?? 0,
      source: card.name,
    });
    markEffect(entry, card, `${card.name}：持续负面蓄势已启动`);
  }

  if (effect.kind === "clear_debuff" && action === ACTIONS.EAT) {
    state.round.buffs = state.round.buffs.filter((buff) => buff.kind !== "flat" || buff.value >= 0);
    markEffect(entry, card);
  }

  if (effect.kind === "permanent_growth_eat" && action === ACTIONS.EAT) {
    growPermanentCard(state, card, "eat_points", effect.amount ?? 0);
    markEffect(entry, card, `${card.name} 永久成长 +${effect.amount ?? 0}`);
  }

  if (effect.kind === "permanent_growth_condition" && action === effect.trigger_action) {
    const permanentCard = state.deck.find((item) => item.uuid === card.uuid);
    let qualifies = false;
    if (effect.condition === "reshuffled") qualifies = state.round.reshuffle_count > 0;
    if (effect.condition === "position") qualifies = matchesPosition(state, effect.position);
    if (effect.condition === "every_n_uses" && permanentCard) {
      permanentCard.growth_uses = (permanentCard.growth_uses ?? 0) + 1;
      card.growth_uses = permanentCard.growth_uses;
      qualifies = permanentCard.growth_uses % Math.max(1, effect.every ?? 1) === 0;
    }
    if (qualifies) {
      const stat = effect.grow_stat ?? "eat_points";
      const growth = growPermanentCard(state, card, stat, effect.amount ?? 0);
      markEffect(entry, card, `${card.name}：${stat === "eat_points" ? "吃分" : "弃分"}成长 +${growth}`);
    } else if (effect.condition === "every_n_uses") {
      markEffect(entry, card, `${card.name}：成长进度 ${permanentCard?.growth_uses ?? 0}/${effect.every}`);
    }
  }

  if (effect.kind === "gold_economy") {
    if (action === ACTIONS.DISCARD && consumeOncePerRound(state, card, effect)) {
      queueRoundGold(state, card.name, effect.discard_add_gold ?? 0);
      markEffect(entry, card, `${card.name}：结算金币 +${effect.discard_add_gold ?? 0}`);
    }
    if (action === ACTIONS.EAT) {
      grantRoundGold(state, entry, card.name, effect.eat_destroy_add_gold ?? 0);
      removePermanentCard(state, card.uuid);
      markEffect(entry, card, `${card.name}：金币 +${effect.eat_destroy_add_gold ?? 0}，摧毁自身`);
    }
  }

  if (effect.kind === "shop_discount"
    && action === (effect.trigger_action ?? ACTIONS.DISCARD)
    && consumeOncePerRound(state, card, effect)) {
    state.round.shop_discount = safeAdd(state.round.shop_discount, effect.discount ?? 0);
    markEffect(entry, card, `${card.name}：商店价格 -${effect.discount ?? 0}`);
  }

  if (effect.kind === "buff_remaining_type"
    && action === effect.trigger_action
    && consumeOncePerRound(state, card, effect)) {
    addBuff(state, {
      kind: "flat",
      action: effect.action,
      target_type: effect.target_type,
      value: effect.add ?? 0,
      remaining: GAME_CONFIG.max_actions_per_round,
    });
    markEffect(entry, card, `${card.name}：本轮后续${effect.target_type}吃分 +${effect.add ?? 0}`);
  }

  if (effect.kind === "gold_from_deck_type"
    && action === effect.trigger_action
    && consumeOncePerRound(state, card, effect)) {
    const count = state.deck.filter((owned) => owned.type === effect.target_type).length;
    const gold = Math.min(effect.max_gold ?? GAME_CONFIG.max_score, Math.floor(count / effect.divisor) * (effect.gold ?? 0));
    queueRoundGold(state, card.name, gold);
    markEffect(entry, card, `${card.name}：${count} 张${effect.target_type}，结算金币 +${gold}`);
  }

  if (effect.kind === "gold_from_reserve"
    && action === effect.trigger_action
    && consumeOncePerRound(state, card, effect)) {
    const reserve = state.round.reserve_count ?? 0;
    const gold = reserve > 0 ? Math.min(effect.max_gold ?? 1, 1 + Math.floor((reserve - 1) / (effect.step ?? 4))) : 0;
    queueRoundGold(state, card.name, gold);
    markEffect(entry, card, reserve > 0 ? `${card.name}：${reserve} 张未登场牌，结算金币 +${gold}` : `${card.name}：没有未登场牌`);
  }

  if (effect.kind === "dynamic_shop_discount"
    && action === effect.trigger_action
    && consumeOncePerRound(state, card, effect)) {
    const processedTypes = new Set([...state.round.actions.map((item) => item.type), card.type]);
    const discount = Math.min(
      effect.max_discount ?? GAME_CONFIG.max_shop_discount ?? GAME_CONFIG.max_score,
      Math.floor(processedTypes.size / Math.max(1, effect.divisor ?? 1)),
    );
    state.round.shop_discount = safeAdd(state.round.shop_discount, discount);
    markEffect(entry, card, `${card.name}：${processedTypes.size} 类，商店价格 -${discount}`);
  }

  if (effect.kind === "scale_by_history" && action === effect.trigger_action) {
    const history = sequenceFor(state, effect.history_action);
    const count = history.filter((item) => {
      const typeMatches = !effect.target_type || item.type === effect.target_type;
      const edibilityMatches = !effect.target_edibility || item.edibility === effect.target_edibility;
      return typeMatches && edibilityMatches;
    }).length;
    const bonus = Math.min(effect.max_bonus ?? GAME_CONFIG.max_score, safeMultiply(count, effect.multiplier ?? 0));
    entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
    if (bonus > 0) {
      entry.effect_log = `${card.name}：历史加成`;
      markEffect(entry, card, `${card.name}：历史加成 +${bonus}`);
    }
  }

  if (effect.kind === "scale_by_unique_history" && action === effect.trigger_action) {
    const history = sequenceFor(state, effect.history_action);
    const uniqueCards = new Set(history.filter((item) => matchesTarget(effect, item)).map((item) => item.card_id));
    const bonus = Math.min(effect.max_bonus ?? GAME_CONFIG.max_score, uniqueCards.size * (effect.multiplier ?? 0));
    entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
    if (bonus > 0) {
      entry.effect_log = `${card.name}：不同卡名追溯`;
      markEffect(entry, card, `${card.name}：追溯 ${uniqueCards.size} 种，+${bonus}`);
    }
  }

  if (effect.kind === "scale_by_negative_history" && action === effect.trigger_action) {
    const history = sequenceFor(state, effect.history_action);
    const count = history.filter((item) => item.points < 0).length;
    const bonus = Math.min(effect.max_bonus ?? GAME_CONFIG.max_score, count * (effect.multiplier ?? 0));
    entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
    if (bonus > 0) {
      entry.effect_log = `${card.name}：负分行动追溯`;
      markEffect(entry, card, `${card.name}：追溯 ${count} 张负分牌，+${bonus}`);
    }
  }

  if (effect.kind === "gold_from_history"
    && action === effect.trigger_action
    && consumeOncePerRound(state, card, effect)) {
    const history = sequenceFor(state, effect.history_action);
    const count = history.filter((item) => matchesTarget(effect, item)).length;
    const gold = Math.min(
      effect.max_gold ?? GAME_CONFIG.max_score,
      Math.floor(count / Math.max(1, effect.divisor ?? 1)) * (effect.gold ?? 0),
    );
    queueRoundGold(state, card.name, gold);
    markEffect(entry, card, `${card.name}：追溯 ${count} 张，结算金币 +${gold}`);
  }

  if (effect.kind === "streak_scale" && action === effect.trigger_action) {
    let streak = 0;
    for (let index = state.round.actions.length - 1; index >= 0; index -= 1) {
      const previous = state.round.actions[index];
      if (previous.action !== effect.history_action || !matchesTarget(effect, previous)) break;
      streak += 1;
    }
    const bonus = Math.min(effect.max_bonus ?? GAME_CONFIG.max_score, streak * (effect.multiplier ?? 0));
    entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
    if (bonus > 0) {
      entry.effect_log = `${card.name}：连续行动追溯`;
      markEffect(entry, card, `${card.name}：连续 ${streak} 张，+${bonus}`);
    }
  }

  if (effect.kind === "retro_multiplier_eaten_tag" && action === (effect.trigger_action ?? ACTIONS.EAT)) {
    const priorScore = state.round.eat_sequence
      .filter((item) => !effect.target_type || item.type === effect.target_type)
      .reduce((sum, item) => sum + item.points, 0);
    entry.effect_bonus = safeAdd(entry.effect_bonus, safeMultiply(priorScore, (effect.multiplier ?? 1) - 1));
    if (priorScore !== 0) {
      entry.effect_log = `${card.name}：追溯加成`;
      markEffect(entry, card, `${card.name}：追溯 +${entry.effect_bonus}`);
    }
  }

  if (effect.kind === "bonus_if_previous" && action === (effect.trigger_action ?? ACTIONS.EAT)) {
    const history = effect.sequence === "discard"
      ? state.round.discard_sequence
      : effect.sequence === "actions"
        ? state.round.actions
        : state.round.eat_sequence;
    const previous = history.at(-1);
    const matches = previous
      && matchesTarget(effect, previous)
      && (!effect.previous_action || previous.action === effect.previous_action)
      && (!effect.previous_negative || previous.points < 0)
      && (!effect.previous_positive || previous.points > 0);
    if (matches) {
      entry.effect_bonus = safeAdd(entry.effect_bonus, effect.bonus ?? 0);
      entry.effect_log = `${card.name}：顺序加成`;
      markEffect(entry, card, `${card.name}：顺序正确 +${effect.bonus ?? 0}`);
    }
  }

  if (effect.kind === "bonus_if_action_streak" && action === effect.trigger_action) {
    let streak = 0;
    for (let index = state.round.actions.length - 1; index >= 0; index -= 1) {
      if (state.round.actions[index].action !== effect.history_action) break;
      streak += 1;
    }
    if (streak >= (effect.count ?? 1)) {
      entry.effect_bonus = safeAdd(entry.effect_bonus, effect.bonus ?? 0);
      entry.effect_log = `${card.name}：行动节奏`;
      markEffect(entry, card, `${card.name}：连续 ${streak} 次${effect.history_action === ACTIONS.EAT ? "吃" : "弃"}，+${effect.bonus ?? 0}`);
    }
  }

  if (effect.kind === "bonus_if_position" && action === effect.trigger_action) {
    const positioned = matchesPosition(state, effect.position);
    if (positioned) {
      entry.effect_bonus = safeAdd(entry.effect_bonus, effect.bonus ?? 0);
      entry.effect_log = `${card.name}：位置加成`;
      markEffect(entry, card, `${card.name}：位置正确 +${effect.bonus ?? 0}`);
    }
  }

  if (effect.kind === "bonus_if_action_number" && action === effect.trigger_action) {
    const actionNumber = state.round.actions.length + 1;
    const positioned = effect.number !== undefined
      ? actionNumber === effect.number
      : effect.parity === "even"
        ? actionNumber % 2 === 0
        : actionNumber % 2 === 1;
    if (positioned) {
      entry.effect_bonus = safeAdd(entry.effect_bonus, effect.bonus ?? 0);
      entry.effect_log = `${card.name}：行动位次`;
      markEffect(entry, card, `${card.name}：第 ${actionNumber} 位 +${effect.bonus ?? 0}`);
    }
  }

  if (effect.kind === "bonus_if_position_previous" && action === effect.trigger_action) {
    const previous = state.round.actions.at(-1);
    if (matchesPosition(state, effect.position) && previous && matchesTarget(effect, previous)) {
      entry.effect_bonus = safeAdd(entry.effect_bonus, effect.bonus ?? 0);
      entry.effect_log = `${card.name}：位置与相邻`;
      markEffect(entry, card, `${card.name}：位置与前位同时满足 +${effect.bonus ?? 0}`);
    }
  }

  if (effect.kind === "position_tradeoff" && action === effect.trigger_action) {
    const positioned = matchesPosition(state, effect.position);
    const adjustment = positioned ? (effect.bonus ?? 0) : (effect.penalty ?? 0);
    entry.effect_bonus = safeAdd(entry.effect_bonus, adjustment);
    entry.effect_log = `${card.name}：位置${positioned ? "奖励" : "惩罚"}`;
    markEffect(entry, card, `${card.name}：位置${positioned ? "正确" : "错误"} ${adjustment >= 0 ? "+" : ""}${adjustment}`);
  }

  if (effect.kind === "bonus_if_next" && action === effect.trigger_action) {
    const next = getNextCard(state);
    if (next && matchesTarget(effect, next)) {
      entry.effect_bonus = safeAdd(entry.effect_bonus, effect.bonus ?? 0);
      entry.effect_log = `${card.name}：下一张加成`;
      markEffect(entry, card, `${card.name}：下一张位置正确 +${effect.bonus ?? 0}`);
    }
  }

  if (effect.kind === "bonus_if_different_previous" && action === effect.trigger_action) {
    const previous = state.round.actions.at(-1);
    if (previous && previous.type !== card.type) {
      entry.effect_bonus = safeAdd(entry.effect_bonus, effect.bonus ?? 0);
      entry.effect_log = `${card.name}：异类前位`;
      markEffect(entry, card, `${card.name}：前位类别不同 +${effect.bonus ?? 0}`);
    }
  }

  if (effect.kind === "bonus_if_previous_score" && action === effect.trigger_action) {
    const previous = state.round.actions.at(-1);
    if (previous && matchesTarget(effect, previous) && previous.points >= (effect.minimum_score ?? 0)) {
      entry.effect_bonus = safeAdd(entry.effect_bonus, effect.bonus ?? 0);
      entry.effect_log = `${card.name}：前位高分`;
      markEffect(entry, card, `${card.name}：前位 ${previous.points} 分，+${effect.bonus ?? 0}`);
    }
  }

  if (effect.kind === "bonus_from_next_base" && action === effect.trigger_action) {
    const next = getNextCard(state);
    if (next) {
      const copied = Math.min(effect.max_bonus ?? GAME_CONFIG.max_score, Math.max(0, next.eat_points ?? 0, next.discard_points ?? 0));
      entry.effect_bonus = safeAdd(entry.effect_bonus, copied);
      if (copied > 0) {
        entry.effect_log = `${card.name}：复制后位牌面`;
        markEffect(entry, card, `${card.name}：复制后一张牌面 +${copied}`);
      }
    }
  }

  if (effect.kind === "copy_previous_score" && action === effect.trigger_action) {
    const copiedScore = Math.max(0, state.round.actions.at(-1)?.points ?? 0);
    if (copiedScore > 0) {
      entry.effect_bonus = safeAdd(entry.effect_bonus, copiedScore);
      entry.effect_log = `${card.name}：复制得分`;
      markEffect(entry, card, `${card.name}：复制 +${copiedScore}`);
    }
  }

  if (effect.kind === "copy_previous_score_capped" && action === effect.trigger_action) {
    const previous = state.round.actions.at(-1);
    if (previous && matchesTarget(effect, previous)) {
      const copiedScore = Math.min(effect.max_bonus ?? GAME_CONFIG.max_score, Math.max(0, previous.points ?? 0));
      entry.effect_bonus = safeAdd(entry.effect_bonus, copiedScore);
      if (copiedScore > 0) {
        entry.effect_log = `${card.name}：复制前位得分`;
        markEffect(entry, card, `${card.name}：复制「${previous.name}」+${copiedScore}`);
      }
    }
  }

  if (effect.kind === "bonus_if_generated" && action === effect.trigger_action && card.generated_from === effect.generated_from) {
    entry.effect_bonus = safeAdd(entry.effect_bonus, effect.bonus ?? 0);
    entry.effect_log = `${card.name}：生成来源加成`;
    markEffect(entry, card, `${card.name}：由指定来源生成 +${effect.bonus ?? 0}`);
  }

  if (effect.kind === "discard_all_remaining" && action === effect.trigger_action) {
    state.round.force_discard_remaining = true;
    if (effect.final_multiplier) {
      state.round.final_multipliers.push({ name: card.name, multiplier: effect.final_multiplier });
    }
    markEffect(entry, card);
  }

  if (effect.kind === "bonus_if_neighbors" && action === effect.trigger_action) {
    const previous = state.round.actions.at(-1);
    const next = getNextCard(state);
    const previousMatches = previous && matchesTarget(effect, previous);
    const nextMatches = next && matchesTarget(effect, next);
    if (previousMatches && nextMatches) {
      entry.effect_bonus = safeAdd(entry.effect_bonus, effect.bonus ?? 0);
      entry.effect_log = `${card.name}：相邻加成`;
      markEffect(entry, card, `${card.name}：前后相邻 +${effect.bonus ?? 0}`);
    }
  }

  if (effect.kind === "bonus_if_exactly_one_neighbor" && action === effect.trigger_action) {
    const previous = state.round.actions.at(-1);
    const next = getNextCard(state);
    const matches = Number(Boolean(previous && matchesTarget(effect, previous)))
      + Number(Boolean(next && matchesTarget(effect, next)));
    if (matches === 1) {
      entry.effect_bonus = safeAdd(entry.effect_bonus, effect.bonus ?? 0);
      entry.effect_log = `${card.name}：单侧相邻`;
      markEffect(entry, card, `${card.name}：恰好一侧满足 +${effect.bonus ?? 0}`);
    }
  }

  if (effect.kind === "bonus_if_neighbor_pair" && action === effect.trigger_action) {
    const previous = state.round.actions.at(-1);
    const next = getNextCard(state);
    const ordered = previous?.type === effect.left_type && next?.type === effect.right_type;
    const reversed = effect.unordered && previous?.type === effect.right_type && next?.type === effect.left_type;
    if (ordered || reversed) {
      entry.effect_bonus = safeAdd(entry.effect_bonus, effect.bonus ?? 0);
      entry.effect_log = `${card.name}：异类夹心`;
      markEffect(entry, card, `${card.name}：相邻组合成立 +${effect.bonus ?? 0}`);
    }
  }

  if (effect.kind === "bonus_if_matching_neighbors" && action === effect.trigger_action) {
    const previous = state.round.actions.at(-1);
    const next = getNextCard(state);
    if (previous && next && previous.type === next.type) {
      entry.effect_bonus = safeAdd(entry.effect_bonus, effect.bonus ?? 0);
      entry.effect_log = `${card.name}：同类夹心`;
      markEffect(entry, card, `${card.name}：前后同类 +${effect.bonus ?? 0}`);
    }
  }

  if (effect.kind === "bonus_if_neighbor_types_different" && action === effect.trigger_action) {
    const previous = state.round.actions.at(-1);
    const next = getNextCard(state);
    if (previous && next && previous.type !== next.type) {
      entry.effect_bonus = safeAdd(entry.effect_bonus, effect.bonus ?? 0);
      entry.effect_log = `${card.name}：异类夹心`;
      markEffect(entry, card, `${card.name}：前后类别不同 +${effect.bonus ?? 0}`);
    }
  }

  if (effect.kind === "bonus_if_mixed_neighbors" && action === effect.trigger_action) {
    const previous = state.round.actions.at(-1);
    const next = getNextCard(state);
    const matches = Number(Boolean(previous && matchesTarget(effect, previous)))
      + Number(Boolean(next && matchesTarget(effect, next)));
    if (previous && next && matches === 1) {
      entry.effect_bonus = safeAdd(entry.effect_bonus, effect.bonus ?? 0);
      entry.effect_log = `${card.name}：混合夹心`;
      markEffect(entry, card, `${card.name}：恰好一侧为目标类别 +${effect.bonus ?? 0}`);
    }
  }

  if (effect.kind === "scale_by_deck" && action === effect.trigger_action) {
    const count = state.deck.filter((owned) => matchesTarget(effect, owned)).length;
    const rawBonus = safeMultiply(Math.floor(count / Math.max(1, effect.divisor ?? 1)), effect.multiplier ?? 1);
    const bonus = Math.min(effect.max_bonus ?? GAME_CONFIG.max_score, rawBonus);
    entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
    if (bonus !== 0) {
      entry.effect_log = `${card.name}：牌组规模加成`;
      markEffect(entry, card, `${card.name}：牌组规模 +${bonus}`);
    }
  }

  if (effect.kind === "bonus_if_type_majority" && action === effect.trigger_action) {
    const count = state.deck.filter((owned) => matchesTarget(effect, owned)).length;
    const required = Math.ceil(state.deck.length * (effect.ratio ?? 0.5));
    if (count >= required) {
      entry.effect_bonus = safeAdd(entry.effect_bonus, effect.bonus ?? 0);
      entry.effect_log = `${card.name}：牌组类别占比`;
      markEffect(entry, card, `${card.name}：${count}/${state.deck.length} 张满足，+${effect.bonus ?? 0}`);
    }
  }

  if (effect.kind === "rabbit_formation" && action === effect.trigger_action) {
    const rabbits = state.deck.filter((item) => item.id === effect.rabbit_id).length;
    const pairs = Math.floor(rabbits / 2);
    const bonus = Math.min(effect.max_bonus ?? GAME_CONFIG.max_score, pairs * (effect.pair_bonus ?? 0));
    entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
    markEffect(entry, card, `${card.name}：${rabbits} 只兔子组成 ${pairs} 对，+${bonus}`);
  }

  if (effect.kind === "scale_by_unique_deck" && action === effect.trigger_action) {
    const uniqueCards = new Set(state.deck.filter((owned) => matchesTarget(effect, owned)).map((owned) => owned.id));
    const bonus = Math.min(effect.max_bonus ?? GAME_CONFIG.max_score, uniqueCards.size * (effect.multiplier ?? 1));
    entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
    if (bonus > 0) {
      entry.effect_log = `${card.name}：牌组多样性`;
      markEffect(entry, card, `${card.name}：${uniqueCards.size} 种不同卡名 +${bonus}`);
    }
  }

  if (effect.kind === "scale_by_remaining" && action === effect.trigger_action) {
    const remaining = getRemainingCards(state).filter((owned) => matchesTarget(effect, owned)).length;
    const bonus = Math.min(effect.max_bonus ?? GAME_CONFIG.max_score, remaining * (effect.multiplier ?? 1));
    entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
    if (bonus > 0) {
      entry.effect_log = `${card.name}：未处理牌预判`;
      markEffect(entry, card, `${card.name}：预判 ${remaining} 张，+${bonus}`);
    }
  }

  if (effect.kind === "generate_card" && action === effect.trigger_action) {
    const previous = state.round.actions.at(-1);
    const next = getNextCard(state);
    const previousMatches = !effect.requires_previous || (
      previous
      && matchesTarget(effect.requires_previous, previous)
      && (!effect.requires_previous.action || previous.action === effect.requires_previous.action)
    );
    const nextMatches = !effect.requires_next || (next && matchesTarget(effect.requires_next, next));
    const positionMatches = !effect.condition_position || matchesPosition(state, effect.condition_position);
    if (previousMatches && nextMatches && positionMatches && consumeOncePerRound(state, card, effect)) {
      const generated = getCardById(effect.card_id);
      let generatedCount = 0;
      while (generated
        && generatedCount < (effect.count ?? 1)
        && state.deck.filter((owned) => owned.id === effect.card_id).length < (effect.max_generated_copies ?? GAME_CONFIG.max_deck_size)
        && state.deck.length < GAME_CONFIG.max_deck_size) {
        createGeneratedCard(state, card, generated, { weakened: effect.generate_weakened });
        generatedCount += 1;
      }
      if (generatedCount > 0 && effect.destroy_self) removePermanentCard(state, card.uuid);
      markEffect(entry, card, generatedCount > 0
        ? `${card.name}：生成${effect.generate_weakened ? "【弱化】" : ""}「${generated?.name}」×${generatedCount}${effect.destroy_self ? "，摧毁自身" : ""}`
        : `${card.name}：生成上限已满`);
    }
  }

  if (effect.kind === "destroy_previous_generate" && action === effect.trigger_action && state.deck.length > 1) {
    const previous = state.round.actions.at(-1);
    if (previous && previous.card_uuid !== card.uuid && matchesTarget(effect, previous)) {
      const removed = removePermanentCard(state, previous.card_uuid);
      const generated = getCardById(effect.card_id);
      let generatedCount = 0;
      while (removed && generated && generatedCount < (effect.count ?? 1) && state.deck.length < GAME_CONFIG.max_deck_size) {
        state.round.generated_count = (state.round.generated_count ?? 0) + 1;
        state.deck.push({
          ...generated,
          synergy_tags: [...generated.synergy_tags],
          effect: generated.effect ? { ...generated.effect, keywords: [...(generated.effect.keywords ?? [])] } : null,
          generated_from: card.id,
          uuid: `${generated.id}-converted-${card.uuid}-${state.current_round}-${state.round.generated_count}`,
        });
        generatedCount += 1;
      }
      if (removed) markEffect(entry, card, `${card.name} 摧毁「${removed.name}」，生成「${generated?.name ?? "未知卡"}」×${generatedCount}`);
    }
  }

  if (effect.kind === "destroy_self_buff" && action === effect.trigger_action) {
    addBuff(state, {
      kind: effect.modifier === "flat" ? "flat" : "multiplier",
      action: effect.action ?? "*",
      target_type: effect.target_type,
      target_edibility: effect.target_edibility,
      remaining: effect.count ?? 1,
      value: effect.modifier === "flat" ? effect.add : effect.multiplier,
      source: card.name,
    });
    const removed = state.deck.length > 1 ? removePermanentCard(state, card.uuid) : null;
    markEffect(entry, card, removed
      ? `${card.name}：摧毁自身，蓄势已启动`
      : `${card.name}：最后一张牌不会摧毁，蓄势已启动`);
  }

  if (effect.kind === "destroy_previous_for_gold" && action === effect.trigger_action && state.deck.length > 1) {
    const previous = state.round.actions.at(-1);
    if (previous && previous.card_uuid !== card.uuid && matchesTarget(effect, previous)) {
      const removed = removePermanentCard(state, previous.card_uuid);
      if (removed) {
        const gold = effect.rarity_gold?.[removed.rarity] ?? 0;
        queueRoundGold(state, card.name, gold);
        markEffect(entry, card, `${card.name} 摧毁「${removed.name}」，结算金币 +${gold}`);
      }
    }
  }

  if (effect.kind === "destroy_previous_discount" && action === effect.trigger_action && state.deck.length > 1) {
    const previous = state.round.actions.at(-1);
    if (previous && previous.card_uuid !== card.uuid && matchesTarget(effect, previous)) {
      const removed = removePermanentCard(state, previous.card_uuid);
      if (removed) {
        const discount = effect.rarity_discount?.[removed.rarity] ?? 0;
        state.round.shop_discount = safeAdd(state.round.shop_discount, discount);
        markEffect(entry, card, `${card.name} 摧毁「${removed.name}」，商店价格 -${discount}`);
      }
    }
  }

  if (effect.kind === "consume_previous_card" && action === effect.trigger_action && state.deck.length > 1) {
    const previous = state.round.actions.at(-1);
    if (previous && matchesTarget(effect, previous) && previous.card_uuid !== card.uuid) {
      const removed = removePermanentCard(state, previous.card_uuid);
      if (removed) {
        const preyValue = Math.max(Math.abs(removed.eat_points ?? 0), Math.abs(removed.discard_points ?? 0));
        const itemGrowth = state.items
          .filter((item) => item.effect?.kind === "devour_growth_bonus")
          .reduce((sum, item) => safeAdd(sum, item.effect.amount ?? 0), 0);
        const growth = safeAdd(Math.max(1, Math.min(effect.max_growth ?? 4, preyValue)), itemGrowth);
        const stat = effect.grow_stat === "eat_points" ? "eat_points" : "discard_points";
        growPermanentCard(state, card, stat, growth);
        markEffect(entry, card, `${card.name} 摧毁「${removed.name}」，${stat === "eat_points" ? "吃分" : "弃分"}成长 +${growth}`);
      }
    }
  }

  if (effect.kind === "gain_gold"
    && action === effect.trigger_action
    && consumeOncePerRound(state, card, effect)) {
    grantRoundGold(state, entry, card.name, effect.gold ?? 0);
    markEffect(entry, card, `${card.name}：金币 +${effect.gold ?? 0}`);
  }

  if (effect.kind === "consume_next_card" && action === effect.trigger_action && state.deck.length > 1) {
    const prey = getNextCard(state);
    if (prey && prey.uuid !== card.uuid && matchesTarget(effect, prey)) {
      const removed = removePermanentCard(state, prey.uuid);
      if (removed) {
        const rarityGrowth = { "普通": 1, "罕见": 2, "稀有": 3, "传奇": 5, "诅咒": 0 };
        const preyValue = effect.growth_source === "rarity"
          ? rarityGrowth[removed.rarity] ?? 1
          : effect.growth_source === "eat_points"
            ? Math.abs(removed.eat_points ?? 0)
            : Math.max(Math.abs(removed.eat_points ?? 0), Math.abs(removed.discard_points ?? 0));
        const growth = Math.max(1, Math.min(effect.max_growth ?? 6, preyValue));
        const stat = effect.grow_stat ?? "discard_points";
        growPermanentCard(state, card, stat, growth);
        state.round.consume_next_uuid = prey.uuid;
        markEffect(entry, card, `${card.name} 摧毁「${prey.name}」，${stat === "eat_points" ? "吃分" : "弃分"}成长 +${growth}`);
      }
    }
  }

  if (effect.kind === "destroy_next_for_gold" && action === effect.trigger_action && state.deck.length > 1) {
    const prey = getNextCard(state);
    if (prey && prey.uuid !== card.uuid) {
      const removed = removePermanentCard(state, prey.uuid);
      if (removed) {
        const gold = effect.rarity_gold?.[removed.rarity] ?? 0;
        queueRoundGold(state, card.name, gold);
        state.round.consume_next_uuid = prey.uuid;
        markEffect(entry, card, `${card.name} 摧毁「${removed.name}」，结算金币 +${gold}`);
      }
    }
  }

  if (effect.kind === "shop_free_reroll_destroy" && action === effect.trigger_action) {
    state.round.shop_free_rerolls = safeAdd(state.round.shop_free_rerolls, effect.count ?? 1);
    removePermanentCard(state, card.uuid);
    markEffect(entry, card, `${card.name}：免费刷新 +${effect.count ?? 1}，摧毁自身`);
  }

  if (effect.kind === "gold_on_discard_count" && action === effect.trigger_action) {
    const discardCount = state.round.discard_sequence.length + 1;
    const key = `card:${card.uuid}:${effect.kind}`;
    if (!state.round.effect_trigger_counts[key]) {
      const triggers = Math.min(effect.max_triggers, Math.floor(discardCount / effect.count));
      const gold = safeMultiply(triggers, effect.gold ?? 0);
      state.round.effect_trigger_counts[key] = 1;
      queueRoundGold(state, card.name, gold);
      if (gold > 0) markEffect(entry, card, `${card.name}：回收 ${discardCount} 张，金币 +${gold}`);
    }
  }

  if (effect.kind === "gain_reshuffle_charge_destroy" && action === effect.trigger_action) {
    const effectiveDeckSize = state.deck.some((owned) => owned.uuid === card.uuid)
      ? state.deck.length - 1
      : state.deck.length;
    if (effectiveDeckSize <= effect.max_deck_size) {
      state.round.reshuffle_charges = safeAdd(state.round.reshuffle_charges, effect.count ?? 1);
      removePermanentCard(state, card.uuid);
      markEffect(entry, card, `${card.name}：重洗 +${effect.count ?? 1}，摧毁自身`);
    } else {
      markEffect(entry, card, `${card.name}：摧毁后牌组仍超过 ${effect.max_deck_size} 张，未启动`);
    }
  }

  if (effect.kind === "gain_reshuffle_charge" && action === effect.trigger_action) {
    if (state.deck.length <= effect.max_deck_size && consumeOncePerRound(state, card, effect)) {
      state.round.reshuffle_charges = safeAdd(state.round.reshuffle_charges, effect.count ?? 1);
      markEffect(entry, card, `${card.name}：重洗 +${effect.count ?? 1}，本轮可叠加`);
    } else if (state.deck.length > effect.max_deck_size) {
      markEffect(entry, card, `${card.name}：牌组超过 ${effect.max_deck_size} 张，未启动`);
    }
  }
}

function hasSequence(sequence, rule) {
  let streak = 0;
  for (const item of sequence) {
    streak = matchesTarget(rule, item) ? streak + 1 : 0;
    if (streak >= rule.count) return true;
  }
  return false;
}

export function evaluateRule(state, rule) {
  const eat = state.round.eat_sequence;
  const discard = state.round.discard_sequence;
  const actions = state.round.actions;

  switch (rule.scope) {
    case "flat_bonus": return true;
    case "sequence_eat": return hasSequence(eat, rule);
    case "sequence_discard": return hasSequence(discard, rule);
    case "time_limit": return state.round.elapsed_ms > 0 && state.round.elapsed_ms <= rule.time_limit_ms;
    case "no_eat_type": return !eat.some((item) => item.type === rule.target_type);
    case "no_eat_edibility": return !eat.some((item) => item.edibility === rule.target_edibility);
    case "no_discard_edibility": return !discard.some((item) => item.edibility === rule.target_edibility);
    case "min_discard": return discard.length >= rule.count;
    case "min_eat": return eat.length >= rule.count;
    case "min_eat_target": return eat.filter((item) => matchesTarget(rule, item)).length >= rule.count;
    case "min_discard_target": return discard.filter((item) => matchesTarget(rule, item)).length >= rule.count;
    case "exact_eat_count": return eat.length === rule.count;
    case "equal_eat_discard": return eat.length > 0 && eat.length === discard.length;
    case "balanced_actions": return eat.length > 0 && discard.length > 0 && Math.abs(eat.length - discard.length) <= 1;
    case "max_deck_size": return state.deck.length <= rule.count;
    case "min_deck_size": return state.deck.length >= rule.count;
    case "no_negative_action": return actions.every((item) => item.points >= 0);
    case "min_negative_eat": return eat.filter((item) => item.points < 0).length >= rule.count;
    case "unique_eat_types": return new Set(eat.map((item) => item.type)).size >= rule.count;
    case "unique_discard_types": return new Set(discard.map((item) => item.type)).size >= rule.count;
    case "round_card_score": return actions.reduce((sum, item) => safeAdd(sum, item.points), 0) >= rule.score;
    case "sacrifice_then_score": return actions.some((item, index) => (
      item.action === ACTIONS.EAT
      && item.points < 0
      && actions.slice(index + 1).some((later) => later.points >= rule.score)
    ));
    case "alternating_actions": {
      let streak = actions.length > 0 ? 1 : 0;
      let best = streak;
      for (let index = 1; index < actions.length; index += 1) {
        streak = actions[index].action !== actions[index - 1].action ? streak + 1 : 1;
        best = Math.max(best, streak);
      }
      return best >= rule.count;
    }
    case "action_streak": {
      let streak = 0;
      for (const item of actions) {
        streak = item.action === rule.action ? streak + 1 : 0;
        if (streak >= rule.count) return true;
      }
      return false;
    }
    case "min_reshuffles": return state.round.reshuffle_count >= rule.count;
    case "post_reshuffle_actions": return actions.filter((item) => item.reshuffle_index > 0).length >= rule.count;
    case "post_reshuffle_score": return actions
      .filter((item) => item.reshuffle_index > 0)
      .reduce((sum, item) => safeAdd(sum, item.points), 0) >= rule.score;
    case "repeat_card_actions": {
      const counts = actions.reduce((result, item) => {
        result[item.card_uuid] = (result[item.card_uuid] ?? 0) + 1;
        return result;
      }, {});
      return Math.max(0, ...Object.values(counts)) >= rule.count;
    }
    case "discard_ratio": return discard.length >= Math.max(rule.minimum ?? 0, eat.length * rule.ratio);
    case "no_eat": return eat.length === 0 && discard.length > 0;
    case "max_eat": return eat.length <= rule.count;
    case "min_discard_food": return discard.filter((item) => item.edibility === "edible").length >= rule.count;
    case "min_wrong_edibility": return (state.round.wrong_edibility_count ?? 0) >= rule.count;
    case "last_action": return matchesTarget(rule, actions.at(-1) ?? {}) && actions.at(-1)?.action === rule.action;
    case "first_last_actions": return actions.length >= 2
      && actions[0].action === rule.first_action
      && actions.at(-1).action === rule.last_action;
    case "perfect_sort": return actions.length > 0 && actions.every((item) => (
      (item.edibility === "edible" && item.action === ACTIONS.EAT)
      || (item.edibility === "inedible" && item.action === ACTIONS.DISCARD)
    ));
    case "min_destroyed": return state.round.destroyed_count >= rule.count;
    case "min_generated": return state.round.generated_count >= rule.count;
    case "min_grown": return state.round.grown_count >= rule.count;
    case "min_fruit_combo": return (state.round.best_fruit_combo ?? 0) >= rule.count;
    case "min_postpone": return (state.round.postpone_count ?? 0) >= rule.count;
    case "min_postpone_effect": return (state.round.postpone_effect_triggers ?? 0) >= rule.count;
    case "min_unique_action_types": return new Set(actions.map((item) => item.type)).size >= rule.count;
    case "no_consecutive_type": return actions.length >= 2
      && actions.every((item, index) => index === 0 || item.type !== actions[index - 1].type);
    case "exact_unique_action_types": return new Set(actions.map((item) => item.type)).size === rule.count;
    case "min_keyword_actions": return actions.filter((item) => item.keywords?.includes(rule.keyword)).length >= rule.count;
    case "first_action_negative": return (actions[0]?.points ?? 0) < 0;
    case "last_action_positive": return (actions.at(-1)?.points ?? 0) > 0;
    default: return false;
  }
}

function applyRoundEndCardEffects(state) {
  const messages = [];
  let scoreBonus = 0;

  for (const verdict of state.round.verdicts.filter((candidate) => !candidate.resolved)) {
    verdict.resolved = true;
    verdict.failed = false;
    scoreBonus = safeAdd(scoreBonus, verdict.success_bonus ?? 5);
    messages.push(`${verdict.card_name}：本轮之后没有硬吃，判词兑现 +${verdict.success_bonus ?? 5}`);
  }

  for (const reserveCard of state.round.reserve_cards ?? []) {
    if (reserveCard.effect?.kind !== "reserve_growth") continue;
    const permanent = state.deck.find((owned) => owned.uuid === reserveCard.uuid);
    if (!permanent) continue;
    const currentGrowth = Math.max(0, (permanent[reserveCard.effect.stat] ?? 0)
      - (permanent[reserveCard.effect.stat === "eat_points" ? "base_eat_points" : "base_discard_points"] ?? 0));
    const remaining = Math.max(0, (reserveCard.effect.max_total_growth ?? 4) - currentGrowth);
    const change = changePermanentCard(state, permanent, reserveCard.effect.stat, Math.min(remaining, reserveCard.effect.amount ?? 1));
    if (change > 0) messages.push(`${reserveCard.name}：本轮未进入牌堆，吃分永久 +${change}`);
  }

  for (const permanent of [...state.deck]) {
    if (permanent.effect?.kind !== "round_end_decay") continue;
    const stat = permanent.effect.stat ?? "eat_points";
    const change = changePermanentCard(state, permanent, stat, permanent.effect.amount ?? -1, { min: permanent.effect.min ?? 0 });
    if (change < 0) messages.push(`${permanent.name}：轮末融化，吃分 ${change}`);
  }

  return { score_bonus: scoreBonus, messages };
}

export function createRoundEngine(options = {}) {
  const random = options.random ?? Math.random;

  function recordPostpone(state, card) {
    const effect = card?.effect;
    const messages = [];
    const pointChanges = [];
    let triggered = false;
    const next = () => [...getRoundCardsExcept(state, card.uuid)].reverse().at(0) ?? null;
    const markAll = () => markRemainingPostponed(state, card.uuid);
    const note = (message) => {
      triggered = true;
      messages.push(message);
    };

    if (effect?.kind === "anorexia_postpone_drain") {
      const target = next();
      const targetChange = target ? changePermanentCard(state, target, "eat_points", -1) : 0;
      const selfChange = changePermanentCard(state, card, "eat_points", 2);
      if (targetChange) pointChanges.push({ card_name: target.name, stat: "eat_points", amount: targetChange });
      if (selfChange) pointChanges.push({ card_name: card.name, stat: "eat_points", amount: selfChange });
      note(`${card.name}：${target ? `「${target.name}」吃分 ${targetChange}` : "没有下一张牌"}，自身吃分 +${selfChange}`);
    }

    if (effect?.kind === "postpone_mark_all_trade") {
      const remaining = getRoundCardsExcept(state, card.uuid);
      markAll();
      const eatChange = changePermanentCard(state, card, "eat_points", -remaining.length);
      const discardChange = changePermanentCard(state, card, "discard_points", remaining.length);
      pointChanges.push(
        { card_name: card.name, stat: "eat_points", amount: eatChange },
        { card_name: card.name, stat: "discard_points", amount: discardChange },
      );
      note(`${card.name}：剩余 ${remaining.length} 张牌均标记已后置；吃分 ${eatChange} / 弃分 +${discardChange}`);
    }

    if (effect?.kind === "postpone_destroy_buff_next") {
      const target = next();
      const targetChange = target ? changePermanentCard(state, target, "eat_points", effect.amount ?? 2) : 0;
      const removed = target && state.deck.length > 1 ? removePermanentCard(state, card.uuid) : null;
      if (removed) removeRoundCard(state, card.uuid);
      if (targetChange) pointChanges.push({ card_name: target.name, stat: "eat_points", amount: targetChange });
      note(`${card.name}：${removed ? "摧毁自身；" : ""}${target ? `「${target.name}」吃分永久 +${targetChange}` : "没有下一张牌"}`);
    }

    if (effect?.kind === "postpone_match_highest_eat") {
      const remaining = getRoundCardsExcept(state, card.uuid);
      if (remaining.length > 0) {
        const highest = Math.max(...remaining.map((item) => item.eat_points ?? 0));
        const change = setPermanentCardStat(state, card, "eat_points", highest);
        pointChanges.push({ card_name: card.name, stat: "eat_points", amount: change });
        note(`${card.name}：吃分永久变为牌堆最高值 ${highest}`);
      } else note(`${card.name}：牌堆中没有其他牌，吃分不变`);
    }

    if (effect?.kind === "postpone_decay_score") {
      const eatChange = changePermanentCard(state, card, "eat_points", -(effect.amount ?? 1));
      const discardChange = changePermanentCard(state, card, "discard_points", -(effect.amount ?? 1));
      const score = Math.max(0, effect.score ?? 4);
      state.round.postpone_bonus_score = safeAdd(state.round.postpone_bonus_score ?? 0, score);
      pointChanges.push(
        { card_name: card.name, stat: "eat_points", amount: eatChange },
        { card_name: card.name, stat: "discard_points", amount: discardChange },
      );
      note(`${card.name}：吃分 ${eatChange} / 弃分 ${discardChange}，本轮 +${score} 分`);
    }

    if (effect?.kind === "postpone_penalty_comeback") {
      const change = changePermanentCard(state, card, "discard_points", -1);
      pointChanges.push({ card_name: card.name, stat: "discard_points", amount: change });
      note(`${card.name}：弃分永久 ${change}`);
    }

    if (effect?.kind === "postpone_buff_animal") {
      const animals = getRoundCardsExcept(state, card.uuid).filter((item) => item.type === "动物");
      const target = animals[Math.min(animals.length - 1, Math.floor(random() * animals.length))];
      if (target) {
        const change = changePermanentCard(state, target, "discard_points", 1);
        markCardsPostponed(state, [target]);
        pointChanges.push({ card_name: target.name, stat: "discard_points", amount: change });
        note(`${card.name}：动物「${target.name}」弃分永久 +${change}，并标记为已后置`);
      } else note(`${card.name}：牌堆中没有其他动物`);
    }

    if (effect?.kind === "postpone_mark_all_growth") {
      const marked = markAll();
      const change = changePermanentCard(state, card, "discard_points", effect.amount ?? 1);
      pointChanges.push({ card_name: card.name, stat: "discard_points", amount: change });
      note(`${card.name}：剩余 ${marked.length} 张牌标记为已后置，自身弃分永久 +${change}`);
    }

    if (effect?.kind === "postpone_nebula") {
      const marked = markAll();
      state.round.hidden_postponed_uuids = [...new Set([
        ...(state.round.hidden_postponed_uuids ?? []),
        ...marked.map((item) => item.uuid),
      ])];
      state.round.nebula_postpone_counts ??= {};
      state.round.nebula_postpone_counts[card.uuid] = 0;
      note(`${card.name}：剩余 ${marked.length} 张牌已后置并翻至牌背`);
    }

    if (effect?.kind === "postpone_generate_edible") {
      const change = changePermanentCard(state, card, "discard_points", -1);
      const candidates = createShopCardPool().filter((candidate) => candidate.edibility === "edible");
      const template = candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
      const generated = createGeneratedCard(state, card, template, { weakened: true });
      pointChanges.push({ card_name: card.name, stat: "discard_points", amount: change });
      note(`${card.name}：弃分永久 ${change}，生成【弱化】「${generated?.name ?? "失败"}」`);
    }

    if (effect?.kind === "postpone_mark_all_wrong_eat") {
      const marked = markAll();
      state.round.wrong_eat_bonus = safeAdd(state.round.wrong_eat_bonus ?? 0, effect.bonus ?? 3);
      note(`${card.name}：剩余 ${marked.length} 张牌标记为已后置；此后错误食性吃额外 +${effect.bonus ?? 3}`);
    }

    const itemEffects = resolveItemPostponeEffects(state, card);
    if (itemEffects.score_bonus > 0) {
      state.round.postpone_bonus_score = safeAdd(state.round.postpone_bonus_score ?? 0, itemEffects.score_bonus);
    }
    messages.push(...itemEffects.messages);
    if (triggered || itemEffects.messages.length > 0) state.round.postpone_effect_triggers = safeAdd(state.round.postpone_effect_triggers ?? 0, 1);
    return {
      triggered: triggered || itemEffects.messages.length > 0,
      messages,
      point_changes: pointChanges,
      score_bonus: itemEffects.score_bonus,
      item_events: itemEffects.item_events,
    };
  }

  function recordAction(state, action, card) {
    if (action !== ACTIONS.EAT && action !== ACTIONS.DISCARD) {
      throw new Error(`Unknown card action: ${action}`);
    }

    const lockAfterResolution = (state.round.lock_next_stats_charges ?? 0) > 0;
    const reductionBefore = getDeckReductionTotal(state);
    const reductionSnapshotBefore = getDeckReductionSnapshot(state);
    const destroyedBefore = state.round.destroyed_count ?? 0;
    for (const sourceUuid of Object.keys(state.round.nebula_postpone_counts ?? {})) {
      if (sourceUuid !== card.uuid) {
        state.round.nebula_postpone_counts[sourceUuid] = safeAdd(state.round.nebula_postpone_counts[sourceUuid] ?? 0, 1);
      }
    }
    const comboWasProtected = (state.round.fruit_combo ?? 0) > 0 && (
      Boolean(state.round.fruit_combo_unbreakable)
      || card.effect?.kind === "fruit_combo_unbreakable"
      || (action === ACTIONS.DISCARD && Boolean(state.round.fruit_combo_discard_shield))
    );
    if ((action !== ACTIONS.EAT || card.type !== "水果") && !comboWasProtected) {
      if ((state.round.fruit_combo ?? 0) > 0) state.round.fruit_combo_broken = true;
      state.round.fruit_combo = 0;
    }
    const immediateEffect = prepareImmediateEffect(state, action, card);
    if (card.effect?.kind === "clear_debuff" && action === ACTIONS.EAT) {
      state.round.buffs = state.round.buffs.filter((buff) => buff.kind !== "flat" || buff.value >= 0);
    }

    const ruleBonus = getRuleFlatBonus(state, action, card);
    const buffs = consumeActionBuffs(state, action, card);
    const itemOverrides = getItemActionOverrides(state, action, card);
    const actionPrintedPoints = action === ACTIONS.EAT ? card.eat_points ?? 0 : card.discard_points ?? 0;
    let printedPoints = buffs.use_opposite_side
      ? (action === ACTIONS.EAT ? card.discard_points ?? 0 : card.eat_points ?? 0)
      : actionPrintedPoints;
    if (buffs.use_best_side) printedPoints = Math.max(card.eat_points ?? 0, card.discard_points ?? 0);
    if (itemOverrides.use_best_side) printedPoints = Math.max(card.eat_points ?? 0, card.discard_points ?? 0);
    printedPoints = itemOverrides.force_zero ? 0 : safeMultiply(printedPoints, itemOverrides.printed_multiplier);
    const itemEffects = resolveItemActionEffects(state, action, card);
    const questModifier = [
      state.round.quest_flat_modifier ?? 0,
      state.round.quest_action_modifiers?.[action] ?? 0,
      state.round.actions.length === 0 ? state.round.quest_first_action_modifier ?? 0 : 0,
      getRemainingCardCount(state) === 0 ? state.round.quest_last_action_modifier ?? 0 : 0,
    ].reduce((sum, value) => safeAdd(sum, value), 0);
    const entry = {
      card_id: card.id,
      card_uuid: card.uuid,
      name: card.name,
      type: card.type,
      edibility: card.edibility,
      rarity: card.rarity,
      keywords: [...new Set([...(card.effect?.keywords ?? []), ...(card.status_keywords ?? [])])],
      action,
      printed_points: printedPoints,
      eat_points_at_action: card.eat_points ?? 0,
      base_eat_points: card.base_eat_points ?? card.eat_points ?? 0,
      rule_bonus: ruleBonus,
      buff_flat_bonus: buffs.flat_bonus,
      buff_multiplier: buffs.multiplier,
      item_bonus: itemEffects.flat_bonus,
      item_markers: itemEffects.markers,
      quest_modifier: questModifier,
      effect_bonus: safeAdd(immediateEffect.bonus, state.round.card_score_bonuses?.[card.uuid] ?? 0),
      reshuffle_index: state.round.reshuffle_count,
      effect_log: null,
      effect_triggered: immediateEffect.detail,
      points: 0,
    };
    const markedCardBonus = state.round.card_score_bonuses?.[card.uuid] ?? 0;
    if (markedCardBonus !== 0) entry.effect_triggered = `已后置牌结算额外 +${markedCardBonus}`;
    entry.wrong_edibility = isWrongEdibilityAction(action, card);
    if (entry.wrong_edibility) {
      state.round.wrong_edibility_count = safeAdd(state.round.wrong_edibility_count ?? 0, 1);
      state.round.wrong_edibility_streak = safeAdd(state.round.wrong_edibility_streak ?? 0, 1);
      state.round.best_wrong_edibility_streak = Math.max(state.round.best_wrong_edibility_streak ?? 0, state.round.wrong_edibility_streak);
    } else {
      state.round.wrong_edibility_streak = 0;
    }
    entry.wrong_edibility_streak = state.round.wrong_edibility_streak;
    if (immediateEffect.bonus !== 0) entry.effect_log = `${card.name}：净化转化`;

    if (entry.wrong_edibility && action === ACTIONS.EAT && (state.round.wrong_eat_bonus ?? 0) !== 0) {
      entry.effect_bonus = safeAdd(entry.effect_bonus, state.round.wrong_eat_bonus);
      entry.effect_triggered = `铁胃徽章：错误食性吃额外 +${state.round.wrong_eat_bonus}`;
    }

    if (entry.wrong_edibility) {
      const verdict = state.round.verdicts.find((candidate) => !candidate.resolved);
      if (verdict) {
        verdict.resolved = true;
        verdict.failed = true;
        entry.effect_bonus = safeAdd(entry.effect_bonus, -(verdict.penalty ?? 3));
        entry.effect_triggered = `${verdict.card_name}：判词命中，本次硬吃额外 -${verdict.penalty ?? 3}`;
      }
    }

    // Effects are applied after consuming existing buffs, so newly created buffs affect future cards only.
    applyCardEffect(state, action, card, entry, random);
    if (shouldEchoDrinkEffect(state, card)) {
      entry.item_drink_echo = true;
      const echoedCard = { ...card, effect: { ...card.effect, once_per_round: false } };
      applyCardEffect(state, action, echoedCard, entry, random);
      markEffect(entry, card, "双层吸管：饮料效果额外生效一次");
      entry.item_drink_echo = false;
    }
    const pendingItemMessages = drainPendingItemMessages(state);
    if (pendingItemMessages.length > 0) {
      const message = pendingItemMessages.join(" · ");
      entry.effect_triggered = entry.effect_triggered ? `${entry.effect_triggered} · ${message}` : message;
    }
    if (lockAfterResolution) {
      state.round.lock_next_stats_charges = Math.max(0, (state.round.lock_next_stats_charges ?? 0) - 1);
      const locked = lockPermanentCardStats(state, card);
      const lockMessage = locked
        ? `覆膜机：已永久锁定「${card.name}」当前牌面`
        : `覆膜机：目标「${card.name}」已离开牌组`;
      entry.effect_triggered = entry.effect_triggered ? `${entry.effect_triggered} · ${lockMessage}` : lockMessage;
    }
    if (comboWasProtected) {
      entry.fruit_combo = state.round.fruit_combo;
      const shieldMessage = `药草茶：水果连击未中断 ×${state.round.fruit_combo}`;
      entry.effect_triggered = entry.effect_triggered
        ? `${entry.effect_triggered} · ${shieldMessage}`
        : shieldMessage;
    }
    if ((card.weakened || card.temporary) && state.deck.some((owned) => owned.uuid === card.uuid)) {
      const index = state.deck.findIndex((owned) => owned.uuid === card.uuid);
      const removed = card.temporary
        ? (index >= 0 ? state.deck.splice(index, 1)[0] : null)
        : state.deck.length > 1 ? removePermanentCard(state, card.uuid) : null;
      if (removed) {
        entry.destroyed_self = true;
        entry.effect_triggered = entry.effect_triggered
          ? `${entry.effect_triggered} · ${card.temporary ? "【临时】" : "【弱化】"}结算后自毁`
          : `${card.name}：${card.temporary ? "【临时】" : "【弱化】"}结算后自毁`;
      }
    }
    const reductionAfter = getDeckReductionTotal(state);
    const reductionSnapshotAfter = getDeckReductionSnapshot(state);
    const restoredStats = [...reductionSnapshotBefore.entries()].flatMap(([key, before]) => {
      const after = reductionSnapshotAfter.get(key);
      const restored = after ? Math.max(0, before.amount - after.amount) : 0;
      return restored > 0 ? [{ card_uuid: before.card_uuid, stat: before.stat, amount: restored }] : [];
    });
    entry.restored_points = Math.max(0, reductionBefore - reductionAfter);
    entry.reduced_points = Math.max(0, reductionAfter - reductionBefore);
    entry.destroyed_count = Math.max(0, (state.round.destroyed_count ?? 0) - destroyedBefore);
    const itemAfterEffects = resolveItemAfterActionEffects(state, action, card, entry, {
      restored_points: entry.restored_points,
      restored_stats: restoredStats,
      reduced_points: entry.reduced_points,
      destroyed_count: entry.destroyed_count,
    });
    entry.effect_bonus = safeAdd(entry.effect_bonus, itemAfterEffects.score_bonus);
    entry.item_events = itemAfterEffects.item_events;
    if (itemAfterEffects.point_changes.length > 0) {
      entry.point_changes = [...(entry.point_changes ?? []), ...itemAfterEffects.point_changes];
    }
    const flatValue = [printedPoints, ruleBonus, buffs.flat_bonus, itemEffects.flat_bonus, entry.quest_modifier]
      .reduce((sum, value) => safeAdd(sum, value), 0);
    entry.points = safeAdd(safeMultiply(flatValue, buffs.multiplier), entry.effect_bonus);
    if (card.effect?.kind === "postpone_penalty_comeback"
      && action === ACTIONS.DISCARD
      && entry.points <= (card.effect.threshold ?? -5)) {
      const bonus = card.effect.bonus ?? 20;
      entry.effect_bonus = safeAdd(entry.effect_bonus, bonus);
      entry.points = safeAdd(entry.points, bonus);
      markEffect(entry, card, `${card.name}：弃置得分不高于 ${card.effect.threshold ?? -5}，反击 +${bonus}`);
    }
    const allItemMessages = [...itemEffects.messages, ...itemAfterEffects.messages];
    if (allItemMessages.length > 0) {
      const itemMessage = allItemMessages.join(" · ");
      entry.effect_triggered = entry.effect_triggered ? `${entry.effect_triggered} · ${itemMessage}` : itemMessage;
    }

    state.round.actions.push(entry);
    sequenceFor(state, action).push(entry);
    recordCardAction(state, action, card);
    return entry;
  }

  function finalizeRound(state) {
    const startingTotalScore = state.total_score;
    const roundEndEffects = applyRoundEndCardEffects(state);
    const itemRoundEndEffects = getItemRoundEndEffects(state, random);
    const actionScore = state.round.actions.reduce((sum, item) => safeAdd(sum, item.points), 0);
    const postponeScore = state.round.postpone_bonus_score ?? 0;
    const cardScore = [actionScore, postponeScore, roundEndEffects.score_bonus, itemRoundEndEffects.score_bonus]
      .reduce((sum, value) => safeAdd(sum, value), 0);
    const multipliers = [
      ...state.round.final_multipliers,
      ...getItemFinalMultipliers(state),
      ...(state.permanent_multipliers ?? []).map((reward) => ({ name: reward.name, multiplier: reward.multiplier, source: "quest" })),
    ];
    const totalMultiplier = multipliers.reduce((value, item) => safeProduct(value, item.multiplier), 1);
    const roundScore = safeMultiply(cardScore, totalMultiplier);

    const breakdown = [{
      label: "牌面与效果",
      text: `${formatScore(cardScore)} 分`,
      value: cardScore,
      number_style: "score-unit",
    }];
    const byType = state.round.actions.reduce((result, item) => {
      result[item.type] = safeAdd(result[item.type] ?? 0, item.points);
      return result;
    }, {});
    Object.entries(byType)
      .sort(([, a], [, b]) => b - a)
      .forEach(([type, score]) => breakdown.push({
        label: `↳ ${type}`,
        text: `${formatScore(score)} 分`,
        kind: "detail",
        value: score,
        number_style: "score-unit",
      }));
    if (postponeScore > 0) {
      breakdown.push({
        label: "↳ 后置效果",
        text: `+${formatScore(postponeScore)} 分`,
        kind: "bonus",
        value: postponeScore,
        number_style: "signed-score-unit",
      });
    }
    roundEndEffects.messages.forEach((message) => breakdown.push({
      label: "↳ 轮末卡牌效果",
      text: message,
      kind: "bonus",
    }));
    itemRoundEndEffects.messages.forEach((message) => breakdown.push({
      label: "↳ 培养道具",
      text: message,
      kind: "bonus",
    }));

    state.round.actions
      .filter((item) => item.effect_bonus !== 0 && item.effect_log)
      .forEach((item) => breakdown.push({
        label: item.effect_log,
        text: `${item.effect_bonus > 0 ? "+" : ""}${formatScore(item.effect_bonus)}`,
        kind: "bonus",
        value: item.effect_bonus,
        number_style: "signed-score",
      }));

    if (multipliers.length > 0) {
      multipliers.forEach((item) => {
        const sourceLabel = item.source === "item"
          ? "道具"
          : item.source === "quest"
            ? "任务"
            : "规则";
        breakdown.push({
          label: `${sourceLabel} · ${item.name}`,
          text: `×${item.multiplier}`,
          kind: "rule",
          value: item.multiplier,
          number_style: "multiplier",
        });
      });
    }

    breakdown.push({
      label: "本轮得分",
      text: `${roundScore >= 0 ? "+" : ""}${formatScore(roundScore)}`,
      kind: "total",
      value: roundScore,
      number_style: "signed-score",
    });

    state.total_score = safeAdd(state.total_score, roundScore);

    return {
      card_score: cardScore,
      total_multiplier: totalMultiplier,
      round_score: roundScore,
      starting_total_score: startingTotalScore,
      presentation_cards: state.round.actions.map((entry) => ({
        card_id: entry.card_id,
        card_uuid: entry.card_uuid,
        name: entry.name,
        type: entry.type,
        edibility: entry.edibility,
        rarity: entry.rarity,
        action: entry.action,
        points: entry.points,
        effect_bonus: entry.effect_bonus,
        effect_triggered: entry.effect_triggered,
        wrong_edibility: entry.wrong_edibility,
        destroyed_self: entry.destroyed_self,
        keywords: [...(entry.keywords ?? [])],
      })),
      rule_results: [],
      completed_rule_ids: [],
      breakdown,
    };
  }

  function levelProgressCheck(state) {
    const milestones = Object.keys(GAME_CONFIG.milestone_targets)
      .map(Number)
      .filter((baseRound) => getEffectiveMilestoneRound(baseRound, state.milestone_delays) === state.current_round);
    const target = milestones.reduce((highest, baseRound) => Math.max(highest, getMilestoneTarget(baseRound, state.mode)), 0);
    return { passed: target === 0 || state.total_score >= target, target, base_round: milestones.at(-1) ?? null };
  }

  function getGoldReward(state) {
    return new Set(state.round.eat_sequence.map((entry) => entry.card_uuid)).size;
  }

  function applyRoundStartEffects(state) {
    if (!state.pending_round_start_purify) return [];
    state.pending_round_start_purify = false;
    const restored = state.deck.reduce((sum, card) => safeAdd(sum, restoreReducedPermanentCardPoints(state, card)), 0);
    return [restored > 0
      ? `修理工具箱：开场净化恢复 ${restored} 点红色降幅`
      : "修理工具箱：开场净化完成，没有可恢复的红色降幅"];
  }

  return {
    recordPostpone,
    recordAction,
    finalizeRound,
    applyRoundStartEffects,
    getGoldReward,
    levelProgressCheck,
    getNextTargetInfo: (state) => getNextMilestone(state.current_round, state.milestone_delays, state.mode),
    getFinalRound: (state) => getFinalRound(state.milestone_delays, state.mode),
  };
}
