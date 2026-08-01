import { GAME_CONFIG, GAME_MODES, isPlateUpgradeRound, isShopMode } from "./config.js";
import { GAME_PHASES, createInitialPlayerState, resetRoundState, transitionPhase } from "./state.js";
import { createGestureController } from "./gesture.js";
import { createRoundEngine } from "./engine.js";
import { createDraftService } from "./draft.js";
import { createShopService } from "./shop.js";
import { evaluateRule } from "./engine.js";
import { randomDraftRules } from "./rules.js";
import { safeAdd } from "./numbers.js";
import { getRoundGoldSources, sumRoundGoldSources } from "./economy.js";
import { createUI } from "./ui.js";
import { browserPlatform } from "./platform.js";
import { playSound, setBGMTheme, toggleBGM, unlockAudio } from "./audio.js";
import { postponeCurrentCard, takeRoundDrawPile } from "./plate.js";
import { getCurrentCard } from "./round-pile.js";
import { activateReshuffle, getReshuffleStatus } from "./reshuffle.js";
import { CARD_TYPES, getCardById } from "./data.js";
import {
  activateCategoryRoundItem,
  applyRoundItemDrawSetup,
  applyRoundItemSetup,
  chooseItem,
  getItemById,
  getItemCardOffers,
  getPostponeLimit,
  hydrateOwnedItems,
  randomDraftItems,
} from "./items.js";

let state = createInitialPlayerState({ create_id: browserPlatform.create_id });
const engine = createRoundEngine({ random: browserPlatform.random });
const draftService = createDraftService({ random: browserPlatform.random, create_id: browserPlatform.create_id });
const shopService = createShopService({ random: browserPlatform.random, create_id: browserPlatform.create_id });
const ui = createUI(document);

let draftBuffer = [];
let itemBuffer = [];
let shopBuffer = null;
let shopThemeBuffer = null;
let shopThemeType = null;
let shopItemBuffer = null;
let actionLocked = true;
let streak = { action: null, count: 0 };
let settings = browserPlatform.load_settings();
let musicEnabled = settings.music;
let effectsEnabled = settings.effects;
setBGMTheme(settings.home_theme, { immediate: true });
const tutorial = { active: false, correct_eat: false, postponed: false, correct_discard: false };

const shuffle = (items) => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(browserPlatform.random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
};

function saveGame() {
  if (state.phase === GAME_PHASES.INIT || state.phase === GAME_PHASES.GAME_OVER) return false;
  return browserPlatform.save_run(state);
}

function savePendingShop() {
  if (state.phase !== GAME_PHASES.SHOP) return;
  state.pending_shop = {
    cards: shopBuffer ?? [],
    themed_cards: shopThemeBuffer ?? [],
    theme_type: shopThemeType,
    items: shopItemBuffer ?? [],
  };
}

function restorePendingShop() {
  const pending = state.pending_shop;
  if (!pending) return false;
  shopBuffer = Array.isArray(pending.cards) ? pending.cards : [];
  shopThemeBuffer = Array.isArray(pending.themed_cards) ? pending.themed_cards : [];
  shopThemeType = pending.theme_type ?? null;
  shopItemBuffer = Array.isArray(pending.items) ? pending.items : [];
  return true;
}

function startSound() {
  if (!musicEnabled && !effectsEnabled) return;
  if (musicEnabled) toggleBGM(true);
}

function tutorialProgress() {
  return [
    { label: "正确吃牌", done: tutorial.correct_eat },
    { label: "后置排牌", done: tutorial.postponed },
    { label: "正确弃牌", done: tutorial.correct_discard },
  ];
}

function renderTutorial() {
  if (!tutorial.active || state.phase !== GAME_PHASES.PLAYING) {
    ui.hideStoryGuide();
    return;
  }
  const progress = tutorialProgress();
  const card = getCurrentCard(state);
  if (!tutorial.correct_eat) {
    const edible = card?.edibility === "edible";
    ui.showStoryGuide({
      step: "eat",
      chapter: "CHAPTER 1 · 看食性，不看外表",
      message: edible ? `「${card.name}」可食用。下滑或点击“吃掉”。` : `「${card?.name ?? "当前牌"}」不可食用，先后置寻找食物。`,
      objective: edible ? "完成一次符合食性的吃牌。" : "点击“后置”，不结算地改变牌序。",
      target: edible ? "#eatButton" : "#postponeButton",
      progress,
    });
    return;
  }
  if (!tutorial.postponed) {
    ui.showStoryGuide({
      step: "postpone",
      chapter: "CHAPTER 2 · 餐盘可以重排",
      message: "后置会把当前牌移到餐盘末尾，不结算，也不占用行动。",
      objective: "点击“后置”或左右侧滑一次。",
      target: "#postponeButton",
      progress,
    });
    return;
  }
  if (!tutorial.correct_discard) {
    const inedible = card?.edibility === "inedible";
    ui.showStoryGuide({
      step: "discard",
      chapter: "CHAPTER 3 · 不能吃，就让它走",
      message: inedible ? `「${card.name}」不可食用。上滑或点击“弃掉”。` : "继续后置，找到一张不可食用牌。",
      objective: inedible ? "完成一次符合食性的弃牌。" : "后置当前牌，寻找不可食用牌。",
      target: inedible ? "#discardButton" : "#postponeButton",
      progress,
    });
    return;
  }
  ui.showStoryGuide({
    step: "complete",
    chapter: "EPILOGUE · 每轮都在构筑",
    message: "轮末可以选牌、刷新或跳过；每 3 轮再从三件不同稀有度的道具中挑选一件。",
    objective: "永久道具会持续改写规则；一次性道具会立即结算并离开道具栏。",
    progress,
    can_continue: true,
    continue_label: "完成教学",
  });
}

