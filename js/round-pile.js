// draw_pile is stored in reverse resolution order:
// index 0 is the final card, and the last element is the current card.
// All card effects must use these helpers instead of encoding that direction again.

export function getDrawPile(state) {
  return Array.isArray(state?.round?.draw_pile) ? state.round.draw_pile : [];
}

export function getCurrentCard(state) {
  return getDrawPile(state).at(-1) ?? null;
}

// Cards left after the current card, kept in storage order (final -> next).
export function getRemainingCards(state) {
  return getDrawPile(state).slice(0, -1);
}

// Cards left after the current card, in the order the player will see them.
export function getRemainingCardsInPlayOrder(state) {
  return getRemainingCards(state).reverse();
}

export function getRemainingCardCount(state) {
  return Math.max(0, getDrawPile(state).length - 1);
}

export function getNextCard(state) {
  return getDrawPile(state).at(-2) ?? null;
}

export function getFinalRemainingCard(state) {
  return getRemainingCardCount(state) > 0 ? getDrawPile(state)[0] : null;
}

// Postpone effects resolve after their source card has moved within the pile.
export function getRoundCardsExcept(state, excludedUuid) {
  return getDrawPile(state).filter((card) => card.uuid !== excludedUuid);
}

export function isCardPostponed(state, cardOrUuid) {
  const uuid = typeof cardOrUuid === "string" ? cardOrUuid : cardOrUuid?.uuid;
  return Boolean(uuid && state?.round?.postponed_uuids?.includes(uuid));
}

export function getCardPostponeCount(state, cardOrUuid) {
  const uuid = typeof cardOrUuid === "string" ? cardOrUuid : cardOrUuid?.uuid;
  return uuid ? Math.max(0, state?.round?.postpone_counts?.[uuid] ?? 0) : 0;
}

// Applying an “already postponed” mark consumes the normal once-per-round allowance.
// An explicit infinite-postpone rule can still override that limit at the caller.
export function markCardsPostponed(state, cards, minimumCount = 1) {
  state.round.postponed_uuids ??= [];
  state.round.postpone_counts ??= {};
  const marked = [];
  for (const card of cards) {
    if (!card?.uuid) continue;
    if (!state.round.postponed_uuids.includes(card.uuid)) state.round.postponed_uuids.push(card.uuid);
    state.round.postpone_counts[card.uuid] = Math.max(minimumCount, state.round.postpone_counts[card.uuid] ?? 0);
    marked.push(card);
  }
  return marked;
}

export function incrementCardPostpone(state, card) {
  const used = getCardPostponeCount(state, card);
  markCardsPostponed(state, [card], used + 1);
  return used + 1;
}
