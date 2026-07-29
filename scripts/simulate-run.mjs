import { GAME_CONFIG, isPlateUpgradeRound } from "../js/config.js";
import { createDraftService } from "../js/draft.js";
import { createRoundEngine } from "../js/engine.js";
import { takeRoundDrawPile } from "../js/plate.js";
import { activateReshuffle, getReshuffleStatus } from "../js/reshuffle.js";
import { createInitialPlayerState, resetRoundState } from "../js/state.js";

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let next = value;
    next = Math.imul(next ^ next >>> 15, next | 1);
    next ^= next + Math.imul(next ^ next >>> 7, next | 61);
    return ((next ^ next >>> 14) >>> 0) / 4294967296;
  };
}

function shuffle(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function actionValue(state, engine, card, action) {
  const trial = structuredClone(state);
  const trialCard = trial.round.draw_pile.find((entry) => entry.uuid === card.uuid);
  return engine.recordAction(trial, action, trialCard).points;
}

function chooseAction(state, engine, card) {
  if (card.effect?.kind === "retention" && card.eat_points < (card.effect.burst_threshold ?? Infinity)) return "discard";
  return actionValue(state, engine, card, "eat") >= actionValue(state, engine, card, "discard") ? "eat" : "discard";
}

function playPlate(state, engine, random) {
  let safety = 0;
  while (safety < GAME_CONFIG.max_actions_per_round) {
    safety += 1;
    if (state.round.draw_pile.length === 0) {
      const reshuffle = getReshuffleStatus(state);
      if (!reshuffle.can_use) break;
      activateReshuffle(state, (cards) => shuffle(cards, random));
      continue;
    }
    const card = state.round.draw_pile.at(-1);
    const action = chooseAction(state, engine, card);
    engine.recordAction(state, action, card);
    state.round.draw_pile.pop();
    if (state.deck.some((owned) => owned.uuid === card.uuid)) state.round.spent_pile.push(card);
    if (state.round.consume_next_uuid) {
      if (state.round.draw_pile.at(-1)?.uuid === state.round.consume_next_uuid) state.round.draw_pile.pop();
      state.round.consume_next_uuid = null;
    }
  }
  if (safety >= GAME_CONFIG.max_actions_per_round) throw new Error("simulation action safety limit reached");
}

function draftValue(card, state) {
  const correctPoints = card.edibility === "edible" ? card.eat_points : card.discard_points;
  const rarityValue = { "普通": 0, "罕见": 1, "稀有": 2.5, "传奇": 4 }[card.rarity] ?? 0;
  const effectValue = card.effect ? 2 : 0;
  const synergyValue = (card.synergy_tags ?? []).filter((tag) => state.deck.some((owned) => owned.synergy_tags?.includes(tag))).length * 0.6;
  const engineValue = ["fruit_combo", "retention", "scale_by_deck", "scale_by_history", "scale_by_unique_deck_types", "buff_next_action", "drain_type_to_self", "store_charges"].includes(card.effect?.kind) ? 2.5 : 0;
  const tokenValue = card.effect?.keywords?.includes("删牌") ? 0.5 : 0;
  return correctPoints + rarityValue + effectValue + synergyValue + engineValue + tokenValue;
}

export function simulateRun({ seed = 1, verbose = false, enforce_milestones = true } = {}) {
  const random = seededRandom(seed);
  let nextId = 0;
  const createId = (card) => `${card.id}-sim-${seed}-${nextId += 1}`;
  const state = createInitialPlayerState({ create_id: createId });
  const engine = createRoundEngine({ random });
  const draft = createDraftService({ random, create_id: createId });
  const log = [];

  for (let round = 1; round <= GAME_CONFIG.total_rounds; round += 1) {
    state.current_round = round;
    resetRoundState(state);
    engine.applyRoundStartEffects(state);
    const deck = shuffle(structuredClone(state.deck), random);
    Object.assign(state.round, takeRoundDrawPile(deck, state.plate_capacity));
    playPlate(state, engine, random);
    const result = engine.finalizeRound(state);
    const milestone = engine.levelProgressCheck(state);
    const failed = enforce_milestones && milestone.target > 0 && !milestone.passed;
    if (!failed && isPlateUpgradeRound(round)) {
      state.plate_capacity += 1;
      state.plate_upgrade_count += 1;
    }
    const snapshot = {
      round,
      round_score: result.round_score,
      total_score: state.total_score,
      deck: state.deck.length,
      plate: state.plate_capacity,
      reserve: state.round.reserve_count,
      tokens: state.delete_tokens,
      milestone: milestone.target > 0 ? `${milestone.passed ? "通过" : "失败"}(${milestone.target})` : "-",
      drafted: "-",
    };
    log.push(snapshot);
    if (failed || round === GAME_CONFIG.total_rounds) break;
    const offers = draft.getOffers(state);
    const chosen = [...offers].sort((left, right) => draftValue(right, state) - draftValue(left, state))[0];
    draft.addCard(state, chosen);
    snapshot.drafted = chosen.name;
  }

  const won = log.length === GAME_CONFIG.total_rounds && state.total_score >= GAME_CONFIG.milestone_targets[15];
  const output = { seed, won, rounds: log.length, score: state.total_score, deck: state.deck.length, plate: state.plate_capacity, tokens: state.delete_tokens, log };
  if (verbose) console.table(log);
  return output;
}

export function simulateBatch({ seeds = 40 } = {}) {
  const runs = Array.from({ length: seeds }, (_, index) => simulateRun({ seed: index + 1 }));
  const scores = runs.map((run) => run.score).sort((a, b) => a - b);
  return {
    runs: runs.length,
    wins: runs.filter((run) => run.won).length,
    win_rate: runs.filter((run) => run.won).length / runs.length,
    median_score: scores[Math.floor(scores.length / 2)],
    max_score: scores.at(-1),
  };
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll("\\", "/")}`).href) {
  const seed = Number(process.argv[2] ?? 1);
  console.log(JSON.stringify({ ...simulateRun({ seed, verbose: true }), log: undefined }, null, 2));
  console.table([simulateBatch()]);
}
