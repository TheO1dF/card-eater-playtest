import { GAME_CONFIG } from "./config.js";
import { addItem, getItemById } from "./items.js";
import { safeMultiply } from "./numbers.js";

const quest = (definition, iconIndex) => Object.freeze({
  icon_atlas: "meta-atlas.webp",
  icon_columns: 4,
  icon_rows: 4,
  icon_x: iconIndex % 4,
  icon_y: Math.floor(iconIndex / 4),
  ...definition,
});

export const QUEST_LIBRARY = Object.freeze([
  quest({
    id: "QST01", name: "首尾赌约", risk: "位置风险",
    penalty: { kind: "first_action_modifier", amount: -4, description: "本轮第一张牌额外 -4 分。" },
    condition: { kind: "first_eat_last_discard", description: "第一张牌必须吃、最后一张牌必须弃。" },
    reward: { kind: "item", item_id: "IT003" },
  }, 8),
  quest({
    id: "QST02", name: "回收誓约", risk: "中风险",
    penalty: { kind: "action_flat_modifier", action: "discard", amount: -1, description: "本轮每次弃牌额外 -1 分。" },
    condition: { kind: "min_discard", count: 5, description: "本轮至少弃 5 张牌。" },
    reward: { kind: "item", item_id: "IT002" },
  }, 9),
  quest({
    id: "QST03", name: "虚空债券", risk: "永久负面",
    penalty: { kind: "add_permanent_void", count: 1, description: "永久向牌组加入 1 张吃 -2、弃 -1、无类别的虚空牌。" },
    condition: { kind: "min_round_score", target_multiplier: 1.25, description: "本轮分数达到强化任务目标。" },
    reward: { kind: "item", item_id: "IT008" },
  }, 10),
  quest({
    id: "QST04", name: "终末观测", risk: "永久负面",
    penalty: { kind: "add_permanent_void", count: 1, description: "永久向牌组加入 1 张吃 -2、弃 -1、无类别的虚空牌。" },
    condition: { kind: "last_discard_and_score", target_multiplier: 0.9, description: "最后一张牌必须弃掉，并达到任务目标。" },
    reward: { kind: "item", item_id: "IT001" },
  }, 11),
  quest({
    id: "QST05", name: "破产采购", risk: "经济清零",
    penalty: { kind: "lose_all_gold", description: "立即失去当前全部金币。" },
    condition: { kind: "min_round_score", target_multiplier: 1.05, description: "本轮分数达到任务目标。" },
    reward: { kind: "item", item_id: "IT005" },
  }, 12),
  quest({
    id: "QST06", name: "袖珍循环", risk: "高风险", requires_item: "IT001", min_round: 6,
    penalty: { kind: "first_action_modifier", amount: -5, description: "本轮第一张牌额外 -5 分。" },
    condition: { kind: "min_reshuffles", count: 1, description: "本轮至少重洗 1 次。" },
    reward: { kind: "item", item_id: "IT004" },
  }, 13),
  quest({
    id: "QST07", name: "苦味加冕", risk: "高风险", min_round: 6,
    penalty: { kind: "action_flat_modifier", action: "eat", amount: -2, description: "本轮每次吃牌额外 -2 分。" },
    condition: { kind: "min_negative_eat", count: 2, description: "本轮主动吃下至少 2 张负分牌。" },
    reward: { kind: "item", item_id: "IT006" },
  }, 14),
  quest({
    id: "QST08", name: "无底胃契", risk: "重度永久负面", min_round: 9,
    penalty: { kind: "add_permanent_void", count: 2, description: "永久向牌组加入 2 张吃 -2、弃 -1、无类别的虚空牌。" },
    condition: { kind: "min_deck_and_score", count: 14, target_multiplier: 1.15, description: "牌组至少 14 张，并达到任务目标。" },
    reward: { kind: "item", item_id: "IT007" },
  }, 15),
  quest({
    id: "QST09", name: "拆解执照", risk: "摧毁挑战", min_round: 6,
    penalty: { kind: "action_flat_modifier", action: "eat", amount: -1, description: "本轮每次吃牌额外 -1 分。" },
    condition: { kind: "min_destroyed", count: 2, description: "本轮通过卡牌效果摧毁至少 2 张牌。" },
    reward: { kind: "item", item_id: "IT009" },
  }, 4),
  quest({
    id: "QST10", name: "万花筒试餐", risk: "多样性风险", min_round: 3,
    penalty: { kind: "first_action_modifier", amount: -5, description: "本轮第一张行动牌额外 -5 分。" },
    condition: { kind: "min_unique_action_types", count: 5, description: "本轮处理至少 5 种不同类别的牌。" },
    reward: { kind: "item", item_id: "IT010" },
  }, 5),
  quest({
    id: "QST11", name: "孵化配额", risk: "生成挑战", min_round: 6,
    penalty: { kind: "action_flat_modifier", action: "discard", amount: -1, description: "本轮每次弃牌额外 -1 分。" },
    condition: { kind: "min_generated", count: 2, description: "本轮通过【生成】向永久牌组加入至少 2 张牌。" },
    reward: { kind: "item", item_id: "IT011" },
  }, 6),
  quest({
    id: "QST12", name: "交错舞步", risk: "节奏风险", min_round: 6,
    penalty: { kind: "round_flat_modifier", amount: -1, description: "本轮每张行动牌额外 -1 分。" },
    condition: { kind: "alternating_actions", count: 6, description: "连续 6 次交替执行吃与弃。" },
    reward: { kind: "item", item_id: "IT012" },
  }, 7),
]);

