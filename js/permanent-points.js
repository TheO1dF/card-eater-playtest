import {
  EFFECT_LAYERS,
  applyExplicitBounds,
  createEffectProcessor,
} from "./effect-processor.js";
import { safeAdd, safeMultiply } from "./numbers.js";

export function isStatLocked(card, stat) {
  return Boolean(card?.stats_locked) || card?.locked_stats?.includes(stat);
}

function physicalCopies(state, cardUuid) {
  return [
    state.deck.find((item) => item.uuid === cardUuid),
    ...(state.round?.draw_pile ?? []),
    ...(state.round?.spent_pile ?? []),
    ...(state.round?.reserve_cards ?? []),
  ].filter((card) => card?.uuid === cardUuid);
}

export function syncPhysicalCard(state, cardUuid, values) {
  const copies = physicalCopies(state, cardUuid);
  copies.forEach((copy) => Object.assign(copy, values));
  return copies[0] ?? null;
}

export function lockPermanentCardStats(state, card, stats = ["eat_points", "discard_points"]) {
  const permanentCard = state.deck.find((item) => item.uuid === card.uuid);
  if (!permanentCard) return false;
  const lockedStats = [...new Set([...(permanentCard.locked_stats ?? []), ...stats])];
  syncPhysicalCard(state, card.uuid, {
    locked_stats: lockedStats,
    status_keywords: [...new Set([...(permanentCard.status_keywords ?? []), "锁定"])],
  });
  return true;
}

function pointChangeMultiplier(state, cardUuid) {
  const configured = state.round?.point_change_multipliers?.[cardUuid];
  if (Number.isFinite(configured) && configured > 0) return configured;
  const legacyStacks = (state.round?.double_point_change_uuids ?? []).filter((uuid) => uuid === cardUuid).length;
  return legacyStacks > 0 ? 2 ** legacyStacks : 1;
}

export function multiplyFuturePointChanges(state, cardUuids, multiplier, source = null) {
  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier === 1) return;
  state.round.point_change_multipliers ??= {};
  state.round.point_change_multiplier_sources ??= {};
  for (const uuid of cardUuids) {
    state.round.point_change_multipliers[uuid] = safeMultiply(
      state.round.point_change_multipliers[uuid] ?? 1,
      multiplier,
    );
    if (source) {
      state.round.point_change_multiplier_sources[uuid] ??= [];
      state.round.point_change_multiplier_sources[uuid].push(source);
    }
  }
}

function resolvePointEvent(state, card, stat, options) {
  const permanentCard = state.deck.find((item) => item.uuid === card.uuid);
  const before = permanentCard?.[stat] ?? 0;
  const event = {
    type: "permanent_point_change",
    state,
    card,
    permanent_card: permanentCard,
    stat,
    mode: options.mode,
    requested: options.value,
    value: before,
    before,
    limits: options.limits ?? {},
    cancelled: false,
  };
  const processor = createEffectProcessor();

  if (!permanentCard || isStatLocked(permanentCard, stat)) {
    processor.enqueue({
      id: "locked-or-missing",
      layer: EFFECT_LAYERS.PREVENTION,
      resolve(current, stack) { stack.cancel("locked_or_missing"); },
    });
  }

  if (options.mode === "add") {
    processor.enqueue({
      id: "point-change-multiplier",
      source: state.round?.point_change_multiplier_sources?.[card.uuid] ?? null,
      layer: EFFECT_LAYERS.REPLACEMENT,
      resolve(current) {
        current.requested = safeMultiply(current.requested, pointChangeMultiplier(state, card.uuid));
      },
    });
  }

  processor.enqueue({
    id: "prevent-protected-decrease",
    layer: EFFECT_LAYERS.PREVENTION,
    applies(current) {
      const requestedValue = current.mode === "add" ? safeAdd(current.before, current.requested) : current.requested;
      return requestedValue < current.before && state.round?.protected_decrease_uuids?.includes(card.uuid);
    },
    resolve(current, stack) { stack.cancel("protected_decrease"); },
  });

  processor.enqueue({
    id: options.mode === "add" ? "add-point-change" : "set-point-value",
    layer: options.mode === "add" ? EFFECT_LAYERS.ADDITIVE : EFFECT_LAYERS.SET,
    resolve(current) {
      current.value = current.mode === "add" ? safeAdd(current.before, current.requested) : safeAdd(0, current.requested);
    },
  });

  processor.enqueue({
    id: "explicit-point-boundary",
    layer: EFFECT_LAYERS.BOUNDARY,
    resolve(current) {
      current.value = applyExplicitBounds(current.value, current.limits, current.before);
    },
  });

  processor.enqueue({
    id: "commit-point-change",
    layer: EFFECT_LAYERS.STATE_BASED,
    resolve_when_cancelled: true,
    resolve(current) {
      if (current.cancelled || !current.permanent_card || current.value === current.before) return;
      syncPhysicalCard(state, card.uuid, { [stat]: current.value });
      state.round.grown_count = safeAdd(state.round.grown_count ?? 0, 1);
    },
  });

  const resolution = processor.resolve(event);
  return {
    amount: resolution.event.cancelled ? 0 : resolution.event.value - before,
    event: resolution.event,
    trace: resolution.trace,
  };
}

export function changePermanentCard(state, card, stat, amount, limits = {}) {
  const requested = Number(amount ?? 0);
  if (!Number.isFinite(requested) || requested === 0) return 0;
  return resolvePointEvent(state, card, stat, { mode: "add", value: requested, limits }).amount;
}

export function setPermanentCardStat(state, card, stat, value, limits = {}) {
  const permanentCard = state.deck.find((item) => item.uuid === card.uuid);
  const requested = Number(value ?? permanentCard?.[stat] ?? 0);
  if (!Number.isFinite(requested)) return 0;
  return resolvePointEvent(state, card, stat, { mode: "set", value: requested, limits }).amount;
}

export function growPermanentCard(state, card, stat, amount, limits = {}) {
  const growth = Math.max(0, Number(amount) || 0);
  return growth > 0 ? changePermanentCard(state, card, stat, growth, limits) : 0;
}