function startTutorial() {
  Object.assign(tutorial, { active: true, correct_eat: false, postponed: false, correct_discard: false });
  renderTutorial();
}

function finishTutorial() {
  tutorial.active = false;
  browserPlatform.save_tutorial_complete();
  ui.hideStoryGuide();
}

function refreshTable() {
  ui.renderStack(state.round.draw_pile, gesture, state);
  ui.renderHud(state);
}

function updateStreak(action) {
  if (streak.action === action) streak.count += 1;
  else streak = { action, count: 1 };
  return streak.count;
}

function presentItemEvents(events = []) {
  if (events.length === 0) return;
  ui.showItemEvolution(events);
  if (effectsEnabled) playSound("essence", Math.max(...events.map((event) => event.level ?? 1)));
}

function finishRoundCycle() {
  ui.closeCardDraft();
  ui.closeItemDraft();
  ui.closeItemCardChoice();
  ui.closeItemCategoryChoice();
  transitionPhase(state, GAME_PHASES.NEXT_ROUND, { round: state.current_round });
  state.current_round += 1;
  state.pending_draft_ids = [];
  state.pending_item_ids = [];
  state.pending_item_resolution = null;
  state.draft_resolved = false;
  state.item_draft_resolved = false;
  saveGame();
  prepareRound();
}

function completeItemReward(message) {
  state.item_draft_resolved = true;
  state.pending_item_resolution = null;
  ui.closeItemDraft();
  ui.closeItemCardChoice();
  ui.closeItemCategoryChoice();
  if (effectsEnabled) playSound("item", 1);
  ui.showPickBurst(message, "item");
  itemBuffer = [];
  saveGame();
  window.setTimeout(finishRoundCycle, 740);
}

function presentPendingItemResolution() {
  const pending = state.pending_item_resolution;
  if (!pending) return false;
  const item = getItemById(pending.item_id);
  if (!item) {
    state.pending_item_resolution = null;
    return false;
  }
  if (pending.kind === "card_choice") {
    let cards = (pending.card_ids ?? []).map(getCardById).filter(Boolean);
    if (cards.length === 0) {
      cards = getItemCardOffers(pending.card_type, 3, browserPlatform.random);
      pending.card_ids = cards.map((card) => card.id);
      saveGame();
    }
    ui.closeItemDraft();
    ui.openItemCardChoice(item, cards, (card) => {
      if (state.phase !== GAME_PHASES.ITEM_DRAFT || state.item_draft_resolved) return;
      const added = draftService.addCard(state, card);
      if (!added) return;
      completeItemReward(`${item.name}：选择「${card.name}」加入牌组`);
    });
    return true;
  }
  if (pending.kind === "category_choice") {
    ui.closeItemDraft();
    ui.openItemCategoryChoice(item, Object.values(CARD_TYPES), (type) => {
      if (state.phase !== GAME_PHASES.ITEM_DRAFT || state.item_draft_resolved) return;
      const result = activateCategoryRoundItem(state, item.id, type);
      if (!result.success) return;
      completeItemReward(result.message);
    });
    return true;
  }
  return false;
}

function enterItemDraft() {
  if (state.phase !== GAME_PHASES.ITEM_DRAFT) return;
  if (state.item_draft_resolved) {
    finishRoundCycle();
    return;
  }
  if (presentPendingItemResolution()) return;
  if (itemBuffer.length === 0) {
    itemBuffer = (state.pending_item_ids ?? []).map(getItemById).filter(Boolean);
    if (itemBuffer.length === 0) itemBuffer = randomDraftItems(state, 3, browserPlatform.random);
  }
  state.pending_item_ids = itemBuffer.map((entry) => entry.id);
  saveGame();
  if (itemBuffer.length === 0) {
    finishRoundCycle();
    return;
  }
  ui.openItemDraft(state, itemBuffer, (entry) => {
    if (state.phase !== GAME_PHASES.ITEM_DRAFT || state.item_draft_resolved) return;
    const result = chooseItem(state, entry);
    if (!result.success) return;
    if (result.resolution === "card_choice") {
      const offers = getItemCardOffers(result.card_type, 3, browserPlatform.random);
      state.pending_item_resolution = {
        kind: "card_choice",
        item_id: entry.id,
        card_type: result.card_type,
        card_ids: offers.map((card) => card.id),
      };
      saveGame();
      presentPendingItemResolution();
      return;
    }
    if (result.resolution === "category_choice") {
      state.pending_item_resolution = { kind: "category_choice", item_id: entry.id };
      saveGame();
      presentPendingItemResolution();
      return;
    }
    completeItemReward(result.message);
  }, () => {
    if (state.phase !== GAME_PHASES.ITEM_DRAFT || state.item_draft_resolved) return;
    state.item_history.push({ round: state.current_round, item_id: null, skipped: true });
    completeItemReward("跳过道具赠礼");
  });
}

