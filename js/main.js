import { GAME_CONFIG, GAME_MODES, isPlateUpgradeRound } from "./config.js";
import { GAME_PHASES, createInitialPlayerState, resetRoundState, transitionPhase } from "./state.js";
import { createGestureController } from "./gesture.js";
import { createRoundEngine } from "./engine.js";
import { createDraftService } from "./draft.js";
import { createUI } from "./ui.js";
import { browserPlatform } from "./platform.js";
import { initAudio, playSound, toggleBGM } from "./audio.js";
import { postponeCurrentCard, takeRoundDrawPile } from "./plate.js";
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
const ui = createUI(document);

let draftBuffer = [];
let itemBuffer = [];
let actionLocked = true;
let streak = { action: null, count: 0 };
let settings = browserPlatform.load_settings();
let musicEnabled = settings.music;
let effectsEnabled = settings.effects;
let bgmStarted = false;
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

function startSound() {
  if (!musicEnabled && !effectsEnabled) return;
  initAudio();
  if (musicEnabled && !bgmStarted) {
    toggleBGM(true);
    bgmStarted = true;
  }
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
  const card = state.round.draw_pile.at(-1);
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
    transitionPhase(state, GAME_PHASES.CARD_DRAFT, { round: state.current_round });
    saveGame();
    enterCardDraft();
  });
}

function completeRound() {
  actionLocked = true;
  transitionPhase(state, GAME_PHASES.SCORING, { round: state.current_round });
  renderTutorial();
  if (state.round.started_at_ms) state.round.elapsed_ms = Math.max(1, browserPlatform.now() - state.round.started_at_ms);
  const result = engine.finalizeRound(state);
  refreshTable();
  const milestone = engine.levelProgressCheck(state);
  const failed = milestone.target > 0 && !milestone.passed;

  if (!failed && isPlateUpgradeRound(state.current_round)) {
    state.plate_capacity = Math.min(GAME_CONFIG.max_plate_capacity, state.plate_capacity + 1);
    state.plate_upgrade_count += 1;
    result.plate_upgrade = true;
    result.breakdown.splice(-1, 0, { label: "五轮赠礼", text: `餐盘上限永久 +1 · 当前 ${state.plate_capacity}`, kind: "bonus" });
  }
  const won = !failed && state.mode !== GAME_MODES.ENDLESS && state.current_round >= engine.getFinalRound(state);
  const outcome = failed ? "defeat" : won ? "victory" : null;
  if (outcome) {
    state.outcome = outcome;
    transitionPhase(state, GAME_PHASES.GAME_OVER, { outcome, score: state.total_score });
    browserPlatform.save_record({
      score: state.total_score,
      outcome,
      mode: state.mode,
      round: state.current_round,
      finished_at: new Date().toISOString(),
      schema_version: state.schema_version,
    });
    browserPlatform.clear_run();
    if (effectsEnabled) playSound(outcome === "victory" ? "milestone" : "error", 1);
  } else {
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
  const currentCard = state.round.draw_pile.at(-1);
  if (!currentCard || currentCard.uuid !== card.uuid) {
    actionLocked = false;
    refreshTable();
    return;
  }
  const hitCount = updateStreak(action);
  const entry = engine.recordAction(state, action, card);
  if (tutorial.active) {
    if (action === "eat" && card.edibility === "edible") tutorial.correct_eat = true;
    if (action === "discard" && card.edibility === "inedible") tutorial.correct_discard = true;
  }
  state.round.draw_pile.pop();
  if (state.deck.some((item) => item.uuid === card.uuid)) state.round.spent_pile.push(card);
  if (state.round.consume_next_uuid) {
    const consumed = state.round.draw_pile.at(-1);
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
  const currentCard = state.round.draw_pile.at(-1);
  if (!currentCard || currentCard.uuid !== card.uuid) {
    actionLocked = false;
    refreshTable();
    return;
  }
  const postponeLimit = getPostponeLimit(state);
  const result = postponeCurrentCard(state, { max_per_card: postponeLimit, unlimited: postponeLimit === Infinity });
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
  const shuffledDeck = shuffle(state.deck.map((card) => ({
    ...card,
    effect: card.effect ? { ...card.effect, keywords: [...(card.effect.keywords ?? [])] } : null,
  })));
  Object.assign(state.round, takeRoundDrawPile(shuffledDeck, state.plate_capacity));
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
  prepareRound();
}

function tryCommit(action) {
  if (actionLocked || state.phase !== GAME_PHASES.PLAYING) return;
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
  onMenu: () => ui.openMenu(state, settings),
});

ui.bindMenu({
  onMusic: (enabled) => {
    musicEnabled = enabled;
    settings = browserPlatform.save_settings({ ...settings, music: enabled });
    if (enabled) {
      startSound();
      toggleBGM(true);
      bgmStarted = true;
    } else {
      toggleBGM(false);
      bgmStarted = false;
    }
    ui.renderSettings(settings);
  },
  onEffects: (enabled) => {
    effectsEnabled = enabled;
    settings = browserPlatform.save_settings({ ...settings, effects: enabled });
    if (enabled) initAudio();
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
if (musicEnabled) {
  startSound();
  const unlockAudio = () => {
    initAudio();
    toggleBGM(true);
    bgmStarted = true;
  };
  window.addEventListener("pointerdown", unlockAudio, { once: true, capture: true });
  window.addEventListener("keydown", unlockAudio, { once: true, capture: true });
  window.addEventListener("touchstart", unlockAudio, { once: true, capture: true });
}
ui.openWelcome({
  onNew: (mode) => {
    startSound();
    browserPlatform.clear_run();
    state = createInitialPlayerState({ create_id: browserPlatform.create_id, mode });
    ui.hideWelcome();
    if (!browserPlatform.load_tutorial_complete()) startTutorial();
    prepareRound();
  },
  onContinue: () => {
    const saved = browserPlatform.load_run();
    if (!saved) return;
    startSound();
    restoreRun(saved);
  },
  onMenu: () => ui.openMenu(null, settings),
}, {
  best_score: browserPlatform.load_records()[0]?.score ?? null,
  has_save: browserPlatform.has_saved_run(),
  unlocked: browserPlatform.has_completed_run(),
});
