import { safeAdd } from "./numbers.js";

function positiveAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

export function recordRoundGold(state, label, value, options = {}) {
  const amount = positiveAmount(value);
  if (!amount || !state?.round) return 0;
  state.round.gold_sources ??= [];
  const timing = options.timing ?? "settlement";
  const kind = options.kind ?? "card";
  const sourceLabel = String(label || "卡牌效果");
  const existing = state.round.gold_sources.find((entry) => (
    entry.label === sourceLabel && entry.timing === timing && entry.kind === kind
  ));
  if (existing) existing.amount = safeAdd(existing.amount, amount);
  else state.round.gold_sources.push({ label: sourceLabel, amount, timing, kind });
  return amount;
}

export function queueRoundGold(state, label, value, kind = "card") {
  const amount = recordRoundGold(state, label, value, { timing: "settlement", kind });
  if (amount) state.round.pending_gold_bonus = safeAdd(state.round.pending_gold_bonus ?? 0, amount);
  return amount;
}

export function grantRoundGold(state, entry, label, value, kind = "card") {
  const amount = recordRoundGold(state, label, value, { timing: "immediate", kind });
  if (!amount) return 0;
  state.gold = safeAdd(state.gold ?? 0, amount);
  if (entry) entry.gold_change = safeAdd(entry.gold_change ?? 0, amount);
  return amount;
}

export function getRoundGoldSources(state) {
  return (state?.round?.gold_sources ?? []).map((entry) => ({ ...entry }));
}

export function sumRoundGoldSources(state, timing = null) {
  return (state?.round?.gold_sources ?? [])
    .filter((entry) => !timing || entry.timing === timing)
    .reduce((total, entry) => safeAdd(total, entry.amount ?? 0), 0);
}
