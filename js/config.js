export const GAME_CONFIG = Object.freeze({
  schema_version: 15,
  total_rounds: 15,
  draft_size: 3,
  plate_upgrade_interval: 5,
  milestone_targets: Object.freeze({
    5: 100,
    10: 300,
    15: 500,
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
});

export function isPlateUpgradeRound(round) {
  return Number.isInteger(round)
    && round > 0
    && round % GAME_CONFIG.plate_upgrade_interval === 0;
}

export function getNextMilestone(currentRound) {
  const rounds = Object.keys(GAME_CONFIG.milestone_targets)
    .map(Number)
    .sort((a, b) => a - b);
  const baseRound = rounds.find((item) => item >= currentRound);
  const resolvedRound = baseRound ?? rounds.at(-1);
  return {
    base_round: resolvedRound,
    round: resolvedRound,
    target: GAME_CONFIG.milestone_targets[resolvedRound],
    endless: false,
  };
}

export function getFinalRound() {
  return GAME_CONFIG.total_rounds;
}