const QUEST_TARGETS = Object.freeze({ 4: 24, 8: 48, 12: 84 });

const VOID_CARD = Object.freeze({
  id: "Q001",
  name: "虚空",
  flavor: "它不属于任何类别，也不会响应任何流派。",
  rarity: "诅咒",
  type: "无类别",
  edibility: "inedible",
  eat_points: -2,
  discard_points: -1,
  base_eat_points: -2,
  base_discard_points: -1,
  role: "sacrifice",
  shop_price: 0,
  synergy_tags: [],
  effect: null,
  art_file: "cards/v017/c008-v3.png",
  runtime_art_mode: "individual",
  runtime_atlas: null,
  runtime_columns: 1,
  runtime_rows: 1,
  runtime_x: 0,
  runtime_y: 0,
  sprite_hue: 0,
  sprite_scale: 1,
});

function cloneQuest(source) {
  return source ? {
    ...source,
    penalty: { ...source.penalty },
    condition: { ...source.condition },
    reward: { ...source.reward },
  } : null;
}

export function getQuestTarget(round, multiplier = 1) {
  const base = QUEST_TARGETS[round] ?? Math.max(24, Math.round(24 * Math.pow(2, Math.max(0, round - 4) / 4)));
  return safeMultiply(base, multiplier);
}

export function isQuestEligible(entry, state) {
  if ((entry.min_round ?? 1) > state.current_round) return false;
  if (entry.requires_item && !state.items.some((item) => item.id === entry.requires_item)) return false;
  const actionBudget = Math.min(state.deck.length, state.plate_capacity ?? GAME_CONFIG.initial_plate_capacity);
  if (entry.condition.kind === "min_discard" && actionBudget < entry.condition.count) return false;
  if (entry.condition.kind === "alternating_actions" && actionBudget < entry.condition.count) return false;
  if (entry.condition.kind === "min_deck_and_score" && state.deck.length < entry.condition.count) return false;
  if (entry.condition.kind === "min_unique_action_types" && new Set(state.deck.map((card) => card.type)).size < entry.condition.count) return false;
  if (entry.condition.kind === "min_negative_eat" && state.deck.filter((card) => card.eat_points < 0).length < entry.condition.count) return false;
  if (entry.condition.kind === "min_destroyed") {
    const destroyCards = state.deck.filter((card) => card.effect?.description?.includes("摧毁")).length;
    if (destroyCards < entry.condition.count) return false;
  }
  if (entry.condition.kind === "min_generated") {
    const generationCapacity = state.deck.reduce((sum, card) => {
      if (!card.effect?.description?.includes("生成")) return sum;
      return sum + Math.max(1, card.effect.count ?? 1);
    }, 0);
    if (generationCapacity < entry.condition.count) return false;
  }
  return !state.quest_history.some((history) => history.id === entry.id);
}

export function randomDraftQuests(count, state, random = Math.random) {
  const pool = QUEST_LIBRARY.filter((entry) => isQuestEligible(entry, state)).map(cloneQuest);
  const picked = [];
  while (picked.length < count && pool.length > 0) {
    picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  }
  return picked;
}

function addPermanentVoidCards(state, count, createId) {
  const source = VOID_CARD;
  let added = 0;
  while (added < count && state.deck.length < GAME_CONFIG.max_deck_size) {
    state.deck.push({ ...source, effect: null, uuid: createId(source, state.deck.length + added) });
    added += 1;
  }
  return added;
}

export function selectQuest(state, selected, createId) {
  const entry = cloneQuest(selected);
  entry.round = state.current_round;
  entry.target = getQuestTarget(state.current_round, entry.condition.target_multiplier ?? 1);
  entry.completed = false;
  entry.finalized = false;
  state.active_quest = entry;
  if (entry.penalty.kind === "lose_all_gold") state.gold = 0;
  if (entry.penalty.kind === "add_permanent_void") {
    entry.penalty.applied_count = addPermanentVoidCards(state, entry.penalty.count, createId);
  }
  return entry;
}

export function applyQuestRoundPenalty(state, random = Math.random) {
  const entry = state.active_quest;
  if (!entry || entry.round !== state.current_round) return;
  if (entry.penalty.kind === "round_flat_modifier") {
    state.round.quest_flat_modifier = entry.penalty.amount;
  }
  if (entry.penalty.kind === "action_flat_modifier") {
    state.round.quest_action_modifiers[entry.penalty.action] = entry.penalty.amount;
  }
  if (entry.penalty.kind === "first_action_modifier") {
    state.round.quest_first_action_modifier = entry.penalty.amount;
  }
  if (entry.penalty.kind === "void_round_cards") {
    const voidCard = VOID_CARD;
    const available = state.round.draw_pile.map((_, index) => index);
    const count = Math.min(entry.penalty.count, available.length);
    for (let picked = 0; picked < count; picked += 1) {
      const optionIndex = Math.floor(random() * available.length);
      const targetIndex = available.splice(optionIndex, 1)[0];
      const original = state.round.draw_pile[targetIndex];
      state.round.draw_pile[targetIndex] = {
        ...voidCard,
        uuid: original.uuid,
        name: `虚空·${original.name}`,
        quest_original_id: original.id,
        quest_void: true,
      };
    }
  }
}

