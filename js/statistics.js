import { GAME_MODES } from "./config.js";

const COUNT_KEYS = Object.freeze([
  "cards_eaten",
  "cards_discarded",
  "cards_deleted",
  "rerolls",
]);

const safeCount = (value) => Math.max(0, Math.floor(Number(value) || 0));

function normalizeCardActions(value = {}) {
  return Object.fromEntries(Object.entries(value ?? {}).map(([cardId, counts]) => [cardId, {
    eat: safeCount(counts?.eat),
    discard: safeCount(counts?.discard),
  }]));
}

export function createRunStatistics(value = {}) {
  const result = {
    cards_eaten: 0,
    cards_discarded: 0,
    cards_deleted: 0,
    rerolls: 0,
    highest_gold: 0,
    card_actions: {},
  };
  for (const key of COUNT_KEYS) result[key] = safeCount(value?.[key]);
  result.highest_gold = safeCount(value?.highest_gold);
  result.card_actions = {
    ...normalizeCardActions(value?.fruit_actions),
    ...normalizeCardActions(value?.card_actions),
  };
  return result;
}

export function createLifetimeStatistics(value = {}) {
  const result = {
    runs_played: safeCount(value?.runs_played),
    victories: safeCount(value?.victories),
    defeats: safeCount(value?.defeats),
    highest_score: Math.max(0, Number(value?.highest_score) || 0),
    ...createRunStatistics(value),
  };
  return result;
}

export function ensureRunStatistics(state) {
  if (!state) return createRunStatistics();
  state.run_statistics = createRunStatistics(state.run_statistics);
  return state.run_statistics;
}

export function shouldTrackStatistics(state) {
  return Boolean(state) && state.mode !== GAME_MODES.ENDLESS;
}

export function recordCardAction(state, action, card) {
  if (!shouldTrackStatistics(state) || !["eat", "discard"].includes(action)) return false;
  const statistics = ensureRunStatistics(state);
  const key = action === "eat" ? "cards_eaten" : "cards_discarded";
  statistics[key] = safeCount(statistics[key] + 1);
  if (card?.id) {
    const cardCounts = statistics.card_actions[card.id] ?? { eat: 0, discard: 0 };
    cardCounts[action] = safeCount(cardCounts[action] + 1);
    statistics.card_actions[card.id] = cardCounts;
  }
  return true;
}

export function recordCardDeletion(state, amount = 1) {
  if (!shouldTrackStatistics(state)) return false;
  const statistics = ensureRunStatistics(state);
  statistics.cards_deleted = safeCount(statistics.cards_deleted + safeCount(amount));
  return true;
}

export function recordReroll(state, amount = 1) {
  if (!shouldTrackStatistics(state)) return false;
  const statistics = ensureRunStatistics(state);
  statistics.rerolls = safeCount(statistics.rerolls + safeCount(amount));
  return true;
}

export function observeRunGold(state) {
  if (!shouldTrackStatistics(state)) return false;
  const statistics = ensureRunStatistics(state);
  statistics.highest_gold = Math.max(statistics.highest_gold, safeCount(state.gold));
  return true;
}

export function mergeCompletedRun(lifetime, state, outcome) {
  const result = createLifetimeStatistics(lifetime);
  if (!shouldTrackStatistics(state) || !["victory", "defeat"].includes(outcome)) return result;
  const run = ensureRunStatistics(state);
  result.runs_played += 1;
  result[outcome === "victory" ? "victories" : "defeats"] += 1;
  result.highest_score = Math.max(result.highest_score, Number(state.total_score) || 0);
  result.highest_gold = Math.max(result.highest_gold, run.highest_gold, safeCount(state.gold));
  for (const key of COUNT_KEYS) result[key] = safeCount(result[key] + run[key]);
  for (const [cardId, counts] of Object.entries(run.card_actions)) {
    const total = result.card_actions[cardId] ?? { eat: 0, discard: 0 };
    total.eat = safeCount(total.eat + counts.eat);
    total.discard = safeCount(total.discard + counts.discard);
    result.card_actions[cardId] = total;
  }
  return result;
}
