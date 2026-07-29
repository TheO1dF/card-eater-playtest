import { GAME_CONFIG } from "./config.js";
import { createShopCardPool, getCardById } from "./data.js";
import { addItem, createShopItemPool, getItemById } from "./items.js";
import { getRarityPrice, getShopWeight, RARITY_MODEL } from "./balance.js";
import { safeAdd, safePositiveInteger } from "./numbers.js";
import { getPlateUpgradeBaseCost, getPlateUpgradeCost } from "./plate.js";

export const RARITY_PRICE = Object.freeze(Object.fromEntries(
  Object.entries(RARITY_MODEL).map(([rarity, model]) => [rarity, model.price]),
));

function takeWeighted(pool, round, random, rareBonus = 0) {
  const weights = pool.map((card) => getShopWeight(card, round) * (card.rarity === "稀有" ? 1 + rareBonus : 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return pool.splice(0, 1)[0];

  let roll = random() * total;
  for (let index = 0; index < pool.length; index += 1) {
    roll -= weights[index];
    if (roll < 0) return pool.splice(index, 1)[0];
  }
  return pool.pop();
}

export function createShopService(options = {}) {
  const random = options.random ?? Math.random;
  const createId = options.create_id ?? (() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

  function getCardPriceModifiers(state) {
    const itemDiscount = state.items
      .filter((entry) => entry.effect?.kind === "shop_price_discount")
      .reduce((total, entry) => total + (entry.effect.amount ?? 0), 0);
    return { discount: (state.round.shop_discount ?? 0) + itemDiscount };
  }

  function repriceShopCards(state, cards) {
    const { discount } = getCardPriceModifiers(state);
    return cards.map((card) => {
      const basePrice = Math.max(1, getRarityPrice(card.rarity) + (card.shop_price_adjustment ?? 0));
      return {
        ...card,
        shop_base_price: basePrice,
        shop_discount: discount,
        shop_price: card.forced_price ? Math.min(4, Math.max(1, basePrice - discount)) : Math.max(1, basePrice - discount),
      };
    });
  }

  function getEligibleCardPool(state) {
    return createShopCardPool().filter((card) => {
      if ((card.min_shop_round ?? 1) > state.current_round) return false;
      return true;
    });
  }

  function getShopCards(state) {
    const pool = getEligibleCardPool(state);
    const offers = [];
    while (offers.length < GAME_CONFIG.shop_offer_count && pool.length > 0) {
      offers.push(takeWeighted(pool, state.current_round, random, state.rare_shop_weight_bonus ?? 0));
    }
    return repriceShopCards(state, offers);
  }

  function getThemedShopCards(state) {
    const pool = getEligibleCardPool(state);
    const groups = [...new Set(pool.map((card) => card.type))]
      .map((type) => ({
        type,
        cards: pool.filter((card) => card.type === type),
        weight: 1 + state.deck.filter((owned) => owned.type === type).length,
      }))
      .filter((group) => group.cards.length >= GAME_CONFIG.shop_offer_count);
    if (groups.length === 0) return { type: null, cards: [] };
    let selected = groups.find((group) => group.type === state.round.forced_theme_type);
    if (!selected) {
      let roll = random() * groups.reduce((sum, group) => sum + group.weight, 0);
      selected = groups.at(-1);
      for (const group of groups) {
        roll -= group.weight;
        if (roll < 0) {
          selected = group;
          break;
        }
      }
    }
    const candidates = [...selected.cards];
    const cards = [];
    while (cards.length < GAME_CONFIG.shop_offer_count && candidates.length > 0) {
      cards.push(takeWeighted(candidates, state.current_round, random, state.rare_shop_weight_bonus ?? 0));
    }
    return { type: selected.type, cards: repriceShopCards(state, cards) };
  }

  function getShopItems(state) {
    const pool = createShopItemPool().filter((entry) => (
      (entry.min_shop_round ?? 1) <= state.current_round
      && (entry.max_shop_round ?? GAME_CONFIG.total_rounds) >= state.current_round
      && !state.items.some((owned) => owned.id === entry.id)
      && !state.pending_rewards?.some((reward) => reward.item_id === entry.id)
    ));
    const offers = [];
    while (offers.length < GAME_CONFIG.shop_item_offer_count && pool.length > 0) {
      offers.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
    }
    return offers.map((entry) => ({ ...entry, shop_price: entry.shop_price }));
  }

  function getBuyCardStatus(state, card) {
    if (!card || !Number.isFinite(card.shop_price)) return { ok: false, reason: "invalid_offer" };
    if (state.deck.length >= GAME_CONFIG.max_deck_size) return { ok: false, reason: "deck_full" };
    if (state.gold < card.shop_price) return { ok: false, reason: "insufficient_gold" };
    const cleanCard = getCardById(card.id);
    if (!cleanCard) return { ok: false, reason: "missing_card" };
    return { ok: true, reason: null, card: cleanCard };
  }

  function buyCard(state, card) {
    const status = getBuyCardStatus(state, card);
    if (!status.ok) return false;
    const cleanCard = status.card;
    state.gold = safeAdd(state.gold, -card.shop_price);
    const dormant = Boolean(state.round.next_purchase_dormant);
    state.deck.push({
      ...cleanCard,
      uuid: createId(cleanCard, state.deck.length),
      ...(dormant ? { dormant_until_round: state.current_round + 1, status_keywords: ["休眠"] } : {}),
    });
    if (dormant) state.round.next_purchase_dormant = false;
    let refund = 0;
    if (state.round.reserve_count > 0) {
      for (const entry of state.items.filter((owned) => owned.effect?.kind === "reserve_purchase_refund")) {
        const key = `item:${entry.id}:purchase-refund`;
        if (state.round.effect_trigger_counts[key]) continue;
        state.round.effect_trigger_counts[key] = 1;
        refund = safeAdd(refund, Math.min(card.shop_price, entry.effect.gold ?? 0));
      }
    }
    state.gold = safeAdd(state.gold, refund);
    state.last_shop_transaction = { kind: "buy_card", card_name: cleanCard.name, cost: card.shop_price, refund, dormant };
    return true;
  }

  function getBuyItemStatus(state, entry) {
    if (!entry || !Number.isFinite(entry.shop_price)) return { ok: false, reason: "invalid_offer" };
    if (state.items.some((owned) => owned.id === entry.id)) return { ok: false, reason: "already_owned" };
    if (state.gold < entry.shop_price) return { ok: false, reason: "insufficient_gold" };
    return { ok: Boolean(getItemById(entry.id)), reason: getItemById(entry.id) ? null : "missing_item" };
  }

  function buyItem(state, entry) {
    const status = getBuyItemStatus(state, entry);
    if (!status.ok) return false;
    state.gold = safeAdd(state.gold, -entry.shop_price);
    return addItem(state, entry.id);
  }

  function getRerollCost(state) {
    if (state.round.shop_free_rerolls > 0) return 0;
    const fullPlateDiscount = state.deck.length <= state.plate_capacity
      ? state.items
        .filter((entry) => entry.effect?.kind === "full_plate_reroll_discount")
        .reduce((total, entry) => total + (entry.effect.amount ?? 0), 0)
      : 0;
    return Math.max(
      1,
      GAME_CONFIG.shop_reroll_base_cost + state.round.shop_reroll_count * GAME_CONFIG.shop_reroll_cost_step - fullPlateDiscount,
    );
  }

  function rerollShop(state) {
    const cost = getRerollCost(state);
    if (cost > 0 && state.gold < cost) return { success: false, cost, cards: null, free: false };
    const free = cost === 0;
    if (free) state.round.shop_free_rerolls = Math.max(0, state.round.shop_free_rerolls - 1);
    else state.gold = safeAdd(state.gold, -cost);
    state.round.shop_reroll_count = safePositiveInteger(state.round.shop_reroll_count + 1, 1000);
    state.round.shop_force_price_four = false;
    state.round.shop_force_price_four_applied = true;
    const themed = getThemedShopCards(state);
    return {
      success: true,
      cost,
      cards: getShopCards(state),
      themed_cards: themed.cards,
      theme_type: themed.type,
      items: getShopItems(state),
      free,
    };
  }

  function getPlateUpgradeStatus(state) {
    const discount = state.items
      .filter((entry) => entry.effect?.kind === "plate_upgrade_discount")
      .reduce((total, entry) => total + (entry.effect.amount ?? 0), 0);
    const baseCost = getPlateUpgradeBaseCost(state.plate_upgrade_count);
    const cost = getPlateUpgradeCost(state.plate_upgrade_count, discount);
    if (state.plate_capacity >= GAME_CONFIG.max_plate_capacity) {
      return { ok: false, reason: "max_capacity", cost, base_cost: baseCost, discount };
    }
    if (state.gold < cost) return { ok: false, reason: "insufficient_gold", cost, base_cost: baseCost, discount };
    return { ok: true, reason: null, cost, base_cost: baseCost, discount };
  }

  function buyPlateUpgrade(state) {
    const status = getPlateUpgradeStatus(state);
    if (!status.ok) return status;
    state.gold = safeAdd(state.gold, -status.cost);
    state.plate_capacity = Math.min(GAME_CONFIG.max_plate_capacity, state.plate_capacity + 1);
    state.plate_upgrade_count = safePositiveInteger(state.plate_upgrade_count + 1, GAME_CONFIG.max_plate_capacity);
    state.last_shop_transaction = {
      kind: "plate_upgrade",
      cost: status.cost,
      plate_capacity: state.plate_capacity,
    };
    return { ...status, success: true, plate_capacity: state.plate_capacity };
  }

  function removeCard(state, cardUuid) {
    const roundFree = (state.round.shop_free_removals ?? 0) > 0;
    const earnedFree = (state.free_card_removals ?? 0) > 0;
    const free = roundFree || earnedFree;
    const removalCost = free ? 0 : state.remove_card_cost;
    if (state.deck.length <= 1 || state.gold < removalCost) return false;
    const index = state.deck.findIndex((card) => card.uuid === cardUuid);
    if (index < 0) return false;

    const removed = state.deck[index];
    const cost = removalCost;
    state.gold = safeAdd(state.gold, -cost);
    state.deck.splice(index, 1);
    state.remove_count += 1;
    if (roundFree) state.round.shop_free_removals = Math.max(0, state.round.shop_free_removals - 1);
    else if (earnedFree) state.free_card_removals = Math.max(0, state.free_card_removals - 1);
    state.remove_card_cost = state.remove_count * GAME_CONFIG.delete_cost_step;
    state.last_shop_transaction = {
      kind: "remove",
      card_name: removed.name,
      cost,
      free_source: roundFree ? "round" : earnedFree ? "milestone" : null,
    };
    return true;
  }

  function applyOpeningPriceOverride(state, groups) {
    if (!state.round.shop_force_price_four || state.round.shop_force_price_four_applied) return null;
    const offers = groups.flat().filter(Boolean);
    const target = offers.reduce((highest, offer) => !highest || offer.shop_price > highest.shop_price ? offer : highest, null);
    state.round.shop_force_price_four_applied = true;
    if (!target || target.shop_price <= 4) return null;
    target.shop_price = 4;
    target.shop_discount = Math.max(target.shop_discount ?? 0, (target.shop_base_price ?? 4) - 4);
    target.forced_price = true;
    return target;
  }

  function getRemoveCardCost(state) {
    return (state.round.shop_free_removals ?? 0) > 0 || (state.free_card_removals ?? 0) > 0
      ? 0
      : state.remove_card_cost;
  }

  return {
    getShopCards,
    getThemedShopCards,
    repriceShopCards,
    getShopItems,
    getBuyCardStatus,
    buyCard,
    getBuyItemStatus,
    buyItem,
    removeCard,
    getRemoveCardCost,
    applyOpeningPriceOverride,
    getRerollCost,
    rerollShop,
    getPlateUpgradeStatus,
    buyPlateUpgrade,
  };
}
