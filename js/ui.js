import { GAME_CONFIG, GAME_MODES, MODE_LABELS, getFinalRound, getNextMilestone } from "./config.js";
import {
  getCurrentItemDescription,
  getCultivationTarget,
  getItemById,
  getItemLevelLabel,
  getItemProgressText,
  getPostponeLimit,
  isCultivationComplete,
} from "./items.js";
import { formatScore } from "./numbers.js";
import { getQuestRequirement, getQuestTarget } from "./quests.js";
import { stripKeywordTags } from "./keywords.js";
import { createCardPool, getCardById } from "./data.js";
import { getPlateSummary } from "./plate.js";
import { getReshuffleStatus } from "./reshuffle.js";
import { getRuleUnlockRound } from "./rules.js";
import { getLiveHudValues } from "./live-hud.js";

const PHASE_LABELS = Object.freeze({
  Init: "准备中", Playing: "出牌中", Scoring: "结算中", CardDraft: "轮末选牌",
  ItemDraft: "挑选道具", NextRound: "下一轮", GameOver: "本局结束",
});

const RARITY_CLASS = Object.freeze({ "普通": "common", "罕见": "uncommon", "稀有": "rare", "传奇": "legendary", "诅咒": "curse" });
const EDIBILITY_LABEL = Object.freeze({ edible: "可食用", inedible: "不可食用" });
const CARD_ART_VERSION = 14;
const CARD_ATLAS_VERSION = 10;
const cardArtCache = new Map();
const freshArtClass = (card) => card.art_file?.includes("-v2.") ? " art-outlined" : "";
const signed = (value) => value > 0 ? `+${formatScore(value)}` : formatScore(value);
const pointTone = (card, stat) => {
  const base = card[`base_${stat}`] ?? card[stat] ?? 0;
  return (card[stat] ?? 0) > base ? "point-increased" : (card[stat] ?? 0) < base ? "point-decreased" : "point-base";
};
const pointValue = (card, stat) => {
  const value = card[stat] ?? 0;
  const base = card[`base_${stat}`] ?? value;
  const delta = value - base;
  const tone = pointTone(card, stat);
  const valueText = signed(value);
  const widthClass = valueText.length >= 6 ? " is-very-wide" : valueText.length >= 4 ? " is-wide" : "";
  const deltaText = `${delta > 0 ? "▲" : "▼"}${Math.abs(delta)} · 原 ${signed(base)}`;
  return `<span class="card-point-wrap ${tone}${widthClass}"><b class="card-point-value">${valueText}</b>${delta === 0 ? "" : `<small class="card-point-delta" title="${deltaText}"><span>${delta > 0 ? "▲" : "▼"}${Math.abs(delta)}</span><span>原 ${signed(base)}</span></small>`}</span>`;
};
const cardEffectText = (card) => {
  const visibleStatuses = (card.status_keywords ?? []).filter((keyword) => ["弱化", "锁定", "休眠"].includes(keyword));
  const status = visibleStatuses.map((keyword) => `【${keyword}】`).join(" ");
  const description = stripKeywordTags(card.effect?.description ?? card.flavor ?? "");
  return `${status}${status ? " " : ""}${description}`;
};
const effectTone = (entry = {}) => {
  const keywords = entry.keywords ?? [];
  if (entry.wrong_edibility || keywords.includes("硬吃")) return "hard";
  if (entry.destroyed_self || keywords.includes("弱化") || keywords.includes("摧毁")) return "destroy";
  const permanentValues = entry.permanent_change ? Object.values(entry.permanent_change).filter(Number.isFinite) : [];
  if (entry.point_changes?.some((change) => change.amount < 0) || permanentValues.some((value) => value < 0)) return "mutation";
  if (keywords.includes("重洗")) return "reshuffle";
  if (keywords.includes("生成")) return "generate";
  if (keywords.includes("经济") || (entry.gold_change ?? 0) !== 0) return "economy";
  if (keywords.includes("成长") || entry.permanent_change) return "growth";
  if (keywords.includes("水果连击")) return "fruit";
  return "effect";
};
const EFFECT_PRESENTATION = Object.freeze({
  hard: { icon: "!", label: "HARD EAT · 硬吃" },
  destroy: { icon: "×", label: "DESTROY · 摧毁" },
  economy: { icon: "✦", label: "CARD EFFECT · 效果" },
  generate: { icon: "+", label: "CREATE · 生成" },
  reshuffle: { icon: "↻", label: "RESHUFFLE · 重洗" },
  growth: { icon: "↑", label: "GROWTH · 成长" },
  mutation: { icon: "↓", label: "POINT SHIFT · 点数变化" },
  fruit: { icon: "◆", label: "FRUIT COMBO · 水果连击" },
  effect: { icon: "✦", label: "CARD EFFECT · 效果" },
});
const cardArtUrl = (card) => card.runtime_art_mode === "atlas"
  ? `./assets/${card.runtime_atlas}?v=${CARD_ATLAS_VERSION}`
  : `./assets/${card.art_file}?v=${CARD_ART_VERSION}`;

function warmCardArt(cards) {
  const ready = cards.map((card) => {
    if (!card.art_file) return;
    const url = cardArtUrl(card);
    if (cardArtCache.has(url)) return cardArtCache.get(url).ready;
    const image = new Image();
    image.decoding = "async";
    image.fetchPriority = "high";
    image.src = url;
    const imageReady = image.decode().catch(() => undefined);
    cardArtCache.set(url, { image, ready: imageReady });
    return imageReady;
  });
  return Promise.all(ready.filter(Boolean));
}

function spriteStyle(card) {
  const hue = Number(card.sprite_hue ?? 0);
  const scale = Number(card.sprite_scale ?? 1);
  if (card.runtime_art_mode === "atlas") {
    const columns = Number(card.runtime_columns);
    const rows = Number(card.runtime_rows);
    const x = Number(card.runtime_x) * 100 / (columns - 1);
    const y = Number(card.runtime_y) * 100 / (rows - 1);
    return `--sprite-image:url('${cardArtUrl(card)}');--sprite-x:${x}%;--sprite-y:${y}%;--sprite-size-x:${columns * 100}%;--sprite-size-y:${rows * 100}%;--sprite-hue:${hue}deg;--sprite-scale:${scale};`;
  }
  if (card.art_file) {
    return `--sprite-image:url('${cardArtUrl(card)}');--sprite-x:50%;--sprite-y:50%;--sprite-size-x:100%;--sprite-size-y:100%;--sprite-hue:${hue}deg;--sprite-scale:${scale};`;
  }
  const columns = Math.max(1, Number(card.sprite_columns ?? 5));
  const rows = Math.max(1, Number(card.sprite_rows ?? 4));
  const spriteX = Number(card.sprite_x ?? 0);
  const spriteY = Number(card.sprite_y ?? 0);
  // Generated sheets are 3:2 canvases containing a 5x2 grid. Render them with
  // their original aspect ratio and a little breathing room instead of
  // stretching every grid cell into a square.
  const generatedSheet = columns === 5 && rows === 2;
  const x = generatedSheet
    ? ((0.9 * spriteX - 0.05) / 3.5) * 100
    : spriteX * (columns === 1 ? 0 : 100 / (columns - 1));
  const y = generatedSheet
    ? (spriteY === 0 ? 12.5 : 87.5)
    : spriteY * (rows === 1 ? 0 : 100 / (rows - 1));
  const backgroundWidth = generatedSheet ? "450%" : `${columns * 100}%`;
  const backgroundHeight = generatedSheet ? "auto" : `${rows * 100}%`;
  const sheet = card.sprite_sheet ?? "card-sprites.webp";
  return `--sprite-image:url('./assets/${sheet}?v=3');--sprite-x:${x}%;--sprite-y:${y}%;--sprite-size-x:${backgroundWidth};--sprite-size-y:${backgroundHeight};--sprite-hue:${hue}deg;--sprite-scale:${scale};`;
}

function setText(node, value) {
  if (node) node.textContent = String(value);
}

function metaStyle(entry) {
  const x = entry.icon_x * 100 / Math.max(1, entry.icon_columns - 1);
  const y = entry.icon_y * 100 / Math.max(1, entry.icon_rows - 1);
  return `--meta-image:url('./assets/${entry.icon_atlas}?v=14');--meta-size-x:${entry.icon_columns * 100}%;--meta-size-y:${entry.icon_rows * 100}%;--meta-x:${x}%;--meta-y:${y}%;`;
}

