import { GAME_CONFIG } from "./config.js";
import { createCardPool } from "./data.js";

const RARITY_WEIGHT = Object.freeze({ "普通": 54, "罕见": 28, "稀有": 14, "传奇": 4 });

function weightedIndex(cards, random) {
  const weights = cards.map((card) => RARITY_WEIGHT[card.rarity] ?? 1);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = random() * total;
  for (let index = 0; index < cards.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return index;
  }
  return cards.length - 1;
}

export function createDraftService(options = {}) {
  const random = options.random ?? Math.random;
  const createId = options.create_id ?? ((card, index) => `${card.id}-draft-${Date.now()}-${index}`);

  function getOffers(state, count = GAME_CONFIG.draft_size, excludedIds = []) {
    const excluded = new Set(excludedIds);
    let pool = createCardPool().filter((card) => (
      (card.min_draft_round ?? 1) <= state.current_round && !excluded.has(card.id)
    ));
    if (pool.length < count) {
      pool = createCardPool().filter((card) => (card.min_draft_round ?? 1) <= state.current_round);
    }
    const offers = [];
    while (offers.length < count && pool.length > 0) {
      const [chosen] = pool.splice(weightedIndex(pool, random), 1);
      offers.push(chosen);
    }
    return offers;
  }

  function addCard(state, card) {
    if (!card || state.deck.length >= GAME_CONFIG.max_deck_size) return null;
    const owned = {
      ...card,
      synergy_tags: [...(card.synergy_tags ?? [])],
      effect: card.effect ? { ...card.effect, keywords: [...(card.effect.keywords ?? [])] } : null,
      uuid: createId(card, state.deck.length),
    };
    state.deck.push(owned);
    state.draft_history.push({ round: state.current_round, card_id: card.id, skipped: false });
    return owned;
  }

  function skip(state) {
    state.draft_history.push({ round: state.current_round, card_id: null, skipped: true });
  }

  function reroll(state, cards = []) {
    if (state.phase !== "CardDraft") return { success: false, reason: "wrong_phase" };
    if ((state.reroll_tokens ?? 0) < 1) return { success: false, reason: "no_token" };
    state.reroll_tokens -= 1;
    const offers = getOffers(state, GAME_CONFIG.draft_size, cards.map((card) => card.id));
    return { success: true, offers, tokens: state.reroll_tokens };
  }

  function removeCard(state, cardUuid) {
    if (state.phase !== "CardDraft") return { success: false, reason: "wrong_phase" };
    if ((state.delete_tokens ?? 0) < 1) return { success: false, reason: "no_token" };
    if (state.deck.length <= 1) return { success: false, reason: "last_card" };
    const index = state.deck.findIndex((card) => card.uuid === cardUuid);
    if (index < 0) return { success: false, reason: "not_found" };
    const [removed] = state.deck.splice(index, 1);
    state.delete_tokens -= 1;
    state.remove_count += 1;
    return { success: true, card: removed, tokens: state.delete_tokens };
  }

  return { getOffers, addCard, skip, reroll, removeCard };
}
