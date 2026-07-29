import { GAME_CONFIG } from "./config.js";

export function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function safeRound(value) {
  const number = finiteNumber(value, value < 0 ? -GAME_CONFIG.max_score : GAME_CONFIG.max_score);
  return Math.round(Math.max(-GAME_CONFIG.max_score, Math.min(GAME_CONFIG.max_score, number)));
}

export function safeAdd(left, right) {
  return safeRound(finiteNumber(left) + finiteNumber(right));
}

export function safeMultiply(left, right) {
  return safeRound(finiteNumber(left) * finiteNumber(right));
}

export function safeProduct(left, right) {
  const product = finiteNumber(left, 1) * finiteNumber(right, 1);
  if (!Number.isFinite(product)) return GAME_CONFIG.max_score;
  return Math.max(-GAME_CONFIG.max_score, Math.min(GAME_CONFIG.max_score, product));
}

export function safePositiveInteger(value, maximum = GAME_CONFIG.max_score) {
  return Math.max(0, Math.min(maximum, Math.floor(finiteNumber(value))));
}

export function formatScore(value) {
  const number = safeRound(value);
  const absolute = Math.abs(number);
  const units = [
    [1e15, "Q"],
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  const unit = units.find(([threshold]) => absolute >= threshold);
  if (!unit) return String(number);
  const compact = number / unit[0];
  return `${compact.toFixed(Math.abs(compact) >= 100 ? 0 : Math.abs(compact) >= 10 ? 1 : 2)}${unit[1]}`;
}
