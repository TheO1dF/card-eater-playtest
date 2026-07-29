export const RARITY_MODEL = Object.freeze({
  "普通": Object.freeze({ price: 5, shop_weight: 58, expected_base: 1, synergy_ceiling: 3 }),
  "罕见": Object.freeze({ price: 8, shop_weight: 27, expected_base: 2, synergy_ceiling: 7 }),
  "稀有": Object.freeze({ price: 12, shop_weight: 12, expected_base: 3, synergy_ceiling: 16 }),
  "传奇": Object.freeze({ price: 18, shop_weight: 3, expected_base: 1, synergy_ceiling: 40 }),
});

export const CARD_ROLES = Object.freeze({
  BASELINE: "baseline",
  SETUP: "setup",
  PAYOFF: "payoff",
  SACRIFICE: "sacrifice",
  ENGINE: "engine",
  ECONOMY: "economy",
});

export function getRarityPrice(rarity) {
  return RARITY_MODEL[rarity]?.price ?? RARITY_MODEL["普通"].price;
}

export function getShopWeight(card, round) {
  const base = RARITY_MODEL[card.rarity]?.shop_weight ?? 1;
  if ((card.min_shop_round ?? 1) > round) return 0;
  if (card.rarity === "传奇" && round < 8) return 0;
  if (card.rarity === "稀有" && round < 3) return base * 0.18;
  if (card.rarity === "普通" && round >= 10) return base * 0.42;
  if (card.rarity === "稀有" && round >= 8) return base * 2.1;
  if (card.rarity === "传奇" && round >= 13) return base * 5;
  if (card.rarity === "传奇" && round >= 10) return base * 2.2;
  return base;
}