function finishCardDraft() {
  ui.closeCardDraft();
  draftBuffer = [];
  state.pending_draft_ids = [];
  state.draft_resolved = false;
  if (state.current_round % GAME_CONFIG.item_draft_interval === 0) {
    transitionPhase(state, GAME_PHASES.ITEM_DRAFT, { round: state.current_round });
    itemBuffer = randomDraftItems(state, 3, browserPlatform.random);
    state.pending_item_ids = itemBuffer.map((entry) => entry.id);
    state.item_draft_resolved = false;
    saveGame();
    enterItemDraft();
    return;
  }
  finishRoundCycle();
}

function enterCardDraft() {
  if (state.phase !== GAME_PHASES.CARD_DRAFT) return;
  if (state.draft_resolved) {
    finishCardDraft();
    return;
  }
  if (draftBuffer.length === 0) {
    draftBuffer = (state.pending_draft_ids ?? []).map(getCardById).filter(Boolean);
    if (draftBuffer.length === 0) draftBuffer = draftService.getOffers(state);
  }
  state.pending_draft_ids = draftBuffer.map((card) => card.id);
  saveGame();
  void ui.preloadCardArt(draftBuffer);
  ui.openCardDraft(state, draftBuffer, {
    onChoose: (card) => {
      if (state.phase !== GAME_PHASES.CARD_DRAFT || state.draft_resolved) return;
      const added = draftService.addCard(state, card);
      if (!added) return;
      state.draft_resolved = true;
      ui.closeCardDraft();
      if (effectsEnabled) playSound("draft", 1);
      ui.showPickBurst(`「${card.name}」加入牌组`, "card");
      saveGame();
      window.setTimeout(finishCardDraft, 740);
    },
    onReroll: () => {
      const result = draftService.reroll(state, draftBuffer);
      if (!result.success) return result;
      draftBuffer = result.offers;
      state.pending_draft_ids = draftBuffer.map((card) => card.id);
      saveGame();
      if (effectsEnabled) playSound("reroll", 1);
      enterCardDraft();
      return result;
    },
    onSkip: () => {
      if (state.phase !== GAME_PHASES.CARD_DRAFT) return;
      draftService.skip(state);
      state.draft_resolved = true;
      saveGame();
      finishCardDraft();
    },
    onRemove: (cardUuid) => {
      const result = draftService.removeCard(state, cardUuid);
      ui.renderHud(state);
      if (result.success) saveGame();
      return result;
    },
    onPrepStore: (cardUuid) => {
      const result = draftService.storePrepCard(state, cardUuid);
      if (result.success) {
        saveGame();
        ui.renderHud(state);
      }
      return result;
    },
    onPrepRetrieve: () => {
      const result = draftService.retrievePrepCard(state);
      if (result.success) { saveGame(); ui.renderHud(state); }
      return result;
    },
    onPrepRemove: () => {
      const result = draftService.removePrepCard(state);
      if (result.success) { saveGame(); ui.renderHud(state); }
      return result;
    },
  });
}

function presentRoundSummary() {
  const pending = state.pending_summary;
  if (!pending) return;
  ui.showRoundSummary(pending.result, state, pending.outcome, () => {
    if (pending.outcome) {
      location.reload();
      return;
    }
    ui.hideRoundSummary();
    state.pending_summary = null;
    if (isShopMode(state.mode)) {
      transitionPhase(state, GAME_PHASES.SHOP, { round: state.current_round });
      saveGame();
      enterShop();
    } else {
      transitionPhase(state, GAME_PHASES.CARD_DRAFT, { round: state.current_round });
      saveGame();
      enterCardDraft();
    }
  });
}

