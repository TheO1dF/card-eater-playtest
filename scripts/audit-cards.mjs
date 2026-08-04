import { readFile } from "node:fs/promises";
import { CARD_EFFECT_CONTRACTS } from "../js/card-effect-contracts.js";
import { CARD_TYPES, createCardPool } from "../js/data.js";

const EXPECTED_COUNT = 89;
const VALID_RARITIES = new Set(["普通", "罕见", "稀有", "传奇"]);
const VALID_EDIBILITY = new Set(["edible", "inedible"]);
const validTypes = Object.values(CARD_TYPES);
const cards = createCardPool();
const errors = [];
const ids = new Set();
const names = new Set();
const artFiles = new Set();
const engineSource = await readFile(new URL("../js/engine.js", import.meta.url), "utf8");

if (cards.length !== EXPECTED_COUNT) errors.push(`expected ${EXPECTED_COUNT} cards, found ${cards.length}`);

for (const card of cards) {
  const label = `${card.id} ${card.name}`;
  if (ids.has(card.id)) errors.push(`${label}: duplicate id`);
  if (names.has(card.name)) errors.push(`${label}: duplicate name`);
  if (artFiles.has(card.art_file)) errors.push(`${label}: duplicate art file ${card.art_file}`);
  ids.add(card.id);
  names.add(card.name);
  artFiles.add(card.art_file);

  if (!validTypes.includes(card.type)) errors.push(`${label}: invalid type ${card.type}`);
  if (!VALID_RARITIES.has(card.rarity)) errors.push(`${label}: invalid rarity ${card.rarity}`);
  if (!VALID_EDIBILITY.has(card.edibility)) errors.push(`${label}: invalid edibility ${card.edibility}`);
  if (![card.eat_points, card.discard_points, card.base_eat_points, card.base_discard_points].every(Number.isFinite)) {
    errors.push(`${label}: non-finite card points`);
  }
  if (!card.effect) continue;
  if (!card.effect.description?.trim()) errors.push(`${label}: effect has no description`);
  if (Number.isFinite(card.effect.max_bonus)
    && !card.effect.description.includes(`最多 +${card.effect.max_bonus}`)) {
    errors.push(`${label}: max_bonus=${card.effect.max_bonus} is not declared in player text`);
  }
  if (Number.isFinite(card.effect.max_eat_points)
    && !new RegExp(`(?:最高|最多|上限)\\s*${card.effect.max_eat_points}`).test(card.effect.description)) {
    errors.push(`${label}: max_eat_points=${card.effect.max_eat_points} is not declared in player text`);
  }
  if (!CARD_EFFECT_CONTRACTS[card.effect.kind]) errors.push(`${label}: missing effect contract for ${card.effect.kind}`);
  if (!engineSource.includes(`\"${card.effect.kind}\"`)) errors.push(`${label}: no engine handler reference for ${card.effect.kind}`);
}

const byType = Object.fromEntries(validTypes.map((type) => [type, cards.filter((card) => card.type === type).length]));
const byScope = Object.fromEntries(Object.values(CARD_EFFECT_CONTRACTS).reduce((counts, contract) => {
  counts.set(contract.scope, (counts.get(contract.scope) ?? 0) + 1);
  return counts;
}, new Map()));

if (errors.length > 0) {
  throw new Error(`Card audit failed:\n${errors.join("\n")}`);
}

console.log(`Card audit passed: ${cards.length}/${EXPECTED_COUNT} cards, ${Object.keys(CARD_EFFECT_CONTRACTS).length} effect contracts.`);
console.log(`Type counts: ${JSON.stringify(byType)}`);
console.log(`Contract scopes: ${JSON.stringify(byScope)}`);