function itemElement(entry) {
  const node = document.createElement("span");
  const target = getCultivationTarget(entry);
  const progress = isCultivationComplete(entry) ? 100 : Math.min(100, (entry.cultivation_progress ?? 0) / target * 100);
  node.className = `item-chip${(entry.level ?? 0) > 0 ? " is-essence" : ""}`;
  node.style.setProperty("--item-progress", `${progress}%`);
  node.title = `${entry.name} · ${getItemLevelLabel(entry)}：${getCurrentItemDescription(entry)}（${getItemProgressText(entry)}）`;
  node.innerHTML = `<span class="meta-sprite" style="${metaStyle(entry)}"></span><i>${entry.level ?? 0}</i>`;
  return node;
}

function shopItemElement(entry, onBuy) {
  const button = document.createElement("button");
  button.className = "shop-item-card";
  button.type = "button";
  const unlockRound = entry.min_shop_round ?? 1;
  const tier = unlockRound >= 4 || entry.shop_price >= 8 ? "核心" : unlockRound >= 2 || entry.shop_price >= 5 ? "进阶" : "基础";
  const roundRange = entry.max_shop_round ? `第 ${unlockRound}–${entry.max_shop_round} 轮` : `第 ${unlockRound} 轮起`;
  button.innerHTML = `
    <span class="shop-item-icon meta-sprite" style="${metaStyle(entry)}"></span>
    <span><small>${tier}道具 · ${entry.role} · ${roundRange}</small><strong>${entry.name}</strong><em>${entry.description}</em></span>
    <b class="price-tag">$ ${entry.shop_price}</b>
  `;
  button.addEventListener("click", () => onBuy(entry));
  return button;
}

function questElement(entry, state, onChoose) {
  const target = getQuestTarget(state.current_round, entry.condition.target_multiplier ?? 1);
  const displayQuest = { ...entry, target };
  const reward = entry.reward.kind === "item" ? getItemById(entry.reward.item_id) : null;
  const button = document.createElement("button");
  button.className = "quest-card";
  button.type = "button";
  button.innerHTML = `
    <span class="quest-card-head"><i class="quest-card-icon meta-sprite" style="${metaStyle(entry)}"></i><span><small>${entry.risk}</small><strong>${entry.name}</strong></span></span>
    <span class="quest-block quest-penalty"><b>代价</b><span>${entry.penalty.description}</span></span>
    <span class="quest-block quest-requirement"><b>本轮要求</b><span>${getQuestRequirement(displayQuest)}</span></span>
    <span class="quest-reward">高级道具奖励 · ${reward ? `${reward.name}：${reward.description}` : entry.reward.name}</span>
  `;
  button.addEventListener("click", () => onChoose(entry), { once: true });
  return button;
}

function cardElement(card, active, depth, fogged = false, postponeCount = 0, postponeLimit = 1) {
  const article = document.createElement("article");
  const pointChanged = pointTone(card, "eat_points") !== "point-base" || pointTone(card, "discard_points") !== "point-base";
  const postponed = postponeCount > 0;
  const postponeText = postponeLimit === Infinity ? `本轮已后置 ${postponeCount} 次，可继续后置` : `本轮已后置 ${postponeCount}/${postponeLimit} 次`;
  article.className = `game-card card-${card.edibility} rarity-${RARITY_CLASS[card.rarity] ?? "common"}${active ? " is-active" : ""}${fogged ? " is-fogged" : ""}${postponed ? " is-postponed" : ""}${pointChanged ? " has-point-change" : ""}${card.weakened ? " is-weakened" : ""}${freshArtClass(card)}`;
  article.style.setProperty("--depth", depth);
  article.style.zIndex = String(10 - depth);
  article.dataset.cardUuid = card.uuid;
  article.setAttribute("aria-label", fogged ? "被星云遮蔽的未处理卡牌" : `${card.name}，吃牌 ${card.eat_points} 分，弃牌 ${card.discard_points} 分${postponed ? `，${postponeText}` : ""}`);
  article.innerHTML = `
    <div class="card-noise" aria-hidden="true"></div>
    <div class="card-head"><span class="rarity-tag">${card.rarity}</span><span class="edibility-tag">${EDIBILITY_LABEL[card.edibility] ?? "特殊"}</span></div>
    <div class="card-art" aria-hidden="true"><span class="game-sprite" style="${spriteStyle(card)}"></span>${postponed ? `<span class="card-postpone-mark"><b>↔</b> ${postponeLimit === Infinity ? `×${postponeCount}` : `${postponeCount}/${postponeLimit}`}</span>` : ""}</div>
    <div class="card-title"><small>${card.type}</small><strong>${card.name}</strong></div>
    <div class="card-scores"><span class="discard-score"><i><small>DISCARD</small>↑ 弃</i>${pointValue(card, "discard_points")}</span><span class="eat-score"><i><small>EAT</small>↓ 吃</i>${pointValue(card, "eat_points")}</span></div>
    <div class="card-effect${card.effect ? "" : " is-flavor"}">${cardEffectText(card)}</div>
  `;
  return article;
}

function ruleElement(rule, onChoose) {
  const button = document.createElement("button");
  button.className = "rule-card";
  button.type = "button";
  const unlockRound = getRuleUnlockRound(rule);
  const tier = unlockRound >= 6 ? "后期" : unlockRound >= 3 ? "进阶" : "基础";
  button.innerHTML = `
    <span class="rule-icon">✦</span>
    <span class="rule-copy"><small class="rule-tier">${tier}合约 · 第 ${unlockRound} 轮起</small><strong>${rule.name}</strong><em>${rule.description}</em></span>
    <span class="rule-multiplier">+${rule.gold_reward} 金币</span>
  `;
  button.addEventListener("click", () => onChoose(rule), { once: true });
  return button;
}

function selectedRuleElement(rule, index) {
  const article = document.createElement("article");
  article.className = "collection-status-card rule-status-card";
  article.innerHTML = `
    <span class="collection-index">${String(index + 1).padStart(2, "0")}</span>
    <span><small>第 ${rule.selected_round ?? "本"} 轮接取 · 完成前持续生效</small><strong>${rule.name}</strong><em>${rule.description}</em></span>
    <b>+${rule.gold_reward} 金币</b>
  `;
  return article;
}

function ownedItemElement(entry) {
  const article = document.createElement("article");
  const target = getCultivationTarget(entry);
  const progress = isCultivationComplete(entry) ? 100 : Math.min(100, (entry.cultivation_progress ?? 0) / target * 100);
  article.className = `collection-status-card item-status-card${(entry.level ?? 0) > 0 ? " is-essence" : ""}`;
  article.innerHTML = `
    <span class="collection-item-icon meta-sprite" style="${metaStyle(entry)}"></span>
    <span><small>${getItemLevelLabel(entry)} · ${entry.role}</small><strong>${entry.name}</strong><em>${getCurrentItemDescription(entry)}</em><span class="item-progress"><i style="width:${progress}%"></i></span><b class="item-progress-copy">${getItemProgressText(entry)} · ${entry.essence_description}</b></span>
  `;
  return article;
}

function shopCardElement(card, onBuy) {
  const button = document.createElement("button");
  button.className = `shop-card rarity-${RARITY_CLASS[card.rarity] ?? "common"}${freshArtClass(card)}`;
  button.type = "button";
  const priceNote = card.shop_discount > 0
    ? `<small class="shop-price-note">基础 $${card.shop_base_price} · 优惠 -${card.shop_discount}</small>`
    : "";
  button.title = `基础价 ${card.shop_base_price ?? card.shop_price}；优惠 ${card.shop_discount ?? 0}`;
  button.innerHTML = `
    <span class="shop-card-icon game-sprite" style="${spriteStyle(card)}"></span>
    <span class="shop-card-copy"><small>${card.rarity} · ${card.type}</small><strong>${card.name}</strong><em>吃 ${pointValue(card, "eat_points")} / 弃 ${pointValue(card, "discard_points")}</em><i>${cardEffectText(card)}</i>${priceNote}</span>
    <span class="price-tag">$ ${card.shop_price}</span>
  `;
  button.addEventListener("click", () => onBuy(card));
  return button;
}

function draftCardElement(card, onChoose) {
  const button = document.createElement("button");
  button.className = `shop-card draft-card rarity-${RARITY_CLASS[card.rarity] ?? "common"}${freshArtClass(card)}`;
  button.type = "button";
  button.innerHTML = `
    <span class="shop-card-icon game-sprite" style="${spriteStyle(card)}"></span>
    <span class="shop-card-copy"><small>${card.rarity} · ${card.type} · ${EDIBILITY_LABEL[card.edibility]}</small><strong>${card.name}</strong><em>吃 ${pointValue(card, "eat_points")} / 弃 ${pointValue(card, "discard_points")}</em><i>${cardEffectText(card)}</i></span>
    <span class="draft-pick-label">选择</span>
  `;
  button.addEventListener("click", () => onChoose(card), { once: true });
  return button;
}

