import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { GAME_CONFIG, GAME_MODES, getFinalRound, getNextMilestone, isPlateUpgradeRound } from "../js/config.js";
import { CARD_LIBRARY, createCardPool, createInitialDeck, getCardById } from "../js/data.js";
import { createDraftService } from "../js/draft.js";
import { createRoundEngine } from "../js/engine.js";
import { postponeCurrentCard, takeRoundDrawPile } from "../js/plate.js";
import { GAME_PHASES, createInitialPlayerState, resetRoundState, transitionPhase } from "../js/state.js";
import { applyRoundItemSetup, chooseItem, createItemPool, hasUnlimitedPostpone, randomDraftItems } from "../js/items.js";

let uuidCounter = 0;
const nextId = (card) => `${card.id}-test-${uuidCounter += 1}`;

function owned(id, suffix = "owned") {
  const card = getCardById(id);
  return {
    ...card,
    synergy_tags: [...card.synergy_tags],
    effect: card.effect ? { ...card.effect, keywords: [...card.effect.keywords] } : null,
    uuid: `${id}-${suffix}-${uuidCounter += 1}`,
  };
}

function stateWith(ids) {
  const state = createInitialPlayerState({ create_id: nextId });
  state.deck = ids.map((id, index) => owned(id, index));
  resetRoundState(state);
  state.round.draw_pile = state.deck.map((card) => ({ ...card, effect: card.effect ? { ...card.effect } : null }));
  state.round.action_budget = state.round.draw_pile.length;
  return state;
}

test("试验版通常为 15 轮，并在第 5/10/15 轮检查 100/300/500", () => {
  assert.equal(GAME_CONFIG.total_rounds, 15);
  assert.equal(getFinalRound(), 15);
  assert.deepEqual(GAME_CONFIG.milestone_targets, { 5: 100, 10: 300, 15: 500 });
  assert.deepEqual(getNextMilestone(1), { base_round: 5, round: 5, target: 100, endless: false });
  assert.deepEqual(getNextMilestone(6), { base_round: 10, round: 10, target: 300, endless: false });
  assert.deepEqual(getNextMilestone(11), { base_round: 15, round: 15, target: 500, endless: false });
  assert.deepEqual(getNextMilestone(5, { 5: 1 }), { base_round: 5, round: 6, target: 100, endless: false });
  assert.equal(getFinalRound({ 15: 2 }), 17);
  assert.equal(isPlateUpgradeRound(5), true);
  assert.equal(isPlateUpgradeRound(10), true);
  assert.equal(isPlateUpgradeRound(15), true);
  assert.equal(isPlateUpgradeRound(4), false);
  assert.equal(getFinalRound({}, GAME_MODES.ENDLESS), Infinity);
  assert.deepEqual(getNextMilestone(16, {}, GAME_MODES.ENDLESS), { base_round: null, round: null, target: 0, endless: true });
  assert.equal(getNextMilestone(1, {}, GAME_MODES.HARD).target, 120);
});

test("状态机从开局直接出牌，轮末只进入三选一", () => {
  const state = createInitialPlayerState({ create_id: nextId });
  assert.equal(state.phase, GAME_PHASES.INIT);
  assert.equal(state.gold, undefined);
  assert.equal(state.delete_tokens, 0);
  transitionPhase(state, GAME_PHASES.PLAYING);
  transitionPhase(state, GAME_PHASES.SCORING);
  transitionPhase(state, GAME_PHASES.CARD_DRAFT);
  transitionPhase(state, GAME_PHASES.NEXT_ROUND);
  transitionPhase(state, GAME_PHASES.PLAYING);
  assert.deepEqual(state.phase_history.map(({ to }) => to), ["Playing", "Scoring", "CardDraft", "NextRound", "Playing"]);
});

test("初始餐盘上限为 10，且每轮只随机登场餐盘上限数量", () => {
  const state = createInitialPlayerState({ create_id: nextId });
  assert.equal(state.plate_capacity, 10);
  const cards = [...state.deck, owned("F001", "extra-a"), owned("K001", "extra-b"), owned("D001", "extra-c"), owned("A001", "extra-d"), owned("B001", "extra-e")];
  const round = takeRoundDrawPile(cards, state.plate_capacity);
  assert.equal(round.draw_pile.length, 10);
  assert.equal(round.action_budget, 10);
  assert.equal(round.reserve_count, 2);
  assert.equal(round.reserve_cards.length, 2);
});

