import { safeAdd, safeMultiply } from "./numbers.js";

export const EFFECT_LAYERS = Object.freeze({
  REPLACEMENT: 10,
  PREVENTION: 20,
  SET: 30,
  ADDITIVE: 40,
  MULTIPLICATIVE: 50,
  BOUNDARY: 55,
  TRIGGERED: 60,
  AFTERMATH: 70,
  STATE_BASED: 80,
  CLEANUP: 90,
});

const VALID_LAYERS = new Set(Object.values(EFFECT_LAYERS));

function compareEffects(left, right) {
  return left.layer - right.layer
    || left.priority - right.priority
    || left.timestamp - right.timestamp
    || left.sequence - right.sequence;
}

export function createEffectProcessor(options = {}) {
  const maxSteps = Math.max(1, Number(options.max_steps) || 2048);
  const pending = [];
  const trace = [];
  const onceKeys = new Set();
  let sequence = 0;
  let currentLayer = -Infinity;
  let resolving = false;

  function enqueue(definition) {
    if (!definition || typeof definition.resolve !== "function") {
      throw new TypeError("Effect definitions require a resolve function.");
    }
    const layer = definition.layer ?? EFFECT_LAYERS.TRIGGERED;
    if (!VALID_LAYERS.has(layer)) throw new RangeError(`Unknown effect layer: ${layer}`);
    if (resolving && layer < currentLayer) {
      throw new Error(`Effect ${definition.id ?? "anonymous"} cannot modify an event retroactively.`);
    }
    if (definition.once_key && onceKeys.has(definition.once_key)) return false;
    if (definition.once_key) onceKeys.add(definition.once_key);
    pending.push({
      ...definition,
      layer,
      priority: Number(definition.priority) || 0,
      timestamp: Number(definition.timestamp) || 0,
      sequence: sequence += 1,
    });
    return true;
  }

  function resolve(event = {}) {
    if (resolving) throw new Error("An effect processor cannot resolve twice at the same time.");
    resolving = true;
    event.cancelled ??= false;
    let steps = 0;
    try {
      while (pending.length > 0) {
        if (steps >= maxSteps) throw new Error(`Effect resolution exceeded ${maxSteps} steps.`);
        pending.sort(compareEffects);
        const effect = pending.shift();
        currentLayer = effect.layer;
        steps += 1;
        if (event.cancelled && !effect.resolve_when_cancelled) continue;
        if (effect.applies && !effect.applies(event)) continue;
        const before = effect.snapshot ? effect.snapshot(event) : null;
        const result = effect.resolve(event, {
          enqueue,
          cancel(reason = effect.id ?? "cancelled") {
            event.cancelled = true;
            event.cancel_reason = reason;
          },
        });
        trace.push({
          id: effect.id ?? `effect-${effect.sequence}`,
          source: effect.source ?? null,
          layer: effect.layer,
          before,
          result: result ?? null,
        });
      }
      return { event, trace: [...trace], steps };
    } finally {
      resolving = false;
      currentLayer = -Infinity;
    }
  }

  return { enqueue, resolve, trace };
}

export function applyExplicitBounds(value, limits = {}, baseline = value) {
  let result = value;
  if (Number.isFinite(limits.min)) result = Math.max(Math.min(limits.min, baseline), result);
  if (Number.isFinite(limits.max)) result = Math.min(Math.max(limits.max, baseline), result);
  return result;
}

export function capWhenDeclared(value, maximum) {
  return Number.isFinite(maximum) ? Math.min(maximum, value) : value;
}

export function resolveLayeredValue(baseValue, modifiers = []) {
  const event = { type: "numeric_value", value: baseValue };
  const processor = createEffectProcessor();
  modifiers.forEach((modifier, index) => {
    if (!modifier || modifier.enabled === false) return;
    const operation = modifier.operation ?? "add";
    const defaultLayer = operation === "set"
      ? EFFECT_LAYERS.SET
      : operation === "multiply"
        ? EFFECT_LAYERS.MULTIPLICATIVE
        : operation === "bound"
          ? EFFECT_LAYERS.BOUNDARY
          : EFFECT_LAYERS.ADDITIVE;
    processor.enqueue({
      id: modifier.id ?? `value-modifier-${index}`,
      source: modifier.source,
      layer: modifier.layer ?? defaultLayer,
      priority: modifier.priority ?? 0,
      timestamp: modifier.timestamp ?? index,
      resolve(current) {
        if (operation === "set") current.value = typeof modifier.value === "function" ? modifier.value(current.value) : modifier.value;
        else if (operation === "multiply") current.value = safeMultiply(current.value, modifier.value);
        else if (operation === "bound") current.value = applyExplicitBounds(current.value, modifier, baseValue);
        else current.value = safeAdd(current.value, modifier.value);
      },
    });
  });
  return processor.resolve(event);
}
