import { GAME_CONFIG } from "./config.js";

export function getReplayableCards(state) {
  const owned = new Set(state.deck.map((card) => card.uuid));
  return state.round.spent_pile.filter((card) => owned.has(card.uuid));
}

export function getReshuffleStatus(state) {
  const replayable = getReplayableCards(state);
  const withinLimit = state.deck.length <= GAME_CONFIG.reshuffle_max_deck_size;
  const hasCharge = state.round.reshuffle_charges > 0;
  return {
    can_use: withinLimit && hasCharge && replayable.length > 0,
    within_limit: withinLimit,
    charges: state.round.reshuffle_charges,
    replayable_count: replayable.length,
    replayable,
  };
}

export function activateReshuffle(state, shuffle) {
  const status = getReshuffleStatus(state);
  if (!status.can_use) return { success: false, ...status };
  state.round.reshuffle_charges -= 1;
  state.round.reshuffle_count += 1;
  state.round.draw_pile = shuffle([...state.round.draw_pile, ...status.replayable]);
  state.round.spent_pile = [];
  state.round.nebula_unresolved_since ??= {};
  state.round.draw_pile
    .filter((card) => card.effect?.kind === "nebula_wager")
    .forEach((card) => { state.round.nebula_unresolved_since[card.uuid] = state.round.actions.length; });
  return {
    success: true,
    replayed_count: status.replayable_count,
    remaining_charges: state.round.reshuffle_charges,
    reshuffle_count: state.round.reshuffle_count,
  };
}