function completeRound() {
  actionLocked = true;
  transitionPhase(state, GAME_PHASES.SCORING, { round: state.current_round });
  renderTutorial();
  if (state.round.started_at_ms) state.round.elapsed_ms = Math.max(1, browserPlatform.now() - state.round.started_at_ms);
  const result = engine.finalizeRound(state);
  if (isShopMode(state.mode)) {
    const baseGold = engine.getGoldReward(state);
    const slowGoldPerCard = state.round.elapsed_ms > 30_000 ? 2 : state.round.elapsed_ms > 20_000 ? 1 : 0;
    const slowGold = slowGoldPerCard * (state.round.slow_finish_rewards ?? 0);
    const pendingEffectGold = state.round.pending_gold_bonus ?? 0;
    const contract = state.active_rules[0] ?? null;
    const contractPassed = contract ? evaluateRule(state, contract) : false;
    const contractGold = contractPassed ? contract.gold_reward ?? 0 : 0;
    const speedGold = state.mode !== GAME_MODES.CONTRACT_SHOP
      ? 0
      : state.round.elapsed_ms <= GAME_CONFIG.contract_fast_time_limit_ms
        ? 2
        : state.round.elapsed_ms <= GAME_CONFIG.contract_time_limit_ms ? 1 : 0;
    const settlementGold = safeAdd(
      safeAdd(baseGold, safeAdd(pendingEffectGold, slowGold)),
      safeAdd(contractGold, speedGold),
    );
    const immediateGold = sumRoundGoldSources(state, "immediate");
    const earnedGold = safeAdd(settlementGold, immediateGold);
    state.gold = safeAdd(state.gold ?? 0, settlementGold);
    const recordedPendingGold = sumRoundGoldSources(state, "settlement");
    const goldSources = getRoundGoldSources(state);
    const untrackedPendingGold = Math.max(0, pendingEffectGold - recordedPendingGold);
    if (untrackedPendingGold > 0) {
      goldSources.push({ label: "其他经济效果", amount: untrackedPendingGold, timing: "settlement", kind: "effect" });
    }
    const summarizedGoldSources = [...goldSources.reduce((sources, source) => {
      const key = `${source.kind}:${source.label}`;
      const existing = sources.get(key);
      if (existing) existing.amount = safeAdd(existing.amount, source.amount ?? 0);
      else sources.set(key, { ...source });
      return sources;
    }, new Map()).values()];
    result.gold_reward = earnedGold;
    result.gold_sources = goldSources;
    result.contract_result = contract ? { ...contract, passed: contractPassed } : null;
    const economyLines = state.mode === GAME_MODES.CONTRACT_SHOP
      ? [
        ...(contract ? [{
          label: `条约 · ${contract.name}`,
          text: contractPassed ? `已达成 · +${contractGold} 金币` : "未达成 · +0 金币",
          kind: contractPassed ? "contract-pass" : "contract-fail",
        }] : []),
        ...(baseGold > 0 ? [{ label: "金币 · 基础吃牌", text: `+${baseGold} 金币`, kind: "gold-detail" }] : []),
        ...summarizedGoldSources.filter((source) => source.amount > 0).map((source) => ({
          label: `金币 · ${source.kind === "item" ? "道具 · " : source.kind === "card" ? "卡牌 · " : ""}${source.label}`,
          text: `+${source.amount} 金币`,
          kind: "gold-detail",
        })),
        ...(slowGold > 0 ? [{ label: "金币 · 慢速出餐", text: `+${slowGold} 金币`, kind: "gold-detail" }] : []),
        ...(speedGold > 0 ? [{ label: `金币 · ${speedGold === 2 ? "8 秒" : "12 秒"}清盘`, text: `+${speedGold} 金币`, kind: "gold-detail" }] : []),
        { label: "本轮获得金币", text: `+${earnedGold} 金币`, kind: "gold-total" },
      ]
      : [{ label: "本轮获得金币", text: `+${earnedGold} 金币`, kind: "gold-total" }];
    result.breakdown.splice(-1, 0, ...economyLines);
    if (contract) {
      state.rule_history.push({ id: contract.id, name: contract.name, round: state.current_round, completed: contractPassed });
      state.active_rules = [];
    }
  }
  refreshTable();
  const milestone = engine.levelProgressCheck(state);
  const failed = milestone.target > 0 && !milestone.passed;

  if (!failed && !isShopMode(state.mode) && isPlateUpgradeRound(state.current_round)) {
    const capacityLimit = state.mode === GAME_MODES.ENDLESS
      ? GAME_CONFIG.endless_max_plate_capacity
      : GAME_CONFIG.max_plate_capacity;
    if (state.plate_capacity < capacityLimit) {
      state.plate_capacity = Math.min(capacityLimit, state.plate_capacity + 1);
      state.plate_upgrade_count += 1;
      result.plate_upgrade = true;
      result.breakdown.splice(-1, 0, { label: "五轮赠礼", text: `餐盘上限永久 +1 · 当前 ${state.plate_capacity}`, kind: "bonus" });
    }
    if (state.mode === GAME_MODES.ENDLESS) {
      state.delete_tokens = safeAdd(state.delete_tokens ?? 0, 1);
      result.breakdown.splice(-1, 0, { label: "无尽补给", text: `删牌标记 +1 · 当前 ${state.delete_tokens}`, kind: "bonus" });
    }
  }
  const won = !failed && (state.mode === GAME_MODES.ENDLESS
    ? state.total_score >= GAME_CONFIG.endless_victory_score
    : state.current_round >= engine.getFinalRound(state));
  const outcome = failed ? "defeat" : won ? "victory" : null;
  if (outcome) {
    state.outcome = outcome;
    transitionPhase(state, GAME_PHASES.GAME_OVER, { outcome, score: state.total_score });
    const record = {
      score: state.total_score,
      outcome,
      mode: state.mode,
      round: state.current_round,
      finished_at: new Date().toISOString(),
      schema_version: state.schema_version,
    };
    browserPlatform.save_record(record);
    state.unlock_progress = browserPlatform.record_run_progress(record);
    browserPlatform.clear_run();
    if (effectsEnabled) playSound(outcome === "victory" ? "milestone" : "error", 1);
  } else if (!isShopMode(state.mode)) {
    state.draft_resolved = false;
    draftBuffer = draftService.getOffers(state);
    state.pending_draft_ids = draftBuffer.map((card) => card.id);
    void ui.preloadCardArt(draftBuffer);
    if (effectsEnabled) playSound("milestone", Math.min(8, state.current_round));
  }
  state.pending_summary = { result, outcome };
  if (!outcome) saveGame();
  presentRoundSummary();
}