function itemDraftElement(entry, onChoose) {
  const button = document.createElement("button");
  button.className = `item-draft-card${entry.consumable ? " is-consumable" : ""}`;
  button.type = "button";
  button.dataset.itemId = entry.id;
  button.dataset.itemSlot = entry.wild ? "wild" : entry.bridge ? "bridge" : "relevant";
  button.innerHTML = `
    <span class="item-draft-icon meta-sprite" style="${metaStyle(entry)}"></span>
    <span class="item-draft-copy"><small>${entry.rarity} · ${entry.role}</small><strong>${entry.name}</strong><em>${entry.description}</em><span class="item-essence-preview"><b>精华</b>${entry.essence_description}</span></span>
    <span class="draft-pick-label">领取</span>
  `;
  button.addEventListener("click", () => onChoose(entry), { once: true });
  return button;
}

function deckChipElement(card, cost, onRemove) {
  const button = document.createElement("button");
  button.className = `deck-chip${freshArtClass(card)}`;
  button.type = "button";
  button.title = `${card.name}：支付 ${cost} 金币从永久牌组中删除，不返还金币`;
  button.innerHTML = `<span class="game-sprite" style="${spriteStyle(card)}"></span><b>${card.name}</b><small>${EDIBILITY_LABEL[card.edibility]} · 吃 ${pointValue(card, "eat_points")} / 弃 ${pointValue(card, "discard_points")}</small><i>删除 $${cost} · 无返还</i>`;
  button.addEventListener("click", () => onRemove(card.uuid));
  return button;
}

function deckStatusCardElement(card, quantity, onRemove = null) {
  const article = document.createElement("article");
  article.className = `deck-status-card rarity-${RARITY_CLASS[card.rarity] ?? "common"}${freshArtClass(card)}`;
  const progress = card.growth_uses ? `<small>成长进度：${card.growth_uses}/${card.effect?.every ?? "?"}</small>` : "";
  const stored = card.stored_score ? `<small>当前储存：${card.stored_score} 分</small>` : "";
  const generated = card.generated_from
    ? `<small>生成来源：${card.generated_label ?? getCardById(card.generated_from)?.name ?? card.generated_from}</small>`
    : "";
  article.innerHTML = `
    <span class="deck-status-art game-sprite" style="${spriteStyle(card)}"></span>
    <span class="deck-status-copy">
      <span class="deck-status-head"><strong>${card.name}</strong><b>×${quantity}</b></span>
      <small>${card.rarity} · ${card.type} · ${EDIBILITY_LABEL[card.edibility]}</small>
      <em>吃 ${pointValue(card, "eat_points")} / 弃 ${pointValue(card, "discard_points")}</em>
      ${generated}${stored}${progress}
      <i>${cardEffectText(card)}</i>
    </span>
  `;
  if (onRemove) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "deck-remove-token";
    remove.textContent = "删除 · 1 token";
    remove.addEventListener("click", () => onRemove(card));
    article.appendChild(remove);
  }
  return article;
}

