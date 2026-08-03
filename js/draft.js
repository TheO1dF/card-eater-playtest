import { GAME_CONFIG, GAME_MODES } from "./config.js";
import { createCardPool } from "./data.js";
import { recordCardDeletion, recordReroll } from "./statistics.js";

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
    const forcedTypes = [...new Set([
      state.mode === GAME_MODES.PREP ? state.prep_slot?.card?.type : null,
      state.next_draft_forced_type,
    ].filter(Boolean))];
    for (const forcedType of forcedTypes) {
      if (offers.length >= count) break;
      const forcedPool = pool.filter((card) => card.type === forcedType);
      if (forcedPool.length > 0) {
        const chosen = forcedPool[weightedIndex(forcedPool, random)];
        offers.push(chosen);
        pool = pool.filter((card) => card.id !== chosen.id);
      }
    }
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
    state.next_draft_forced_type = null;
    return owned;
  }

  function skip(state) {
    state.draft_history.push({ round: state.current_round, card_id: null, skipped: true });
    state.next_draft_forced_type = null;
  }

  function reroll(state, cards = []) {
    if (state.phase !== "CardDraft") return { success: false, reason: "wrong_phase" };
    const hasFreeReroll = (state.free_rerolls ?? 0) > 0;
    if (!hasFreeReroll && (state.reroll_tokens ?? 0) < 1) return { success: false, reason: "no_token" };
    if (hasFreeReroll) state.free_rerolls -= 1;
    else state.reroll_tokens -= 1;
    const offers = getOffers(state, GAME_CONFIG.draft_size, cards.map((card) => card.id));
    recordReroll(state);
    return { success: true, offers, used_free: hasFreeReroll, free_rerolls: state.free_rerolls, tokens: state.reroll_tokens };
  }

  function removeCard(state, cardUuid) {
    if (state.phase !== "CardDraft") return { success: false, reason: "wrong_phase" };
    if (state.mode === GAME_MODES.PREP) return { success: false, reason: "prep_mode" };
    if ((state.delete_tokens ?? 0) < 1) return { success: false, reason: "no_token" };
    if (state.deck.length <= 1) return { success: false, reason: "last_card" };
    const index = state.deck.findIndex((card) => card.uuid === cardUuid);
    if (index < 0) return { success: false, reason: "not_found" };
    const [removed] = state.deck.splice(index, 1);
    state.delete_tokens -= 1;
    state.remove_count += 1;
    recordCardDeletion(state);
    return { success: true, card: removed, tokens: state.delete_tokens };
  }

  function storePrepCard(state, cardUuid) {
    if (state.mode !== GAME_MODES.PREP || state.phase !== "CardDraft") return { success: false, reason: "wrong_mode" };
    if (state.deck.length <= 1) return { success: false, reason: "last_card" };
    const index = state.deck.findIndex((card) => card.uuid === cardUuid);
    if (index < 0) return { success: false, reason: "not_found" };
    const previous = state.prep_slot?.card ?? null;
    if (previous) state.deck.push(previous);
    const [card] = state.deck.splice(index, 1);
    state.prep_slot = { card, stored_round: state.current_round, ready_round: state.current_round + 1 };
    return { success: true, card, returned: previous, ready_round: state.prep_slot.ready_round };
  }

  function retrievePrepCard(state) {
    if (state.mode !== GAME_MODES.PREP || state.phase !== "CardDraft") return { success: false, reason: "wrong_mode" };
    const card = state.prep_slot?.card;
    if (!card) return { success: false, reason: "empty" };
    state.deck.push(card);
    state.prep_slot = null;
    return { success: true, card };
  }

  function removePrepCard(state) {
    if (state.mode !== GAME_MODES.PREP || state.phase !== "CardDraft") return { success: false, reason: "wrong_mode" };
    const slot = state.prep_slot;
    if (!slot?.card) return { success: false, reason: "empty" };
    if (state.current_round < (slot.ready_round ?? Number.POSITIVE_INFINITY)) return { success: false, reason: "not_ready" };
    const card = slot.card;
    state.prep_slot = null;
    state.remove_count += 1;
    recordCardDeletion(state);
    return { success: true, card };
  }

  return { getOffers, addCard, skip, reroll, removeCard, storePrepCard, retrievePrepCard, removePrepCard };
}