function resolveForcedDiscards() {
  if (!state.round.force_discard_remaining) return;
  state.round.force_discard_remaining = false;
  while (state.round.draw_pile.length > 0 && state.round.actions.length < GAME_CONFIG.max_actions_per_round) {
    const forcedCard = state.round.draw_pile.pop();
    engine.recordAction(state, "discard", forcedCard);
    if (state.deck.some((item) => item.uuid === forcedCard.uuid)) state.round.spent_pile.push(forcedCard);
  }
  state.round.draw_pile.length = 0;
}

function resolveEmptyDrawPile() {
  if (state.round.draw_pile.length > 0) return false;
  const reshuffle = getReshuffleStatus(state);
  if (reshuffle.can_use) {
    const result = activateReshuffle(state, shuffle);
    if (!result.success) {
      completeRound();
      return true;
    }
    actionLocked = true;
    streak = { action: null, count: 0 };
    refreshTable();
    ui.showEffectFlash(`自动重洗 · ${result.replayed_count} 张牌回到餐盘`);
    ui.playReshuffleAnimation();
    saveGame();
    window.setTimeout(() => {
      if (state.phase !== GAME_PHASES.PLAYING) return;
      actionLocked = false;
      refreshTable();
      renderTutorial();
    }, 580);
    return true;
  }
  completeRound();
  return true;
}

function handleAction(action, card) {
  if (state.phase !== GAME_PHASES.PLAYING) {
    actionLocked = false;
    return;
  }
  const currentCard = getCurrentCard(state);
  if (!currentCard || currentCard.uuid !== card.uuid) {
    actionLocked = false;
    refreshTable();
    return;
  }
  const hitCount = updateStreak(action);
  state.round.live_elapsed_ms = state.round.started_at_ms
    ? Math.max(0, browserPlatform.now() - state.round.started_at_ms)
    : 0;
  const entry = engine.recordAction(state, action, card);
  if (tutorial.active) {
    if (action === "eat" && card.edibility === "edible") tutorial.correct_eat = true;
    if (action === "discard" && card.edibility === "inedible") tutorial.correct_discard = true;
  }
  state.round.draw_pile.pop();
  if (state.deck.some((item) => item.uuid === card.uuid)) state.round.spent_pile.push(card);
  if (state.round.consume_next_uuid) {
    const consumed = getCurrentCard(state);
    if (consumed?.uuid === state.round.consume_next_uuid) state.round.draw_pile.pop();
    state.round.consume_next_uuid = null;
  }
  ui.showFloatingScore(entry.points, action, hitCount);
  if (entry.wrong_edibility) ui.showHardEat(entry.wrong_edibility_streak, entry.points);
  if (entry.fruit_combo) ui.showFruitCombo(entry.fruit_combo);
  if (entry.effect_triggered) ui.showEffectFlash(entry.effect_triggered, entry);
  presentItemEvents(entry.item_events);
  ui.showPointMutation(entry, card);
  ui.punchAction(entry.points, hitCount);
  if (effectsEnabled) {
    playSound(action, hitCount);
    if (entry.effect_triggered) playSound("effect", hitCount);
    if (hitCount >= 3 || entry.points >= 8) playSound("combo", Math.max(hitCount, entry.points));
  }
  if (entry.points < 0) {
    if (effectsEnabled) playSound("error", 1);
  }
  if (state.round.actions.length >= GAME_CONFIG.max_actions_per_round) {
    state.round.force_discard_remaining = true;
    ui.showEffectFlash("本轮行动已达安全上限，剩余牌自动清空");
  }
  resolveForcedDiscards();
  ui.setGestureProgress({ progress: 0, direction: null });
  saveGame();
  if (!resolveEmptyDrawPile()) {
    actionLocked = false;
    refreshTable();
    renderTutorial();
  }
}

