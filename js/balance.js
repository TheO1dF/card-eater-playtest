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

export function getShopWeight(card, round, loweredRarity = false) {
  const base = RARITY_MODEL[card.rarity]?.shop_weight ?? 1;
  if ((card.min_shop_round ?? 1) > round) return 0;
  if (card.rarity === "传奇" && round < 8) return 0;
  let weight = base;
  if (card.rarity === "稀有" && round < 3) weight = base * 0.18;
  else if (card.rarity === "普通" && round >= 10) weight = base * 0.42;
  else if (card.rarity === "稀有" && round >= 8) weight = base * 2.1;
  else if (card.rarity === "传奇" && round >= 13) weight = base * 5;
  else if (card.rarity === "传奇" && round >= 10) weight = base * 2.2;
  if (!loweredRarity) return weight;
  const penalty = { "普通": 1.35, "罕见": 0.72, "稀有": 0.35, "传奇": 0.15 }[card.rarity] ?? 1;
  return weight * penalty;
}
