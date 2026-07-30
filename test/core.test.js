import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { GAME_CONFIG, GAME_MODES, getFinalRound, getNextMilestone, isPlateUpgradeRound } from "../js/config.js";
import { CARD_LIBRARY, createCardPool, createInitialDeck, getCardById } from "../js/data.js";
import { createDraftService } from "../js/draft.js";
import { createRoundEngine } from "../js/engine.js";
import { postponeCurrentCard, takeRoundDrawPile } from "../js/plate.js";
import {
  getCurrentCard,
  getFinalRemainingCard,
  getNextCard,
  getRemainingCardCount,
  getRemainingCards,
  getRemainingCardsInPlayOrder,
  markCardsPostponed,
} from "../js/round-pile.js";
import { CARD_EFFECT_CONTRACTS } from "../js/card-effect-contracts.js";
import { migrateRunState } from "../js/platform.js";
import { GAME_PHASES, createInitialPlayerState, resetRoundState, transitionPhase } from "../js/state.js";
import {
  activateCategoryRoundItem,
  applyRoundItemDrawSetup,
  applyRoundItemSetup,
  chooseItem,
  createItemPool,
  getItemActionOverrides,
  getItemCardOffers,
  getItemFinalMultipliers,
  getItemRoundEndEffects,
  getPostponeLimit,
  hasUnlimitedPostpone,
  maybeDuplicateGeneratedCard,
  randomDraftItems,
  resolveItemActionEffects,
} from "../js/items.js";

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
  state.delete_tokens = 0;
  state.deck = ids.map((id, index) => owned(id, index));
  resetRoundState(state);
  state.round.draw_pile = state.deck.map((card) => ({ ...card, effect: card.effect ? { ...card.effect } : null }));
  state.round.action_budget = state.round.draw_pile.length;
  return state;
}

test("牌堆查询统一区分当前、下一张、剩余顺序与最后一张", () => {
  const state = stateWith(["F001", "K001", "A001", "P001"]);
  assert.equal(getCurrentCard(state).id, "P001");
  assert.equal(getNextCard(state).id, "A001");
  assert.equal(getFinalRemainingCard(state).id, "F001");
  assert.equal(getRemainingCardCount(state), 3);
  assert.deepEqual(getRemainingCards(state).map((card) => card.id), ["F001", "K001", "A001"]);
  assert.deepEqual(getRemainingCardsInPlayOrder(state).map((card) => card.id), ["A001", "K001", "F001"]);
});

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

test("旧自动存档迁移后保留对局并切换到稀有度道具状态", () => {
  const saved = {
    schema_version: 20,
    phase: GAME_PHASES.PLAYING,
    current_round: 4,
    total_score: 72,
    deck: [{ id: "F009", uuid: "pear-saved" }],
    round: { postponed_uuids: ["pear-saved"] },
  };
  const migrated = migrateRunState(saved);
  assert.equal(migrated.schema_version, 23);
  assert.equal(migrated.current_round, 4);
  assert.equal(migrated.total_score, 72);
  assert.equal(migrated.deck[0].uuid, "pear-saved");
  assert.equal(migrated.round.postpone_counts["pear-saved"], 1);
  assert.equal(migrated.round.item_fruit_chain, 0);
  assert.equal(migrated.item_serial, 0);
  assert.deepEqual(migrated.items, []);
  assert.deepEqual(migrated.exiled_cards, []);
  assert.equal(migrated.free_rerolls, 1);
});

test("当前版本存档也会修复后置 UUID 与次数不一致", () => {
  const state = createInitialPlayerState({ create_id: nextId });
  state.round.postponed_uuids = [state.deck[0].uuid];
  state.round.postpone_counts = {};
  const migrated = migrateRunState(state);
  assert.equal(migrated.round.postpone_counts[state.deck[0].uuid], 1);

  migrated.round.postponed_uuids = [];
  migrated.round.postpone_counts[state.deck[1].uuid] = 1;
  const reconciled = migrateRunState(migrated);
  assert.ok(reconciled.round.postponed_uuids.includes(state.deck[1].uuid));
});

