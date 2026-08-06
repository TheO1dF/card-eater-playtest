import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { GAME_CONFIG, GAME_MODES, STANDARD_DIFFICULTY_MAX, getFinalRound, getNextMilestone, getStandardDifficultyConfig, getVisibleStandardDifficultySteps, isPlateUpgradeRound } from "../js/config.js";
import { CARD_LIBRARY, VOID_CARD_ID, createCardPool, createInitialDeck, createShopCardPool, getCardById } from "../js/data.js";
import { createDraftService } from "../js/draft.js";
import { createRoundEngine, evaluateRule } from "../js/engine.js";
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
import { RELEASE_GENERATION, browserPlatform, migrateRunState, prepareReleaseGeneration } from "../js/platform.js";
import { createShopService } from "../js/shop.js";
import { getRoundGoldSources, grantRoundGold, queueRoundGold, sumRoundGoldSources } from "../js/economy.js";
import { SUMMARY_RAPID_CARD_THRESHOLD, getRoundGrade, getScoreHeat, getScoreImpact, getSummaryBeatDuration, getSummaryCardTiming } from "../js/round-presentation.js";
import { mergeCompletedRun, observeRunGold } from "../js/statistics.js";
import { EFFECT_LAYERS, createEffectProcessor, resolveLayeredValue } from "../js/effect-processor.js";
import { changePermanentCard, multiplyFuturePointChanges } from "../js/permanent-points.js";
import { RULE_LIBRARY, addActiveRule, settleActiveRules } from "../js/rules.js";
import { GAME_PHASES, createInitialPlayerState, resetRoundState, transitionPhase } from "../js/state.js";
import { FIRST_MEETING_PROLOGUE, getHomeCompanionLines, getModeCompanionIntro } from "../js/companion.js";
import {
  MUTATION_IDS,
  MUTATION_LIBRARY,
  createFusionCard,
  getMutationTaskMultiplier,
  getRoundDraftPickCount,
  initializeMutationRun,
} from "../js/mutations.js";
import {
  activateCategoryRoundItem,
  applyRoundItemDrawSetup,
  applyRoundItemSetup,
  chooseItem,
  createItemCatalogPool,
  createItemPool,
  createShopItemPool,
  getItemActionOverrides,
  getItemCardOffers,
  getItemFinalMultipliers,
  getItemRoundEndEffects,
  getPostponeLimit,
  hasExtraPostpone,
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

test("标准难度 0 使用 60/180/500，异变沿用教学目标", () => {
  assert.equal(GAME_CONFIG.total_rounds, 15);
  assert.equal(getFinalRound(), 15);
  assert.deepEqual(GAME_CONFIG.milestone_targets, { 5: 80, 10: 200, 15: 600 });
  assert.deepEqual(getNextMilestone(1), { base_round: 5, round: 5, target: 60, endless: false });
  assert.deepEqual(getNextMilestone(6), { base_round: 10, round: 10, target: 180, endless: false });
  assert.deepEqual(getNextMilestone(11), { base_round: 15, round: 15, target: 500, endless: false });
  assert.deepEqual(getNextMilestone(5, { 5: 1 }), { base_round: 5, round: 6, target: 60, endless: false });
  assert.equal(getFinalRound({ 15: 2 }), 17);
  assert.equal(isPlateUpgradeRound(5), true);
  assert.equal(isPlateUpgradeRound(10), true);
  assert.equal(isPlateUpgradeRound(15), true);
  assert.equal(isPlateUpgradeRound(4), false);
  assert.equal(getFinalRound({}, GAME_MODES.ENDLESS), Infinity);
  assert.deepEqual(getNextMilestone(16, {}, GAME_MODES.ENDLESS), { base_round: null, round: null, target: 0, endless: true });
  assert.equal(getNextMilestone(1, {}, GAME_MODES.MUTATION).target, 60);
});

test("标准难度 0 至 10 的限制按层累计", () => {
  assert.equal(STANDARD_DIFFICULTY_MAX, 10);
  assert.deepEqual(getStandardDifficultyConfig(0).targets, { 5: 60, 10: 180, 15: 500 });
  assert.deepEqual(getStandardDifficultyConfig(1).targets, { 5: 80, 10: 180, 15: 500 });
  assert.deepEqual(getStandardDifficultyConfig(2).targets, { 5: 80, 10: 180, 15: 600 });
  assert.deepEqual(getStandardDifficultyConfig(3).targets, { 5: 80, 10: 200, 15: 600 });
  assert.equal(getStandardDifficultyConfig(4).lower_card_draft_rarity, true);
  assert.equal(getStandardDifficultyConfig(5).lower_shop_rarity, true);
  assert.equal(getStandardDifficultyConfig(6).free_round_reroll, false);
  assert.equal(getStandardDifficultyConfig(7).initial_delete_tokens, 0);
  assert.deepEqual(getStandardDifficultyConfig(8).targets, { 5: 100, 10: 200, 15: 600 });
  assert.equal(getStandardDifficultyConfig(9).skip_round_five_plate_upgrade, true);
  assert.equal(getStandardDifficultyConfig(10).starts_with_void, true);

  const tutorial = createInitialPlayerState({ create_id: nextId, difficulty: 0 });
  const hardest = createInitialPlayerState({ create_id: nextId, difficulty: 10 });
  assert.equal(tutorial.delete_tokens, 1);
  assert.equal(tutorial.free_rerolls, 1);
  assert.equal(tutorial.deck.length, 7);
  assert.equal(hardest.delete_tokens, 0);
  assert.equal(hardest.free_rerolls, 0);
  assert.equal(hardest.deck.length, 8);
  assert.equal(hardest.deck.at(-1).id, VOID_CARD_ID);
  assert.equal(getCardById(VOID_CARD_ID).name, "虚空牌");
  assert.equal(getCardById(VOID_CARD_ID).eat_points, -1);
  assert.equal(getCardById(VOID_CARD_ID).discard_points, -1);
});

test("标准难度菜单只渐进显示已解锁难度与紧邻的下一层", () => {
  assert.deepEqual(getVisibleStandardDifficultySteps(0).map(({ level }) => level), [0, 1]);
  assert.deepEqual(getVisibleStandardDifficultySteps(3).map(({ level }) => level), [0, 1, 2, 3, 4]);
  assert.deepEqual(getVisibleStandardDifficultySteps(10).map(({ level }) => level), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("八种异变分别改写开局、选牌、计分与融合规则", () => {
  assert.equal(MUTATION_LIBRARY.length, 8);

  const cats = createInitialPlayerState({ create_id: nextId, mode: GAME_MODES.MUTATION });
  initializeMutationRun(cats, MUTATION_IDS.CAT_ARMY, { create_id: nextId, random: () => 0 });
  assert.ok(cats.deck.every((card) => card.id === "A001"));

  const star = createInitialPlayerState({ create_id: nextId, mode: GAME_MODES.MUTATION });
  initializeMutationRun(star, MUTATION_IDS.START_FROM_STAR, { create_id: nextId, random: () => 0 });
  assert.deepEqual(star.deck.map((card) => card.id), ["C001"]);
  assert.equal(getRoundDraftPickCount(star), 2);

  const animals = createInitialPlayerState({ create_id: nextId, mode: GAME_MODES.MUTATION });
  initializeMutationRun(animals, MUTATION_IDS.ANIMAL_FRIENDS, { create_id: nextId, random: () => 0 });
  animals.phase = GAME_PHASES.CARD_DRAFT;
  const animalOffers = createDraftService({ random: () => 0, create_id: nextId }).getOffers(animals);
  assert.ok(animalOffers.every((card) => card.type === "动物"));

  const speed = createInitialPlayerState({ create_id: nextId, mode: GAME_MODES.MUTATION });
  initializeMutationRun(speed, MUTATION_IDS.SPEED_SERVICE, { create_id: nextId, random: () => 0 });
  assert.ok(speed.items.some((item) => item.id === "C12"));
  assert.equal(getMutationTaskMultiplier({ difficulty: 5 }), 1.2);

  const feast = createInitialPlayerState({ create_id: nextId, mode: GAME_MODES.MUTATION });
  initializeMutationRun(feast, MUTATION_IDS.EAT_FEAST, { create_id: nextId, random: () => 0 });
  const engine = createRoundEngine({ random: () => 0 });
  assert.equal(engine.recordAction(feast, "eat", owned("K001", "feast-eat")).points, 4);
  assert.equal(engine.recordAction(feast, "discard", owned("A001", "feast-discard")).points, 0);

  const fused = createFusionCard(getCardById("P002"), getCardById("U003"));
  assert.equal(fused.eat_points, -4);
  assert.equal(fused.discard_points, -1);
  assert.equal(fused.effect.components.length, 2);
  assert.equal(fused.fusion_parts.length, 2);
});

test("条约限时经济使用 12 秒与 8 秒两档", () => {
  assert.equal(GAME_CONFIG.contract_time_limit_ms, 12_000);
  assert.equal(GAME_CONFIG.contract_fast_time_limit_ms, 8_000);
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
  assert.equal(migrated.schema_version, GAME_CONFIG.schema_version);
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

test("状态机支持轻量选牌流程，也支持条约与商店分支", () => {
  const state = createInitialPlayerState({ create_id: nextId });
  assert.equal(state.phase, GAME_PHASES.INIT);
  assert.equal(state.gold, 0);
  assert.equal(state.delete_tokens, 1);
  assert.equal(state.reroll_tokens, 0);
  assert.equal(state.free_rerolls, 1);
  transitionPhase(state, GAME_PHASES.PLAYING);
  transitionPhase(state, GAME_PHASES.SCORING);
  transitionPhase(state, GAME_PHASES.CARD_DRAFT);
  transitionPhase(state, GAME_PHASES.NEXT_ROUND);
  transitionPhase(state, GAME_PHASES.PLAYING);
  assert.deepEqual(state.phase_history.map(({ to }) => to), ["Playing", "Scoring", "CardDraft", "NextRound", "Playing"]);
  const shop = createInitialPlayerState({ create_id: nextId, mode: GAME_MODES.CONTRACT_SHOP });
  transitionPhase(shop, GAME_PHASES.RULE_DRAFT);
  transitionPhase(shop, GAME_PHASES.PLAYING);
  transitionPhase(shop, GAME_PHASES.SCORING);
  transitionPhase(shop, GAME_PHASES.SHOP);
  assert.equal(shop.phase, GAME_PHASES.SHOP);
});

test("初始餐盘上限为 10，且每轮只随机登场餐盘上限数量", () => {
  const state = createInitialPlayerState({ create_id: nextId });
  assert.equal(state.plate_capacity, 10);
  const cards = [...state.deck, owned("F001", "extra-a"), owned("K001", "extra-b"), owned("D001", "extra-c"), owned("A001", "extra-d"), owned("B001", "extra-e")];
  const round = takeRoundDrawPile(cards, state.plate_capacity, () => 0);
  const alternateRound = takeRoundDrawPile(cards, state.plate_capacity, () => 0.999999);
  assert.equal(round.draw_pile.length, 10);
  assert.equal(round.action_budget, 10);
  assert.equal(round.reserve_count, 2);
  assert.equal(round.reserve_cards.length, 2);
  assert.notDeepEqual(
    round.draw_pile.map((card) => card.uuid),
    alternateRound.draw_pile.map((card) => card.uuid),
    "超出餐盘上限时，登场集合必须由本轮随机抽样决定",
  );
  assert.equal(new Set([...round.draw_pile, ...round.reserve_cards].map((card) => card.uuid)).size, cards.length);
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

test("卡牌稀有度按基础收益、成长与规则改写重新分层", () => {
  const cards = createCardPool();
  const distribution = Object.fromEntries(["普通", "罕见", "稀有", "传奇"].map((rarity) => [
    rarity,
    cards.filter((card) => card.rarity === rarity).length,
  ]));
  assert.deepEqual(distribution, { 普通: 24, 罕见: 35, 稀有: 24, 传奇: 6 });
  assert.equal(CARD_LIBRARY.K001.rarity, "普通");
  assert.equal(CARD_LIBRARY.K004.rarity, "普通", "巨无霸只是高基础点数与自我转换，不应占用稀有位");
  assert.equal(CARD_LIBRARY.K008.rarity, "稀有", "能翻倍剩余快餐点数变化的三明治应属于构筑核心");
  assert.equal(CARD_LIBRARY.C008.rarity, "传奇", "延后里程碑属于改变整局规则的效果");
  assert.equal(CARD_LIBRARY.U002.rarity, "传奇", "整类点数转移并无限成长属于改变流派的效果");
});

test("普通卡池保持轻量，经济效果只在商店卡池回归", () => {
  const cards = createCardPool();
  const forbidden = /金币|商店|价格|计时|限时|合约/;
  assert.equal(cards.filter((card) => card.role === "economy").length, 0);
  assert.deepEqual(cards.filter((card) => forbidden.test(card.effect?.description ?? "")).map((card) => card.id), []);
  const economy = createShopCardPool({ economy: true });
  assert.ok(economy.some((card) => card.role === "economy"));
  assert.match(economy.find((card) => card.id === "F013").effect.description, /金币/);
  assert.equal(economy.find((card) => card.id === "K006").name, "收费炸鸡桶");
});

test("初始牌组仍是七张教学牌，四张可食用、三张不可食用", () => {
  const deck = createInitialDeck({ create_id: nextId });
  assert.equal(deck.length, 7);
  assert.equal(deck.filter((card) => card.edibility === "edible").length, 4);
  assert.equal(deck.filter((card) => card.edibility === "inedible").length, 3);
  assert.equal(new Set(deck.map((card) => card.uuid)).size, 7);
  assert.ok(deck.some((card) => card.id === "F001"), "初始牌组应回调为苹果");
  assert.equal(deck.some((card) => card.id === "F009"), false, "初始牌组不再包含梨子");
  assert.equal(deck.some((card) => card.id === "F003"), false, "初始牌组不再包含西瓜");
});

test("新道具池包含 32 件命名道具、四档稀有度与定向候选", () => {
  const state = createInitialPlayerState({ create_id: nextId });
  const pool = createItemPool();
  assert.equal(pool.length, 32);
  assert.deepEqual(new Set(pool.map((item) => item.rarity)), new Set(["普通", "罕见", "稀有", "传奇"]));
  assert.equal(new Set(pool.map((item) => item.id)).size, 32);
  assert.equal(pool.find((item) => item.id === "C10").name, "魔法帽");
  assert.deepEqual(
    { name: pool.find((item) => item.id === "C14").name, description: pool.find((item) => item.id === "C14").description },
    { name: "双程传菜带", description: "同一张卡牌每轮可以额外后置 1 次，最多后置 2 次。" },
  );
  const offers = randomDraftItems(state, 3, () => 0);
  assert.equal(offers.length, 3);
  assert.equal(new Set(offers.map((entry) => entry.id)).size, 3);
  assert.equal(offers[1].bridge, true);
  assert.equal(offers[2].wild, true);
});

test("道具图鉴独立列出全部常规、一次性与商店经济道具", () => {
  const catalog = createItemCatalogPool();
  assert.equal(catalog.length, 39);
  assert.equal(new Set(catalog.map((item) => item.id)).size, 39);
  assert.equal(catalog.filter((item) => item.catalog_group === "consumable").length, 10);
  assert.equal(catalog.filter((item) => item.catalog_group === "standard").length, 22);
  assert.equal(catalog.filter((item) => item.catalog_group === "economy").length, 7);
  assert.ok(catalog.every((item) => item.name && item.rarity && item.role && item.description));
  assert.ok(catalog.every((item) => item.icon_file === `item-sprites/v024/${item.id.toLowerCase()}.png`));
});

test("道具稀有度区分一次性资源、稳定引擎与规则改写", () => {
  const catalog = createItemCatalogPool();
  const distribution = Object.fromEntries(["普通", "罕见", "稀有", "传奇"].map((rarity) => [
    rarity,
    catalog.filter((item) => item.rarity === rarity).length,
  ]));
  assert.deepEqual(distribution, { 普通: 14, 罕见: 9, 稀有: 13, 传奇: 3 });
  const byId = Object.fromEntries(catalog.map((item) => [item.id, item]));
  assert.equal(byId.C3.rarity, "普通");
  assert.equal(byId.C14.rarity, "稀有", "额外后置一次不再等同于无限后置的传奇强度");
  assert.equal(byId.C15.rarity, "传奇", "每次摧毁稳定转化为高分临时牌属于整局核心引擎");
  assert.equal(byId.E104.rarity, "稀有");
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

test("额外后置、动物领队、12 秒倍率与临时复制按轮生效", () => {
  const state = stateWith(["F009", "A001", "A004"]);
  assert.equal(chooseItem(state, "C14").success, true);
  assert.equal(hasExtraPostpone(state), true);
  assert.equal(getPostponeLimit(state), 2);
  const firstPostpone = postponeCurrentCard(state, { max_per_card: getPostponeLimit(state) });
  assert.equal(firstPostpone.success, true);
  state.round.draw_pile.splice(state.round.draw_pile.indexOf(firstPostpone.card), 1);
  state.round.draw_pile.push(firstPostpone.card);
  assert.equal(postponeCurrentCard(state, { max_per_card: getPostponeLimit(state) }).success, true);
  state.round.draw_pile.splice(state.round.draw_pile.indexOf(firstPostpone.card), 1);
  state.round.draw_pile.push(firstPostpone.card);
  assert.equal(postponeCurrentCard(state, { max_per_card: getPostponeLimit(state) }).reason, "already_postponed");

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

test("双程传菜带的第二次后置在真实出牌顺序下可用，后置效果触发两次", () => {
  const engine = createRoundEngine();
  // draw_pile 的 0 号位最后结算、末位是当前牌，所以 B007「押分瓶」是当前牌。
  const state = stateWith(["A001", "K001", "F001", "B007"]);
  assert.equal(chooseItem(state, "C14").success, true);
  assert.equal(getPostponeLimit(state), 2);

  const target = getCurrentCard(state);
  assert.equal(target.id, "B007");
  assert.equal(postponeCurrentCard(state, { max_per_card: getPostponeLimit(state) }).success, true);
  engine.recordPostpone(state, target);
  assert.equal(state.round.postpone_bonus_score, 4);

  // 后置会把牌送到餐盘末尾，按真实顺序结算完其余牌后，它是唯一剩下的当前牌。
  while (state.round.draw_pile.length > 1) state.round.draw_pile.pop();
  assert.equal(getCurrentCard(state).uuid, target.uuid);

  // 回归点：这里过去会因为“餐盘只剩一张牌”被拒绝，额外后置永远用不掉，
  // 后置效果也就只能触发一次。
  const second = postponeCurrentCard(state, { max_per_card: getPostponeLimit(state) });
  assert.equal(second.success, true);
  assert.equal(second.postpone_count_for_card, 2);
  engine.recordPostpone(state, target);
  assert.equal(state.round.postpone_bonus_score, 8);

  const permanent = state.deck.find((card) => card.id === "B007");
  assert.equal(permanent.eat_points, -2);
  assert.equal(permanent.discard_points, -2);

  // 上限之外仍然拒绝，单张牌不会被无限后置刷分。
  assert.equal(postponeCurrentCard(state, { max_per_card: getPostponeLimit(state) }).reason, "already_postponed");

  // 没有额外后置时，只剩一张牌依旧不能后置。
  const plain = stateWith(["A001", "F001"]);
  plain.round.draw_pile.pop();
  assert.equal(postponeCurrentCard(plain, { max_per_card: 1 }).reason, "not_enough_cards");
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

test("效果处理器按替代、设值、加法、倍率、触发与善后层稳定结算", () => {
  const processor = createEffectProcessor();
  const order = [];
  processor.enqueue({ id: "trigger", layer: EFFECT_LAYERS.TRIGGERED, resolve(event, stack) {
    order.push("trigger");
    stack.enqueue({ id: "after", layer: EFFECT_LAYERS.AFTERMATH, resolve() { order.push("after"); } });
  } });
  processor.enqueue({ id: "replacement", layer: EFFECT_LAYERS.REPLACEMENT, resolve() { order.push("replacement"); } });
  processor.enqueue({ id: "add", layer: EFFECT_LAYERS.ADDITIVE, resolve() { order.push("add"); } });
  const resolution = processor.resolve({ type: "test" });
  assert.deepEqual(order, ["replacement", "add", "trigger", "after"]);
  assert.deepEqual(resolution.trace.map((entry) => entry.id), order);

  const value = resolveLayeredValue(2, [
    { id: "add-three", operation: "add", value: 3 },
    { id: "times-four", operation: "multiply", value: 4 },
    { id: "late-five", operation: "add", layer: EFFECT_LAYERS.AFTERMATH, value: 5 },
  ]);
  assert.equal(value.event.value, 25);
});

test("未写明上限的永久点数与连击不会再被隐藏边界截断", () => {
  const engine = createRoundEngine({ random: () => 0 });
  const fastFoodState = stateWith(["K002"]);
  const noodle = fastFoodState.deck[0];
  noodle.eat_points = -5;
  noodle.discard_points = 12;
  fastFoodState.round.draw_pile[0].eat_points = -5;
  fastFoodState.round.draw_pile[0].discard_points = 12;
  engine.recordAction(fastFoodState, "eat", fastFoodState.round.draw_pile[0]);
  assert.equal(noodle.eat_points, -6);
  assert.equal(noodle.discard_points, 13);

  const dessertState = stateWith(["D001"]);
  dessertState.deck[0].eat_points = 30;
  dessertState.round.draw_pile[0].eat_points = 30;
  engine.recordAction(dessertState, "discard", dessertState.round.draw_pile[0]);
  assert.equal(dessertState.deck[0].eat_points, 32);

  const cappedState = stateWith(["D004"]);
  cappedState.deck[0].eat_points = 11;
  cappedState.round.draw_pile[0].eat_points = 11;
  engine.recordAction(cappedState, "discard", cappedState.round.draw_pile[0]);
  assert.equal(cappedState.deck[0].eat_points, 12);

  const fruitState = stateWith(["F001"]);
  fruitState.round.fruit_combo = 99;
  const apple = engine.recordAction(fruitState, "eat", fruitState.round.draw_pile[0]);
  assert.equal(apple.effect_bonus, 100);
});

test("同名卡牌倍率与无尽道具按来源实例独立叠加", () => {
  const engine = createRoundEngine({ random: () => 0 });
  const sandwichState = stateWith(["K002", "K008", "K008"]);
  const firstSandwich = getCurrentCard(sandwichState);
  engine.recordAction(sandwichState, "discard", firstSandwich);
  sandwichState.round.draw_pile.pop();
  const secondSandwich = getCurrentCard(sandwichState);
  engine.recordAction(sandwichState, "discard", secondSandwich);
  sandwichState.round.draw_pile.pop();
  const noodle = getCurrentCard(sandwichState);
  const beforeEat = sandwichState.deck.find((card) => card.uuid === noodle.uuid).eat_points;
  const beforeDiscard = sandwichState.deck.find((card) => card.uuid === noodle.uuid).discard_points;
  engine.recordAction(sandwichState, "eat", noodle);
  const permanentNoodle = sandwichState.deck.find((card) => card.uuid === noodle.uuid);
  assert.equal(permanentNoodle.eat_points, beforeEat - 4);
  assert.equal(permanentNoodle.discard_points, beforeDiscard + 4);

  const itemState = stateWith(["A001", "B003"]);
  itemState.mode = GAME_MODES.ENDLESS;
  assert.equal(chooseItem(itemState, "C9").success, true);
  assert.equal(chooseItem(itemState, "C9").success, true);
  engine.recordAction(itemState, "eat", getCurrentCard(itemState));
  assert.equal(itemState.round.buffs.filter((buff) => buff.value === 4).length, 3);

  const copyState = stateWith(["F001"]);
  copyState.mode = GAME_MODES.ENDLESS;
  assert.equal(chooseItem(copyState, "C16").success, true);
  assert.equal(chooseItem(copyState, "C16").success, true);
  const generated = owned("F009", "stack-generated");
  copyState.deck.push(generated);
  maybeDuplicateGeneratedCard(copyState, generated);
  assert.equal(copyState.deck.filter((card) => card.temporary && card.generated_from === "item:C16").length, 2);

  const edgeState = stateWith(["F001", "K001"]);
  edgeState.mode = GAME_MODES.ENDLESS;
  assert.equal(chooseItem(edgeState, "C18").success, true);
  assert.equal(chooseItem(edgeState, "C18").success, true);
  edgeState.round.actions.push({ action: "eat" });
  edgeState.round.draw_pile = [edgeState.deck[1]];
  assert.equal(getItemActionOverrides(edgeState, "eat", edgeState.deck[1]).printed_multiplier, 4);
});

test("多件摧毁保护道具各自替代一次摧毁事件", () => {
  const state = stateWith(["A001", "F013", "F013"]);
  state.mode = GAME_MODES.ENDLESS;
  assert.equal(chooseItem(state, "C2").success, true);
  assert.equal(chooseItem(state, "C2").success, true);
  const engine = createRoundEngine();
  engine.recordAction(state, "eat", getCurrentCard(state));
  state.round.draw_pile.pop();
  engine.recordAction(state, "eat", getCurrentCard(state));
  assert.equal(state.deck.length, 3);
  assert.equal(state.round.destroyed_count, 0);
});

test("点数变化倍率按层乘算且显式上限最后生效", () => {
  const state = stateWith(["K002"]);
  const card = state.deck[0];
  card.eat_points = 0;
  state.round.draw_pile[0].eat_points = 0;
  multiplyFuturePointChanges(state, [card.uuid], 2, "倍率一");
  multiplyFuturePointChanges(state, [card.uuid], 2, "倍率二");
  assert.equal(changePermanentCard(state, card, "eat_points", 3), 12);
  card.eat_points = 10;
  state.round.draw_pile[0].eat_points = 10;
  assert.equal(changePermanentCard(state, card, "eat_points", 3, { max: 15 }), 5);
  assert.equal(card.eat_points, 15);
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
    const extraCard = getCurrentCard(state);
    assert.equal(postponeCurrentCard(state, { max_per_card: 2 }).success, true, `${sourceId} 可被额外后置规则改写`);
    state.round.draw_pile.splice(state.round.draw_pile.indexOf(extraCard), 1);
    state.round.draw_pile.push(extraCard);
    assert.equal(postponeCurrentCard(state, { max_per_card: 2 }).reason, "already_postponed", `${sourceId} 额外后置后达到上限`);
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

test("保温灯餐台会继续叠加隔夜餐盒成长且不再存在隐式厌食边界", () => {
  const engine = createRoundEngine();
  const fillers = Array.from({ length: 13 }, () => "F001");
  const state = stateWith([...fillers, "K010", "K011"]);
  const lunchbox = getCurrentCard(state);
  const warmer = state.round.draw_pile.find((card) => card.id === "K010");

  engine.recordPostpone(state, lunchbox);
  const permanentLunchbox = state.deck.find((card) => card.uuid === lunchbox.uuid);
  assert.equal(permanentLunchbox.eat_points, -13);
  assert.equal(permanentLunchbox.discard_points, 13);

  engine.recordAction(state, "eat", warmer);
  assert.equal(permanentLunchbox.eat_points, -14);
  assert.equal(permanentLunchbox.discard_points, 14);
  assert.equal(lunchbox.eat_points, -14);
  assert.equal(lunchbox.discard_points, 14);
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
  assert.equal(state.gold, 0);
});

test("轮末结算只有分数，没有合约或限时经济条目", () => {
  const engine = createRoundEngine();
  const state = stateWith(["F001", "A001"]);
  engine.recordAction(state, "eat", state.deck[0]);
  engine.recordAction(state, "discard", state.deck[1]);
  const result = engine.finalizeRound(state);
  assert.equal(result.round_score, 4);
  assert.equal(state.total_score, 4);
  assert.equal(result.starting_total_score, 0);
  assert.equal(result.presentation_cards.length, 2);
  assert.deepEqual(result.presentation_cards.map((entry) => entry.points), [2, 2]);
  assert.ok(result.breakdown.filter((line) => Number.isFinite(line.value)).length >= 4);
  assert.deepEqual(result.rule_results, []);
  assert.ok(result.breakdown.every((line) => !/金币|限时|合约|商店/.test(`${line.label}${line.text}`)));
});

test("轮末评级边界、热度与单牌冲击等级保持一致", () => {
  assert.equal(getRoundGrade(-8).grade, "C");
  assert.equal(getRoundGrade(19).grade, "C");
  assert.equal(getRoundGrade(20).grade, "B");
  assert.equal(getRoundGrade(29).grade, "B");
  assert.equal(getRoundGrade(30).grade, "A");
  assert.equal(getRoundGrade(49).grade, "A");
  assert.equal(getRoundGrade(50).grade, "A+");
  assert.equal(getRoundGrade(99).grade, "A+");
  assert.equal(getRoundGrade(100).grade, "S");
  assert.equal(getScoreHeat(100), 5);
  assert.equal(getScoreImpact(-100), 5);
});

test("目标按有效轮次检查，并允许引力井延后", () => {
  const engine = createRoundEngine();
  const state = createInitialPlayerState({ create_id: nextId });
  state.current_round = 5;
  state.total_score = 59;
  assert.deepEqual(engine.levelProgressCheck(state), { passed: false, target: 60, base_round: 5 });
  state.total_score = 60;
  assert.deepEqual(engine.levelProgressCheck(state), { passed: true, target: 60, base_round: 5 });
  state.current_round = 6;
  assert.deepEqual(engine.levelProgressCheck(state), { passed: true, target: 0, base_round: null });
  state.milestone_delays = { 5: 1 };
  state.current_round = 5;
  assert.deepEqual(engine.levelProgressCheck(state), { passed: true, target: 0, base_round: null });
  state.current_round = 6;
  state.total_score = 59;
  assert.deepEqual(engine.levelProgressCheck(state), { passed: false, target: 60, base_round: 5 });
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

test("菜单与主循环包含解锁模式、商店、条约与备料 UI", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const main = await readFile(new URL("../js/main.js", import.meta.url), "utf8");
  const gesture = await readFile(new URL("../js/gesture.js", import.meta.url), "utf8");
  const audio = await readFile(new URL("../js/audio.js", import.meta.url), "utf8");
  const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(html, /id="shopPanel"/);
  assert.match(html, /id="ruleDraft"/);
  assert.match(html, /所有条约并行判定/);
  assert.match(html, /id="prepModeButton"/);
  assert.match(html, /id="randomStartToggle"/);
  assert.ok(html.indexOf('class="random-start-toggle"') < html.indexOf('id="normalModeButton"'), "随机开局应位于模式列表顶部");
  assert.match(html, /id="timerValue"/);
  assert.match(html, /首要目标：尽量获得高分/);
  assert.match(html, /id="storyGestureLegend"/);
  assert.match(main, /createShopService|randomDraftRules|settleActiveRules|tickTimer/);
  assert.match(main, /这局最重要的事：拿分/);
  assert.match(main, /const targets = getStandardDifficultyConfig\(state\.difficulty\)\.targets/);
  assert.match(main, /第 5 轮 \$\{targets\[5\]\} 分，第 10 轮 \$\{targets\[10\]\} 分，第 15 轮 \$\{targets\[15\]\} 分/);
  assert.match(main, /total: tutorial\.extended_progress \? 11 : 8/);
  assert.match(main, /FIRST_MEETING_PROLOGUE/);
  assert.match(main, /forceCatFirst/);
  assert.match(main, /不要吃我喵/);
  assert.match(html, /id="homeCompanion"/);
  assert.match(html, /id="companionScene"/);
  assert.match(ui, /playCompanionSequence/);
  assert.match(main, /progress\.progress >= 0\.16/);
  assert.match(gesture, /config\.canCommit/);
  assert.match(main, /developerMode|getCurrentUnlocks/);
  assert.match(main, /god: Boolean\(progression\.god\)/);
  assert.match(main, /ui\.hasBlockingOverlay\(\)/);
  assert.match(main, /setBGMTheme\(settings\.home_theme/);
  assert.match(audio, /C major \/ warm lydian/);
  assert.match(audio, /E minor \/ mysterious add9/);
  assert.match(audio, /continuous-\$\{THEME_CROSSFADE_SECONDS\}s-crossfade/);
  assert.match(audio, /const thresholds = \[1, 2, 3, 5, 8, 12, 20, 35, 60, 100\]/);
  assert.match(ui, /classList\.toggle\("is-unlocked"/);
  assert.match(ui, /首要目标：尽量获得高分/);
  assert.match(ui, /按住卡牌 · 轻拖 · 松手/);
  assert.match(ui, /向下拖 · 吃牌/);
  assert.match(ui, /向左或向右拖 · 后置/);
  assert.match(ui, /向上拖 · 弃牌/);
  assert.match(ui, /hasBlockingOverlay\(\)/);
  assert.match(ui, /theater\.appendChild\(cardNode\)/);
  assert.match(ui, /presentationState = pauseOnReview \? "review-paused" : "review"/);
  assert.match(ui, /line\.dataset\.startValue = "0"/);
  assert.match(html, /id="summaryPauseToggle"/);
  assert.match(html, /data-summary-speed="fast"/);
  assert.match(html, /id="summarySkipToggle"/);
  assert.match(html, /<details class="summary-settings" id="summarySettings">/);
  assert.match(main, /"ui-click"/);
  assert.match(audio, /UI_SOUND_VARIANTS/);
  assert.match(audio, /nextUiSoundVariant/);
  assert.match(styles, /\.summary-pixel-field/);
  assert.match(styles, /\.summary-grade-stamp::after/);
  assert.match(styles, /grid-template-rows:\s*auto minmax\(58px, 1fr\) auto auto auto/);
  assert.match(styles, /\.card-head, \.card-title, \.card-scores, \.card-effect\s*\{[^}]*z-index:\s*2/);
  assert.match(styles, /\.overlay\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0;[\s\S]*?z-index:\s*120;/);
  assert.match(styles, /\.welcome-overlay\s*\{[\s\S]*?inset:\s*0;/);
  assert.match(html, /id="developerModeNotice"/);
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

test("咔嚓序章、模式说明与主界面提示覆盖完整陪伴路径", () => {
  assert.deepEqual(FIRST_MEETING_PROLOGUE.map((step) => step.visual), ["black", "wake", "plate"]);
  assert.match(FIRST_MEETING_PROLOGUE[1].message, /这里是哪里/);
  for (const mode of [GAME_MODES.PREP, GAME_MODES.SHOP, GAME_MODES.CONTRACT_SHOP, GAME_MODES.ENDLESS]) {
    const intro = getModeCompanionIntro({ mode });
    assert.ok(intro.length >= 2, `${mode} 应有独立咔嚓说明`);
    assert.ok(intro.every((step) => step.speaker === "咔嚓"));
  }
  const mutationIntro = getModeCompanionIntro({ mode: GAME_MODES.MUTATION, mutation_id: MUTATION_IDS.DARKNESS });
  assert.match(mutationIntro.map((step) => `${step.message}${step.detail}`).join(""), /不见光明/);
  const homeLines = getHomeCompanionLines({ unlocks: { prep: true, shop: true, mutation: true }, tutorial_complete: true });
  assert.ok(homeLines.some((line) => line.includes("备料")));
  assert.ok(homeLines.some((line) => line.includes("金币")));
  assert.ok(homeLines.some((line) => line.includes("异变")));
});

test("随机开局替换两张教学牌，备料位替代删牌并保证同类候选", () => {
  const baseline = createInitialDeck({ create_id: nextId });
  const randomDeck = createInitialDeck({ create_id: nextId, random_start: true, random: () => 0 });
  assert.equal(randomDeck.length, 7);
  assert.equal(randomDeck.filter((card, index) => card.id !== baseline[index].id).length, 2);

  const state = createInitialPlayerState({ create_id: nextId, mode: GAME_MODES.PREP });
  const service = createDraftService({ random: () => 0, create_id: nextId });
  state.phase = GAME_PHASES.CARD_DRAFT;
  const stored = service.storePrepCard(state, state.deck[0].uuid);
  assert.equal(stored.success, true);
  assert.equal(state.deck.length, 6);
  assert.equal(service.removeCard(state, state.deck[0].uuid).reason, "prep_mode");
  assert.ok(service.getOffers(state).some((card) => card.type === stored.card.type));
  assert.equal(service.removePrepCard(state).reason, "not_ready");
  state.current_round += 1;
  assert.equal(service.removePrepCard(state).success, true);
});

test("苹果与梨使用新的水果连击规则，商店道具池带回经济道具", () => {
  assert.equal(getCardById("F001").effect.kind, "fruit_combo");
  assert.equal(getCardById("F009").effect.grant_reroll_at, 3);
  assert.equal(getCardById("F009", { economy: true }).effect.shop_free_rerolls, 1);
  assert.ok(createCardPool()
    .filter((card) => card.effect?.kind === "fruit_combo")
    .every((card) => card.effect.bonus_per_combo >= 1), "所有水果连击牌都必须按当前连击数加分");
  const state = stateWith(["F001", "F001", "F009"]);
  const engine = createRoundEngine();
  const firstApple = engine.recordAction(state, "eat", state.deck[0]);
  const secondApple = engine.recordAction(state, "eat", state.deck[1]);
  const pear = engine.recordAction(state, "eat", state.deck[2]);
  assert.equal(firstApple.effect_bonus, 1);
  assert.equal(firstApple.points, 2);
  assert.equal(secondApple.effect_bonus, 2);
  assert.equal(secondApple.points, 3);
  assert.equal(pear.fruit_combo, 3);
  assert.equal(pear.effect_bonus, 3);
  assert.equal(pear.points, 4);
  assert.equal(state.reroll_tokens, 1);

  const bananaState = stateWith(["F002"]);
  const banana = engine.recordAction(bananaState, "eat", bananaState.deck[0]);
  assert.equal(banana.effect_bonus, 1, "香蕉原有的水果连击加分不能被重复或移除");
  assert.equal(banana.points, 2);
  const aboveThresholdState = stateWith(["F001", "F001", "F009", "F009"]);
  engine.recordAction(aboveThresholdState, "eat", aboveThresholdState.deck[0]);
  engine.recordAction(aboveThresholdState, "eat", aboveThresholdState.deck[1]);
  engine.recordAction(aboveThresholdState, "eat", aboveThresholdState.deck[2]);
  const aboveThresholdPear = engine.recordAction(aboveThresholdState, "eat", aboveThresholdState.deck[3]);
  assert.equal(aboveThresholdPear.fruit_combo, 4);
  assert.equal(aboveThresholdState.reroll_tokens, 2, "连击 3 与连击 4 的梨都应获得刷新标记");

  const shopPearState = createInitialPlayerState({ create_id: nextId, mode: GAME_MODES.SHOP });
  shopPearState.deck = ["F001", "F001", "F009"].map((id) => {
    const card = getCardById(id, { economy: true });
    return { ...card, uuid: nextId(card) };
  });
  engine.recordAction(shopPearState, "eat", shopPearState.deck[0]);
  engine.recordAction(shopPearState, "eat", shopPearState.deck[1]);
  const shopPear = engine.recordAction(shopPearState, "eat", shopPearState.deck[2]);
  assert.equal(shopPear.fruit_combo, 3);
  assert.equal(shopPear.effect_bonus, 3);
  assert.equal(shopPear.points, 4);
  assert.equal(shopPearState.reroll_tokens, 0, "商店梨不应生成无用的刷新标记");
  assert.equal(shopPearState.round.shop_free_rerolls, 1, "商店梨应增加下一间商店的免费刷新次数");

  const starterComboState = stateWith(["F001"]);
  assert.equal(chooseItem(starterComboState, "C4").success, true);
  resetRoundState(starterComboState);
  applyRoundItemSetup(starterComboState);
  starterComboState.round.draw_pile = starterComboState.deck.map((card) => ({ ...card }));
  const firstFruit = engine.recordAction(starterComboState, "eat", starterComboState.round.draw_pile[0]);
  assert.equal(firstFruit.fruit_combo, 2, "初始连击 1 后首次触发应直接显示 ×2");
  assert.ok(createShopItemPool().some((item) => item.effect.kind === "shop_price_discount"));
});

test("商店模式恢复买牌、扩容、删牌三角，经济卡使用经典效果", () => {
  const state = createInitialPlayerState({ create_id: nextId, mode: GAME_MODES.SHOP });
  const service = createShopService({ random: () => 0, create_id: nextId });
  state.gold = 50;
  const offers = service.getShopCards(state);
  assert.equal(offers.length, 3);
  assert.equal(service.buyCard(state, offers[0]), true);
  const afterBuy = state.gold;
  assert.equal(service.buyPlateUpgrade(state).success, true);
  assert.ok(state.gold < afterBuy);
  const beforeRemove = state.deck.length;
  assert.equal(service.removeCard(state, state.deck[0].uuid), true);
  assert.equal(state.deck.length, beforeRemove - 1);
  assert.equal(getCardById("D007", { economy: true }).effect.burst_discount, 3);
  assert.equal(getCardById("A009", { economy: true }).effect.kind, "destroy_self_raise_rarity");
});

test("普通商店仅卡牌统一便宜一金币，其他服务与条约商店同价", () => {
  const normal = createInitialPlayerState({ create_id: nextId, mode: GAME_MODES.SHOP });
  const contract = createInitialPlayerState({ create_id: nextId, mode: GAME_MODES.CONTRACT_SHOP });
  normal.gold = 50;
  contract.gold = 50;
  normal.remove_card_cost = 3;
  contract.remove_card_cost = 3;
  const service = createShopService({ random: () => 0, create_id: nextId });
  const baseCard = getCardById("F001", { economy: true });
  const normalCard = service.repriceShopCards(normal, [baseCard])[0];
  const contractCard = service.repriceShopCards(contract, [baseCard])[0];
  assert.equal(normalCard.shop_price, Math.max(1, contractCard.shop_price - 1));
  assert.equal(service.getPlateUpgradeStatus(normal).cost, service.getPlateUpgradeStatus(contract).cost);
  assert.equal(service.getRemoveCardCost(normal), 3);
  assert.equal(service.getRemoveCardCost(contract), 3);
  const normalItem = service.getShopItems(normal)[0];
  const contractItem = service.getShopItems(contract)[0];
  assert.equal(normalItem.id, contractItem.id);
  assert.equal(normalItem.shop_price, contractItem.shop_price);
});

test("条约商店允许未完成条约跨轮保留，并与新条约并行结算", () => {
  const rule = (id) => RULE_LIBRARY.find((entry) => entry.id === id);
  const engine = createRoundEngine();
  const state = stateWith(["F001", "A001"]);
  state.mode = GAME_MODES.CONTRACT_SHOP;
  assert.equal(addActiveRule(state, rule("eat-four")), true);
  assert.equal(addActiveRule(state, rule("no-negative")), true);
  assert.equal(addActiveRule(state, rule("no-negative")), false, "同一条约不能重复并行");
  engine.recordAction(state, "eat", state.deck[0]);
  engine.recordAction(state, "discard", state.deck[1]);

  const firstSettlement = settleActiveRules(state, evaluateRule);
  assert.equal(firstSettlement.results.length, 2);
  assert.equal(firstSettlement.gold_reward, 3);
  assert.deepEqual(firstSettlement.results.map((entry) => [entry.id, entry.passed]), [
    ["eat-four", false],
    ["no-negative", true],
  ]);
  assert.deepEqual(state.active_rules.map((entry) => entry.id), ["eat-four"]);
  assert.equal(state.active_rules[0].attempts, 1);
  assert.equal(state.rule_history.at(-1).id, "no-negative");

  state.current_round = 2;
  resetRoundState(state);
  assert.equal(addActiveRule(state, rule("discard-four")), true);
  assert.deepEqual(state.active_rules.map((entry) => entry.id), ["eat-four", "discard-four"]);

  const simultaneous = stateWith(["F001", "A001"]);
  simultaneous.mode = GAME_MODES.CONTRACT_SHOP;
  addActiveRule(simultaneous, rule("perfect-sort"));
  addActiveRule(simultaneous, rule("no-negative"));
  engine.recordAction(simultaneous, "eat", simultaneous.deck[0]);
  engine.recordAction(simultaneous, "discard", simultaneous.deck[1]);
  const simultaneousSettlement = settleActiveRules(simultaneous, evaluateRule);
  assert.equal(simultaneousSettlement.gold_reward, 6);
  assert.equal(simultaneous.active_rules.length, 0);
  assert.equal(simultaneous.rule_history.length, 2);
});

test("金币账本区分立即收入与轮末收入并保留具体来源", () => {
  const state = createInitialPlayerState({ create_id: nextId, mode: GAME_MODES.CONTRACT_SHOP });
  const action = {};
  assert.equal(grantRoundGold(state, action, "风险经纪人", 2), 2);
  assert.equal(queueRoundGold(state, "投币吸管", 1, "item"), 1);
  assert.equal(state.gold, 2);
  assert.equal(action.gold_change, 2);
  assert.equal(state.round.pending_gold_bonus, 1);
  assert.equal(sumRoundGoldSources(state, "immediate"), 2);
  assert.equal(sumRoundGoldSources(state, "settlement"), 1);
  assert.deepEqual(getRoundGoldSources(state).map(({ label, amount, timing, kind }) => ({ label, amount, timing, kind })), [
    { label: "风险经纪人", amount: 2, timing: "immediate", kind: "card" },
    { label: "投币吸管", amount: 1, timing: "settlement", kind: "item" },
  ]);
});

test("无尽模式允许重复道具，餐盘与百万分终点都有明确边界", () => {
  const state = createInitialPlayerState({ create_id: nextId, mode: GAME_MODES.ENDLESS });
  assert.equal(chooseItem(state, "C7").success, true);
  assert.equal(chooseItem(state, "C7").success, true);
  assert.equal(state.items.filter((item) => item.id === "C7").length, 2);
  assert.equal(chooseItem(state, "C14").success, true);
  assert.equal(chooseItem(state, "C14").success, true);
  assert.equal(getPostponeLimit(state), 3);
  assert.equal(GAME_CONFIG.endless_max_plate_capacity, 16);
  assert.equal(GAME_CONFIG.endless_victory_score, 1_000_000);
});

test("解锁进度按完成局数、任意通关与商店通关分别累计", () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  assert.equal(browserPlatform.get_unlocks().random_start, false);
  browserPlatform.record_run_progress({ outcome: "defeat", mode: GAME_MODES.NORMAL });
  assert.equal(browserPlatform.get_unlocks().random_start, true);
  browserPlatform.record_run_progress({ outcome: "victory", mode: GAME_MODES.MUTATION });
  assert.equal(browserPlatform.get_unlocks().prep, true);
  assert.equal(browserPlatform.get_unlocks().shop, true);
  browserPlatform.record_run_progress({ outcome: "victory", mode: GAME_MODES.SHOP });
  assert.equal(browserPlatform.get_unlocks().contract_shop, true);
  browserPlatform.record_run_progress({ outcome: "victory", mode: GAME_MODES.ENDLESS });
  assert.equal(browserPlatform.get_unlocks().god, true);
  assert.deepEqual(browserPlatform.load_progression().mode_victories, { mutation: 1, shop: 1, endless: 1 });
  const settings = browserPlatform.save_settings({ home_theme: "day", random_start: true, summary_pause: true, summary_speed: "fast", summary_skip: true });
  assert.equal(settings.home_theme, "day");
  assert.equal(settings.summary_pause, true);
  assert.equal(settings.summary_speed, "fast");
  assert.equal(settings.summary_skip, true);
  assert.equal(browserPlatform.load_settings().home_theme, "day");
  assert.equal(browserPlatform.load_settings().summary_speed, "fast");
  delete globalThis.localStorage;
});

test("正式版首次启动会清除全部旧存档且同一世代不会重复清除", () => {
  const values = new Map([
    ["cardeater.progression.v1", JSON.stringify({ runs_played: 99, victories: 9 })],
    ["cardeater.story-tutorial.v1", "complete"],
    ["cardeater.active-run.v2", JSON.stringify({ phase: "Playing" })],
    ["cardeater.legacy-unknown.v9", "legacy"],
    ["unrelated.preference", "keep"],
  ]);
  const storage = {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };

  assert.equal(prepareReleaseGeneration(storage), true);
  assert.equal(values.get("cardeater.release-generation"), RELEASE_GENERATION);
  assert.equal(values.has("cardeater.progression.v1"), false);
  assert.equal(values.has("cardeater.story-tutorial.v1"), false);
  assert.equal(values.has("cardeater.active-run.v2"), false);
  assert.equal(values.has("cardeater.legacy-unknown.v9"), false);
  assert.equal(values.get("unrelated.preference"), "keep");

  values.set("cardeater.progression.v1", JSON.stringify({ runs_played: 1 }));
  assert.equal(prepareReleaseGeneration(storage), false);
  assert.equal(values.has("cardeater.progression.v1"), true);
});

test("标准难度必须依次通关上一层，难度 10 通关后保持封顶", () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };

  assert.equal(browserPlatform.get_unlocks().normal_difficulty_max, 0);
  browserPlatform.record_run_progress({ outcome: "defeat", mode: GAME_MODES.NORMAL, difficulty: 2 });
  assert.equal(browserPlatform.get_unlocks().normal_difficulty_max, 0, "越级通关不能跳过前置难度");

  for (let difficulty = 0; difficulty < STANDARD_DIFFICULTY_MAX; difficulty += 1) {
    assert.equal(browserPlatform.get_unlocks().normal_difficulty_max, difficulty);
    browserPlatform.record_run_progress({ outcome: "victory", mode: GAME_MODES.NORMAL, difficulty });
    assert.equal(browserPlatform.get_unlocks().normal_difficulty_max, difficulty + 1);
  }

  browserPlatform.record_run_progress({ outcome: "victory", mode: GAME_MODES.NORMAL, difficulty: STANDARD_DIFFICULTY_MAX });
  const progress = browserPlatform.load_progression();
  assert.equal(browserPlatform.get_unlocks().normal_difficulty_max, STANDARD_DIFFICULTY_MAX);
  assert.equal(progress.normal_difficulty_victories[STANDARD_DIFFICULTY_MAX], 1);
  delete globalThis.localStorage;
});

test("主界面统计累计完整对局动作并完全排除无尽模式", () => {
  const normal = createInitialPlayerState({ create_id: nextId });
  const engine = createRoundEngine({ random: () => 0 });
  const apple = owned("F001", "statistics-apple");
  const pear = owned("F009", "statistics-pear");
  engine.recordAction(normal, "eat", apple);
  engine.recordAction(normal, "discard", pear);
  normal.phase = GAME_PHASES.CARD_DRAFT;
  normal.free_rerolls = 1;
  normal.delete_tokens = 1;
  const draft = createDraftService({ random: () => 0, create_id: nextId });
  assert.equal(draft.reroll(normal, []).success, true);
  assert.equal(draft.removeCard(normal, normal.deck[0].uuid).success, true);
  normal.gold = 17;
  normal.total_score = 321;
  observeRunGold(normal);

  const totals = mergeCompletedRun({}, normal, "victory");
  assert.equal(totals.runs_played, 1);
  assert.equal(totals.victories, 1);
  assert.equal(totals.defeats, 0);
  assert.equal(totals.cards_eaten, 1);
  assert.equal(totals.cards_discarded, 1);
  assert.equal(totals.cards_deleted, 1);
  assert.equal(totals.rerolls, 1);
  assert.equal(totals.highest_score, 321);
  assert.equal(totals.highest_gold, 17);
  assert.deepEqual(totals.card_actions.F001, { eat: 1, discard: 0 });
  assert.deepEqual(totals.card_actions.F009, { eat: 0, discard: 1 });

  engine.recordAction(normal, "discard", owned("A001", "statistics-animal"));
  engine.recordAction(normal, "eat", owned("P001", "statistics-person"));
  const expanded = mergeCompletedRun({}, normal, "defeat");
  assert.deepEqual(expanded.card_actions.A001, { eat: 0, discard: 1 });
  assert.deepEqual(expanded.card_actions.P001, { eat: 1, discard: 0 });

  const endless = createInitialPlayerState({ create_id: nextId, mode: GAME_MODES.ENDLESS });
  engine.recordAction(endless, "eat", apple);
  endless.total_score = 1_000_000;
  endless.gold = 999;
  observeRunGold(endless);
  const unchanged = mergeCompletedRun(totals, endless, "victory");
  assert.deepEqual(unchanged, totals);
});

test("统计档案持久化且旧纪录迁移时忽略无尽模式", () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  values.set("cardeater.run-history.v1", JSON.stringify([
    { outcome: "victory", mode: GAME_MODES.NORMAL, score: 600 },
    { outcome: "defeat", mode: "hard", score: 70 },
    { outcome: "victory", mode: GAME_MODES.ENDLESS, score: 1_000_000 },
  ]));
  const legacy = browserPlatform.load_statistics();
  assert.equal(legacy.runs_played, 2);
  assert.equal(legacy.victories, 1);
  assert.equal(legacy.defeats, 1);
  assert.equal(legacy.highest_score, 600);

  const state = createInitialPlayerState({ create_id: nextId });
  state.total_score = 850;
  state.run_statistics.cards_eaten = 9;
  browserPlatform.record_run_statistics(state, "victory");
  const saved = browserPlatform.load_statistics();
  assert.equal(saved.runs_played, 3);
  assert.equal(saved.victories, 2);
  assert.equal(saved.cards_eaten, 9);
  assert.equal(saved.highest_score, 850);
  delete globalThis.localStorage;
});

test("旧水果逐卡统计会迁移到全类别卡牌统计", () => {
  const values = new Map([
    ["cardeater.statistics.v1", JSON.stringify({
      runs_played: 2,
      fruit_actions: { F001: { eat: 7, discard: 3 } },
    })],
  ]);
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  const migrated = browserPlatform.load_statistics();
  assert.deepEqual(migrated.card_actions.F001, { eat: 7, discard: 3 });
  assert.equal("fruit_actions" in migrated, false);
  delete globalThis.localStorage;
});

test("轮末演出第十四张开始自动加速并支持玩家速度与跳过设置", () => {
  assert.equal(SUMMARY_RAPID_CARD_THRESHOLD, 13);
  const thirteenth = getSummaryCardTiming(12, { summary_speed: "normal" });
  const fourteenth = getSummaryCardTiming(13, { summary_speed: "normal" });
  const fast = getSummaryCardTiming(0, { summary_speed: "fast" });
  const skipped = getSummaryCardTiming(0, { summary_skip: true });
  assert.equal(thirteenth.rapid, false);
  assert.equal(fourteenth.rapid, true);
  assert.ok(fourteenth.count < thirteenth.count / 2);
  assert.ok(fast.count < thirteenth.count);
  assert.deepEqual(skipped, { reveal: 0, count: 0, gap: 0, rapid: false });
  assert.equal(getSummaryBeatDuration(1000, { summary_speed: "fast" }), 580);
  assert.equal(getSummaryBeatDuration(1000, { summary_skip: true }), 0);
});
