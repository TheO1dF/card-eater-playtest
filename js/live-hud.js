import { safeAdd } from "./numbers.js";

const numberOrZero = (value) => Number.isFinite(value) ? value : 0;

/**
 * Values already earned during the current round, before round-end-only
 * effects and multipliers are evaluated. This is presentation data only: it
 * never mutates the economy or changes when card effects can spend coins.
 */
export function getLiveHudValues(state) {
  const playing = state?.phase === "Playing";
  const round = state?.round ?? {};
  const actions = Array.isArray(round.actions) ? round.actions : [];
  const liveRoundScore = playing
    ? actions.reduce((sum, entry) => safeAdd(sum, numberOrZero(entry?.points)), numberOrZero(round.postpone_bonus_score))
    : 0;
  const eatenCardCoins = playing
    ? new Set((round.eat_sequence ?? []).map((entry) => entry?.card_uuid).filter(Boolean)).size
    : 0;
  const queuedGold = playing ? numberOrZero(round.pending_gold_bonus) : 0;
  const pendingGold = safeAdd(eatenCardCoins, queuedGold);
  const settledScore = numberOrZero(state?.total_score);
  const settledGold = numberOrZero(state?.gold);

  return {
    playing,
    settled_score: settledScore,
    live_round_score: liveRoundScore,
    display_score: safeAdd(settledScore, liveRoundScore),
    settled_gold: settledGold,
    eaten_card_coins: eatenCardCoins,
    queued_gold: queuedGold,
    pending_gold: pendingGold,
    display_gold: safeAdd(settledGold, pendingGold),
  };
}