test("轮末奖励固定三选一，可选牌或跳过", () => {
  const state = createInitialPlayerState({ create_id: nextId });
  state.current_round = 6;
  const service = createDraftService({ random: () => 0, create_id: nextId });
  const offers = service.getOffers(state);
  assert.equal(offers.length, 3);
  assert.equal(new Set(offers.map((card) => card.id)).size, 3);
  const before = state.deck.length;
  const added = service.addCard(state, offers[0]);
  assert.equal(state.deck.length, before + 1);
  assert.equal(added.id, offers[0].id);
  assert.deepEqual(state.draft_history.at(-1), { round: 6, card_id: offers[0].id, skipped: false });
  service.skip(state);
  assert.deepEqual(state.draft_history.at(-1), { round: 6, card_id: null, skipped: true });
});

test("选牌刷新消耗 token，并避开当前三张牌", () => {
  const state = createInitialPlayerState({ create_id: nextId });
  const service = createDraftService({ random: () => 0, create_id: nextId });
  state.phase = GAME_PHASES.CARD_DRAFT;
  const first = service.getOffers(state);
  const result = service.reroll(state, first);
  assert.equal(result.success, true);
  assert.equal(state.reroll_tokens, 0);
  assert.equal(result.offers.length, 3);
  assert.equal(result.offers.some((card) => first.some((old) => old.id === card.id)), false);
  assert.equal(service.reroll(state, result.offers).reason, "no_token");
});

test("删牌必须在轮末选牌阶段消耗 token，且至少保留一张", () => {
  const state = createInitialPlayerState({ create_id: nextId });
  const service = createDraftService();
  state.delete_tokens = 2;
  state.phase = GAME_PHASES.PLAYING;
  assert.equal(service.removeCard(state, state.deck[0].uuid).reason, "wrong_phase");
  state.phase = GAME_PHASES.CARD_DRAFT;
  const removed = service.removeCard(state, state.deck[0].uuid);
  assert.equal(removed.success, true);
  assert.equal(state.delete_tokens, 1);
  assert.equal(state.deck.length, 6);
  state.deck = [state.deck[0]];
  assert.equal(service.removeCard(state, state.deck[0].uuid).reason, "last_card");
  state.delete_tokens = 0;
  assert.equal(service.removeCard(state, state.deck[0].uuid).reason, "no_token");
});

test("89 张卡保留八类结构与唯一美术，玩家文案不再自动堆叠标签", async () => {
  const cards = createCardPool();
  assert.equal(cards.length, 89);
  assert.deepEqual(Object.fromEntries([...new Set(cards.map((card) => card.type))].map((type) => [type, cards.filter((card) => card.type === type).length])), {
    水果: 13, 快餐: 12, 甜点: 11, 饮料: 12, 动物: 12, 星体: 11, 人物: 10, 通用: 8,
  });
  assert.equal(new Set(cards.map((card) => card.id)).size, 89);
  assert.equal(new Set(cards.map((card) => card.art_file)).size, 89);
  assert.ok(cards.every((card) => !card.effect?.description.startsWith("【")), "效果说明不应自动显示内部标签");
  for (const card of cards) {
    await assert.doesNotReject(() => readFile(new URL(`../assets/${card.art_file}`, import.meta.url)));
  }
});

test("卡池不再包含经济角色或金币、商店、计时效果说明", () => {
  const cards = createCardPool();
  const forbidden = /金币|商店|刷新|价格|计时|限时|合约/;
  assert.equal(cards.filter((card) => card.role === "economy").length, 0);
  assert.deepEqual(cards.filter((card) => forbidden.test(card.effect?.description ?? "")).map((card) => card.id), []);
});

test("初始牌组仍是七张教学牌，四张可食用、三张不可食用", () => {
  const deck = createInitialDeck({ create_id: nextId });
  assert.equal(deck.length, 7);
  assert.equal(deck.filter((card) => card.edibility === "edible").length, 4);
  assert.equal(deck.filter((card) => card.edibility === "inedible").length, 3);
  assert.equal(new Set(deck.map((card) => card.uuid)).size, 7);
  assert.ok(deck.some((card) => card.id === "F009"), "初始牌组应包含梨子");
  assert.equal(deck.some((card) => card.id === "F003"), false, "初始牌组不再包含西瓜");
});