function handlePostpone(card) {
  if (state.phase !== GAME_PHASES.PLAYING) {
    actionLocked = false;
    return;
  }
  const currentCard = getCurrentCard(state);
  if (!currentCard || currentCard.uuid !== card.uuid) {
    actionLocked = false;
    refreshTable();
    return;
  }
  const postponeLimit = getPostponeLimit(state);
  const result = postponeCurrentCard(state, { max_per_card: postponeLimit });
  if (!result.success) {
    actionLocked = false;
    ui.showEffectFlash(result.reason === "already_postponed" ? `「${card.name}」本轮已达到后置次数上限` : "餐盘只剩一张牌，无法后置");
    refreshTable();
    return;
  }
  const effectResult = engine.recordPostpone(state, card);
  const totalPostponeScore = (result.score_bonus ?? 0) + (effectResult.score_bonus ?? 0);
  streak = { action: null, count: 0 };
  const messages = [result.direction === "front" ? `末牌「${result.revealed_card?.name ?? "未知牌"}」立即登场` : `后置「${card.name}」`];
  if (totalPostponeScore > 0) ui.showFloatingScore(totalPostponeScore, "postpone", 1);
  messages.push(...effectResult.messages);
  ui.showEffectFlash(messages.join(" · "));
  ui.punchAction(totalPostponeScore, 1, "postpone");
  presentItemEvents(effectResult.item_events);
  if (tutorial.active) tutorial.postponed = true;
  if (effectsEnabled) playSound("postpone", 1);
  actionLocked = false;
  saveGame();
  refreshTable();
  renderTutorial();
}

const gesture = createGestureController({
  onEat: (card) => handleAction("eat", card),
  onDiscard: (card) => handleAction("discard", card),
  onPostpone: (card) => handlePostpone(card),
  onProgress: (progress) => ui.setGestureProgress(progress),
  onCommit: () => { actionLocked = true; },
});

function prepareRound() {
  resetRoundState(state);
  state.free_rerolls = 1;
  const roundStartMessages = [
    ...applyRoundItemSetup(state, { create_id: browserPlatform.create_id }),
    ...engine.applyRoundStartEffects(state),
  ];
  const roundDeck = state.deck.map((card) => ({
    ...card,
    effect: card.effect ? { ...card.effect, keywords: [...(card.effect.keywords ?? [])] } : null,
  }));
  Object.assign(state.round, takeRoundDrawPile(roundDeck, state.plate_capacity, browserPlatform.random));
  roundStartMessages.push(...applyRoundItemDrawSetup(state, browserPlatform.random));
  streak = { action: null, count: 0 };
  actionLocked = true;
  refreshTable();
  if (effectsEnabled) playSound("deal", state.round.draw_pile.length);
  ui.playDealAnimation(state.round.draw_pile.length, () => {
    state.round.started_at_ms = browserPlatform.now();
    state.round.elapsed_ms = 0;
    transitionPhase(state, GAME_PHASES.PLAYING, { round: state.current_round });
    actionLocked = false;
    saveGame();
    ui.renderHud(state);
    if (roundStartMessages.length > 0) ui.showEffectFlash(roundStartMessages.join(" · "));
    renderTutorial();
  });
}

function enterRuleDraft() {
  if (state.phase === GAME_PHASES.INIT || state.phase === GAME_PHASES.NEXT_ROUND) {
    transitionPhase(state, GAME_PHASES.RULE_DRAFT, { round: state.current_round });
  }
  const previous = state.rule_history.slice(-1).map((entry) => ({ id: entry.id }));
  const options = randomDraftRules(GAME_CONFIG.draft_size, previous, browserPlatform.random, state.deck, state.current_round);
  ui.renderHud(state);
  ui.openRuleDraft(options, state, (rule) => {
    if (state.phase !== GAME_PHASES.RULE_DRAFT) return;
    state.active_rules = [{ ...rule, selected_round: state.current_round }];
    ui.closeRuleDraft();
    saveGame();
    prepareRound();
  });
}