test("状态机从开局直接出牌，轮末只进入三选一", () => {
  const state = createInitialPlayerState({ create_id: nextId });
  assert.equal(state.phase, GAME_PHASES.INIT);
  assert.equal(state.gold, undefined);
  assert.equal(state.delete_tokens, 1);
  assert.equal(state.reroll_tokens, 0);
  assert.equal(state.free_rerolls, 1);
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

test("每轮第一次选牌刷新免费，之后才消耗刷新标记", () => {
  const state = createInitialPlayerState({ create_id: nextId });
  const service = createDraftService({ random: () => 0, create_id: nextId });
  state.phase = GAME_PHASES.CARD_DRAFT;
  const first = service.getOffers(state);
  const result = service.reroll(state, first);
  assert.equal(result.success, true);
  assert.equal(result.used_free, true);
  assert.equal(state.free_rerolls, 0);
  assert.equal(state.reroll_tokens, 0);
  assert.equal(result.offers.length, 3);
  assert.equal(result.offers.some((card) => first.some((old) => old.id === card.id)), false);
  assert.equal(service.reroll(state, result.offers).reason, "no_token");
  state.reroll_tokens = 1;
  const paid = service.reroll(state, result.offers);
  assert.equal(paid.success, true);
  assert.equal(paid.used_free, false);
  assert.equal(state.reroll_tokens, 0);
});

test("删牌必须在轮末选牌阶段消耗删牌标记，且至少保留一张", () => {
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

test("新道具池包含 32 件命名道具、四档稀有度与定向候选", () => {
  const state = createInitialPlayerState({ create_id: nextId });
  const pool = createItemPool();
  assert.equal(pool.length, 32);
  assert.deepEqual(new Set(pool.map((item) => item.rarity)), new Set(["普通", "罕见", "稀有", "传奇"]));
  assert.equal(new Set(pool.map((item) => item.id)).size, 32);
  assert.equal(pool.find((item) => item.id === "C10").name, "魔法帽");
  const offers = randomDraftItems(state, 3, () => 0);
  assert.equal(offers.length, 3);
  assert.equal(new Set(offers.map((entry) => entry.id)).size, 3);
  assert.equal(offers[1].bridge, true);
  assert.equal(offers[2].wild, true);
});

test("一次性选牌券、刷新硬币与类别通行证会立即进入各自结算", () => {
  const state = createInitialPlayerState({ create_id: nextId });
  const fruitTicket = chooseItem(state, "A1");
  assert.equal(fruitTicket.resolution, "card_choice");
  assert.ok(getItemCardOffers(fruitTicket.card_type, 3, () => 0).every((card) => card.type === "水果"));
  const rerollsBefore = state.reroll_tokens;
  assert.equal(chooseItem(state, "C3").resolution, "immediate");
  assert.equal(state.reroll_tokens, rerollsBefore + 2);
  assert.equal(state.items.length, 0);
  assert.equal(chooseItem(state, "C19").resolution, "category_choice");
  assert.equal(activateCategoryRoundItem(state, "C19", "甜点").success, true);
  assert.equal(state.items[0].selected_type, "甜点");
  assert.equal(state.items[0].applies_round, state.current_round + 1);
});

test("金面天平使用较高牌面，首尾砝码只改牌面而不翻倍效果", () => {
  const engine = createRoundEngine();
  const bestState = stateWith(["A001", "F009"]);
  assert.equal(chooseItem(bestState, "B1").success, true);
  const cat = bestState.deck[0];
  const best = engine.recordAction(bestState, "eat", cat);
  assert.equal(best.printed_points, 2);

  const edgeState = stateWith(["F009", "K001"]);
  assert.equal(chooseItem(edgeState, "C18").success, true);
  assert.equal(engine.recordAction(edgeState, "eat", edgeState.deck[0]).printed_points, 0);
  edgeState.round.actions.push({ action: "eat" });
  edgeState.round.draw_pile = [edgeState.deck[1]];
  assert.equal(getItemActionOverrides(edgeState, "eat", edgeState.deck[1]).printed_multiplier, 2);
});

test("无限后置、动物领队、12 秒倍率与临时复制按轮生效", () => {
  const state = stateWith(["F009", "A001", "A004"]);
  assert.equal(chooseItem(state, "C14").success, true);
  assert.equal(hasUnlimitedPostpone(state), true);
  assert.equal(getPostponeLimit(state), Infinity);

  assert.equal(chooseItem(state, "C5").success, true);
  applyRoundItemDrawSetup(state, () => 0);
  assert.equal(state.round.draw_pile.at(-1).type, "动物");

  assert.equal(chooseItem(state, "C12").success, true);
  state.round.elapsed_ms = 11999;
  assert.equal(getItemFinalMultipliers(state)[0].multiplier, 1.2);

  assert.equal(chooseItem(state, "C16").success, true);
  const generated = owned("F009", "generated");
  state.deck.push(generated);
  const copy = maybeDuplicateGeneratedCard(state, generated);
  assert.equal(copy.temporary, true);
  assert.equal(copy.effect, null);
  assert.equal(maybeDuplicateGeneratedCard(state, generated), null);
});

test("周期删牌、错误食性连击与三式打卡器在轮末结算", () => {
  const state = stateWith(["F009", "A001", "K001"]);
  state.current_round = 3;
  assert.equal(chooseItem(state, "C1").success, true);
  assert.equal(chooseItem(state, "B2").success, true);
  assert.equal(chooseItem(state, "C20").success, true);
  state.round.best_wrong_edibility_streak = 4;
  state.round.actions = [{ action: "eat" }, { action: "discard" }];
  state.round.postpone_count = 1;
  const result = getItemRoundEndEffects(state, () => 0);
  assert.equal(state.delete_tokens, 1);
  assert.equal(result.score_bonus, 5);
});

test("摧毁保护只挡第一次，沼气炉把真实摧毁转换为牌堆顶临时火", () => {
  const engine = createRoundEngine({ random: () => 0 });
  const protectedState = stateWith(["A001", "F013"]);
  assert.equal(chooseItem(protectedState, "C2").success, true);
  const lantern = protectedState.round.draw_pile.at(-1);
  engine.recordAction(protectedState, "eat", lantern);
  assert.ok(protectedState.deck.some((card) => card.uuid === lantern.uuid));
  assert.equal(protectedState.round.destroyed_count, 0);

  const gasState = stateWith(["A001", "F013"]);
  assert.equal(chooseItem(gasState, "C15").success, true);
  const fuel = gasState.round.draw_pile.at(-1);
  engine.recordAction(gasState, "eat", fuel);
  gasState.round.draw_pile.pop();
  const gas = gasState.round.draw_pile.at(-1);
  assert.equal(gas.name, "沼气火");
  assert.equal(gas.eat_points, 8);
  assert.equal(gas.discard_points, -3);
  assert.equal(gas.temporary, true);
});

test("双层吸管重复饮料效果，梨香催熟袋改写香蕉生成", () => {
  const engine = createRoundEngine({ random: () => 0 });
  const drinkState = stateWith(["A001", "B003"]);
  assert.equal(chooseItem(drinkState, "C9").success, true);
  engine.recordAction(drinkState, "eat", drinkState.round.draw_pile.at(-1));
  assert.equal(drinkState.round.buffs.filter((buff) => buff.value === 4).length, 2);

  const bananaState = stateWith(["A001", "F002"]);
  assert.equal(chooseItem(bananaState, "C11").success, true);
  bananaState.round.fruit_combo = 2;
  engine.recordAction(bananaState, "eat", bananaState.round.draw_pile.at(-1));
  assert.ok(bananaState.deck.some((card) => card.id === "F009" && card.generated_from === "F002"));
});

test("恢复复利会按恢复差值永久成长，冷藏水果离场一轮后带成长返回", () => {
  const engine = createRoundEngine({ random: () => 0 });
  const restoreState = stateWith(["F009", "B001"]);
  const pear = restoreState.deck.find((card) => card.id === "F009");
  pear.eat_points = 0;
  restoreState.round.draw_pile.find((card) => card.uuid === pear.uuid).eat_points = 0;
  assert.equal(chooseItem(restoreState, "C13").success, true);
  engine.recordAction(restoreState, "eat", restoreState.round.draw_pile.at(-1));
  assert.equal(pear.eat_points, 2);

  const coldState = stateWith(["A001", "F009"]);
  assert.equal(chooseItem(coldState, "C17").success, true);
  const coldPear = coldState.deck.find((card) => card.id === "F009");
  coldState.round.actions = [{ action: "eat", type: "水果", card_uuid: coldPear.uuid }];
  getItemRoundEndEffects(coldState, () => 0);
  assert.equal(coldState.deck.some((card) => card.uuid === coldPear.uuid), false);
  coldState.current_round += 1;
  resetRoundState(coldState);
  applyRoundItemSetup(coldState);
  assert.equal(coldState.deck.some((card) => card.uuid === coldPear.uuid), false);
  coldState.current_round += 1;
  resetRoundState(coldState);
  applyRoundItemSetup(coldState);
  assert.equal(coldState.deck.find((card) => card.uuid === coldPear.uuid).eat_points, coldPear.eat_points + 2);
});

test("交替吃弃、弃水果和错误食性吃会分别显示并给出即时奖励", () => {
  const state = stateWith(["F009", "A001"]);
  assert.equal(chooseItem(state, "C7").success, true);
  assert.equal(chooseItem(state, "C8").success, true);
  assert.equal(chooseItem(state, "B3").success, true);
  state.round.last_item_action = "eat";
  const fruitDiscard = resolveItemActionEffects(state, "discard", state.deck[0]);
  assert.equal(fruitDiscard.flat_bonus, 3);
  assert.match(fruitDiscard.messages.join(" "), /交替/);
  state.round.last_item_action = "discard";
  const wrongEat = resolveItemActionEffects(state, "eat", state.deck[1]);
  assert.equal(wrongEat.flat_bonus, 2);
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

test("所有后置打标效果会同步状态与次数，普通规则禁止再次后置", () => {
  for (const sourceId of ["K011", "C004", "C011", "U004"]) {
    const state = stateWith(["F001", "A001", sourceId]);
    const engine = createRoundEngine({ random: () => 0 });
    const source = state.round.draw_pile.at(-1);
    assert.equal(postponeCurrentCard(state).success, true);
    const result = engine.recordPostpone(state, source);
    const remaining = state.round.draw_pile.filter((card) => card.uuid !== source.uuid);
    assert.equal(result.triggered, true, sourceId);
    assert.equal(remaining.length, 2, sourceId);
    assert.ok(remaining.every((card) => state.round.postponed_uuids.includes(card.uuid)), sourceId);
    assert.ok(remaining.every((card) => state.round.postpone_counts[card.uuid] === 1), sourceId);
    assert.equal(postponeCurrentCard(state).reason, "already_postponed", `${sourceId} 标记后的牌不能再次普通后置`);
    assert.equal(postponeCurrentCard(state, { unlimited: true }).success, true, `${sourceId} 可被无限后置规则改写`);
  }

  const actionState = stateWith(["F001", "A001", "U008"]);
  const actionEngine = createRoundEngine();
  const laminator = actionState.round.draw_pile.at(-1);
  actionEngine.recordAction(actionState, "discard", laminator);
  actionState.round.draw_pile.pop();
  assert.ok(actionState.round.draw_pile.every((card) => actionState.round.postponed_uuids.includes(card.uuid)));
  assert.ok(actionState.round.draw_pile.every((card) => actionState.round.postpone_counts[card.uuid] === 1));
  assert.equal(postponeCurrentCard(actionState).reason, "already_postponed");

  const animalState = stateWith(["A001", "A010"]);
  const animalEngine = createRoundEngine({ random: () => 0 });
  const sheepdog = animalState.round.draw_pile.at(-1);
  assert.equal(postponeCurrentCard(animalState).success, true);
  animalEngine.recordPostpone(animalState, sheepdog);
  const markedAnimal = animalState.round.draw_pile.at(-1);
  assert.ok(animalState.round.postponed_uuids.includes(markedAnimal.uuid));
  assert.equal(animalState.round.postpone_counts[markedAnimal.uuid], 1);
  assert.equal(postponeCurrentCard(animalState).reason, "already_postponed");
});

test("后置结算使用移动后的下一张，并正确统计除来源外的整副餐盘", () => {
  const engine = createRoundEngine({ random: () => 0 });

  const lunchboxState = stateWith(["F001", "A001", "K011"]);
  const lunchbox = getCurrentCard(lunchboxState);
  assert.equal(postponeCurrentCard(lunchboxState).success, true);
  engine.recordPostpone(lunchboxState, lunchbox);
  const ownedLunchbox = lunchboxState.deck.find((card) => card.uuid === lunchbox.uuid);
  assert.equal(ownedLunchbox.eat_points, -1);
  assert.equal(ownedLunchbox.discard_points, 1);

  const wingState = stateWith(["F001", "A001", "K007"]);
  const wing = getCurrentCard(wingState);
  assert.equal(postponeCurrentCard(wingState).success, true);
  assert.equal(getCurrentCard(wingState).id, "A001");
  engine.recordPostpone(wingState, wing);
  assert.equal(wingState.deck.find((card) => card.id === "A001").eat_points, -2);
  assert.equal(wingState.deck.find((card) => card.id === "K007").eat_points, 5);

  const reverseState = stateWith(["F001", "A001", "K007"]);
  reverseState.round.reverse_postpone_charges = 1;
  const reverseWing = getCurrentCard(reverseState);
  const reverseResult = postponeCurrentCard(reverseState);
  assert.equal(reverseResult.direction, "front");
  assert.equal(getCurrentCard(reverseState).id, "F001");
  engine.recordPostpone(reverseState, reverseWing);
  assert.equal(reverseState.deck.find((card) => card.id === "F001").eat_points, 0);
});

test("美食评论家按下一张牌的食性给予结算加分或永久降低弃点", () => {
  const engine = createRoundEngine();

  const edibleState = stateWith(["K001", "P010"]);
  const edibleCritic = edibleState.round.draw_pile.at(-1);
  engine.recordAction(edibleState, "discard", edibleCritic);
  const edibleNext = edibleState.round.draw_pile[0];
  assert.equal(edibleState.round.card_score_bonuses[edibleNext.uuid], 3);
  edibleState.round.draw_pile.pop();
  const edibleResult = engine.recordAction(edibleState, "eat", edibleNext);
  assert.equal(edibleResult.effect_bonus, 3);
  assert.equal(edibleResult.points, 5);

  const inedibleState = stateWith(["A001", "P010"]);
  const inedibleCritic = inedibleState.round.draw_pile.at(-1);
  const inedibleNext = inedibleState.deck[0];
  const discardBefore = inedibleNext.discard_points;
  engine.recordAction(inedibleState, "discard", inedibleCritic);
  assert.equal(inedibleNext.discard_points, discardBefore - 1);
  assert.equal(inedibleState.round.card_score_bonuses[inedibleNext.uuid] ?? 0, 0);
});

test("风险经纪人只在它是本轮第一张弃牌时额外加七分", () => {
  const engine = createRoundEngine();

  const firstDiscardState = stateWith(["P002"]);
  const firstResult = engine.recordAction(firstDiscardState, "discard", firstDiscardState.round.draw_pile.at(-1));
  assert.equal(firstResult.effect_bonus, 7);
  assert.equal(firstResult.points, 4);

  const afterEatState = stateWith(["P002", "F001"]);
  engine.recordAction(afterEatState, "eat", afterEatState.round.draw_pile.at(-1));
  afterEatState.round.draw_pile.pop();
  const afterEatResult = engine.recordAction(afterEatState, "discard", afterEatState.round.draw_pile.at(-1));
  assert.equal(afterEatResult.effect_bonus, 7);

  const afterDiscardState = stateWith(["P002", "A001"]);
  engine.recordAction(afterDiscardState, "discard", afterDiscardState.round.draw_pile.at(-1));
  afterDiscardState.round.draw_pile.pop();
  const lateResult = engine.recordAction(afterDiscardState, "discard", afterDiscardState.round.draw_pile.at(-1));
  assert.equal(lateResult.effect_bonus, 0);
  assert.equal(lateResult.points, -3);
});

test("隔夜餐盒与辣鸡翅使用调整后的稀有度", () => {
  assert.equal(CARD_LIBRARY.K011.rarity, "稀有");
  assert.equal(CARD_LIBRARY.K007.rarity, "罕见");
});

test("餐盘数量、下一张、末牌和已后置目标按统一牌堆语义结算", () => {
  const engine = createRoundEngine({ random: () => 0 });

  const dessertState = stateWith(["D001", "F001", "D010"]);
  const dessertResult = engine.recordAction(dessertState, "eat", getCurrentCard(dessertState));
  assert.equal(dessertResult.effect_bonus, 1);
  assert.equal(dessertResult.points, 2);

  const remainingState = stateWith(["F001", "A001", "K001", "C006"]);
  const remainingResult = engine.recordAction(remainingState, "discard", getCurrentCard(remainingState));
  assert.equal(remainingResult.effect_bonus, 3);
  assert.equal(remainingResult.points, 5);

  const uniqueState = stateWith(["F001", "A001", "K001", "P009"]);
  const uniqueResult = engine.recordAction(uniqueState, "discard", getCurrentCard(uniqueState));
  assert.equal(uniqueResult.effect_bonus, 3);

  const tailState = stateWith(["F001", "A001", "D011"]);
  const tailResult = engine.recordAction(tailState, "eat", getCurrentCard(tailState));
  assert.equal(tailResult.effect_bonus, 3);

  const markedState = stateWith(["F001", "A001", "C009"]);
  markCardsPostponed(markedState, getRemainingCards(markedState));
  const moon = getCurrentCard(markedState);
  engine.recordAction(markedState, "discard", moon);
  markedState.round.draw_pile.pop();
  const markedResult = engine.recordAction(markedState, "discard", getCurrentCard(markedState));
  assert.equal(markedResult.effect_bonus, 2);
  assert.equal(markedResult.points, 4);
});

test("89 张卡均有有效契约，并可在基础与相邻上下文安全结算", () => {
  const supportIds = ["F001", "K001", "D001", "B001", "A001", "C001", "P001", "U001"];
  const cards = createCardPool();
  const engine = createRoundEngine({ random: () => 0 });
  assert.equal(cards.length, 89);

  for (const template of cards) {
    if (template.effect) assert.ok(CARD_EFFECT_CONTRACTS[template.effect.kind], `${template.id} 缺少效果契约`);

    for (const action of ["eat", "discard"]) {
      const state = stateWith([...supportIds, template.id]);
      const result = engine.recordAction(state, action, getCurrentCard(state));
      assert.ok(Number.isFinite(result.points), `${template.id} ${action} 得分不是有限数`);
      assert.ok(state.deck.every((card) => Number.isFinite(card.eat_points) && Number.isFinite(card.discard_points)), `${template.id} ${action} 产生非法牌面`);
    }

    const warmState = stateWith([...supportIds, template.id, "F001"]);
    engine.recordAction(warmState, "eat", getCurrentCard(warmState));
    warmState.round.draw_pile.pop();
    const warmResult = engine.recordAction(warmState, "discard", getCurrentCard(warmState));
    assert.ok(Number.isFinite(warmResult.points), `${template.id} 相邻上下文得分不是有限数`);

    const timing = template.effect ? CARD_EFFECT_CONTRACTS[template.effect.kind].timing : "";
    if (timing.includes("postpone")) {
      const state = stateWith([...supportIds, template.id]);
      const source = getCurrentCard(state);
      assert.equal(postponeCurrentCard(state).success, true, `${template.id} 无法进行首次后置`);
      const result = engine.recordPostpone(state, source);
      assert.ok(Number.isFinite(result.score_bonus), `${template.id} 后置奖励不是有限数`);
    }
  }
});

test("加分券的两次蓄势每轮只允许创建一次", () => {
  const state = stateWith(["U003", "U003"]);
  const engine = createRoundEngine();
  const first = getCurrentCard(state);
  engine.recordAction(state, "discard", first);
  state.round.draw_pile.pop();
  const second = getCurrentCard(state);
  engine.recordAction(state, "discard", second);
  assert.equal(state.round.buffs.filter((buff) => buff.source === "加分券").length, 2, "两张不同实体各创建一组蓄势");

  const repeatedState = stateWith(["U003", "F001"]);
  const coupon = repeatedState.deck[0];
  engine.recordAction(repeatedState, "discard", coupon);
  engine.recordAction(repeatedState, "discard", coupon);
  assert.equal(repeatedState.round.buffs.filter((buff) => buff.source === "加分券").length, 1);
});

test("发馊外卖、变味炸鸡桶与三明治使用新版快餐规则", () => {
  const engine = createRoundEngine({ random: () => 0 });

  const takeoutState = stateWith(["K005", "F001"]);
  const takeout = takeoutState.deck[0];
  engine.recordAction(takeoutState, "eat", takeout);
  assert.equal(takeout.eat_points, 2);
  assert.equal(takeout.discard_points, -1);
  const deckBefore = takeoutState.deck.length;
  engine.recordAction(takeoutState, "discard", takeout);
  assert.equal(takeoutState.deck.length, deckBefore + 1);
  assert.equal(takeoutState.deck.at(-1).id, "K005");

  const bucketState = stateWith(["K006", "F001"]);
  const bucket = bucketState.deck[0];
  engine.recordAction(bucketState, "eat", bucket);
  assert.equal(bucket.eat_points, 1);
  assert.equal(bucket.discard_points, -1);
  engine.recordAction(bucketState, "discard", bucket);
  assert.equal(bucketState.next_draft_forced_type, "快餐");
  bucketState.phase = GAME_PHASES.CARD_DRAFT;
  const service = createDraftService({ random: () => 0, create_id: nextId });
  const forcedOffers = service.getOffers(bucketState);
  assert.ok(forcedOffers.some((card) => card.type === "快餐"));
  service.skip(bucketState);
  assert.equal(bucketState.next_draft_forced_type, null);

  const sandwichState = stateWith(["K002", "K008"]);
  const sandwich = sandwichState.deck[1];
  engine.recordAction(sandwichState, "eat", sandwich);
  assert.equal(sandwich.eat_points, 0);
  assert.equal(sandwich.discard_points, 0);
  sandwichState.round.draw_pile.pop();
  const ramen = sandwichState.deck[0];
  engine.recordAction(sandwichState, "eat", ramen);
  assert.equal(ramen.eat_points, 0);
  assert.equal(ramen.discard_points, 1);
});

test("原经济牌现在提供体系内分数或删牌标记", () => {
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

test("留存爆发可以产出删牌标记，不经过金币", () => {
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
  assert.doesNotMatch(`${main}\n${ui}`, /\.vibrate\(|navigator\.vibrate/);
  assert.match(html, /id="itemDraft"/);
  assert.match(main, /saveGame\(\)/);
});
