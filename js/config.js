export const GAME_CONFIG = Object.freeze({
  schema_version: 26,
  total_rounds: 15,
  draft_size: 3,
  item_draft_interval: 3,
  plate_upgrade_interval: 5,
  milestone_targets: Object.freeze({
    5: 80,
    10: 200,
    15: 600,
  }),
  standard_difficulty_zero_targets: Object.freeze({
    5: 60,
    10: 180,
    15: 500,
  }),
  max_deck_size: 160,
  reshuffle_max_deck_size: 10,
  max_actions_per_round: 400,
  initial_plate_capacity: 10,
  max_plate_capacity: 160,
  endless_max_plate_capacity: 16,
  endless_victory_score: 1_000_000,
  delete_cost_step: 3,
  shop_offer_count: 3,
  shop_item_offer_count: 2,
  shop_reroll_base_cost: 2,
  shop_reroll_cost_step: 1,
  plate_upgrade_base_cost: 2,
  contract_time_limit_ms: 12_000,
  contract_fast_time_limit_ms: 8_000,
  numeric_safety_limit: Number.MAX_SAFE_INTEGER,
});

export const GAME_MODES = Object.freeze({
  NORMAL: "normal",
  ENDLESS: "endless",
  MUTATION: "mutation",
  PREP: "prep",
  SHOP: "shop",
  CONTRACT_SHOP: "contract_shop",
});

export const MODE_LABELS = Object.freeze({
  [GAME_MODES.NORMAL]: "标准模式",
  [GAME_MODES.ENDLESS]: "无尽模式",
  [GAME_MODES.MUTATION]: "异变模式",
  [GAME_MODES.PREP]: "备料模式",
  [GAME_MODES.SHOP]: "商店模式",
  [GAME_MODES.CONTRACT_SHOP]: "条约商店模式",
});

export const STANDARD_DIFFICULTY_MAX = 10;

export const STANDARD_DIFFICULTY_STEPS = Object.freeze([
  Object.freeze({ level: 0, name: "教学难度", description: "阶段目标 60 / 180 / 500；保留完整的新手资源。" }),
  Object.freeze({ level: 1, name: "开胃压力", description: "第 5 轮目标从 60 提高至 80。" }),
  Object.freeze({ level: 2, name: "终局加码", description: "第 15 轮目标从 500 提高至 600。" }),
  Object.freeze({ level: 3, name: "中盘加码", description: "第 10 轮目标从 180 提高至 200。" }),
  Object.freeze({ level: 4, name: "普通货架", description: "卡牌三选一更难出现高稀有度卡牌。" }),
  Object.freeze({ level: 5, name: "紧缩供应", description: "道具与商店候选更难出现高稀有度内容。" }),
  Object.freeze({ level: 6, name: "刷新收费", description: "每轮不再赠送一次免费刷新。" }),
  Object.freeze({ level: 7, name: "没有赠券", description: "开局不再赠送删牌标记。" }),
  Object.freeze({ level: 8, name: "首关加码", description: "第 5 轮目标再次从 80 提高至 100。" }),
  Object.freeze({ level: 9, name: "餐盘紧缩", description: "通过第 5 轮时不再免费扩充餐盘。" }),
  Object.freeze({ level: 10, name: "虚空来客", description: "初始牌组额外加入一张吃 -1 / 弃 -1 的虚空牌。" }),
]);

export function normalizeStandardDifficulty(value = 0) {
  return Math.max(0, Math.min(STANDARD_DIFFICULTY_MAX, Math.trunc(Number(value) || 0)));
}

export function getStandardDifficultyConfig(value = 0) {
  const level = normalizeStandardDifficulty(value);
  return {
    level,
    targets: Object.freeze({
      5: level >= 8 ? 100 : level >= 1 ? 80 : 60,
      10: level >= 3 ? 200 : 180,
      15: level >= 2 ? 600 : 500,
    }),
    lower_card_draft_rarity: level >= 4,
    lower_shop_rarity: level >= 5,
    free_round_reroll: level < 6,
    initial_delete_tokens: level < 7 ? 1 : 0,
    skip_round_five_plate_upgrade: level >= 9,
    starts_with_void: level >= 10,
  };
}

export function isShopMode(mode) {
  return mode === GAME_MODES.SHOP || mode === GAME_MODES.CONTRACT_SHOP;
}

export function isPrepMode(mode) { return mode === GAME_MODES.PREP; }

export function isPlateUpgradeRound(round) {
  return Number.isInteger(round)
    && round > 0
    && round % GAME_CONFIG.plate_upgrade_interval === 0;
}

export function getMilestoneTarget(round, mode = GAME_MODES.NORMAL, difficulty = 0) {
  if (mode === GAME_MODES.NORMAL || mode === GAME_MODES.MUTATION) {
    return getStandardDifficultyConfig(mode === GAME_MODES.NORMAL ? difficulty : 0).targets[round] ?? 0;
  }
  return GAME_CONFIG.milestone_targets[round] ?? 0;
}

export function getEffectiveMilestoneRound(baseRound, delays = {}) {
  return baseRound + Math.max(0, Number(delays?.[baseRound]) || 0);
}

export function getNextMilestone(currentRound, delays = {}, mode = GAME_MODES.NORMAL, difficulty = 0) {
  const rounds = Object.keys(GAME_CONFIG.milestone_targets)
    .map(Number)
    .sort((a, b) => a - b);
  const baseRound = rounds.find((item) => getEffectiveMilestoneRound(item, delays) >= currentRound);
  if (baseRound === undefined && mode === GAME_MODES.ENDLESS) {
    return { base_round: null, round: null, target: 0, endless: true };
  }
  const resolvedBaseRound = baseRound ?? rounds.at(-1);
  return {
    base_round: resolvedBaseRound,
    round: getEffectiveMilestoneRound(resolvedBaseRound, delays),
    target: getMilestoneTarget(resolvedBaseRound, mode, difficulty),
    endless: false,
  };
}

export function getFinalRound(delays = {}, mode = GAME_MODES.NORMAL) {
  return mode === GAME_MODES.ENDLESS
    ? Infinity
    : getEffectiveMilestoneRound(GAME_CONFIG.total_rounds, delays);
}
