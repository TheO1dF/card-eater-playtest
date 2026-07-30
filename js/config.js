export const GAME_CONFIG = Object.freeze({
  schema_version: 23,
  total_rounds: 15,
  draft_size: 3,
  item_draft_interval: 3,
  plate_upgrade_interval: 5,
  milestone_targets: Object.freeze({
    5: 80,
    10: 200,
    15: 600,
  }),
  max_deck_size: 160,
  reshuffle_max_deck_size: 10,
  max_actions_per_round: 400,
  initial_plate_capacity: 10,
  max_plate_capacity: 160,
  max_score: 9_000_000_000_000_000,
});

export const GAME_MODES = Object.freeze({
  NORMAL: "normal",
  ENDLESS: "endless",
  HARD: "hard",
});

export const MODE_LABELS = Object.freeze({
  [GAME_MODES.NORMAL]: "标准模式",
  [GAME_MODES.ENDLESS]: "无尽模式",
  [GAME_MODES.HARD]: "高难模式",
});

export function isPlateUpgradeRound(round) {
  return Number.isInteger(round)
    && round > 0
    && round % GAME_CONFIG.plate_upgrade_interval === 0;
}

export function getMilestoneTarget(round, mode = GAME_MODES.NORMAL) {
  const base = GAME_CONFIG.milestone_targets[round] ?? 0;
  return mode === GAME_MODES.HARD ? Math.ceil(base * 1.2) : base;
}

export function getEffectiveMilestoneRound(baseRound, delays = {}) {
  return baseRound + Math.max(0, Number(delays?.[baseRound]) || 0);
}

export function getNextMilestone(currentRound, delays = {}, mode = GAME_MODES.NORMAL) {
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
    target: getMilestoneTarget(resolvedBaseRound, mode),
    endless: false,
  };
}

export function getFinalRound(delays = {}, mode = GAME_MODES.NORMAL) {
  return mode === GAME_MODES.ENDLESS
    ? Infinity
    : getEffectiveMilestoneRound(GAME_CONFIG.total_rounds, delays);
}
