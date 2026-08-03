import { finiteNumber } from "./numbers.js";

export const SUMMARY_RAPID_CARD_THRESHOLD = 13;

export function getSummaryCardTiming(index, settings = {}, reducedMotion = false) {
  const rapid = index >= SUMMARY_RAPID_CARD_THRESHOLD;
  if (reducedMotion || settings.summary_skip === true) {
    return Object.freeze({ reveal: 0, count: 0, gap: 0, rapid });
  }
  const selectedSpeed = settings.summary_speed === "fast" ? 0.58 : 1;
  const longDeckSpeed = rapid ? 0.42 : 1;
  const scale = selectedSpeed * longDeckSpeed;
  return Object.freeze({
    reveal: Math.round(520 * scale),
    count: Math.round(720 * scale),
    gap: Math.round(170 * scale),
    rapid,
  });
}

export function getSummaryBeatDuration(milliseconds, settings = {}, reducedMotion = false) {
  if (reducedMotion || settings.summary_skip === true) return 0;
  return Math.round(milliseconds * (settings.summary_speed === "fast" ? 0.58 : 1));
}

export const ROUND_GRADE_SCALE = Object.freeze([
  Object.freeze({ grade: "S", minimum: 100, label: "神级盛宴", tone: "s" }),
  Object.freeze({ grade: "A+", minimum: 50, label: "火热出餐", tone: "aplus" }),
  Object.freeze({ grade: "A", minimum: 30, label: "漂亮一轮", tone: "a" }),
  Object.freeze({ grade: "B", minimum: 20, label: "稳定发挥", tone: "b" }),
  Object.freeze({ grade: "C", minimum: -Infinity, label: "继续加热", tone: "c" }),
]);

export function getRoundGrade(score) {
  const value = finiteNumber(score);
  return ROUND_GRADE_SCALE.find((entry) => value >= entry.minimum) ?? ROUND_GRADE_SCALE.at(-1);
}

export function getScoreImpact(score) {
  const value = Math.abs(finiteNumber(score));
  if (value >= 100) return 5;
  if (value >= 50) return 4;
  if (value >= 20) return 3;
  if (value >= 8) return 2;
  if (value >= 3) return 1;
  return 0;
}

export function getScoreHeat(score) {
  const value = Math.max(0, finiteNumber(score));
  if (value >= 100) return 5;
  if (value >= 50) return 4;
  if (value >= 30) return 3;
  if (value >= 15) return 2;
  if (value > 0) return 1;
  return 0;
}