export function getQuestRequirement(entry) {
  if (!entry) return "";
  if (["min_round_score", "last_discard_and_score", "min_deck_and_score"].includes(entry.condition.kind)) {
    return `${entry.condition.description}（${entry.target} 分）`;
  }
  return entry.condition.description;
}

function evaluateQuest(state, entry, result) {
  const actions = state.round.actions;
  switch (entry.condition.kind) {
    case "min_round_score": return result.round_score >= entry.target;
    case "min_discard": return state.round.discard_sequence.length >= entry.condition.count;
    case "last_discard_and_score": return actions.at(-1)?.action === "discard" && result.round_score >= entry.target;
    case "first_eat_last_discard": return actions[0]?.action === "eat" && actions.at(-1)?.action === "discard";
    case "min_deck_and_score": return state.deck.length >= entry.condition.count && result.round_score >= entry.target;
    case "min_reshuffles": return state.round.reshuffle_count >= entry.condition.count;
    case "min_negative_eat": return state.round.eat_sequence.filter((action) => action.points < 0).length >= entry.condition.count;
    case "min_destroyed": return state.round.destroyed_count >= entry.condition.count;
    case "min_generated": return state.round.generated_count >= entry.condition.count;
    case "min_unique_action_types": return new Set(actions.map((item) => item.type)).size >= entry.condition.count;
    case "alternating_actions": {
      let streak = actions.length > 0 ? 1 : 0;
      let best = streak;
      for (let index = 1; index < actions.length; index += 1) {
        streak = actions[index].action !== actions[index - 1].action ? streak + 1 : 1;
        best = Math.max(best, streak);
      }
      return best >= entry.condition.count;
    }
    default: return false;
  }
}

function queueReward(state, entry) {
  const effectiveRound = state.current_round + 1;
  if (entry.reward.kind === "item") {
    const reward = getItemById(entry.reward.item_id);
    const exists = state.items.some((item) => item.id === entry.reward.item_id)
      || state.pending_rewards.some((pending) => pending.item_id === entry.reward.item_id);
    if (!exists) {
      state.pending_rewards.push({ kind: "item", item_id: entry.reward.item_id, effective_round: effectiveRound });
    }
    return {
      granted: !exists,
      effective_round: effectiveRound,
      label: reward ? `${reward.name}：${reward.description}` : entry.reward.item_id,
    };
  }
  if (entry.reward.kind === "permanent_multiplier") {
    const exists = state.permanent_multipliers.some((reward) => reward.id === entry.reward.id)
      || state.pending_rewards.some((pending) => pending.reward?.id === entry.reward.id);
    if (!exists) state.pending_rewards.push({ kind: "permanent_multiplier", reward: { ...entry.reward }, effective_round: effectiveRound });
    return { granted: !exists, effective_round: effectiveRound, label: `${entry.reward.name} ×${entry.reward.multiplier}` };
  }
  return { granted: false, label: "无" };
}

export function activatePendingQuestRewards(state) {
  const activated = [];
  const remaining = [];
  for (const pending of state.pending_rewards) {
    if (pending.effective_round > state.current_round) {
      remaining.push(pending);
      continue;
    }
    if (pending.kind === "item") {
      const granted = addItem(state, pending.item_id);
      const reward = getItemById(pending.item_id);
      if (granted && reward) activated.push(reward.name);
    }
    if (pending.kind === "permanent_multiplier") {
      const exists = state.permanent_multipliers.some((reward) => reward.id === pending.reward.id);
      if (!exists) {
        state.permanent_multipliers.push({ ...pending.reward });
        activated.push(pending.reward.name);
      }
    }
  }
  state.pending_rewards = remaining;
  return activated;
}

export function finalizeQuest(state, result) {
  const entry = state.active_quest;
  if (!entry || entry.round !== state.current_round || entry.finalized) return null;
  entry.completed = evaluateQuest(state, entry, result);
  entry.finalized = true;
  const rewardResult = entry.completed ? queueReward(state, entry) : { granted: false, label: "任务失败，奖励未获得" };
  const history = {
    id: entry.id,
    name: entry.name,
    round: entry.round,
    completed: entry.completed,
    reward: rewardResult.label,
    reward_effective_round: rewardResult.effective_round ?? null,
  };
  state.quest_history.push(history);
  return {
    id: entry.id,
    name: entry.name,
    completed: entry.completed,
    requirement: getQuestRequirement(entry),
    penalty: entry.penalty.description,
    reward: rewardResult.label,
    reward_effective_round: rewardResult.effective_round ?? null,
  };
}