function enterShop() {
  if (state.phase !== GAME_PHASES.SHOP) return;
  if (shopBuffer === null) restorePendingShop();
  if (shopBuffer === null) shopBuffer = shopService.getShopCards(state);
  else shopBuffer = shopService.repriceShopCards(state, shopBuffer);
  if (shopThemeBuffer === null) {
    const themed = shopService.getThemedShopCards(state);
    shopThemeBuffer = themed.cards;
    shopThemeType = themed.type;
  } else shopThemeBuffer = shopService.repriceShopCards(state, shopThemeBuffer);
  if (shopItemBuffer === null) shopItemBuffer = shopService.getShopItems(state);
  const arrivedWithLockedShop = Boolean(state.shop_lock_carry);
  if (arrivedWithLockedShop) state.shop_lock_carry = false;
  shopService.applyOpeningPriceOverride(state, [shopBuffer, shopThemeBuffer]);
  savePendingShop();
  const redraw = () => { savePendingShop(); saveGame(); enterShop(); };
  ui.openShop(
    state, shopBuffer, shopThemeBuffer, shopThemeType, shopItemBuffer,
    (card) => {
      if (shopService.buyCard(state, card)) {
        shopBuffer = shopBuffer.filter((entry) => entry !== card);
        shopThemeBuffer = shopThemeBuffer.filter((entry) => entry !== card);
        ui.setShopMessage(`购入「${card.name}」，已加入永久牌组。`, "success");
      } else ui.setShopMessage("购买失败：请检查金币或牌组上限。", "error");
      redraw();
    },
    (item) => {
      if (shopService.buyItem(state, item)) {
        shopItemBuffer = shopItemBuffer.filter((entry) => entry !== item);
        ui.setShopMessage(`购入道具「${item.name}」。`, "success");
      } else ui.setShopMessage("道具购买失败：金币不足或已经持有。", "error");
      redraw();
    },
    (uuid) => {
      if (shopService.removeCard(state, uuid)) ui.setShopMessage("卡牌已永久删除。", "success");
      else ui.setShopMessage("无法删除：至少保留一张牌，并确认金币足够。", "error");
      redraw();
    },
    () => {
      const result = shopService.buyPlateUpgrade(state);
      ui.setShopMessage(result.success ? `餐盘上限提升至 ${result.plate_capacity}。` : "金币不足或餐盘已满。", result.success ? "success" : "error");
      redraw();
    },
    () => {
      const result = shopService.rerollShop(state);
      if (result.success) {
        shopBuffer = result.cards;
        shopThemeBuffer = result.themed_cards;
        shopThemeType = result.theme_type;
        shopItemBuffer = result.items;
        ui.setShopMessage(result.free ? "使用免费刷新。" : `支付 ${result.cost} 金币刷新。`, "success");
      } else ui.setShopMessage(`金币不足，刷新需要 ${result.cost}。`, "error");
      redraw();
    },
    () => {
      state.shop_lock_requested = !state.shop_lock_requested;
      ui.setShopMessage(state.shop_lock_requested ? "已锁定下轮商店。" : "已取消锁定。", "normal");
      redraw();
    },
    () => {
      if (state.phase !== GAME_PHASES.SHOP) return;
      state.shop_lock_carry = state.shop_lock_requested;
      state.shop_lock_requested = false;
      if (!state.shop_lock_carry) {
        shopBuffer = null; shopThemeBuffer = null; shopThemeType = null; shopItemBuffer = null;
        state.pending_shop = null;
      } else {
        savePendingShop();
      }
      ui.closeShop();
      transitionPhase(state, GAME_PHASES.NEXT_ROUND, { round: state.current_round });
      state.current_round += 1;
      saveGame();
      if (state.mode === GAME_MODES.CONTRACT_SHOP) enterRuleDraft();
      else prepareRound();
    },
    shopService.getPlateUpgradeStatus(state),
    arrivedWithLockedShop,
  );
}

function restoreRun(saved) {
  state = saved;
  state.items ??= [];
  hydrateOwnedItems(state);
  state.item_history ??= [];
  state.pending_draft_ids ??= [];
  state.pending_item_ids ??= [];
  state.pending_item_resolution ??= null;
  state.exiled_cards ??= [];
  state.draft_resolved ??= false;
  state.item_draft_resolved ??= false;
  state.reroll_tokens ??= 0;
  state.free_rerolls ??= 1;
  state.prep_slot ??= null;
  state.gold ??= 0;
  state.pending_shop ??= null;
  state.rule_history ??= [];
  draftBuffer = state.pending_draft_ids.map(getCardById).filter(Boolean);
  itemBuffer = state.pending_item_ids.map(getItemById).filter(Boolean);
  ui.hideWelcome();
  if (state.phase === GAME_PHASES.PLAYING) {
    actionLocked = false;
    refreshTable();
    return;
  }
  if (state.phase === GAME_PHASES.SCORING && state.pending_summary) {
    refreshTable();
    presentRoundSummary();
    return;
  }
  if (state.phase === GAME_PHASES.CARD_DRAFT) {
    refreshTable();
    enterCardDraft();
    return;
  }
  if (state.phase === GAME_PHASES.ITEM_DRAFT) {
    refreshTable();
    enterItemDraft();
    return;
  }
  if (state.phase === GAME_PHASES.SHOP) {
    refreshTable();
    enterShop();
    return;
  }
  if (state.phase === GAME_PHASES.RULE_DRAFT) {
    refreshTable();
    enterRuleDraft();
    return;
  }
  prepareRound();
}

function tryCommit(action) {
  if (actionLocked || state.phase !== GAME_PHASES.PLAYING || ui.hasBlockingOverlay()) return;
  if (gesture.commit(action)) actionLocked = true;
}

function goHome() {
  saveGame();
  location.reload();
}

