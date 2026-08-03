import { GAME_CONFIG, GAME_MODES, MODE_LABELS, getFinalRound, getMilestoneTarget, getNextMilestone, isShopMode } from "./config.js";
import {
  getCurrentItemDescription,
  getItemById,
  getItemLevelLabel,
  getPostponeLimit,
} from "./items.js";
import { getCardPostponeCount, getCurrentCard, isCardPostponed } from "./round-pile.js";
import { finiteNumber, formatScore, safeAdd } from "./numbers.js";
import { getQuestRequirement, getQuestTarget } from "./quests.js";
import { stripKeywordTags } from "./keywords.js";
import { CARD_TYPES, createCardPool, getCardById } from "./data.js";
import { getPlateSummary } from "./plate.js";
import { getReshuffleStatus } from "./reshuffle.js";
import { getRuleUnlockRound } from "./rules.js";
import { getLiveHudValues } from "./live-hud.js";
import {
  getRoundGrade,
  getScoreHeat,
  getScoreImpact,
  getSummaryBeatDuration,
  getSummaryCardTiming,
} from "./round-presentation.js";

const PHASE_LABELS = Object.freeze({
  Init: "准备中", Playing: "出牌中", Scoring: "结算中", CardDraft: "轮末选牌",
  ItemDraft: "挑选道具", RuleDraft: "选择条约", Shop: "商店中", NextRound: "下一轮", GameOver: "本局结束",
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
  node.className = `item-chip item-rarity-${RARITY_CLASS[entry.rarity] ?? "common"}`;
  node.title = `${entry.name} · ${getItemLevelLabel(entry)}：${getCurrentItemDescription(entry)}`;
  node.innerHTML = `<span class="meta-sprite" style="${metaStyle(entry)}"></span><i>◆</i>`;
  return node;
}

function shopItemElement(entry, onBuy) {
  const button = document.createElement("button");
  button.className = "shop-item-card";
  button.type = "button";
  button.innerHTML = `
    <span class="shop-item-icon meta-sprite" style="${metaStyle(entry)}"></span>
    <span><small>${entry.rarity} · ${entry.role}</small><strong>${entry.name}</strong><em>${entry.description}</em></span>
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

function cardElement(card, active, depth, fogged = false, postponeCount = 0, postponeLimit = 1, markedPostponed = false) {
  const article = document.createElement("article");
  const pointChanged = pointTone(card, "eat_points") !== "point-base" || pointTone(card, "discard_points") !== "point-base";
  const postponed = markedPostponed || postponeCount > 0;
  const postponeText = postponeCount === 0
    ? "本轮已被效果标记为后置"
    : postponeLimit === Infinity ? `本轮已后置 ${postponeCount} 次，可继续后置` : `本轮已后置 ${postponeCount}/${postponeLimit} 次`;
  const postponeBadge = postponeCount === 0
    ? "已后置"
    : postponeLimit === Infinity ? `×${postponeCount}` : `${postponeCount}/${postponeLimit}`;
  article.className = `game-card card-${card.edibility} rarity-${RARITY_CLASS[card.rarity] ?? "common"}${active ? " is-active" : ""}${fogged ? " is-fogged" : ""}${postponed ? " is-postponed" : ""}${pointChanged ? " has-point-change" : ""}${card.weakened ? " is-weakened" : ""}${freshArtClass(card)}`;
  article.style.setProperty("--depth", depth);
  article.style.zIndex = String(10 - depth);
  article.dataset.cardUuid = card.uuid;
  article.setAttribute("aria-label", fogged ? "被星云遮蔽的未处理卡牌" : `${card.name}，吃牌 ${card.eat_points} 分，弃牌 ${card.discard_points} 分${postponed ? `，${postponeText}` : ""}`);
  article.innerHTML = `
    <div class="card-noise" aria-hidden="true"></div>
    <div class="card-head"><span class="rarity-tag">${card.rarity}</span><span class="edibility-tag">${EDIBILITY_LABEL[card.edibility] ?? "特殊"}</span></div>
    <div class="card-art" aria-hidden="true"><span class="game-sprite" style="${spriteStyle(card)}"></span>${postponed ? `<span class="card-postpone-mark"><b>↔</b> ${postponeBadge}</span>` : ""}</div>
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
    <span><small>第 ${rule.selected_round ?? "本"} 轮接取 · 已尝试 ${rule.attempts ?? 0} 轮</small><strong>${rule.name}</strong><em>${rule.description}</em></span>
    <b>+${rule.gold_reward} 金币</b>
  `;
  return article;
}

function ownedItemElement(entry) {
  const article = document.createElement("article");
  article.className = `collection-status-card item-status-card item-rarity-${RARITY_CLASS[entry.rarity] ?? "common"}`;
  article.innerHTML = `
    <span class="collection-item-icon meta-sprite" style="${metaStyle(entry)}"></span>
    <span><small>${entry.rarity} · ${entry.role}</small><strong>${entry.name}</strong><em>${getCurrentItemDescription(entry)}</em></span>
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
    <span class="shop-card-copy"><small>${card.rarity} · ${card.type} · ${EDIBILITY_LABEL[card.edibility]}</small><strong>${card.name}</strong><span class="draft-card-points"><span class="draft-eat-point">吃 <b>${signed(card.eat_points)}</b></span><span class="draft-point-separator">/</span><span class="draft-discard-point">弃 <b>${signed(card.discard_points)}</b></span></span><i>${cardEffectText(card)}</i></span>
    <span class="draft-pick-label">选择</span>
  `;
  button.addEventListener("click", () => onChoose(card), { once: true });
  return button;
}

function summaryScoreCardElement(entry, mode) {
  const source = getCardById(entry.card_id, { economy: isShopMode(mode) }) ?? {
    id: entry.card_id,
    name: entry.name,
    type: entry.type,
    rarity: entry.rarity,
    edibility: entry.edibility,
  };
  const card = { ...source, name: entry.name ?? source.name, type: entry.type ?? source.type };
  const points = finiteNumber(entry.points);
  const impact = getScoreImpact(points);
  const article = document.createElement("article");
  article.className = `summary-score-card rarity-${RARITY_CLASS[entry.rarity] ?? "common"} action-${entry.action}${points < 0 ? " is-negative" : ""}${entry.wrong_edibility ? " is-hard-eat" : ""}`;
  article.dataset.impact = String(impact);
  article.setAttribute("aria-label", `${card.name}，${entry.action === "eat" ? "吃牌" : "弃牌"}，${points >= 0 ? "加" : "减"}${formatScore(Math.abs(points))}分`);
  const actionLabel = entry.action === "eat" ? "吃牌" : "弃牌";
  const detail = entry.effect_triggered || (entry.effect_bonus ? `卡牌效果 ${entry.effect_bonus > 0 ? "+" : ""}${formatScore(entry.effect_bonus)}` : "牌面结算");
  article.title = `${card.name} · ${actionLabel} ${points >= 0 ? "+" : ""}${formatScore(points)} · ${detail}`;
  const sparks = Array.from({ length: 8 }, (_, index) => `<i style="--spark:${index}"></i>`).join("");
  article.innerHTML = `
    <span class="summary-card-sparks" aria-hidden="true">${sparks}</span>
    <span class="summary-card-frame">
      <small><b>${entry.action === "eat" ? "↓" : "↑"}</b>${entry.type}</small>
      <span class="summary-card-art game-sprite" style="${spriteStyle(card)}"></span>
      <strong>${card.name}</strong>
      <em>${actionLabel}</em>
    </span>
    <b class="summary-card-points">${points >= 0 ? "+" : ""}${formatScore(points)}</b>
  `;
  return article;
}

function formatReceiptAnimatedValue(item, value) {
  const number = finiteNumber(value);
  switch (item.number_style) {
    case "signed-score-unit": return `${number >= 0 ? "+" : ""}${formatScore(number)} 分`;
    case "signed-score": return `${number >= 0 ? "+" : ""}${formatScore(number)}`;
    case "score-unit": return `${formatScore(number)} 分`;
    case "signed-gold": return `${number >= 0 ? "+" : ""}${formatScore(number)} 金币`;
    case "multiplier": return `×${Number.isInteger(number) ? number : number.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}`;
    default: return item.text;
  }
}

function itemDraftElement(entry, onChoose) {
  const button = document.createElement("button");
  button.className = `item-draft-card item-rarity-${RARITY_CLASS[entry.rarity] ?? "common"}${entry.consumable ? " is-consumable" : ""}`;
  button.type = "button";
  button.dataset.itemId = entry.id;
  button.dataset.itemSlot = entry.wild ? "wild" : entry.bridge ? "bridge" : "relevant";
  button.innerHTML = `
    <span class="item-draft-icon meta-sprite" style="${metaStyle(entry)}"></span>
    <span class="item-draft-copy"><small>${entry.rarity} · ${entry.role}</small><strong>${entry.name}</strong><em>${entry.description}</em></span>
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
  button.innerHTML = `<span class="game-sprite" style="${spriteStyle(card)}"></span><b>${card.name}</b><small>${EDIBILITY_LABEL[card.edibility]} · 吃 ${pointValue(card, "eat_points")} / 弃 ${pointValue(card, "discard_points")}</small><i>删除 $${cost}</i>`;
  button.addEventListener("click", () => onRemove(card.uuid));
  return button;
}

function deckStatusCardElement(card, quantity, onRemove = null, onInspect = null, actionLabel = "删除 · 1 枚标记") {
  const article = document.createElement("article");
  article.className = `deck-status-card rarity-${RARITY_CLASS[card.rarity] ?? "common"}${freshArtClass(card)}`;
  article.dataset.cardId = card.id;
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
  if (onInspect) {
    article.classList.add("is-inspectable");
    article.tabIndex = 0;
    article.setAttribute("role", "button");
    article.setAttribute("aria-label", `查看${card.name}完整卡牌：${cardEffectText(card)}`);
    article.title = cardEffectText(card);
    article.addEventListener("click", () => onInspect(card));
    article.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onInspect(card);
      }
    });
  }
  if (onRemove) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "deck-remove-token";
    remove.textContent = actionLabel;
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
    tokens: get("#tokenValue"), resourceLabel: get("#resourceLabel"), resourceHint: get("#resourceHint"),
    remaining: get("#remainingValue"), timer: get("#timerValue"), phase: get("#phaseValue"),
    eatZone: get("#eatZone"), discardZone: get("#discardZone"), swipeStatus: get("#swipeStatus"),
    draft: get("#ruleDraft"), draftList: get("#ruleDraftList"), summary: get("#roundSummary"),
    quest: get("#questDraft"), questList: get("#questDraftList"),
    shop: get("#shopPanel"), shopOffers: get("#shopOfferList"), shopThemeOffers: get("#shopThemeOfferList"), shopItems: get("#shopItemOfferList"), shopDeck: get("#shopDeckList"), welcome: get("#welcomeOverlay"),
    cardDraft: get("#cardDraft"), cardDraftList: get("#cardDraftList"),
    itemDraft: get("#itemDraft"), itemDraftList: get("#itemDraftList"),
    itemCardChoice: get("#itemCardChoice"), itemCardChoiceList: get("#itemCardChoiceList"),
    itemCategoryChoice: get("#itemCategoryChoice"), itemCategoryChoiceList: get("#itemCategoryChoiceList"),
    deleteConfirm: get("#deleteConfirm"),
    questStatus: get("#questStatus"), questInfoButton: get("#questInfoButton"),
    deckStatus: get("#deckStatus"), deckInfoButton: get("#deckInfoButton"),
    ruleStatus: get("#ruleStatus"), ruleInfoButton: get("#ruleInfoButton"),
    itemStatus: get("#itemStatus"), itemInfoButton: get("#itemInfoButton"),
    storyGuide: get("#storyGuide"), tutorialInfoButton: get("#tutorialInfoButton"),
    gameMenu: get("#gameMenu"), menuButton: get("#menuButton"),
    cardCatalog: get("#cardCatalog"), catalogList: get("#catalogList"),
    catalogCardDetail: get("#catalogCardDetail"), catalogCardPreview: get("#catalogCardPreview"),
  };

  let tutorialFocus = null;
  let menuState = null;
  let menuSettings = null;
  let storySuspendedByMenu = false;
  let menuOpenedFromHome = false;
  let deckRemovalHandler = null;
  let homeRainTimer = null;
  let catalogMode = "standard";
  let catalogActiveCardId = null;
  let summaryPresentationRun = 0;
  let summaryAdvance = null;
  const homeRainCards = createCardPool();

  nodes.summary?.addEventListener("pointerdown", (event) => {
    if (!summaryAdvance || event.target.closest("#summaryContinueBtn")) return;
    event.preventDefault();
    summaryAdvance();
  });

  function waitForSummaryBeat(milliseconds, runId) {
    if (milliseconds <= 0 || runId !== summaryPresentationRun) return Promise.resolve();
    return new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timer);
        if (summaryAdvance === finish) summaryAdvance = null;
        resolve();
      };
      const timer = window.setTimeout(finish, milliseconds);
      summaryAdvance = finish;
    });
  }

  function waitForSummaryAdvance(runId) {
    if (runId !== summaryPresentationRun) return Promise.resolve();
    return new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (summaryAdvance === finish) summaryAdvance = null;
        resolve();
      };
      summaryAdvance = finish;
    });
  }

  function animateSummaryValue(from, to, milliseconds, runId, onFrame) {
    const startValue = finiteNumber(from);
    const endValue = finiteNumber(to);
    if (milliseconds <= 0 || startValue === endValue || runId !== summaryPresentationRun) {
      onFrame(endValue);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const startedAt = performance.now();
      let frame = 0;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        window.cancelAnimationFrame(frame);
        if (summaryAdvance === finish) summaryAdvance = null;
        onFrame(endValue);
        resolve();
      };
      const step = (now) => {
        if (runId !== summaryPresentationRun) {
          finish();
          return;
        }
        const progress = Math.min(1, (now - startedAt) / milliseconds);
        const eased = 1 - ((1 - progress) ** 3);
        onFrame(startValue + (endValue - startValue) * eased);
        if (progress >= 1) finish();
        else frame = window.requestAnimationFrame(step);
      };
      summaryAdvance = finish;
      frame = window.requestAnimationFrame(step);
    });
  }

  async function playRoundSummaryPresentation(result, state, options, runId) {
    const performanceStage = get("#summaryPerformance");
    const receiptStage = get("#summaryReceiptStage");
    const theater = get("#summaryCardTheater");
    const liveTotal = get("#summaryLiveTotal");
    const liveRound = get("#summaryLiveRound");
    const progress = get("#summaryCardProgress");
    const progressFill = get("#summaryCardProgressFill");
    const receiptList = get("#summaryBreakdownList");
    const receiptScore = get("#summaryReceiptScore");
    const gradeStage = get("#summaryGradeStage");
    const gradeStamp = get("#summaryGradeStamp");
    const performanceSkip = get("#summarySkipHint");
    const receiptSkip = get("#summaryReceiptSkip");
    const button = get("#summaryContinueBtn");
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const presentationSettings = options.settings ?? {};
    const skipAnimations = presentationSettings.summary_skip === true;
    const pauseOnReview = presentationSettings.summary_pause === true && !skipAnimations;
    const cards = result.presentation_cards ?? [];
    const startingTotal = finiteNumber(result.starting_total_score, state.total_score - result.round_score);
    let runningRound = 0;

    const mobileStage = window.matchMedia?.("(max-width: 720px)")?.matches;
    const columns = mobileStage
      ? cards.length <= 6 ? Math.max(1, Math.min(3, cards.length)) : cards.length <= 16 ? 4 : 5
      : cards.length <= 5 ? Math.max(1, cards.length) : cards.length <= 10 ? 5 : cards.length <= 18 ? 6 : 7;

    performanceStage.hidden = skipAnimations;
    receiptStage.hidden = !skipAnimations;
    button.hidden = true;
    button.disabled = true;
    receiptList.replaceChildren();
    gradeStage.hidden = true;
    gradeStage.classList.remove("is-stamping", "is-settled");
    gradeStamp.dataset.grade = "c";
    gradeStamp.dataset.phase = "idle";
    nodes.summary.dataset.presentationState = "cards";
    nodes.summary.dataset.presentationSpeed = presentationSettings.summary_speed === "fast" ? "fast" : "normal";
    nodes.summary.dataset.heat = "0";
    theater.replaceChildren();
    theater.classList.remove("is-reviewing");
    theater.style.setProperty("--summary-columns", String(columns));
    theater.style.setProperty("--summary-card-basis", `${Math.max(10, (100 / columns) - 1.6)}%`);
    theater.dataset.cardCount = String(cards.length);
    setText(liveTotal, formatScore(startingTotal));
    setText(liveRound, "本轮 +0");
    setText(progress, `逐牌计分 0 / ${cards.length}`);
    setText(performanceSkip, "点击任意位置 · 加速当前卡牌");
    receiptSkip.hidden = false;
    progressFill?.style.setProperty("width", "0%");

    for (let index = 0; index < cards.length; index += 1) {
      if (runId !== summaryPresentationRun) return;
      const entry = cards[index];
      const timing = getSummaryCardTiming(index, presentationSettings, reducedMotion);
      const previousRound = runningRound;
      runningRound = safeAdd(runningRound, entry.points ?? 0);
      const cardNode = summaryScoreCardElement(entry, state.mode);
      const previousCard = theater.querySelector(".summary-score-card.is-current");
      previousCard?.classList.remove("is-current");
      previousCard?.classList.add("is-settled");
      cardNode.style.setProperty("--reveal-order", String(index));
      cardNode.style.setProperty("--summary-card-reveal-duration", `${timing.reveal}ms`);
      cardNode.style.setProperty("--summary-point-duration", `${Math.max(0, Math.round(timing.reveal * 1.17))}ms`);
      cardNode.style.setProperty("--summary-spark-duration", `${Math.max(0, Math.round(timing.reveal * 1.08))}ms`);
      cardNode.classList.toggle("is-rapid", timing.rapid);
      theater.appendChild(cardNode);
      void cardNode.offsetWidth;
      cardNode.classList.add("is-revealed", "is-current");
      nodes.summary.dataset.heat = String(Math.max(getScoreHeat(runningRound), getScoreImpact(entry.points ?? 0)));
      setText(progress, `${timing.rapid ? "快速上菜" : "逐牌计分"} ${index + 1} / ${cards.length}`);
      progressFill?.style.setProperty("width", `${(index + 1) / Math.max(1, cards.length) * 100}%`);
      if (!skipAnimations) options.onSound?.(entry.points < 0 ? "score-negative" : "score-reveal", Math.max(1, Math.abs(entry.points ?? 0)));
      await animateSummaryValue(previousRound, runningRound, timing.count, runId, (value) => {
        const rounded = Math.round(value);
        setText(liveTotal, formatScore(safeAdd(startingTotal, rounded)));
        setText(liveRound, `本轮 ${rounded >= 0 ? "+" : ""}${formatScore(rounded)}`);
      });
      await waitForSummaryBeat(timing.gap, runId);
    }

    if (cards.length === 0) {
      theater.innerHTML = '<div class="summary-no-cards"><b>EMPTY PLATE</b><span>本轮没有可重放的卡牌结算</span></div>';
      await waitForSummaryBeat(getSummaryBeatDuration(680, presentationSettings, reducedMotion), runId);
    }
    if (runId !== summaryPresentationRun) return;

    theater.querySelector(".summary-score-card.is-current")?.classList.add("is-settled");
    theater.querySelector(".summary-score-card.is-current")?.classList.remove("is-current");
    theater.classList.add("is-reviewing");
    nodes.summary.dataset.presentationState = pauseOnReview ? "review-paused" : "review";
    setText(progress, cards.length > 0 ? `本轮 ${cards.length} 张牌 · 得分一览` : "本轮空餐盘");
    setText(performanceSkip, pauseOnReview ? "复盘已暂停 · 点击进入详细清单" : "点击任意位置 · 进入详细清单");
    if (!skipAnimations) options.onSound?.("score-review", Math.max(1, Math.abs(runningRound)));
    if (pauseOnReview) await waitForSummaryAdvance(runId);
    else await waitForSummaryBeat(getSummaryBeatDuration(2800, presentationSettings, reducedMotion), runId);
    if (runId !== summaryPresentationRun) return;

    performanceStage.hidden = true;
    receiptStage.hidden = false;
    nodes.summary.dataset.presentationState = "receipt";
    setText(receiptScore, "+0");
    let receiptRunningScore = 0;

    for (let index = 0; index < result.breakdown.length; index += 1) {
      if (runId !== summaryPresentationRun) return;
      const item = result.breakdown[index];
      const line = document.createElement("div");
      line.className = `receipt-line ${item.kind ?? ""}${skipAnimations ? " is-visible" : " is-entering"}`;
      const label = document.createElement("span");
      const value = document.createElement("b");
      label.textContent = item.label;
      value.textContent = Number.isFinite(item.value)
        ? formatReceiptAnimatedValue(item, 0)
        : item.text;
      line.append(label, value);
      receiptList.appendChild(line);
      void line.offsetWidth;
      if (!skipAnimations) line.classList.add("is-visible");
      if (!skipAnimations) options.onSound?.("receipt-tick", Math.min(8, index + 1));

      if (Number.isFinite(item.value)) {
        line.dataset.startValue = "0";
        const from = 0;
        const to = item.value;
        const liveStart = receiptRunningScore;
        const changesReceiptTotal = item.label === "牌面与效果" || item.kind === "total";
        const liveEnd = item.label === "牌面与效果" ? to : item.kind === "total" ? result.round_score : liveStart;
        line.classList.add("is-counting");
        await animateSummaryValue(from, to, getSummaryBeatDuration(560, presentationSettings, reducedMotion), runId, (animated) => {
          value.textContent = formatReceiptAnimatedValue(item, animated);
          if (changesReceiptTotal) {
            const ratio = to === from ? 1 : (animated - from) / (to - from);
            const current = liveStart + (liveEnd - liveStart) * Math.max(0, Math.min(1, ratio));
            setText(receiptScore, `${current >= 0 ? "+" : ""}${formatScore(current)}`);
          }
        });
        line.classList.remove("is-counting");
        if (changesReceiptTotal) receiptRunningScore = liveEnd;
      } else {
        await waitForSummaryBeat(getSummaryBeatDuration(120, presentationSettings, reducedMotion), runId);
      }
      await waitForSummaryBeat(getSummaryBeatDuration(45, presentationSettings, reducedMotion), runId);
    }

    if (runId !== summaryPresentationRun) return;
    setText(receiptScore, `${result.round_score >= 0 ? "+" : ""}${formatScore(result.round_score)}`);
    const grade = getRoundGrade(result.round_score);
    setText(get("#summaryGradeValue"), grade.grade);
    setText(get("#summaryGradeLabel"), grade.label);
    gradeStamp.dataset.grade = grade.tone;
    gradeStage.hidden = false;
    if (skipAnimations) {
      gradeStage.classList.add("is-settled");
      gradeStamp.dataset.phase = "settled";
    } else {
      gradeStamp.dataset.phase = "striking";
      setText(receiptSkip, "点击任意位置 · 快速盖章");
      void gradeStage.offsetWidth;
      gradeStage.classList.add("is-stamping");
      options.onSound?.("grade-stamp", Math.max(1, ["c", "b", "a", "aplus", "s"].indexOf(grade.tone) + 1));
      await waitForSummaryBeat(getSummaryBeatDuration(820, presentationSettings, reducedMotion), runId);
      gradeStage.classList.remove("is-stamping");
      gradeStage.classList.add("is-settled");
      gradeStamp.dataset.phase = "settled";
    }

    if (runId !== summaryPresentationRun) return;
    nodes.summary.dataset.presentationState = "ready";
    button.hidden = false;
    button.disabled = false;
    receiptSkip.hidden = true;
    summaryAdvance = null;
  }

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

  function applyHomeTheme(theme = "night") {
    const selected = theme === "day" ? "day" : "night";
    if (nodes.welcome) nodes.welcome.dataset.homeTheme = selected;
    const button = get("#homeThemeToggle");
    if (button) {
      button.textContent = selected === "day" ? "☀ 白昼" : "☾ 夜间";
      button.title = selected === "day" ? "切换为夜间色调" : "切换为白昼色调";
      button.setAttribute("aria-pressed", String(selected === "day"));
    }
    return selected;
  }

  function applyHomeProgression(progression = {}, god = false, unlocks = {}) {
    const modeVictories = progression.mode_victories ?? {};
    const logo = get("#homeLogo");
    const sigils = [...root.querySelectorAll("[data-home-mode]")];
    const cleared = sigils.filter((sigil) => (modeVictories[sigil.dataset.homeMode] ?? 0) > 0);
    sigils.forEach((sigil) => {
      const count = modeVictories[sigil.dataset.homeMode] ?? 0;
      const unlocked = sigil.dataset.homeMode === "normal" || Boolean(unlocks[sigil.dataset.homeMode]);
      sigil.dataset.modeLabel ??= sigil.title || sigil.dataset.homeMode;
      sigil.classList.toggle("is-unlocked", unlocked);
      sigil.classList.toggle("is-cleared", count > 0);
      sigil.dataset.unlocked = String(unlocked);
      sigil.dataset.victories = String(count);
      sigil.title = `${sigil.dataset.modeLabel} · ${count > 0 ? `已通关 ${count} 次` : unlocked ? "已解锁" : "未解锁"}`;
    });
    if (logo) {
      logo.dataset.clearCount = String(cleared.length);
      logo.classList.toggle("cleared-normal", (modeVictories.normal ?? 0) > 0);
      logo.classList.toggle("cleared-prep", (modeVictories.prep ?? 0) > 0);
      logo.classList.toggle("cleared-shop", (modeVictories.shop ?? 0) > 0);
      logo.classList.toggle("cleared-contract", (modeVictories.contract_shop ?? 0) > 0);
      logo.classList.toggle("cleared-hard", (modeVictories.hard ?? 0) > 0);
      logo.classList.toggle("cleared-endless", (modeVictories.endless ?? 0) > 0);
      logo.classList.toggle("is-god", Boolean(god));
    }
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
    const gestures = get("#storyGestureLegend");
    if (gestures) {
      const gestureCopy = {
        practice: ["☝", "按住卡牌 · 轻拖 · 松手"],
        eat: ["↓", "向下拖 · 吃牌"],
        postpone: ["↔", "向左或向右拖 · 后置"],
        discard: ["↑", "向上拖 · 弃牌"],
      }[model.gesture];
      gestures.hidden = !gestureCopy;
      gestures.className = `story-gesture-legend${model.gesture ? ` ${model.gesture}` : ""}`;
      gestures.innerHTML = gestureCopy ? `<span><b>${gestureCopy[0]}</b>${gestureCopy[1]}</span>` : "";
    }
    const progress = get("#storyGuideProgress");
    const current = Math.max(1, Math.min(model.progress?.current ?? 1, model.progress?.total ?? 1));
    const total = Math.max(current, model.progress?.total ?? current);
    progress.innerHTML = `<span>教学 ${current}/${total}</span><i><b style="width:${current / total * 100}%"></b></i>`;
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

  function closeCatalogCardDetail() {
    nodes.catalogCardDetail?.classList.remove("show");
    nodes.cardCatalog?.removeAttribute("aria-hidden");
  }

  function closeCatalogToMenu() {
    closeCatalogCardDetail();
    nodes.cardCatalog?.classList.remove("show");
    if (menuState || menuOpenedFromHome) {
      nodes.gameMenu?.classList.add("show");
      get("#cardCatalogButton")?.focus();
    }
  }

  function catalogUsesEconomyCards() {
    return catalogMode === "shop";
  }

  function syncCatalogModeControls() {
    root.querySelectorAll("[data-catalog-mode]").forEach((button) => {
      const selected = button.dataset.catalogMode === catalogMode;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function renderCatalogList() {
    const filter = get("#catalogTypeFilter");
    if (!filter || !nodes.catalogList) return;
    const allCards = createCardPool({ economy: catalogUsesEconomyCards() });
    const cards = filter.value === "all" ? allCards : allCards.filter((card) => card.type === filter.value);
    setText(get("#catalogSummary"), `${cards.length} 张卡牌 · ${catalogUsesEconomyCards() ? "商店效果" : "标准效果"}`);
    nodes.catalogList.replaceChildren(...cards.map((card) => deckStatusCardElement(card, 1, null, (entry) => openCatalogCardDetail(entry.id))));
  }

  function setCatalogMode(mode) {
    if (!['standard', 'shop'].includes(mode)) return;
    catalogMode = mode;
    syncCatalogModeControls();
    renderCatalogList();
    if (catalogActiveCardId && nodes.catalogCardDetail?.classList.contains("show")) {
      openCatalogCardDetail(catalogActiveCardId, false);
    }
  }

  function openCatalogCardDetail(cardOrId, focusClose = true) {
    const cardId = typeof cardOrId === "string" ? cardOrId : cardOrId?.id;
    const card = getCardById(cardId, { economy: catalogUsesEconomyCards() });
    if (!card) return;
    catalogActiveCardId = card.id;
    const preview = cardElement(card, false, 0, false, 0, 1);
    preview.classList.add("catalog-preview-game-card");
    preview.removeAttribute("aria-label");
    nodes.catalogCardPreview?.replaceChildren(preview);
    const copy = get("#catalogCardDetailCopy");
    if (copy) copy.innerHTML = `
      <small>${catalogUsesEconomyCards() ? "商店效果" : "标准效果"} · ${card.rarity} · ${card.type} · ${EDIBILITY_LABEL[card.edibility]}</small>
      <strong>${card.name}</strong>
      <div class="catalog-detail-points"><span class="eat"><small>吃牌</small><b>${signed(card.eat_points)}</b></span><span class="discard"><small>弃牌</small><b>${signed(card.discard_points)}</b></span></div>
      <section><small>CARD EFFECT · 卡牌效果</small><p>${cardEffectText(card)}</p></section>
    `;
    setText(get("#catalogCardDetailTitle"), card.name);
    syncCatalogModeControls();
    nodes.cardCatalog?.setAttribute("aria-hidden", "true");
    nodes.catalogCardDetail?.classList.add("show");
    if (focusClose) get("#catalogCardDetailClose")?.focus();
  }

  function openDeleteConfirmation(card, costOrOnRemove, maybeOnRemove) {
    const shopCost = typeof costOrOnRemove === "number" ? costOrOnRemove : null;
    const onRemove = typeof costOrOnRemove === "function" ? costOrOnRemove : maybeOnRemove;
    const preview = get("#deleteConfirmCard");
    preview.innerHTML = `
      <span class="game-sprite" style="${spriteStyle(card)}"></span>
      <span class="delete-confirm-copy">
        <strong>${card.name}</strong>
        <small>${card.rarity} · ${card.type} · ${EDIBILITY_LABEL[card.edibility]}</small>
        <em>吃 ${signed(card.eat_points)} / 弃 ${signed(card.discard_points)}<br />${card.effect?.description ?? "无额外效果"}</em>
      </span>
    `;
    setText(get("#deleteConfirmWarning"), shopCost === null
      ? `确认消耗 1 枚删牌标记删除「${card.name}」？此操作不可撤销。`
      : `确认${shopCost > 0 ? `支付 ${shopCost} 金币` : "免费"}删除「${card.name}」？此操作不可撤销。`);
    const accept = get("#deleteConfirmAccept");
    accept.textContent = shopCost === null ? "确认删除 · 1 枚标记" : `确认删除 · ${shopCost > 0 ? `$${shopCost}` : "免费"}`;
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
    if (nodes.catalogCardDetail?.classList.contains("show")) {
      closeCatalogCardDetail();
      return;
    }
    if (nodes.deleteConfirm?.classList.contains("show")) {
      closeDeleteConfirmation();
      return;
    }
    if (nodes.cardCatalog?.classList.contains("show")) {
      closeCatalogToMenu();
      return;
    }
    const statusOverlay = [nodes.deckStatus, nodes.questStatus, nodes.ruleStatus, nodes.itemStatus]
      .find((overlay) => overlay?.classList.contains("show"));
    if (statusOverlay) {
      statusOverlay.classList.remove("show");
      return;
    }
    if (nodes.gameMenu?.classList.contains("show")) {
      nodes.gameMenu.classList.remove("show");
      resumeStoryAfterMenu();
    }
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
      <div><small>永久餐盘</small><b>${state.plate_capacity} 张</b><span>${isShopMode(state.mode) ? "在商店中付费扩容" : "每 5 轮免费 +1"}</span></div>
      <div><small>未登场候选</small><b>${reserveCount} 张</b><span>每轮重新随机抽取</span></div>
      <div><small>${state.mode === GAME_MODES.PREP ? "备料位" : isShopMode(state.mode) ? "金币" : "删牌标记"}</small><b>${state.mode === GAME_MODES.PREP ? (state.prep_slot?.card ? "1 / 1" : "0 / 1") : isShopMode(state.mode) ? state.gold ?? 0 : `${state.delete_tokens ?? 0} 枚`}</b><span>${state.mode === GAME_MODES.PREP ? "轮末可调整" : isShopMode(state.mode) ? "用于商店操作" : "仅轮末选牌阶段可用"}</span></div>
    `;
    const prepMode = state.mode === GAME_MODES.PREP;
    const canRemove = state.phase === "CardDraft" && state.deck.length > 1 && deckRemovalHandler
      && (prepMode || (state.delete_tokens ?? 0) > 0);
    const listNodes = groups.map(({ card, quantity }) => deckStatusCardElement(
      card,
      quantity,
      canRemove ? (selected) => {
        if (prepMode) {
          const result = deckRemovalHandler.store(selected.uuid);
          if (result?.success) openDeckStatus(state);
          return;
        }
        openDeleteConfirmation(selected, () => {
        const result = deckRemovalHandler.remove(selected.uuid);
        if (result?.success) openDeckStatus(state);
      });
      } : null,
      null,
      prepMode ? "放入备料位" : "删除 · 1 枚标记",
    ));
    if (prepMode && state.prep_slot?.card) {
      const slot = document.createElement("article");
      const ready = state.current_round >= (state.prep_slot.ready_round ?? Infinity);
      slot.className = "prep-slot-card";
      slot.innerHTML = `<span class="game-sprite" style="${spriteStyle(state.prep_slot.card)}"></span><span><small>备料位 · 本轮不会登场</small><b>${state.prep_slot.card.name}</b><em>${ready ? "已存放一轮，可以永久移除" : `再经过一轮可移除（第 ${state.prep_slot.ready_round} 轮轮末）`}</em></span><div><button type="button" data-prep-action="retrieve">取回牌组</button><button type="button" data-prep-action="remove" ${ready ? "" : "disabled"}>永久移除</button></div>`;
      slot.querySelector('[data-prep-action="retrieve"]').onclick = () => { if (deckRemovalHandler.retrieve()?.success) openDeckStatus(state); };
      slot.querySelector('[data-prep-action="remove"]').onclick = () => { if (deckRemovalHandler.removePrep()?.success) openDeckStatus(state); };
      listNodes.unshift(slot);
    }
    get("#deckStatusList").replaceChildren(...listNodes);
    setText(get("#deckRemovalHint"), prepMode
      ? (state.phase === "CardDraft" ? "点击一张永久牌放入唯一备料位；原备料会自动取回。存放经过一轮后，可选择永久移除。" : "备料只在轮末选牌阶段调整；备料中的牌不会进入下一轮餐盘。")
      : state.phase === "CardDraft"
      ? (state.delete_tokens > 0 ? `当前有 ${state.delete_tokens} 枚删牌标记；点击卡牌下方按钮即可删除。` : "当前没有删牌标记。你仍可查看牌组后返回选牌。")
      : "出牌阶段只能查看；轮末三选一时可消耗删牌标记删除卡牌。");
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
    get("#ruleStatusSummary").innerHTML = `<b>${rules.length ? `${rules.length} 条并行条约` : "暂无条约"}</b><span>每轮共同判定；完成即领取金币，未完成会保留到下一轮。</span>`;
    const list = get("#ruleStatusList");
    if (rules.length === 0) list.innerHTML = '<p class="collection-status-empty">下一轮开场可以接取一条新条约。</p>';
    else list.replaceChildren(...rules.map(selectedRuleElement));
    nodes.deckStatus?.classList.remove("show");
    nodes.questStatus?.classList.remove("show");
    nodes.itemStatus?.classList.remove("show");
    nodes.ruleStatus?.classList.add("show");
  }

  function openItemStatus(state) {
    const items = state.items;
    get("#itemStatusSummary").innerHTML = `<b>${items.length} 件永久道具</b><span>普通、罕见、稀有与传奇道具均会直接改变本局规则；一次性道具使用后不会留在此处。</span>`;
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
    const shopMode = isShopMode(state.mode);
    const prepMode = state.mode === GAME_MODES.PREP;
    updateHudValue(nodes.tokens, shopMode ? state.gold ?? 0 : prepMode ? (state.prep_slot?.card ? 1 : 0) : state.delete_tokens ?? 0);
    setText(nodes.resourceLabel, shopMode ? "金币" : prepMode ? "备料位" : "删牌标记");
    setText(nodes.resourceHint, shopMode ? "轮末消费" : prepMode ? (state.prep_slot?.card?.name ?? "空") : "轮末使用");
    const timerCell = get("#timerCell");
    const contractTiming = state.mode === GAME_MODES.CONTRACT_SHOP
      && ["Playing", "Scoring"].includes(state.phase);
    if (timerCell) timerCell.hidden = !contractTiming;
    setText(nodes.scoreLabel, live.playing ? "实时总分" : "总分");
    nodes.scoreDelta.hidden = !live.playing || contractTiming;
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
    if (nodes.ruleInfoButton) {
      nodes.ruleInfoButton.hidden = state.mode !== GAME_MODES.CONTRACT_SHOP;
      nodes.ruleInfoButton.onclick = () => openRuleStatus(state);
    }
    const postponeButton = get("#postponeButton");
    if (postponeButton) {
      const reshuffle = getReshuffleStatus(state);
      const currentCard = getCurrentCard(state);
      const postponeLimit = getPostponeLimit(state);
      const usedPostpones = currentCard ? state.round.postpone_counts?.[currentCard.uuid] ?? 0 : 0;
      const alreadyPostponed = usedPostpones >= postponeLimit;
      postponeButton.disabled = state.phase !== "Playing" || state.round.draw_pile.length < 2 || alreadyPostponed;
      postponeButton.title = alreadyPostponed
        ? "这张牌本轮已经达到后置次数上限"
        : `侧滑或点击：把当前牌移动到餐盘末尾；每张最多 ${postponeLimit} 次`;
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
            : postponeLimit > 1
              ? `双程传菜带 · 同一张牌最多后置 ${postponeLimit} 次`
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

  function renderUnlockProgress(host, progress = {}, unlocks = {}) {
    if (!host) return;
    const rows = [
      ["随机开局", unlocks.random_start, `${Math.min(progress.runs_played ?? 0, 1)}/1 局`],
      ["备料模式", unlocks.prep, `${Math.min(progress.runs_played ?? 0, 2)}/2 局`],
      ["商店模式", unlocks.shop, `${Math.min(progress.victories ?? 0, 1)}/1 次通关`],
      ["条约商店", unlocks.contract_shop, `${Math.min(progress.shop_victories ?? 0, 1)}/1 次商店通关`],
      ["无尽 / 高难", unlocks.endless && unlocks.hard, `${Math.min(progress.victories ?? 0, 1)}/1 次通关`],
      ["GOD 标记", unlocks.god, `${Math.min(progress.endless_victories ?? 0, 1)}/1 次无尽通关`],
    ];
    host.innerHTML = rows.map(([name, unlocked, value]) => `<span class="${unlocked ? "is-unlocked" : ""}"><b>${unlocked ? "✓" : "◇"} ${name}</b><small>${unlocked ? "已解锁" : value}</small></span>`).join("");
  }

  function renderHomeStatistics(statistics = {}) {
    const cards = createCardPool();
    const cardActions = statistics.card_actions ?? statistics.fruit_actions ?? {};
    const types = Object.values(CARD_TYPES);
    const overview = [
      ["通关次数", statistics.victories],
      ["游玩次数", statistics.runs_played],
      ["失败次数", statistics.defeats],
      ["吃牌次数", statistics.cards_eaten],
      ["弃牌次数", statistics.cards_discarded],
      ["最高得分", statistics.highest_score],
      ["最高金币", statistics.highest_gold],
      ["删除卡牌", statistics.cards_deleted],
      ["刷新次数", statistics.rerolls],
    ];
    const overviewHost = get("#homeStatisticsOverview");
    if (overviewHost) overviewHost.innerHTML = overview.map(([label, value]) => `<span><small>${label}</small><b>${formatScore(Number(value) || 0)}</b></span>`).join("");
    const tabs = get("#homeStatisticsTypeTabs");
    const select = get("#homeStatisticsTypeSelect");
    tabs.innerHTML = types.map((type) => `<button type="button" data-statistics-type="${type}" aria-pressed="false">${type}</button>`).join("");
    select.innerHTML = types.map((type) => `<option value="${type}">${type}</option>`).join("");
    const renderType = (type) => {
      const selectedType = types.includes(type) ? type : types[0];
      const typeCards = cards.filter((card) => card.type === selectedType);
      const totals = typeCards.reduce((sum, card) => ({
        eat: sum.eat + (Number(cardActions[card.id]?.eat) || 0),
        discard: sum.discard + (Number(cardActions[card.id]?.discard) || 0),
      }), { eat: 0, discard: 0 });
      setText(get("#homeCardStatisticsTitle"), `${selectedType}记录`);
      setText(get("#homeCardStatisticsTotal"), `吃 ${formatScore(totals.eat)} · 弃 ${formatScore(totals.discard)}`);
      select.value = selectedType;
      for (const button of tabs.querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.statisticsType === selectedType));
      const list = get("#homeCardStatisticsList");
      list.innerHTML = typeCards.map((card) => {
        const counts = cardActions[card.id] ?? { eat: 0, discard: 0 };
        return `<span data-card-id="${card.id}" data-card-type="${card.type}"><b>${card.name}</b><i>吃 <strong>${formatScore(Number(counts.eat) || 0)}</strong></i><i>弃 <strong>${formatScore(Number(counts.discard) || 0)}</strong></i></span>`;
      }).join("");
      list.scrollTop = 0;
    };
    for (const button of tabs.querySelectorAll("button")) button.onclick = () => renderType(button.dataset.statisticsType);
    select.onchange = () => renderType(select.value);
    renderType(types[0]);
  }

  return {
    preloadCardArt: warmCardArt,
    openWelcome(callbacks, options = {}) {
      renderHomeCardRain();
      applyHomeTheme(options.home_theme);
      applyHomeProgression(options.progression, options.god, options.unlocks);
      setText(get("#welcomeBestScore"), options.best_score ?? "--");
      renderHomeStatistics(options.statistics);
      const statisticsOverlay = get("#homeStatisticsOverlay");
      const closeStatistics = () => { statisticsOverlay.hidden = true; };
      get("#homeStatisticsButton").onclick = () => { statisticsOverlay.hidden = false; };
      get("#homeStatisticsClose").onclick = closeStatistics;
      statisticsOverlay.onclick = (event) => { if (event.target === statisticsOverlay) closeStatistics(); };
      const chooser = get("#modeChooser");
      const continueButton = get("#continueGameButton");
      continueButton.disabled = !options.has_save;
      continueButton.title = options.has_save ? "从最近一次自动保存继续" : "当前没有可继续的对局";
      get("#newGameButton").onclick = () => { chooser.hidden = !chooser.hidden; };
      continueButton.onclick = callbacks.onContinue;
      get("#homeMenuButton").onclick = callbacks.onMenu;
      get("#normalModeButton").onclick = () => callbacks.onNew(GAME_MODES.NORMAL);
      for (const [selector, mode, key] of [
        ["#prepModeButton", GAME_MODES.PREP, "prep"],
        ["#shopModeButton", GAME_MODES.SHOP, "shop"],
        ["#contractShopModeButton", GAME_MODES.CONTRACT_SHOP, "contract_shop"],
        ["#endlessModeButton", GAME_MODES.ENDLESS, "endless"],
        ["#hardModeButton", GAME_MODES.HARD, "hard"],
      ]) {
        const button = get(selector);
        const unlocked = Boolean(options.unlocks?.[key]);
        button.disabled = !unlocked;
        button.classList.toggle("is-locked", !unlocked);
        button.onclick = unlocked ? () => callbacks.onNew(mode) : null;
        if (unlocked) {
          const copy = {
            prep: "单格备料 · 存放一轮可永久移除",
            shop: "经济构筑 · 买牌、扩容与删牌",
            contract_shop: "合约经济 · 12 秒双档限时",
            endless: "突破 15 轮 · 百万分终点",
            hard: "小餐盘 · 更高阶段目标",
          }[key];
          if (copy) setText(button.querySelector("small"), copy);
        }
      }
      const randomToggle = get("#randomStartToggle");
      randomToggle.disabled = !options.unlocks?.random_start;
      randomToggle.checked = Boolean(options.random_start && options.unlocks?.random_start);
      randomToggle.onchange = () => callbacks.onRandomStart?.(randomToggle.checked);
      get("#randomStartHint").textContent = options.unlocks?.random_start ? "随机替换初始牌组中的两张牌 · 对所有模式生效" : "游玩 1 局后解锁";
      get("#godBadge").hidden = !options.god;
      get("#homeThemeToggle").onclick = () => {
        const nextTheme = nodes.welcome?.dataset.homeTheme === "day" ? "night" : "day";
        applyHomeTheme(nextTheme);
        callbacks.onHomeTheme?.(nextTheme);
      };
      get("#developerModeNotice").hidden = !options.developer_mode;
      nodes.welcome.classList.add("show");
    },
    hideWelcome() {
      get("#homeStatisticsOverlay").hidden = true;
      nodes.welcome.classList.remove("show");
      stopHomeCardRain();
    },
    hasBlockingOverlay() {
      return Boolean(root.querySelector(".overlay.show"));
    },
    setHomeTheme: applyHomeTheme,
    showStoryGuide,
    hideStoryGuide,
    renderHud,
    renderTimer(milliseconds) { setText(nodes.timer, `${(milliseconds / 1000).toFixed(1)}s`); },
    renderStack(cards, gesture, state = null) {
      nodes.stack.replaceChildren();
      const stacked = [...cards];
      stacked.forEach((card, index) => {
        const depth = stacked.length - 1 - index;
        const postponeCount = getCardPostponeCount(state, card);
        const postponeLimit = state ? getPostponeLimit(state) : 1;
        const markedPostponed = isCardPostponed(state, card);
        const fogged = Boolean(state.round.hidden_postponed_uuids?.includes(card.uuid));
        const node = cardElement(card, depth === 0, depth, fogged, postponeCount, postponeLimit, markedPostponed);
        const shuffleSide = depth % 2 === 0 ? -1 : 1;
        const shuffleRank = Math.floor(depth / 2);
        node.classList.toggle("is-stack-hidden", depth > 2);
        if (depth > 2) node.setAttribute("aria-hidden", "true");
        node.style.setProperty("--shuffle-x", `${shuffleSide * 42}%`);
        node.style.setProperty("--shuffle-cross", `${shuffleSide * -11}%`);
        node.style.setProperty("--shuffle-tilt", `${shuffleSide * 7.5}deg`);
        node.style.setProperty("--shuffle-counter-tilt", `${shuffleSide * -3.5}deg`);
        node.style.setProperty("--shuffle-rank-y", `${shuffleRank * 5 - 12}px`);
        node.style.setProperty("--shuffle-weave-y", `${-18 + (depth % 3) * 7}px`);
        node.style.setProperty("--shuffle-delay", `${180 + Math.min(depth, 12) * 28}ms`);
        nodes.stack.appendChild(node);
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
    openMenu(state, currentSettings, progression = {}, unlocks = {}) {
      menuState = state;
      menuSettings = currentSettings;
      menuOpenedFromHome = !state;
      setText(get("#menuModeLabel"), state ? MODE_LABELS[state.mode] : "主界面设置");
      if (state) {
        const milestone = getNextMilestone(state.current_round, state.milestone_delays, state.mode);
        const targetRoadmap = [5, 10, 15].map((round) => formatScore(getMilestoneTarget(round, state.mode))).join(" / ");
        setText(get("#menuObjective"), milestone.endless
          ? `首要目标：尽量获得高分 · 前 15 轮阶段目标 ${targetRoadmap} · 无尽第 ${state.current_round} 轮累计 ${formatScore(state.total_score)} 分`
          : `首要目标：尽量获得高分 · 第 5 / 10 / 15 轮累计目标 ${targetRoadmap} · 当前需在第 ${milestone.round} 轮达到 ${formatScore(milestone.target)} 分（已有 ${formatScore(state.total_score)}）`);
        const modeRules = {
          [GAME_MODES.PREP]: "备料模式：没有删牌标记。轮末可把一张牌放入备料位；它下一轮不登场，并保证候选中至少一张同类别牌。存放满一轮后可永久移除。",
          [GAME_MODES.SHOP]: "商店模式：轮末不进行免费卡牌/道具三选一，也不免费扩容；吃牌赚取金币，在商店中权衡买牌、扩容和删牌。",
          [GAME_MODES.CONTRACT_SHOP]: "条约商店：包含完整商店经济；每轮接取一条新条约，所有条约并行判定，未完成会跨轮保留；12 秒内清盘 +1 金币，8 秒内清盘 +2 金币。",
          [GAME_MODES.ENDLESS]: `无尽模式：道具可以重复获得；每 5 轮扩容并获得删牌标记，餐盘最多 ${GAME_CONFIG.endless_max_plate_capacity} 张；累计 1,000,000 分通关。`,
          [GAME_MODES.HARD]: "高难模式：初始餐盘少 1 格，第 5 / 10 / 15 轮目标提高 20%。",
          [GAME_MODES.NORMAL]: "标准模式：轮末免费选牌，每轮免费刷新一次；每 3 轮获得一次可跳过的道具选择。",
        };
        setText(get("#menuModeRules"), modeRules[state.mode] ?? "");
      } else {
        setText(get("#menuObjective"), "首要目标：尽量获得高分，并在阶段轮次达到累计目标；对局会在操作、选牌与轮次结算后自动保存。");
        setText(get("#menuModeRules"), "完成对局会推进模式解锁；失败也计入游玩局数。所有模式的通关都计入通用通关进度。");
      }
      get("#menuHomeButton").hidden = !state;
      get("#tutorialInfoButton").hidden = !state;
      get("#gameMenuClose").textContent = state ? "返回游戏" : "返回主界面";
      this.renderSettings(currentSettings);
      renderUnlockProgress(get("#unlockProgressList"), progression, unlocks);
      if (state) suspendStoryForMenu();
      nodes.cardCatalog?.classList.remove("show");
      closeCatalogCardDetail();
      nodes.gameMenu?.classList.add("show");
    },
    bindMenu({ onMusic, onEffects, onFontSize, onSummaryPause, onSummarySpeed, onSummarySkip, onHome }) {
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
      get("#summaryPauseToggle")?.addEventListener("click", () => onSummaryPause(get("#summaryPauseToggle")?.getAttribute("aria-pressed") !== "true"));
      root.querySelectorAll("[data-summary-speed]").forEach((button) => {
        button.addEventListener("click", () => onSummarySpeed(button.dataset.summarySpeed));
      });
      get("#summarySkipToggle")?.addEventListener("click", () => onSummarySkip(get("#summarySkipToggle")?.getAttribute("aria-pressed") !== "true"));
      get("#cardCatalogButton")?.addEventListener("click", () => {
        nodes.gameMenu?.classList.remove("show");
        const filter = get("#catalogTypeFilter");
        const allCards = createCardPool();
        const types = [...new Set(allCards.map((card) => card.type))].sort((a, b) => a.localeCompare(b, "zh-CN"));
        const selectedType = filter.value;
        filter.innerHTML = '<option value="all">全部类别</option>' + types.map((type) => `<option value="${type}">${type}</option>`).join("");
        filter.value = types.includes(selectedType) ? selectedType : "all";
        filter.onchange = renderCatalogList;
        syncCatalogModeControls();
        renderCatalogList();
        nodes.cardCatalog?.classList.add("show");
      });
      root.querySelectorAll("[data-catalog-mode]").forEach((button) => {
        button.addEventListener("click", () => setCatalogMode(button.dataset.catalogMode));
      });
      get("#cardCatalogClose")?.addEventListener("click", () => {
        if (menuState) setText(get("#menuModeLabel"), MODE_LABELS[menuState.mode]);
        closeCatalogToMenu();
      });
      get("#catalogCardDetailClose")?.addEventListener("click", closeCatalogCardDetail);
      nodes.catalogCardDetail?.addEventListener("click", (event) => {
        if (event.target === nodes.catalogCardDetail) closeCatalogCardDetail();
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
        const label = button?.querySelector("[data-setting-state], :scope > b");
        if (label) label.textContent = enabled ? "开启" : "关闭";
      };
      updateToggle("#musicToggle", currentSettings.music !== false);
      updateToggle("#effectsToggle", currentSettings.effects !== false);
      updateToggle("#summaryPauseToggle", currentSettings.summary_pause === true);
      updateToggle("#summarySkipToggle", currentSettings.summary_skip === true);
      root.querySelectorAll("[data-font-size]").forEach((button) => {
        button.classList.toggle("is-selected", button.dataset.fontSize === currentSettings.font_size);
        button.setAttribute("aria-pressed", String(button.dataset.fontSize === currentSettings.font_size));
      });
      root.querySelectorAll("[data-summary-speed]").forEach((button) => {
        const selected = button.dataset.summarySpeed === (currentSettings.summary_speed === "fast" ? "fast" : "normal");
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", String(selected));
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
      setText(get("#draftTargetProgress"), `当前 ${formatScore(state.total_score)} · 还差 ${formatScore(scoreNeeded)} · 剩余 ${roundsRemaining} 轮 · 已有 ${state.active_rules.length} 条并行条约`);
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
      const inventory = get(".inventory-bar");
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
      layer.setAttribute("aria-label", `${cardCount} 张牌洗牌并落入餐盘`);
      stage.classList.remove("is-dealing");
      stack.classList.remove("is-shuffle-dealing");
      inventory?.classList.add("is-hidden-for-deal");
      cards.forEach((card) => {
        card.classList.add("is-deal-covered");
        card.dataset.dealInstance = "true";
      });
      void stack.offsetWidth;
      host.appendChild(layer);
      stage.classList.add("is-dealing");
      stack.classList.add("is-shuffle-dealing");
      const duration = 1780;
      const landingTimer = window.setTimeout(() => layer.classList.add("is-stacking"), 1320);
      window.setTimeout(() => {
        if (landingTimer !== null) window.clearTimeout(landingTimer);
        stage.classList.remove("is-dealing");
        inventory?.classList.remove("is-hidden-for-deal");
        stack.classList.remove("is-shuffle-dealing");
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
    showRoundSummary(result, state, outcome, onConfirm, options = {}) {
      const runId = ++summaryPresentationRun;
      summaryAdvance = null;
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

      list.replaceChildren();
      const unlockPanel = get("#summaryUnlockProgress");
      if (outcome && state.unlock_progress) {
        const progress = state.unlock_progress;
        renderUnlockProgress(get("#summaryUnlockProgressList"), progress, {
          random_start: progress.runs_played >= 1,
          prep: progress.runs_played >= 2,
          shop: progress.victories >= 1,
          contract_shop: progress.shop_victories >= 1,
          endless: progress.victories >= 1,
          hard: progress.victories >= 1,
          god: Boolean(progress.god),
        });
        unlockPanel.hidden = false;
      } else if (unlockPanel) unlockPanel.hidden = true;
      if (outcome === "victory") {
        eyebrow.textContent = state.mode === GAME_MODES.ENDLESS ? "ONE MILLION COMPLETE" : "15 ROUNDS COMPLETE";
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
          result.reroll_grant ? `刷新标记增至 ${state.reroll_tokens}` : null,
        ].filter(Boolean);
        const nextLabel = isShopMode(state.mode) ? "进入商店" : "选择一张牌";
        tip.textContent = gifts.length > 0
          ? `${gifts.join("，")}。接下来${nextLabel}。`
          : isShopMode(state.mode) ? "结算金币后进入商店，在买牌、扩容与删牌之间取舍。" : "接下来从三张牌中选择一张加入永久牌组，也可以刷新或跳过。";
        button.textContent = `确认结算 · ${nextLabel}`;
        button.classList.remove("danger-action");
      }
      button.hidden = true;
      button.disabled = true;
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
      nodes.summary.dataset.presentationState = "starting";
      nodes.summary.dataset.heat = "0";
      nodes.summary.classList.add("show");

      void playRoundSummaryPresentation(result, state, options, runId).catch(() => {
        if (runId !== summaryPresentationRun) return;
        get("#summaryPerformance").hidden = true;
        get("#summaryReceiptStage").hidden = false;
        list.innerHTML = result.breakdown.map((item) => `<div class="receipt-line ${item.kind ?? ""} is-visible"><span>${item.label}</span><b>${item.text}</b></div>`).join("");
        const grade = getRoundGrade(result.round_score);
        setText(get("#summaryReceiptScore"), `${result.round_score >= 0 ? "+" : ""}${formatScore(result.round_score)}`);
        setText(get("#summaryGradeValue"), grade.grade);
        setText(get("#summaryGradeLabel"), grade.label);
        const gradeStage = get("#summaryGradeStage");
        const gradeStamp = get("#summaryGradeStamp");
        gradeStamp.dataset.grade = grade.tone;
        gradeStage.hidden = false;
        gradeStage.classList.remove("is-stamping");
        gradeStage.classList.add("is-settled");
        gradeStamp.dataset.phase = "settled";
        nodes.summary.dataset.presentationState = "ready";
        button.hidden = false;
        button.disabled = false;
        get("#summaryReceiptSkip").hidden = true;
        summaryAdvance = null;
      });
    },
    hideRoundSummary() {
      summaryPresentationRun += 1;
      summaryAdvance?.();
      summaryAdvance = null;
      nodes.summary.classList.remove("show");
      nodes.summary.dataset.presentationState = "idle";
      nodes.summary.dataset.heat = "0";
    },
    openCardDraft(state, cards, callbacks) {
      renderHud(state);
      const prepMode = state.mode === GAME_MODES.PREP;
      const updateTokens = () => {
        setText(get("#draftResourceLabel"), prepMode ? "备料位" : "删牌标记");
        setText(get("#draftTokenValue"), prepMode ? (state.prep_slot?.card ? "1/1" : "0/1") : state.delete_tokens ?? 0);
        updateHudValue(nodes.tokens, prepMode ? (state.prep_slot?.card ? 1 : 0) : state.delete_tokens ?? 0);
      };
      const updatePrepPreview = () => {
        const host = get("#prepSlotPreview");
        if (!host) return;
        host.hidden = !prepMode;
        if (!prepMode) return;
        const slot = state.prep_slot;
        if (!slot?.card) {
          host.innerHTML = "<b>备料位为空</b><span>整理牌组时可放入一张牌；下一轮不会登场，并保证三选一中出现同类别牌。</span>";
          return;
        }
        const ready = state.current_round >= (slot.ready_round ?? Infinity);
        host.innerHTML = `<span class="game-sprite" style="${spriteStyle(slot.card)}"></span><span><b>${slot.card.name}</b><small>${ready ? "已可永久移除" : "存放满一轮后可永久移除"}</small></span><button type="button" data-prep="retrieve">取回</button><button type="button" data-prep="remove" ${ready ? "" : "disabled"}>移除</button>`;
        host.querySelector('[data-prep="retrieve"]').onclick = () => { const result = callbacks.onPrepRetrieve(); if (result?.success) { updateTokens(); updatePrepPreview(); } };
        host.querySelector('[data-prep="remove"]').onclick = () => { const result = callbacks.onPrepRemove(); if (result?.success) { updateTokens(); updatePrepPreview(); } };
      };
      deckRemovalHandler = {
        remove: (cardUuid) => {
          const result = callbacks.onRemove(cardUuid);
          updateTokens();
          if (result?.success) setText(get("#draftMessage"), `已删除「${result.card.name}」。还剩 ${result.tokens} 枚删牌标记。`);
          return result;
        },
        store: (cardUuid) => { const result = callbacks.onPrepStore(cardUuid); updateTokens(); updatePrepPreview(); return result; },
        retrieve: () => { const result = callbacks.onPrepRetrieve(); updateTokens(); updatePrepPreview(); return result; },
        removePrep: () => { const result = callbacks.onPrepRemove(); updateTokens(); updatePrepPreview(); return result; },
      };
      nodes.cardDraftList.replaceChildren(...cards.map((card) => draftCardElement(card, callbacks.onChoose)));
      setText(get("#draftMessage"), prepMode
        ? "整理牌组可调整唯一备料位；备料牌下一轮不会登场。"
        : "");
      updateTokens();
      updatePrepPreview();
      setText(get("#draftRerollValue"), state.reroll_tokens ?? 0);
      get("#draftManageDeck").onclick = () => openDeckStatus(state);
      const reroll = get("#draftReroll");
      reroll.disabled = (state.free_rerolls ?? 0) < 1 && (state.reroll_tokens ?? 0) < 1;
      reroll.textContent = (state.free_rerolls ?? 0) > 0
        ? `免费刷新 · ${state.free_rerolls}`
        : `刷新 · ${state.reroll_tokens ?? 0} 枚标记`;
      reroll.onclick = () => {
        const result = callbacks.onReroll();
        if (!result?.success) setText(get("#draftMessage"), "本轮免费刷新已使用，且没有刷新标记。");
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
    openItemDraft(state, items, onChoose, onSkip) {
      renderHud(state);
      setText(get("#itemDraftRound"), `第 ${state.current_round} 轮赠礼`);
      nodes.itemDraftList.replaceChildren(...items.map((entry) => itemDraftElement(entry, onChoose)));
      get("#itemDraftSkip").onclick = onSkip;
      nodes.itemDraft?.classList.add("show");
    },
    closeItemDraft() { nodes.itemDraft?.classList.remove("show"); },
    openItemCardChoice(item, cards, onChoose) {
      setText(get("#itemCardChoiceEyebrow"), `${item.rarity} · ${item.name}`);
      setText(get("#itemCardChoiceTitle"), `选择一张${item.effect.card_type}牌`);
      setText(get("#itemCardChoiceLead"), `${item.name}会立即消耗；选中的卡牌永久加入牌组。`);
      nodes.itemCardChoiceList?.replaceChildren(...cards.map((card) => draftCardElement(card, onChoose)));
      nodes.itemCardChoice?.classList.add("show");
    },
    closeItemCardChoice() { nodes.itemCardChoice?.classList.remove("show"); },
    openItemCategoryChoice(item, types, onChoose) {
      setText(get("#itemCategoryChoiceTitle"), `${item.name}：选择强化类别`);
      setText(get("#itemCategoryChoiceLead"), `下一轮所选类别的每张牌结算时额外 +${item.effect.bonus ?? 4} 分，随后道具自毁。`);
      nodes.itemCategoryChoiceList?.replaceChildren(...types.map((type) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "item-category-button";
        button.innerHTML = `<b>${type}</b><span>下一轮每张 +${item.effect.bonus ?? 4}</span>`;
        button.addEventListener("click", () => onChoose(type), { once: true });
        return button;
      }));
      nodes.itemCategoryChoice?.classList.add("show");
    },
    closeItemCategoryChoice() { nodes.itemCategoryChoice?.classList.remove("show"); },
    openShop(state, cards, themedCards, themeType, itemOffers, onBuy, onBuyItem, onRemove, onPlateUpgrade, onReroll, onLock, onContinue, plateUpgradeStatus, arrivedWithLockedShop = false) {
      renderHud(state);
      const removeCardCost = (state.round.shop_free_removals ?? 0) > 0 || (state.free_card_removals ?? 0) > 0
        ? 0
        : state.remove_card_cost;
      setText(get("#shopGold"), state.gold ?? 0);
      setText(get("#shopDeleteCost"), removeCardCost === 0 ? "免费" : `$${removeCardCost}`);
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
        : `当前 ${state.plate_capacity} 张 → ${state.plate_capacity + 1} 张${plateUpgradeStatus.discount > 0 ? ` · 优惠 -${plateUpgradeStatus.discount}` : ""}`;
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
      setText(get("#shopMessage"), "");
      nodes.shop.classList.remove("show");
    },
    setShopMessage(message, tone = "normal") {
      const node = get("#shopMessage");
      setText(node, message);
      node.dataset.tone = tone;
    },
    openShopTutorial(mode, onContinue) {
      setText(get("#shopTutorialTitle"), mode === GAME_MODES.CONTRACT_SHOP ? "条约商店模式教学" : "商店模式教学");
      setText(get("#shopTutorialGoldBonus"), mode === GAME_MODES.CONTRACT_SHOP
        ? "经济卡与道具可追加金币；每轮可接取一条新条约，未完成的条约会保留并与新条约共同判定。12 秒内清空餐盘 +1 金币，8 秒内清空 +2 金币。"
        : "带有“金币”说明的经济卡与道具可以追加收入；卡牌图鉴可切换查看商店效果。");
      get("#shopTutorialContinue").onclick = () => {
        get("#shopTutorial")?.classList.remove("show");
        onContinue();
      };
      get("#shopTutorial")?.classList.add("show");
    },
  };
}
