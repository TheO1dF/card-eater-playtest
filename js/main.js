import { GAME_CONFIG, isPlateUpgradeRound } from "./config.js";
import { GAME_PHASES, createInitialPlayerState, resetRoundState, transitionPhase } from "./state.js";
import { createGestureController } from "./gesture.js";
import { createRoundEngine } from "./engine.js";
import { createDraftService } from "./draft.js";
import { createUI } from "./ui.js";
import { browserPlatform } from "./platform.js";
import { initAudio, playSound, toggleBGM } from "./audio.js";
import { postponeCurrentCard, takeRoundDrawPile } from "./plate.js";
import { activateReshuffle, getReshuffleStatus } from "./reshuffle.js";

const state = createInitialPlayerState({ create_id: browserPlatform.create_id });
const engine = createRoundEngine({ random: browserPlatform.random });
const draftService = createDraftService({ random: browserPlatform.random, create_id: browserPlatform.create_id });
const ui = createUI(document);

let draftBuffer = [];
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
      message: edible
        ? `「${card.name}」可食用。下滑或点击“吃掉”，获得吃点并触发卡牌效果。`
        : `「${card?.name ?? "当前牌"}」不可食用。先把它后置，寻找可食用牌。`,
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
      message: "后置会把当前牌移到餐盘末尾，不结算，也不占用行动。每轮每张实体牌只能后置一次。",
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
      message: inedible
        ? `「${card.name}」不可食用。上滑或点击“弃掉”，使用它的弃点。`
        : `「${card?.name ?? "当前牌"}」可食用。继续后置，找到一张不可食用牌。`,
      objective: inedible ? "完成一次符合食性的弃牌。" : "后置当前牌，寻找不可食用牌。",
      target: inedible ? "#discardButton" : "#postponeButton",
      progress,
    });
    return;
  }
  ui.showStoryGuide({
    step: "complete",
    chapter: "EPILOGUE · 每轮都在构筑",
    message: "餐盘清空后，你会从三张卡里选一张加入永久牌组，也可以跳过。第 5、10、15 轮要达到阶段目标。",
    objective: "需要删牌时，在轮末选牌阶段点击牌组并消耗 token。",
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

function finishDraft() {
  ui.closeCardDraft();
  transitionPhase(state, GAME_PHASES.NEXT_ROUND, { round: state.current_round });
  state.current_round += 1;
  prepareRound();
}

function enterCardDraft() {
  if (state.phase !== GAME_PHASES.CARD_DRAFT) return;
  if (draftBuffer.length === 0) draftBuffer = draftService.getOffers(state);
  void ui.preloadCardArt(draftBuffer);
  ui.openCardDraft(state, draftBuffer, {
    onChoose: (card) => {
      if (state.phase !== GAME_PHASES.CARD_DRAFT) return;
      const added = draftService.addCard(state, card);
      if (!added) return;
      draftBuffer = [];
      finishDraft();
    },
    onSkip: () => {
      if (state.phase !== GAME_PHASES.CARD_DRAFT) return;
      draftService.skip(state);
      draftBuffer = [];
      finishDraft();
    },
    onRemove: (cardUuid) => {
      const result = draftService.removeCard(state, cardUuid);
      ui.renderHud(state);
      return result;
    },
  });
}

function completeRound() {
  actionLocked = true;
  transitionPhase(state, GAME_PHASES.SCORING, { round: state.current_round });
  renderTutorial();
  const result = engine.finalizeRound(state);
  refreshTable();

  const milestone = engine.levelProgressCheck(state);
  const failed = milestone.target > 0 && !milestone.passed;
  if (!failed && isPlateUpgradeRound(state.current_round)) {
    state.plate_capacity = Math.min(GAME_CONFIG.max_plate_capacity, state.plate_capacity + 1);
    state.plate_upgrade_count += 1;
    result.plate_upgrade = true;
    result.breakdown.splice(-1, 0, {
      label: "五轮赠礼",
      text: `餐盘上限永久 +1 · 当前 ${state.plate_capacity}`,
      kind: "bonus",
    });
  }
  const won = !failed && state.current_round >= GAME_CONFIG.total_rounds;
  const outcome = failed ? "defeat" : won ? "victory" : null;

  if (outcome) {
    state.outcome = outcome;
    transitionPhase(state, GAME_PHASES.GAME_OVER, { outcome, score: state.total_score });
    browserPlatform.save_record({
      score: state.total_score,
      outcome,
      round: state.current_round,
      finished_at: new Date().toISOString(),
      schema_version: state.schema_version,
    });
  } else {
    draftBuffer = draftService.getOffers(state);
    void ui.preloadCardArt(draftBuffer);
  }

  ui.showRoundSummary(result, state, outcome, () => {
    if (outcome) {
      location.reload();
      return;
    }
    ui.hideRoundSummary();
    transitionPhase(state, GAME_PHASES.CARD_DRAFT, { round: state.current_round });
    enterCardDraft();
  });
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
    ui.showEffectFlash(`自动重洗 · ${result.replayed_count} 张牌回到餐盘 · 剩余 ${result.remaining_charges} 次`);
    ui.playReshuffleAnimation();
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
  ui.showPointMutation(entry, card);
  if (effectsEnabled) {
    playSound(action, hitCount);
    if (entry.effect_triggered) playSound("effect", hitCount);
  }
  browserPlatform.vibrate(entry.points < 0 ? [16, 20, 16] : 7);
  if (entry.points < 0) {
    ui.triggerShake();
    if (effectsEnabled) playSound("error", 1);
  }
  if (state.round.actions.length >= GAME_CONFIG.max_actions_per_round) {
    state.round.force_discard_remaining = true;
    ui.showEffectFlash("本轮行动已达安全上限，剩余牌自动清空");
  }
  resolveForcedDiscards();
  ui.setGestureProgress({ progress: 0, direction: null });
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
  const result = postponeCurrentCard(state);
  if (!result.success) {
    actionLocked = false;
    ui.showEffectFlash(result.reason === "already_postponed" ? `「${card.name}」本轮已经后置过` : "餐盘只剩一张牌，无法后置");
    refreshTable();
    return;
  }
  const effectResult = engine.recordPostpone(state, card);
  streak = { action: null, count: 0 };
  const messages = [result.direction === "front"
    ? `末牌「${result.revealed_card?.name ?? "未知牌"}」立即登场`
    : `后置「${card.name}」`];
  if (result.score_bonus > 0) ui.showFloatingScore(result.score_bonus, "postpone", 1);
  messages.push(...effectResult.messages);
  ui.showEffectFlash(messages.join(" · "));
  if (tutorial.active) tutorial.postponed = true;
  if (effectsEnabled) playSound("effect", 1);
  actionLocked = false;
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
  const roundStartMessages = engine.applyRoundStartEffects(state);
  const shuffledDeck = shuffle(state.deck.map((card) => ({
    ...card,
    effect: card.effect ? { ...card.effect, keywords: [...(card.effect.keywords ?? [])] } : null,
  })));
  Object.assign(state.round, takeRoundDrawPile(shuffledDeck, state.plate_capacity));
  streak = { action: null, count: 0 };
  actionLocked = true;
  refreshTable();
  ui.showCountdown(() => {
    transitionPhase(state, GAME_PHASES.PLAYING, { round: state.current_round });
    actionLocked = false;
    ui.renderHud(state);
    if (roundStartMessages.length > 0) ui.showEffectFlash(roundStartMessages.join(" · "));
    renderTutorial();
  });
}

function tryCommit(action) {
  if (actionLocked || state.phase !== GAME_PHASES.PLAYING) return;
  if (gesture.commit(action)) actionLocked = true;
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
});

ui.bindTutorial({ onSkip: finishTutorial, onContinue: finishTutorial, onReplay: startTutorial });

window.addEventListener("keydown", (event) => {
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  tryCommit(event.key === "ArrowUp" ? "discard" : event.key === "ArrowDown" ? "eat" : "postpone");
});

window.addEventListener("pagehide", () => gesture.destroy(), { once: true });
ui.applyFontSize(settings.font_size);
ui.renderSettings(settings);

const launchGame = (withTutorial) => {
  startSound();
  if (withTutorial) startTutorial();
  else ui.hideStoryGuide();
  prepareRound();
};

ui.openWelcome(
  { onNormal: () => launchGame(false), onTutorial: () => launchGame(true) },
  browserPlatform.load_records()[0]?.score ?? null,
  browserPlatform.load_tutorial_complete(),
);
