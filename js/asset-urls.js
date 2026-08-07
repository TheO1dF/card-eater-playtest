// Single source of truth for runtime asset URLs.
//
// js/ui.js builds its sprite styles from these helpers and js/offline.js reuses
// them to compute the offline bundle, so the cached URL set can never drift away
// from the URL set the game actually requests. Bumping a version constant here
// invalidates that asset everywhere at once.

export const CARD_ART_VERSION = 14;
export const CARD_ATLAS_VERSION = 10;
export const CARD_SHEET_VERSION = 3;
export const META_ICON_VERSION = 24;
export const META_ATLAS_VERSION = 14;

export const CARD_SPRITE_SHEET = "card-sprites.webp";

export const cardArtUrl = (card) => card.runtime_art_mode === "atlas"
  ? `./assets/${card.runtime_atlas}?v=${CARD_ATLAS_VERSION}`
  : `./assets/${card.art_file}?v=${CARD_ART_VERSION}`;

export const cardSheetUrl = (card) => `./assets/${card.sprite_sheet ?? CARD_SPRITE_SHEET}?v=${CARD_SHEET_VERSION}`;

export const metaIconUrl = (entry) => `./assets/${entry.icon_file}?v=${META_ICON_VERSION}`;

export const metaAtlasUrl = (entry) => `./assets/${entry.icon_atlas}?v=${META_ATLAS_VERSION}`;

// VOID is drawn from CSS gradients alone, so it never contributes a request.
const isDrawnWithoutArt = (card) => card.id === "VOID";

function pushCardArt(card, into) {
  if (!card || isDrawnWithoutArt(card)) return;
  if (card.runtime_art_mode === "fusion") {
    for (const part of card.fusion_parts ?? []) pushCardArt(part, into);
    return;
  }
  if (card.runtime_art_mode === "atlas") {
    if (card.runtime_atlas) into.add(cardArtUrl(card));
    return;
  }
  into.add(card.art_file ? cardArtUrl(card) : cardSheetUrl(card));
}

/** Every card-art URL `spriteStyle` and `warmCardArt` can ask for. */
export function collectCardArtUrls(cards) {
  const urls = new Set();
  for (const card of cards) pushCardArt(card, urls);
  return [...urls];
}

/** Every icon URL `metaStyle` can ask for, across items and quests. */
export function collectMetaIconUrls(entries) {
  const urls = new Set();
  for (const entry of entries) {
    if (!entry) continue;
    if (entry.icon_file) urls.add(metaIconUrl(entry));
    else if (entry.icon_atlas) urls.add(metaAtlasUrl(entry));
  }
  return [...urls];
}