test("每三轮道具三选一支持永久、一次性、生成与无限后置", () => {
  const state = createInitialPlayerState({ create_id: nextId });
  const offers = randomDraftItems(state, 3, () => 0);
  assert.equal(offers.length, 3);
  assert.equal(new Set(offers.map((entry) => entry.id)).size, 3);

  const instant = chooseItem(state, "IT101");
  assert.equal(instant.consumed, true);
  assert.equal(state.delete_tokens, 2);
  assert.equal(state.items.some((entry) => entry.id === "IT101"), false);

  assert.equal(chooseItem(state, "IT011").success, true);
  assert.equal(hasUnlimitedPostpone(state), true);
  resetRoundState(state);
  state.round.draw_pile = [owned("F001", "post-a"), owned("A001", "post-b")];
  assert.equal(postponeCurrentCard(state, { unlimited: true }).success, true);
  assert.equal(postponeCurrentCard(state, { unlimited: true }).success, true);
  assert.equal(postponeCurrentCard(state, { unlimited: true }).success, true);

  assert.equal(chooseItem(state, "IT012").success, true);
  const before = state.deck.length;
  const messages = applyRoundItemSetup(state, { create_id: nextId });
  assert.equal(state.deck.length, before + 1);
  assert.equal(state.deck.at(-1).id, "F009");
  assert.equal(state.deck.at(-1).weakened, true);
  assert.equal(messages.length, 1);
});

test("新道具候选不再奖励牌组尺寸限制或额外餐盘扩容", () => {
  const pool = createItemPool();
  assert.ok(pool.length >= 12);
  assert.ok(pool.every((item) => item.effect.kind !== "deck_multiplier"));
  assert.ok(pool.every((item) => item.effect.kind !== "grant_plate_capacity"));
});

test("道具阶段位于卡牌三选一与下一轮之间", () => {
  const state = createInitialPlayerState({ create_id: nextId });
  transitionPhase(state, GAME_PHASES.PLAYING);
  transitionPhase(state, GAME_PHASES.SCORING);
  transitionPhase(state, GAME_PHASES.CARD_DRAFT);
  transitionPhase(state, GAME_PHASES.ITEM_DRAFT);
  transitionPhase(state, GAME_PHASES.NEXT_ROUND);
  assert.deepEqual(state.phase_history.map(({ to }) => to), ["Playing", "Scoring", "CardDraft", "ItemDraft", "NextRound"]);
});

test("内部效果标签仍供引擎使用，但不写入开头说明", () => {
  const banana = CARD_LIBRARY.F002;
  assert.ok(banana.effect.keywords.includes("水果连击"));
  assert.equal(banana.effect.description.startsWith("【"), false);
  assert.match(banana.effect.description, /水果连击/);
});

test("水果连击、后置与甜点留存继续工作", () => {
  const engine = createRoundEngine({ random: () => 0 });
  const fruitState = stateWith(["F002", "F003", "A001"]);
  const first = engine.recordAction(fruitState, "eat", fruitState.deck[0]);
  const second = engine.recordAction(fruitState, "eat", fruitState.deck[1]);
  assert.equal(first.fruit_combo, 1);
  assert.equal(second.fruit_combo, 2);
  assert.ok(second.points > first.points);

  const postponeState = stateWith(["A001", "F001"]);
  const current = postponeState.round.draw_pile.at(-1);
  const postponed = postponeCurrentCard(postponeState);
  assert.equal(postponed.success, true);
  engine.recordPostpone(postponeState, current);
  assert.ok(postponeState.round.postponed_uuids.includes(current.uuid));

  const dessertState = stateWith(["D001", "F001"]);
  engine.recordAction(dessertState, "discard", dessertState.deck[0]);
  assert.equal(dessertState.deck[0].eat_points, 4);
});