ui.bindControls({
  onEat: () => tryCommit("eat"),
  onDiscard: () => tryCommit("discard"),
  onPostpone: () => tryCommit("postpone"),
  onMenu: () => ui.openMenu(state, settings, browserPlatform.load_progression(), getCurrentUnlocks()),
});

ui.bindMenu({
  onMusic: (enabled) => {
    musicEnabled = enabled;
    settings = browserPlatform.save_settings({ ...settings, music: enabled });
    if (enabled) {
      startSound();
      void unlockAudio().then(() => toggleBGM(true));
    } else {
      toggleBGM(false);
    }
    ui.renderSettings(settings);
  },
  onEffects: (enabled) => {
    effectsEnabled = enabled;
    settings = browserPlatform.save_settings({ ...settings, effects: enabled });
    if (enabled) void unlockAudio();
    ui.renderSettings(settings);
  },
  onFontSize: (fontSize) => {
    settings = browserPlatform.save_settings({ ...settings, font_size: fontSize });
    ui.applyFontSize(fontSize);
    ui.renderSettings(settings);
  },
  onHome: goHome,
});

ui.bindTutorial({ onSkip: finishTutorial, onContinue: finishTutorial, onReplay: startTutorial });

window.addEventListener("keydown", (event) => {
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  tryCommit(event.key === "ArrowUp" ? "discard" : event.key === "ArrowDown" ? "eat" : "postpone");
});

window.addEventListener("pagehide", () => {
  saveGame();
  gesture.destroy();
}, { once: true });

ui.applyFontSize(settings.font_size);
ui.renderSettings(settings);
if (musicEnabled) toggleBGM(true);
if (musicEnabled || effectsEnabled) {
  let audioUnlockPending = false;
  let audioUnlocked = false;
  const unlockFromGesture = () => {
    if (audioUnlocked || audioUnlockPending) return;
    audioUnlockPending = true;
    void unlockAudio().then((context) => {
      audioUnlockPending = false;
      audioUnlocked = context.state === "running";
      if (audioUnlocked && musicEnabled) toggleBGM(true);
    });
  };
  window.addEventListener("pointerdown", unlockFromGesture, { capture: true });
  window.addEventListener("keydown", unlockFromGesture, { capture: true });
  window.addEventListener("touchstart", unlockFromGesture, { capture: true, passive: true });
}
function tickTimer() {
  if (state.mode === GAME_MODES.CONTRACT_SHOP && state.phase === GAME_PHASES.PLAYING && state.round.started_at_ms) {
    ui.renderTimer(browserPlatform.now() - state.round.started_at_ms);
  }
  requestAnimationFrame(tickTimer);
}
requestAnimationFrame(tickTimer);

const developerMode = (
  ["localhost", "127.0.0.1", "::1"].includes(location.hostname) || location.protocol === "file:"
) && new URLSearchParams(location.search).get("dev") === "1";
const developerUnlocks = Object.freeze({
  random_start: true,
  prep: true,
  shop: true,
  contract_shop: true,
  endless: true,
  hard: true,
  god: true,
});
const getCurrentUnlocks = () => developerMode ? developerUnlocks : browserPlatform.get_unlocks();
const progression = browserPlatform.load_progression();
const unlocks = getCurrentUnlocks();
document.documentElement.dataset.developerMode = developerMode ? "true" : "false";
ui.openWelcome({
  onNew: (mode) => {
    startSound();
    browserPlatform.clear_run();
    const randomStart = unlocks.random_start && settings.random_start;
    state = createInitialPlayerState({ create_id: browserPlatform.create_id, mode, random_start: randomStart, random: browserPlatform.random });
    ui.hideWelcome();
    const launch = () => {
      if (!browserPlatform.load_tutorial_complete() && mode === GAME_MODES.NORMAL) startTutorial();
      if (mode === GAME_MODES.CONTRACT_SHOP) enterRuleDraft();
      else prepareRound();
    };
    if (isShopMode(mode) && !browserPlatform.load_shop_tutorial_complete()) {
      ui.openShopTutorial(mode, () => { browserPlatform.save_shop_tutorial_complete(); launch(); });
    } else launch();
  },
  onContinue: () => {
    const saved = browserPlatform.load_run();
    if (!saved) return;
    startSound();
    restoreRun(saved);
  },
  onMenu: () => ui.openMenu(null, settings, browserPlatform.load_progression(), getCurrentUnlocks()),
  onRandomStart: (enabled) => {
    settings = browserPlatform.save_settings({ ...settings, random_start: enabled });
  },
  onHomeTheme: (theme) => {
    settings = browserPlatform.save_settings({ ...settings, home_theme: theme });
    ui.setHomeTheme(settings.home_theme);
    setBGMTheme(settings.home_theme);
  },
}, {
  best_score: browserPlatform.load_records()[0]?.score ?? null,
  has_save: browserPlatform.has_saved_run(),
  unlocks,
  progression,
  random_start: settings.random_start,
  home_theme: settings.home_theme,
  god: Boolean(progression.god),
  developer_mode: developerMode,
});
