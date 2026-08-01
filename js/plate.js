import { GAME_CONFIG } from "./config.js";
import { getCardPostponeCount, getCurrentCard, incrementCardPostpone } from "./round-pile.js";

function count(value) {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
}

export function getPlateDrawBudget(deckSize, plateCapacity) {
  return Math.min(count(deckSize), count(plateCapacity));
}

export function takeRoundDrawPile(deck, plateCapacity, random = Math.random) {
  const cards = [...deck];
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const roll = Number(random());
    const normalized = Number.isFinite(roll) ? Math.min(0.999999999999, Math.max(0, roll)) : 0;
    const target = Math.floor(normalized * (index + 1));
    [cards[index], cards[target]] = [cards[target], cards[index]];
  }
  const actionBudget = getPlateDrawBudget(cards.length, plateCapacity);
  const reserve = cards.slice(actionBudget);
  return {
    draw_pile: cards.slice(0, actionBudget),
    action_budget: actionBudget,
    reserve_count: reserve.length,
    reserve_cards: reserve,
    reserve_type_counts: reserve.reduce((counts, card) => {
      counts[card.type] = (counts[card.type] ?? 0) + 1;
      return counts;
    }, {}),
  };
}

export function getPlateUpgradeBaseCost(upgradeCount) {
  const level = count(upgradeCount);
  return GAME_CONFIG.plate_upgrade_base_cost + level * (level + 1) / 2;
}

export function getPlateUpgradeCost(upgradeCount, discount = 0) {
  return Math.max(1, getPlateUpgradeBaseCost(upgradeCount) - count(discount));
}

export function getPlateSummary(deckSize, plateCapacity) {
  const size = count(deckSize);
  const capacity = Math.max(1, count(plateCapacity));
  const actionBudget = getPlateDrawBudget(size, capacity);
  return {
    deck_size: size,
    capacity,
    action_budget: actionBudget,
    reserve_count: Math.max(0, size - actionBudget),
  };
}

export function postponeCurrentCard(state, options = {}) {
  const pile = state?.round?.draw_pile;
  if (!Array.isArray(pile) || pile.length < 2) return { success: false, reason: "not_enough_cards" };
  const card = getCurrentCard(state);
  const requestedLimit = Number(options.max_per_card);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.floor(requestedLimit)) : 1;
  const used = getCardPostponeCount(state, card);
  if (used >= limit) {
    return { success: false, reason: "already_postponed", card };
  }
  const postponeCount = incrementCardPostpone(state, card);

  let direction = "back";
  let revealedCard = null;
  if ((state.round.reverse_postpone_charges ?? 0) > 0) {
    pile.pop();
    revealedCard = pile.shift();
    pile.push(card, revealedCard);
    state.round.reverse_postpone_charges -= 1;
    state.round.postpone_effect_triggers = (state.round.postpone_effect_triggers ?? 0) + 1;
    direction = "front";
  } else {
    pile.pop();
    pile.unshift(card);
  }

  let scoreBonus = 0;
  if ((state.round.postpone_score_charges ?? 0) > 0 && (state.round.postpone_score_awarded ?? 0) < 2) {
    state.round.postpone_score_charges -= 1;
    state.round.postpone_score_awarded = (state.round.postpone_score_awarded ?? 0) + 1;
    state.round.postpone_bonus_score = (state.round.postpone_bonus_score ?? 0) + 1;
    state.round.postpone_effect_triggers = (state.round.postpone_effect_triggers ?? 0) + 1;
    scoreBonus = 1;
  }
  state.round.postpone_count = (state.round.postpone_count ?? 0) + 1;
  return {
    success: true,
    card,
    remaining: pile.length,
    direction,
    revealed_card: revealedCard,
    score_bonus: scoreBonus,
    postpone_count_for_card: postponeCount,
    postpone_limit: limit,
  };
}