export function createUI(root) {
  const get = (selector) => root.querySelector(selector);
  const nodes = {
    stack: get("#cardStack"), empty: get("#deckEmpty"), round: get("#roundValue"), score: get("#scoreValue"),
    scoreLabel: get("#scoreLabel"), scoreDelta: get("#scoreDelta"),
    tokens: get("#tokenValue"),
    remaining: get("#remainingValue"), timer: get("#timerValue"), phase: get("#phaseValue"),
    eatZone: get("#eatZone"), discardZone: get("#discardZone"), swipeStatus: get("#swipeStatus"),
    draft: get("#ruleDraft"), draftList: get("#ruleDraftList"), summary: get("#roundSummary"),
    quest: get("#questDraft"), questList: get("#questDraftList"),
    shop: get("#shopPanel"), shopOffers: get("#shopOfferList"), shopThemeOffers: get("#shopThemeOfferList"), shopItems: get("#shopItemOfferList"), shopDeck: get("#shopDeckList"), welcome: get("#welcomeOverlay"),
    cardDraft: get("#cardDraft"), cardDraftList: get("#cardDraftList"),
    itemDraft: get("#itemDraft"), itemDraftList: get("#itemDraftList"),
    deleteConfirm: get("#deleteConfirm"),
    questStatus: get("#questStatus"), questInfoButton: get("#questInfoButton"),
    deckStatus: get("#deckStatus"), deckInfoButton: get("#deckInfoButton"),
    ruleStatus: get("#ruleStatus"), ruleInfoButton: get("#ruleInfoButton"),
    itemStatus: get("#itemStatus"), itemInfoButton: get("#itemInfoButton"),
    storyGuide: get("#storyGuide"), tutorialInfoButton: get("#tutorialInfoButton"),
    gameMenu: get("#gameMenu"), menuButton: get("#menuButton"),
    cardCatalog: get("#cardCatalog"), catalogList: get("#catalogList"),
  };

  let tutorialFocus = null;
  let menuState = null;
  let menuSettings = null;
  let storySuspendedByMenu = false;
  let menuOpenedFromHome = false;
  let deckRemovalHandler = null;
  let homeRainTimer = null;
  const homeRainCards = createCardPool();

  function createHomeRainCard(host, card, initial = false) {
    const duration = 7.8 + Math.random() * 5.2;
    const node = document.createElement("span");
    node.className = "home-rain-card";
    node.dataset.cardId = card.id;
    node.style.setProperty("--rain-x", `${(2 + Math.random() * 96).toFixed(2)}%`);
    node.style.setProperty("--rain-delay", `${initial ? -(Math.random() * duration).toFixed(2) : "0"}s`);
    node.style.setProperty("--rain-duration", `${duration.toFixed(2)}s`);
    node.style.setProperty("--rain-turn", `${(-18 + Math.random() * 36).toFixed(2)}deg`);
    node.style.setProperty("--rain-turn-end", `${(-28 + Math.random() * 56).toFixed(2)}deg`);
    node.style.setProperty("--rain-scale", (0.72 + Math.random() * 0.38).toFixed(3));
    node.style.setProperty("--rain-drift", `${(-70 + Math.random() * 140).toFixed(1)}px`);
    node.style.setProperty("--rain-opacity", (0.32 + Math.random() * 0.26).toFixed(2));
    node.innerHTML = `<span class="home-rain-art"><i class="game-sprite" style="${spriteStyle(card)}"></i></span>`;
    node.addEventListener("animationend", () => node.remove(), { once: true });
    host.appendChild(node);
    return node;
  }

  function stopHomeCardRain() {
    if (homeRainTimer !== null) window.clearInterval(homeRainTimer);
    homeRainTimer = null;
    get("#homeCardRain")?.replaceChildren();
  }

  function renderHomeCardRain() {
    const host = get("#homeCardRain");
    if (!host) return;
    stopHomeCardRain();
    const shuffled = [...homeRainCards];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
    }
    const featured = ["A001", "F002", "F003"].map(getCardById).filter(Boolean);
    const initialCards = [...featured, ...shuffled.filter((card) => !featured.some((entry) => entry.id === card.id))].slice(0, 34);
    for (let index = initialCards.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [initialCards[index], initialCards[swap]] = [initialCards[swap], initialCards[index]];
    }
    initialCards.forEach((card) => createHomeRainCard(host, card, true));
    homeRainTimer = window.setInterval(() => {
      if (!nodes.welcome?.classList.contains("show")) return;
      const card = homeRainCards[Math.floor(Math.random() * homeRainCards.length)];
      if (card) createHomeRainCard(host, card);
    }, 310);
  }

  function updateHudValue(node, value) {
    if (!node) return;
    const next = formatScore(value);
    if (node.textContent === next) return;
    const hasRendered = node.dataset.rendered === "true";
    node.textContent = next;
    node.dataset.rendered = "true";
    if (!hasRendered) return;
    node.classList.remove("hud-value-pop");
    void node.offsetWidth;
    node.classList.add("hud-value-pop");
  }

  function suspendStoryForMenu() {
    if (!nodes.storyGuide?.hidden) {
      storySuspendedByMenu = true;
      nodes.storyGuide.hidden = true;
    }
  }

  function resumeStoryAfterMenu() {
    if (storySuspendedByMenu && nodes.storyGuide) nodes.storyGuide.hidden = false;
    storySuspendedByMenu = false;
  }

  function clearTutorialFocus() {
    tutorialFocus?.classList.remove("tutorial-focus");
    tutorialFocus = null;
  }

  function showStoryGuide(model = {}) {
    if (!nodes.storyGuide) return;
    clearTutorialFocus();
    nodes.storyGuide.hidden = false;
    nodes.storyGuide.dataset.step = model.step ?? "story";
    nodes.storyGuide.dataset.placement = model.placement ?? "table";
    setText(get("#storyGuideChapter"), model.chapter ?? "PROLOGUE · 会说话的牌");
    setText(get("#storyGuideSpeaker"), model.speaker ?? "咔嚓");
    setText(get("#storyGuideMessage"), model.message ?? "我会陪你完成这一轮。");
    setText(get("#storyGuideObjective"), model.objective ?? "跟着高亮提示操作。");
    const progress = get("#storyGuideProgress");
    progress.innerHTML = (model.progress ?? [])
      .map((entry) => `<span class="${entry.done ? "done" : ""}">${entry.done ? "✓" : "○"} ${entry.label}</span>`)
      .join("");
    const next = get("#storyGuideNext");
    next.hidden = !model.can_continue;
    next.textContent = model.continue_label ?? "继续";
    if (model.target) {
      tutorialFocus = get(model.target);
      tutorialFocus?.classList.add("tutorial-focus");
    }
  }

  function hideStoryGuide() {
    clearTutorialFocus();
    if (nodes.storyGuide) nodes.storyGuide.hidden = true;
  }

  function closeDeleteConfirmation() {
    nodes.deleteConfirm?.classList.remove("show");
  }

  function openDeleteConfirmation(card, onRemove) {
    const preview = get("#deleteConfirmCard");
    preview.innerHTML = `
      <span class="game-sprite" style="${spriteStyle(card)}"></span>
      <span class="delete-confirm-copy">
        <strong>${card.name}</strong>
        <small>${card.rarity} · ${card.type} · ${EDIBILITY_LABEL[card.edibility]}</small>
        <em>吃 ${signed(card.eat_points)} / 弃 ${signed(card.discard_points)}<br />${card.effect?.description ?? "无额外效果"}</em>
      </span>
    `;
    setText(get("#deleteConfirmWarning"), `确认消耗 1 枚删牌 token 删除「${card.name}」？此操作不可撤销。`);
    const accept = get("#deleteConfirmAccept");
    accept.textContent = "确认删除 · 1 token";
    accept.onclick = () => {
      closeDeleteConfirmation();
      onRemove(card.uuid);
    };
    get("#deleteConfirmCancel").onclick = closeDeleteConfirmation;
    nodes.deleteConfirm?.classList.add("show");
  }

  nodes.deleteConfirm?.addEventListener("click", (event) => {
    if (event.target === nodes.deleteConfirm) closeDeleteConfirmation();
  });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (nodes.deleteConfirm?.classList.contains("show")) closeDeleteConfirmation();
    nodes.questStatus?.classList.remove("show");
    nodes.deckStatus?.classList.remove("show");
    nodes.ruleStatus?.classList.remove("show");
    nodes.itemStatus?.classList.remove("show");
    nodes.gameMenu?.classList.remove("show");
    nodes.cardCatalog?.classList.remove("show");
    resumeStoryAfterMenu();
  });

  function openDeckStatus(state) {
    const grouped = new Map();
    for (const card of state.deck) {
      const key = [card.id, card.eat_points, card.discard_points, card.generated_from ?? "", card.stored_score ?? 0, card.growth_uses ?? 0].join("|");
      const group = grouped.get(key) ?? { card, quantity: 0 };
      group.quantity += 1;
      grouped.set(key, group);
    }
    const groups = [...grouped.values()].sort((left, right) => (
      left.card.type.localeCompare(right.card.type, "zh-CN") || left.card.name.localeCompare(right.card.name, "zh-CN")
    ));
    const typeCounts = state.deck.reduce((counts, card) => {
      counts[card.type] = (counts[card.type] ?? 0) + 1;
      return counts;
    }, {});
    get("#deckStatusSummary").innerHTML = `
      <b>${state.deck.length} / ${GAME_CONFIG.max_deck_size} 张</b>
      <span>${Object.entries(typeCounts).sort(([, a], [, b]) => b - a).map(([type, count]) => `${type} ${count}`).join(" · ")}</span>
    `;
    const liveRound = state.phase === "Playing" || state.phase === "Scoring";
    const plate = getPlateSummary(state.deck.length, state.plate_capacity);
    const actionBudget = liveRound && state.round.action_budget ? state.round.action_budget : plate.action_budget;
    const reserveCount = liveRound && state.round.action_budget ? state.round.reserve_count : plate.reserve_count;
    get("#deckCapacitySummary").innerHTML = `
      <div><small>${liveRound ? "本轮登场" : "下轮预计"}</small><b>${actionBudget} / ${state.deck.length}</b><span>${reserveCount > 0 ? `${reserveCount} 张留在牌组` : "全牌组登场"}</span></div>
      <div><small>永久餐盘</small><b>${state.plate_capacity} 张</b><span>每 5 轮免费 +1</span></div>
      <div><small>未登场候选</small><b>${reserveCount} 张</b><span>每轮重新随机抽取</span></div>
      <div><small>删牌 token</small><b>${state.delete_tokens ?? 0} 枚</b><span>仅轮末选牌阶段可用</span></div>
    `;
    const canRemove = state.phase === "CardDraft" && (state.delete_tokens ?? 0) > 0 && state.deck.length > 1 && deckRemovalHandler;
    get("#deckStatusList").replaceChildren(...groups.map(({ card, quantity }) => deckStatusCardElement(
      card,
      quantity,
      canRemove ? (selected) => openDeleteConfirmation(selected, () => {
        const result = deckRemovalHandler(selected.uuid);
        if (result?.success) openDeckStatus(state);
      }) : null,
    )));
    setText(get("#deckRemovalHint"), state.phase === "CardDraft"
      ? (state.delete_tokens > 0 ? `当前有 ${state.delete_tokens} 枚 token；点击卡牌下方按钮即可删除。` : "当前没有删牌 token。你仍可查看牌组后返回选牌。")
      : "出牌阶段只能查看；轮末三选一时可消耗 token 删除卡牌。");
    nodes.questStatus?.classList.remove("show");
    nodes.ruleStatus?.classList.remove("show");
    nodes.itemStatus?.classList.remove("show");
    nodes.deckStatus?.classList.add("show");
  }

  function openQuestStatus(state) {
    const entry = state.active_quest;
    const content = get("#questStatusContent");
    const title = get("#questStatusTitle");
    if (entry) {
      const reward = entry.reward.kind === "item" ? getItemById(entry.reward.item_id) : null;
      setText(title, entry.name);
      content.innerHTML = `
        <div class="quest-status-state ${entry.finalized ? (entry.completed ? "success" : "failed") : "active"}">${entry.finalized ? (entry.completed ? "任务完成" : "任务失败") : `第 ${entry.round} 轮进行中`}</div>
        <div class="quest-block quest-penalty"><b>当前惩罚</b><span>${entry.penalty.description}</span></div>
        <div class="quest-block quest-requirement"><b>完成要求</b><span>${getQuestRequirement(entry)}</span></div>
        <div class="quest-status-reward"><b>完成奖励</b><span>${reward ? `${reward.name}：${reward.description}` : entry.reward.name}</span><small>完成后在下一轮开始时生效</small></div>
      `;
    } else {
      setText(title, "任务记录");
      content.innerHTML = state.quest_history.length === 0
        ? '<p class="quest-status-empty">当前没有危险任务。高难模式会在第 4 / 8 / 12 轮强制三选一。</p>'
        : `<ul class="quest-history-list">${state.quest_history.map((history) => `<li class="${history.completed ? "success" : "failed"}"><b>${history.completed ? "✓" : "×"} ${history.name}</b><span>第 ${history.round} 轮 · ${history.reward}</span></li>`).join("")}</ul>`;
    }
    nodes.deckStatus?.classList.remove("show");
    nodes.ruleStatus?.classList.remove("show");
    nodes.itemStatus?.classList.remove("show");
    nodes.questStatus?.classList.add("show");
  }

  function openRuleStatus(state) {
    const rules = state.active_rules;
    get("#ruleStatusSummary").innerHTML = `<b>${rules.length ? "当前持续合约" : "等待新合约"}</b><span>未完成会跨轮保留；完成后奖励金币、记录完成并从当前合约栏移除。</span>`;
    const list = get("#ruleStatusList");
    if (rules.length === 0) list.innerHTML = '<p class="collection-status-empty">当前没有合约。下一轮开始时将从三条可完成合约中选择一条。</p>';
    else list.replaceChildren(...rules.map(selectedRuleElement));
    nodes.deckStatus?.classList.remove("show");
    nodes.questStatus?.classList.remove("show");
    nodes.itemStatus?.classList.remove("show");
    nodes.ruleStatus?.classList.add("show");
  }

  function openItemStatus(state) {
    const items = state.items;
    get("#itemStatusSummary").innerHTML = `<b>${items.length} 件培养道具</b><span>行动会积累培养进度；精华突破后改变规则，带“无限培养”的道具可持续升级。</span>`;
    const list = get("#itemStatusList");
    if (items.length === 0) list.innerHTML = '<p class="collection-status-empty">尚未获得永久道具。完成第 3 轮后会出现第一次道具三选一。</p>';
    else list.replaceChildren(...items.map(ownedItemElement));
    nodes.deckStatus?.classList.remove("show");
    nodes.questStatus?.classList.remove("show");
    nodes.ruleStatus?.classList.remove("show");
    nodes.itemStatus?.classList.add("show");
  }

  function renderItems(state) {
    const tray = get("#itemTray");
    if (!tray) return;
    if (state.items.length === 0) tray.innerHTML = '<span class="item-empty">尚未获得</span>';
    else tray.replaceChildren(...state.items.map(itemElement));
  }

  function renderHud(state) {
    const live = getLiveHudValues(state);
    const finalRound = getFinalRound({}, state.mode);
    setText(nodes.round, Number.isFinite(finalRound) ? `${state.current_round}/${finalRound}` : `${state.current_round}/∞`);
    updateHudValue(nodes.score, live.display_score);
    updateHudValue(nodes.tokens, state.delete_tokens ?? 0);
    setText(nodes.scoreLabel, live.playing ? "实时总分" : "总分");
    nodes.scoreDelta.hidden = !live.playing;
    setText(nodes.scoreDelta, `本轮 ${live.live_round_score >= 0 ? "+" : ""}${formatScore(live.live_round_score)}`);
    nodes.score.closest(".hud-cell")?.classList.toggle("is-live", live.playing);
    nodes.score.title = live.playing
      ? `已结算 ${formatScore(live.settled_score)}；本轮已确定 ${live.live_round_score >= 0 ? "+" : ""}${formatScore(live.live_round_score)}；轮末效果与倍率尚未计入`
      : String(live.settled_score);
    const liveRound = state.phase === "Playing" || state.phase === "Scoring";
    const budget = liveRound && state.round.action_budget
      ? state.round.action_budget
      : getPlateSummary(state.deck.length, state.plate_capacity).action_budget;
    setText(get("#remainingLabel"), liveRound ? "餐盘剩余" : "下轮登场");
    setText(nodes.remaining, liveRound ? `${state.round.draw_pile.length}/${budget}` : `${budget}张`);
    nodes.remaining.title = `${liveRound ? "本轮" : "下轮预计"}登场 ${budget} 张；永久牌组 ${state.deck.length} 张`;
    setText(nodes.phase, PHASE_LABELS[state.phase] ?? state.phase);
    renderItems(state);
    if (nodes.deckInfoButton) {
      nodes.deckInfoButton.title = `查看永久牌组（${state.deck.length} 张）`;
      nodes.deckInfoButton.onclick = () => {
        if (nodes.deckStatus?.classList.contains("show")) nodes.deckStatus.classList.remove("show");
        else openDeckStatus(state);
      };
    }
    if (nodes.itemInfoButton) {
      nodes.itemInfoButton.title = `查看道具（${state.items.length} 件）`;
      nodes.itemInfoButton.onclick = () => {
        if (nodes.itemStatus?.classList.contains("show")) nodes.itemStatus.classList.remove("show");
        else openItemStatus(state);
      };
    }
    const postponeButton = get("#postponeButton");
    if (postponeButton) {
      const reshuffle = getReshuffleStatus(state);
      const currentCard = state.round.draw_pile.at(-1);
      const postponeLimit = getPostponeLimit(state);
      const usedPostpones = currentCard ? state.round.postpone_counts?.[currentCard.uuid] ?? 0 : 0;
      const unlimitedPostpone = postponeLimit === Infinity;
      const alreadyPostponed = usedPostpones >= postponeLimit;
      postponeButton.disabled = state.phase !== "Playing" || state.round.draw_pile.length < 2 || alreadyPostponed;
      postponeButton.title = alreadyPostponed
        ? "这张牌本轮已经达到后置次数上限"
        : `侧滑或点击：把当前牌移动到餐盘末尾；${unlimitedPostpone ? "可无限后置" : `每张最多 ${postponeLimit} 次`}`;
      const hint = get("#reshuffleHint");
      const postponeEffectHint = (state.round.reverse_postpone_charges ?? 0) > 0
        ? "送餐员蓄势：下次后置将末牌调到当前"
        : (state.round.postpone_score_charges ?? 0) > 0
          ? `理牌托盘：后置 +1（剩余 ${state.round.postpone_score_charges} 次）`
          : null;
      setText(hint, postponeEffectHint
        ?? (alreadyPostponed
          ? "当前牌已达到后置次数上限"
          : reshuffle.charges > 0
            ? `自动重洗 ${reshuffle.charges} 次 · 后置标记不会清除`
            : unlimitedPostpone
              ? `回转餐车精华 · 同一张牌可无限后置`
              : `本轮已后置 ${state.round.postpone_count ?? 0} 次 · 每张最多 ${postponeLimit} 次`));
    }
  }

  function setGestureProgress({ progress = 0, direction = null }) {
    const strength = Math.max(0, Math.min(1, progress));
    nodes.eatZone?.style.setProperty("--gesture", direction === "eat" ? strength : 0);
    nodes.discardZone?.style.setProperty("--gesture", direction === "discard" ? strength : 0);
    nodes.eatZone?.classList.toggle("is-target", direction === "eat" && strength > 0.12);
    nodes.discardZone?.classList.toggle("is-target", direction === "discard" && strength > 0.12);
    if (nodes.swipeStatus) {
      nodes.swipeStatus.className = `swipe-status${direction ? ` ${direction}` : ""}`;
      nodes.swipeStatus.textContent = strength > 0.12
        ? (direction === "eat" ? "松手吃掉" : direction === "discard" ? "松手弃掉" : "松手后置")
        : "";
      nodes.swipeStatus.style.opacity = String(strength);
    }
  }

  return {
    preloadCardArt: warmCardArt,
    openWelcome(callbacks, options = {}) {
      renderHomeCardRain();
      setText(get("#welcomeBestScore"), options.best_score ?? "--");
      const chooser = get("#modeChooser");
      const continueButton = get("#continueGameButton");
      continueButton.disabled = !options.has_save;
      continueButton.title = options.has_save ? "从最近一次自动保存继续" : "当前没有可继续的对局";
      get("#newGameButton").onclick = () => { chooser.hidden = !chooser.hidden; };
      continueButton.onclick = callbacks.onContinue;
      get("#homeMenuButton").onclick = callbacks.onMenu;
      get("#normalModeButton").onclick = () => callbacks.onNew(GAME_MODES.NORMAL);
      for (const [selector, mode] of [["#endlessModeButton", GAME_MODES.ENDLESS], ["#hardModeButton", GAME_MODES.HARD]]) {
        const button = get(selector);
        button.disabled = !options.unlocked;
        button.classList.toggle("is-locked", !options.unlocked);
        button.onclick = options.unlocked ? () => callbacks.onNew(mode) : null;
      }
      nodes.welcome.classList.add("show");
    },
    hideWelcome() {
      nodes.welcome.classList.remove("show");
      stopHomeCardRain();
    },
    showStoryGuide,
    hideStoryGuide,
    renderHud,
    renderTimer(milliseconds) { setText(nodes.timer, `${(milliseconds / 1000).toFixed(1)}s`); },
    renderStack(cards, gesture, state = null) {
      nodes.stack.replaceChildren();
      const visible = cards.slice(-3);
      visible.forEach((card, index) => {
        const depth = visible.length - 1 - index;
        const postponeCount = state?.round?.postpone_counts?.[card.uuid] ?? 0;
        const postponeLimit = state ? getPostponeLimit(state) : 1;
        const fogged = Boolean(state.round.hidden_postponed_uuids?.includes(card.uuid));
        nodes.stack.appendChild(cardElement(card, depth === 0, depth, fogged, postponeCount, postponeLimit));
      });
      const activeCard = cards.at(-1);
      const activeElement = nodes.stack.querySelector(".game-card.is-active");
      nodes.empty.hidden = Boolean(activeCard);
      if (activeElement && activeCard) gesture.bind(activeElement, activeCard);
    },
    setGestureProgress,
    bindControls({ onEat, onDiscard, onPostpone, onMenu }) {
      get("#eatButton")?.addEventListener("click", onEat);
      get("#discardButton")?.addEventListener("click", onDiscard);
      nodes.menuButton?.addEventListener("click", onMenu);
      get("#postponeButton")?.addEventListener("click", onPostpone);
      get("#questStatusClose")?.addEventListener("click", () => nodes.questStatus?.classList.remove("show"));
      get("#deckStatusClose")?.addEventListener("click", () => nodes.deckStatus?.classList.remove("show"));
      get("#ruleStatusClose")?.addEventListener("click", () => nodes.ruleStatus?.classList.remove("show"));
      get("#itemStatusClose")?.addEventListener("click", () => nodes.itemStatus?.classList.remove("show"));
    },
    bindTutorial({ onSkip, onContinue, onReplay }) {
      get("#storyGuideSkip")?.addEventListener("click", onSkip);
      get("#storyGuideNext")?.addEventListener("click", onContinue);
      nodes.tutorialInfoButton?.addEventListener("click", () => {
        nodes.gameMenu?.classList.remove("show");
        storySuspendedByMenu = false;
        onReplay();
      });
    },
    openMenu(state, currentSettings) {
      menuState = state;
      menuSettings = currentSettings;
      menuOpenedFromHome = !state;
      setText(get("#menuModeLabel"), state ? MODE_LABELS[state.mode] : "主界面设置");
      if (state) {
        const milestone = getNextMilestone(state.current_round, state.milestone_delays, state.mode);
        setText(get("#menuObjective"), milestone.endless
          ? `无尽模式 · 当前第 ${state.current_round} 轮 · 累计 ${formatScore(state.total_score)} 分`
          : `当前目标：第 ${milestone.round} 轮累计达到 ${formatScore(milestone.target)} 分 · 当前 ${formatScore(state.total_score)}`);
      } else {
        setText(get("#menuObjective"), "对局中会在每次操作、选牌与轮次结算后自动保存。");
      }
      get("#menuHomeButton").hidden = !state;
      get("#tutorialInfoButton").hidden = !state;
      get("#gameMenuClose").textContent = state ? "返回游戏" : "返回主界面";
      this.renderSettings(currentSettings);
      if (state) suspendStoryForMenu();
      nodes.cardCatalog?.classList.remove("show");
      nodes.gameMenu?.classList.add("show");
    },
    bindMenu({ onMusic, onEffects, onFontSize, onHome }) {
      get("#gameMenuClose")?.addEventListener("click", () => {
        nodes.gameMenu?.classList.remove("show");
        if (!menuOpenedFromHome) resumeStoryAfterMenu();
      });
      get("#menuHomeButton")?.addEventListener("click", onHome);
      get("#musicToggle")?.addEventListener("click", () => onMusic(get("#musicToggle")?.getAttribute("aria-pressed") !== "true"));
      get("#effectsToggle")?.addEventListener("click", () => onEffects(get("#effectsToggle")?.getAttribute("aria-pressed") !== "true"));
      root.querySelectorAll("[data-font-size]").forEach((button) => {
        button.addEventListener("click", () => onFontSize(button.dataset.fontSize));
      });
      get("#cardCatalogButton")?.addEventListener("click", () => {
        nodes.gameMenu?.classList.remove("show");
        const allCards = createCardPool();
        const filter = get("#catalogTypeFilter");
        const types = [...new Set(allCards.map((card) => card.type))].sort((a, b) => a.localeCompare(b, "zh-CN"));
        filter.innerHTML = '<option value="all">全部类别</option>' + types.map((type) => `<option value="${type}">${type}</option>`).join("");
        const renderCatalog = () => {
          const cards = filter.value === "all" ? allCards : allCards.filter((card) => card.type === filter.value);
          setText(get("#catalogSummary"), `${cards.length} 张卡牌`);
          nodes.catalogList.replaceChildren(...cards.map((card) => deckStatusCardElement(card, 1)));
        };
        filter.onchange = renderCatalog;
        renderCatalog();
        nodes.cardCatalog?.classList.add("show");
      });
      get("#cardCatalogClose")?.addEventListener("click", () => {
        nodes.cardCatalog?.classList.remove("show");
        if (menuState) {
          setText(get("#menuModeLabel"), MODE_LABELS[menuState.mode]);
          nodes.gameMenu?.classList.add("show");
        } else if (menuOpenedFromHome) {
          nodes.gameMenu?.classList.add("show");
        }
      });
    },
    applyFontSize(fontSize) {
      root.documentElement.dataset.fontSize = ["small", "medium", "large"].includes(fontSize) ? fontSize : "medium";
    },
    renderSettings(currentSettings) {
      menuSettings = currentSettings;
      const updateToggle = (selector, enabled) => {
        const button = get(selector);
        button?.setAttribute("aria-pressed", String(enabled));
        button?.classList.toggle("is-off", !enabled);
        const label = button?.querySelector("b");
        if (label) label.textContent = enabled ? "开启" : "关闭";
      };
      updateToggle("#musicToggle", currentSettings.music !== false);
      updateToggle("#effectsToggle", currentSettings.effects !== false);
      root.querySelectorAll("[data-font-size]").forEach((button) => {
        button.classList.toggle("is-selected", button.dataset.fontSize === currentSettings.font_size);
        button.setAttribute("aria-pressed", String(button.dataset.fontSize === currentSettings.font_size));
      });
    },
    playReshuffleAnimation() {
      const stage = get(".deck-stage");
      if (!stage) return;
      stage.classList.remove("is-reshuffling");
      void stage.offsetWidth;
      stage.classList.add("is-reshuffling");
      window.setTimeout(() => stage.classList.remove("is-reshuffling"), 650);
    },
    showFloatingScore(points, action, streak) {
      const stage = get(".deck-stage");
      if (!stage) return;
      const floater = document.createElement("div");
      floater.className = `score-floater ${points < 0 ? "negative" : action}`;
      floater.style.setProperty("--score-scale", Math.min(1 + Math.max(0, streak - 1) * 0.12, 1.7));
      const comboLabel = streak >= 8 ? "OVERDRIVE" : streak >= 5 ? "FEVER" : streak >= 3 ? "HIT" : "";
      floater.textContent = `${points > 0 ? "+" : ""}${formatScore(points)}${comboLabel ? ` · ${streak} ${comboLabel}` : ""}`;
      stage.appendChild(floater);
      floater.addEventListener("animationend", () => floater.remove(), { once: true });
    },
    punchAction(points = 0, streakCount = 1, action = "score") {
      const stage = get(".deck-stage");
      if (!stage) return;
      const weight = points >= 10 || streakCount >= 5 ? "heavy" : points >= 5 || streakCount >= 3 ? "medium" : "light";
      stage.classList.remove("card-punch", "postpone-punch");
      void stage.offsetWidth;
      stage.classList.add(action === "postpone" ? "postpone-punch" : "card-punch");
      const burst = document.createElement("div");
      burst.className = `juice-burst ${weight}`;
      burst.innerHTML = Array.from({ length: weight === "heavy" ? 12 : 7 }, (_, index) => `<i style="--spark:${index}"></i>`).join("");
      stage.appendChild(burst);
      window.setTimeout(() => {
        stage.classList.remove("card-punch", "postpone-punch");
        burst.remove();
      }, 520);
    },
    showPickBurst(message, tone = "card") {
      const host = get(".game-shell");
      if (!host) return;
      const node = document.createElement("div");
      node.className = `pick-burst ${tone}`;
      node.innerHTML = `<small>${tone === "item" ? "ITEM GET" : "DECK UP"}</small><b>${message}</b>`;
      host.appendChild(node);
      node.addEventListener("animationend", () => node.remove(), { once: true });
    },
    showEffectFlash(message, entry = {}) {
      const feed = get("#effectFeed");
      const stage = get(".deck-stage");
      if (!feed || !stage) return;
      const tone = effectTone(entry);
      const presentation = EFFECT_PRESENTATION[tone] ?? EFFECT_PRESENTATION.effect;
      stage.dataset.lastEffectTone = tone;
      stage.dataset.lastEffectMessage = message;
      const flash = document.createElement("div");
      flash.className = `effect-flash tone-${tone}`;
      flash.innerHTML = `<b>${presentation.icon}</b><span><small>${presentation.label}</small><em>${message}</em></span>`;
      feed.prepend(flash);
      [...feed.children].slice(3).forEach((node) => node.remove());
      stage.classList.remove("effect-pulse", "tone-effect", "tone-growth", "tone-fruit", "tone-hard", "tone-mutation", "tone-destroy", "tone-economy", "tone-generate", "tone-reshuffle");
      void stage.offsetWidth;
      stage.classList.add("effect-pulse", `tone-${tone}`);
      window.setTimeout(() => stage.classList.remove("effect-pulse", `tone-${tone}`), 720);
      flash.addEventListener("animationend", () => flash.remove(), { once: true });
    },
    showHardEat(streak, points) {
      const stage = get(".deck-stage");
      if (!stage) return;
      stage.dataset.lastHardEatStreak = String(streak);
      const flash = document.createElement("div");
      flash.className = `hard-eat-flash${streak >= 3 ? " is-chain" : ""}`;
      flash.innerHTML = `<small>WRONG SIDE · 硬吃</small><b>×${streak}</b><span>${points >= 0 ? `逆势得分 +${formatScore(points)}` : `承担 ${formatScore(points)} 分`}</span>`;
      stage.appendChild(flash);
      flash.addEventListener("animationend", () => flash.remove(), { once: true });
    },
    showPointMutation(entry, card) {
      const stage = get(".deck-stage");
      if (!stage) return;
      const changes = [...(entry.point_changes ?? [])];
      if (changes.length === 0 && entry.permanent_change) {
        if (Number.isFinite(entry.permanent_change.eat)) changes.push({ card_name: card.name, stat: "eat_points", amount: entry.permanent_change.eat });
        if (Number.isFinite(entry.permanent_change.discard)) changes.push({ card_name: card.name, stat: "discard_points", amount: entry.permanent_change.discard });
        if (entry.permanent_change.stat && Number.isFinite(entry.permanent_change.amount)) changes.push({ card_name: card.name, ...entry.permanent_change });
      }
      if (Number.isFinite(entry.gold_change) && entry.gold_change !== 0) changes.push({ card_name: "金币", stat: "gold", amount: entry.gold_change });
      if (changes.length === 0) return;
      const burst = document.createElement("div");
      burst.className = "point-mutation-burst";
      burst.innerHTML = changes.slice(0, 5).map((change) => {
        const label = change.stat === "eat_points" ? "吃点" : change.stat === "discard_points" ? "弃点" : "金币";
        const tone = change.amount > 0 ? "up" : "down";
        return `<span class="${tone}"><small>${change.card_name}</small><b>${label} ${change.amount > 0 ? "+" : ""}${change.amount}</b></span>`;
      }).join("");
      stage.appendChild(burst);
      burst.addEventListener("animationend", () => burst.remove(), { once: true });
    },
    showFruitCombo(combo) {
      const stage = get(".deck-stage");
      if (!stage) return;
      stage.dataset.lastFruitCombo = String(combo);
      const flash = document.createElement("div");
      flash.className = `fruit-combo-flash${combo >= 5 ? " is-fever" : ""}`;
      flash.innerHTML = `<small>FRUIT COMBO</small><b>×${combo}</b><span>${combo === 1 ? "连续吃水果可叠加" : combo >= 5 ? "果汁爆发!" : "连击上升"}</span>`;
      stage.appendChild(flash);
      flash.addEventListener("animationend", () => flash.remove(), { once: true });
    },
    openRuleDraft(options, state, onChoose) {
      const milestone = getNextMilestone(state.current_round, state.milestone_delays, state.mode);
      if (milestone.endless) {
        setText(get("#draftRoundValue"), String(state.current_round).padStart(2, "0"));
        setText(get("#draftTargetText"), "无尽模式 · 已通过全部累计分数门槛");
        setText(get("#draftTargetProgress"), `当前 ${formatScore(state.total_score)} 分 · 继续构筑直到你主动离开`);
        get("#draftTargetFill")?.style.setProperty("width", "100%");
        nodes.draftList.replaceChildren(...options.map((rule) => ruleElement(rule, onChoose)));
        nodes.draft.classList.add("show");
        return;
      }
      const scoreNeeded = Math.max(0, milestone.target - state.total_score);
      const roundsRemaining = Math.max(1, milestone.round - state.current_round + 1);
      const progress = milestone.target > 0 ? Math.max(0, Math.min(100, state.total_score / milestone.target * 100)) : 100;
      setText(get("#draftRoundValue"), String(state.current_round).padStart(2, "0"));
      setText(get("#draftTargetText"), `第 ${milestone.round} 轮结算前累计达到 ${formatScore(milestone.target)} 分`);
      setText(get("#draftTargetProgress"), `当前 ${formatScore(state.total_score)} · 还差 ${formatScore(scoreNeeded)} · 剩余 ${roundsRemaining} 轮 · 持续合约待选择`);
      get("#draftTargetFill")?.style.setProperty("width", `${progress}%`);
      nodes.draftList.replaceChildren(...options.map((rule) => ruleElement(rule, onChoose)));
      nodes.draft.classList.add("show");
    },
    closeRuleDraft() { nodes.draft.classList.remove("show"); },
    openQuestDraft(options, state, onChoose) {
      setText(get("#questRoundValue"), String(state.current_round).padStart(2, "0"));
      nodes.questList.replaceChildren(...options.map((entry) => questElement(entry, state, onChoose)));
      nodes.quest.classList.add("show");
    },
    closeQuestDraft() { nodes.quest.classList.remove("show"); },
    playDealAnimation(cardCount, onComplete) {
      const stage = get(".deck-stage");
      const host = get(".playfield");
      const stack = nodes.stack;
      const cards = [...(stack?.querySelectorAll(".game-card") ?? [])];
      if (!stage || !host || !stack || cards.length === 0) {
        onComplete();
        return;
      }
      host.querySelector(".deal-layer")?.remove();
      const layer = document.createElement("div");
      layer.className = "deal-layer";
      layer.setAttribute("role", "status");
      layer.setAttribute("aria-live", "polite");
      layer.innerHTML = `<div class="deal-copy"><small>PLATE ${String(cardCount).padStart(2, "0")}</small><strong>牌堆落位</strong><span>${cardCount} 张牌进入本轮餐盘</span></div>`;
      stage.classList.add("is-dealing");
      stack.classList.add("is-deal-entering");
      cards.forEach((card) => {
        card.classList.add("is-deal-covered");
        card.dataset.dealInstance = "true";
      });
      void stack.offsetWidth;
      host.appendChild(layer);
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      const duration = reducedMotion ? 160 : 1120;
      window.setTimeout(() => {
        stage.classList.remove("is-dealing");
        stack.classList.remove("is-deal-entering");
        cards.forEach((card) => {
          card.classList.remove("is-deal-covered");
        });
        layer.classList.add("is-leaving");
        window.setTimeout(() => {
          layer.remove();
          onComplete();
        }, 220);
      }, duration);
    },
    showItemEvolution(events = []) {
      const host = get(".playfield");
      if (!host || events.length === 0) return;
      const node = document.createElement("div");
      node.className = "essence-awakening";
      node.innerHTML = `<small>ESSENCE AWAKENED</small>${events.map((event) => `<strong>${event.name}</strong><span>${event.level === 1 ? "精华突破" : `无限培养 · Lv.${event.level}`}</span>`).join("")}`;
      host.appendChild(node);
      window.setTimeout(() => node.remove(), 1650);
    },
    showRoundSummary(result, state, outcome, onConfirm) {
      const title = get("#summaryTitle");
      const tip = get("#summaryTip");
      const eyebrow = get("#summaryEyebrow");
      const button = get("#summaryContinueBtn");
      const list = get("#summaryBreakdownList");
      const milestone = getNextMilestone(state.current_round, state.milestone_delays, state.mode);
      const roundsRemaining = milestone.round === null ? 0 : Math.max(0, milestone.round - state.current_round);
      const milestoneProgress = milestone.target > 0
        ? Math.max(0, Math.min(100, state.total_score / milestone.target * 100))
        : 100;

      setText(get("#summaryMilestoneRounds"), milestone.endless
        ? "无尽模式 · 已无累计分数门槛"
        : roundsRemaining === 0 ? `本轮为第 ${milestone.round} 轮目标结算` : `距离第 ${milestone.round} 轮目标还有 ${roundsRemaining} 轮`);
      setText(get("#summaryMilestoneScore"), milestone.endless
        ? `累计 ${formatScore(state.total_score)} 分 · 第 ${state.current_round} 轮`
        : `累计 ${formatScore(state.total_score)} / 目标 ${formatScore(milestone.target)} 分`);
      get("#summaryMilestoneFill")?.style.setProperty("width", `${milestoneProgress}%`);

      list.innerHTML = result.breakdown.map((item) => `<div class="receipt-line ${item.kind ?? ""}"><span>${item.label}</span><b>${item.text}</b></div>`).join("");
      if (outcome === "victory") {
        eyebrow.textContent = "15 ROUNDS COMPLETE";
        title.textContent = "通关成功！";
        tip.textContent = `最终得分 ${formatScore(state.total_score)}，记录已保存到本机。`;
        button.textContent = "再来一局";
        button.classList.add("danger-action");
      } else if (outcome === "defeat") {
        eyebrow.textContent = "TARGET MISSED";
        title.textContent = "挑战失败";
        tip.textContent = `本阶段需要 ${formatScore(getNextMilestone(state.current_round, state.milestone_delays, state.mode).target)} 分，当前为 ${formatScore(state.total_score)} 分。`;
        button.textContent = "重新开始";
        button.classList.add("danger-action");
      } else {
        eyebrow.textContent = `ROUND ${String(state.current_round).padStart(2, "0")} CLEAR`;
        title.textContent = "本轮结算";
        const gifts = [
          result.plate_upgrade ? `餐盘上限提升至 ${state.plate_capacity}` : null,
          result.reroll_grant ? `刷新 token 增至 ${state.reroll_tokens}` : null,
        ].filter(Boolean);
        tip.textContent = gifts.length > 0
          ? `${gifts.join("，")}。接下来选择一张牌。`
          : "接下来从三张牌中选择一张加入永久牌组，也可以刷新或跳过。";
        button.textContent = "确认结算 · 三选一";
        button.classList.remove("danger-action");
      }
      button.disabled = false;
      button.onclick = async () => {
        const label = button.textContent;
        button.disabled = true;
        if (!outcome) button.textContent = "正在准备选牌…";
        try {
          await onConfirm();
        } finally {
          button.disabled = false;
          if (nodes.summary.classList.contains("show")) {
            button.textContent = label;
          }
        }
      };
      nodes.summary.classList.add("show");
    },
    hideRoundSummary() { nodes.summary.classList.remove("show"); },
    openCardDraft(state, cards, callbacks) {
      renderHud(state);
      const updateTokens = () => {
        setText(get("#draftTokenValue"), state.delete_tokens ?? 0);
        updateHudValue(nodes.tokens, state.delete_tokens ?? 0);
      };
      deckRemovalHandler = (cardUuid) => {
        const result = callbacks.onRemove(cardUuid);
        updateTokens();
        if (result?.success) setText(get("#draftMessage"), `已删除「${result.card.name}」。还剩 ${result.tokens} 枚 token。`);
        return result;
      };
      nodes.cardDraftList.replaceChildren(...cards.map((card) => draftCardElement(card, callbacks.onChoose)));
      setText(get("#draftMessage"), "三选一，也可以刷新或跳过。选牌前可先整理永久牌组。");
      updateTokens();
      setText(get("#draftRerollValue"), state.reroll_tokens ?? 0);
      get("#draftManageDeck").onclick = () => openDeckStatus(state);
      const reroll = get("#draftReroll");
      reroll.disabled = (state.reroll_tokens ?? 0) < 1;
      reroll.textContent = `刷新 · ${state.reroll_tokens ?? 0}`;
      reroll.onclick = () => {
        const result = callbacks.onReroll();
        if (!result?.success) setText(get("#draftMessage"), "没有可用的刷新 token。");
      };
      get("#draftSkip").onclick = callbacks.onSkip;
      nodes.cardDraft.classList.add("show");
    },
    closeCardDraft() {
      closeDeleteConfirmation();
      nodes.deckStatus?.classList.remove("show");
      nodes.cardDraft?.classList.remove("show");
      deckRemovalHandler = null;
    },
    openItemDraft(state, items, onChoose) {
      renderHud(state);
      setText(get("#itemDraftRound"), `第 ${state.current_round} 轮赠礼`);
      nodes.itemDraftList.replaceChildren(...items.map((entry) => itemDraftElement(entry, onChoose)));
      nodes.itemDraft?.classList.add("show");
    },
    closeItemDraft() { nodes.itemDraft?.classList.remove("show"); },
    openShop(state, cards, themedCards, themeType, itemOffers, onBuy, onBuyItem, onRemove, onPlateUpgrade, onReroll, onLock, onContinue, plateUpgradeStatus, arrivedWithLockedShop = false) {
      renderHud(state);
      const removeCardCost = (state.round.shop_free_removals ?? 0) > 0 || (state.free_card_removals ?? 0) > 0 ? 0 : state.remove_card_cost;
      const plate = getPlateSummary(state.deck.length, state.plate_capacity);
      get("#shopPlateSummary").innerHTML = `
        <span><b>${state.deck.length} 张牌</b> · 永久餐盘 <b>${state.plate_capacity}</b> 张 · 下轮登场 ${plate.action_budget} 张</span>
        <span>${plate.reserve_count > 0 ? `${plate.reserve_count} 张不会在下轮登场` : "当前牌组可全部登场"}</span>
      `;
      nodes.shopOffers.replaceChildren(...cards.map((card) => shopCardElement(card, onBuy)));
      if (cards.length === 0) nodes.shopOffers.innerHTML = '<p class="empty-shop">商品售罄</p>';
      setText(get("#shopThemeTitle"), themeType ? `${themeType}专柜` : "同类专柜");
      nodes.shopThemeOffers.replaceChildren(...themedCards.map((card) => shopCardElement(card, onBuy)));
      if (themedCards.length === 0) nodes.shopThemeOffers.innerHTML = '<p class="empty-shop">同类商品售罄</p>';
      nodes.shopItems.replaceChildren(...itemOffers.map((entry) => shopItemElement(entry, onBuyItem)));
      if (itemOffers.length === 0) nodes.shopItems.innerHTML = '<p class="empty-shop">本局低级道具已售罄</p>';
      nodes.shopDeck.replaceChildren(...state.deck.map((card) => deckChipElement(
        card,
        removeCardCost,
        () => openDeleteConfirmation(card, removeCardCost, onRemove),
      )));
      const plateUpgradeButton = get("#shopPlateUpgrade");
      const plateUpgradeDetail = get("#shopPlateUpgradeDetail");
      const plateMaxed = plateUpgradeStatus.reason === "max_capacity";
      plateUpgradeButton.disabled = plateMaxed;
      plateUpgradeButton.textContent = plateMaxed
        ? `餐盘已满 · ${state.plate_capacity}/${GAME_CONFIG.max_plate_capacity}`
        : `永久扩容 +1 · $${plateUpgradeStatus.cost}`;
      plateUpgradeButton.onclick = onPlateUpgrade;
      plateUpgradeDetail.textContent = plateMaxed
        ? "已达到本局餐盘容量上限"
        : `当前 ${state.plate_capacity} 张 → ${state.plate_capacity + 1} 张${plateUpgradeStatus.discount > 0 ? ` · 量尺优惠 -${plateUpgradeStatus.discount}` : ""}`;
      const fullPlateDiscount = state.deck.length <= state.plate_capacity
        ? state.items
          .filter((entry) => entry.effect?.kind === "full_plate_reroll_discount")
          .reduce((sum, entry) => sum + (entry.effect.amount ?? 0), 0)
        : 0;
      const rerollCost = state.round.shop_free_rerolls > 0
        ? 0
        : Math.max(1, GAME_CONFIG.shop_reroll_base_cost + state.round.shop_reroll_count * GAME_CONFIG.shop_reroll_cost_step - fullPlateDiscount);
      const rerollButton = get("#shopReroll");
      rerollButton.textContent = rerollCost === 0
        ? `免费刷新 · 剩余 ${state.round.shop_free_rerolls}`
        : `刷新商品 · $${rerollCost}`;
      rerollButton.disabled = rerollCost > 0 && state.gold < rerollCost;
      rerollButton.onclick = onReroll;
      const lockButton = get("#shopLock");
      lockButton.classList.toggle("is-locked", state.shop_lock_requested);
      lockButton.setAttribute("aria-pressed", String(state.shop_lock_requested));
      lockButton.textContent = state.shop_lock_requested ? "◆ 已锁定下轮商店" : "◇ 锁定下轮商店";
      lockButton.onclick = onLock;
      lockButton.title = "锁定后，下一轮商店保留当前未购买的卡牌、同类专柜与道具；价格会按当时优惠重新计算。";
      if (arrivedWithLockedShop) setText(get("#shopMessage"), "商店锁定已生效：本轮保留了上一间商店的商品。");
      get("#shopContinue").onclick = onContinue;
      nodes.shop.classList.add("show");
    },
    closeShop() {
      closeDeleteConfirmation();
      nodes.shop.classList.remove("show");
    },
    setShopMessage(message, tone = "normal") {
      const node = get("#shopMessage");
      setText(node, message);
      node.dataset.tone = tone;
    },
  };
}