test("原经济牌现在提供体系内分数或删牌 token", () => {
  const engine = createRoundEngine();

  const lanternState = stateWith(["F013", "F001"]);
  const lantern = lanternState.deck[0];
  const lanternResult = engine.recordAction(lanternState, "eat", lantern);
  assert.equal(lanternState.delete_tokens, 1);
  assert.equal(lanternState.deck.some((card) => card.uuid === lantern.uuid), false);
  assert.equal(lanternResult.destroyed_self, true);

  const brokerState = stateWith(["P002", "F001"]);
  const broker = engine.recordAction(brokerState, "discard", brokerState.deck[0]);
  assert.equal(broker.points, 4, "-3 牌面与 +7 效果合计应为 4");

  const mealState = stateWith(["K009", "F001"]);
  const meal = engine.recordAction(mealState, "eat", mealState.deck[0]);
  assert.equal(meal.points, 5, "前三次行动应获得 +3 分");
});

test("留存爆发可以产出删牌 token，不经过金币", () => {
  const engine = createRoundEngine();
  const state = stateWith(["D007", "F001"]);
  state.deck[0].eat_points = 10;
  state.round.draw_pile[0].eat_points = 10;
  const result = engine.recordAction(state, "eat", state.round.draw_pile[0]);
  assert.equal(state.delete_tokens, 1);
  assert.equal(result.points, 20);
  assert.equal(state.gold, undefined);
});

test("轮末结算只有分数，没有合约或限时经济条目", () => {
  const engine = createRoundEngine();
  const state = stateWith(["F001", "A001"]);
  engine.recordAction(state, "eat", state.deck[0]);
  engine.recordAction(state, "discard", state.deck[1]);
  const result = engine.finalizeRound(state);
  assert.equal(result.round_score, 3);
  assert.equal(state.total_score, 3);
  assert.deepEqual(result.rule_results, []);
  assert.ok(result.breakdown.every((line) => !/金币|限时|合约|商店/.test(`${line.label}${line.text}`)));
});

test("目标按有效轮次检查，并允许引力井延后", () => {
  const engine = createRoundEngine();
  const state = createInitialPlayerState({ create_id: nextId });
  state.current_round = 5;
  state.total_score = 99;
  assert.deepEqual(engine.levelProgressCheck(state), { passed: false, target: 100, base_round: 5 });
  state.total_score = 100;
  assert.deepEqual(engine.levelProgressCheck(state), { passed: true, target: 100, base_round: 5 });
  state.current_round = 6;
  assert.deepEqual(engine.levelProgressCheck(state), { passed: true, target: 0, base_round: null });
  state.milestone_delays = { 5: 1 };
  state.current_round = 5;
  assert.deepEqual(engine.levelProgressCheck(state), { passed: true, target: 0, base_round: null });
  state.current_round = 6;
  state.total_score = 99;
  assert.deepEqual(engine.levelProgressCheck(state), { passed: false, target: 100, base_round: 5 });
});

test("引力井弃置后摧毁自身并把下一目标延后一轮", () => {
  const engine = createRoundEngine();
  const state = stateWith(["C008", "F001"]);
  state.current_round = 5;
  const gravityWell = state.round.draw_pile.find((card) => card.id === "C008");
  const result = engine.recordAction(state, "discard", gravityWell);
  assert.equal(state.milestone_delays[5], 1);
  assert.equal(state.deck.some((card) => card.uuid === gravityWell.uuid), false);
  assert.equal(result.destroyed_self, true);
  assert.match(result.effect_triggered, /目标结算延后 1 轮/);
});

test("菜单与主循环源码不再包含商店、任务选择、金币或计时 UI", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const main = await readFile(new URL("../js/main.js", import.meta.url), "utf8");
  const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(html, /id="shopPanel"|id="ruleDraft"|id="questDraft"|id="goldValue"|id="timerValue"/);
  assert.doesNotMatch(main, /createShopService|randomDraftRules|randomDraftQuests|tickTimer/);
  assert.match(html, /id="cardDraft"/);
  assert.match(html, /id="tokenValue"/);
  assert.match(html, /id="newGameButton"/);
  assert.match(html, /id="continueGameButton"/);
  assert.match(main, /playDealAnimation/);
  assert.doesNotMatch(`${main}\n${ui}\n${styles}`, /triggerShake|shellShake|impact-heavy/);
  assert.match(html, /id="itemDraft"/);
  assert.match(main, /saveGame\(\)/);
});
