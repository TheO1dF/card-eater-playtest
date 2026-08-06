import { createCardPool } from "./data.js";
import { createItemCatalogPool } from "./items.js";
import { MODE_LABELS, STANDARD_DIFFICULTY_STEPS } from "./config.js";
import { MUTATION_LIBRARY } from "./mutations.js";
import { RULE_LIBRARY } from "./rules.js";
import { QUEST_LIBRARY } from "./quests.js";
import { KEYWORD_LIBRARY } from "./keywords.js";
import {
  CARD_EN,
  COMMON_EN,
  DIFFICULTY_EN,
  ITEM_EN,
  KEYWORD_EN,
  MODE_EN,
  MUTATION_EN,
  PHRASE_EN,
  QUEST_EN,
  RULE_EN,
} from "./i18n-content.js";

export const LANGUAGES = Object.freeze({ ZH: "zh", EN: "en" });

// Han characters, used to tell a fully translated string from a half-translated one.
const HAS_CHINESE = /[㐀-鿿]/u;

// The markup and every game string are authored in Chinese, so "zh" is the
// source locale: translation is a no-op until setLocale switches it. The
// player-facing default comes from getDefaultLanguage() in platform.js and is
// applied by main.js at boot.
let locale = LANGUAGES.ZH;
let observer = null;
const exactEnglish = new Map(Object.entries(COMMON_EN));
const phraseEnglish = [];
const textRecords = new WeakMap();
const attributeRecords = new WeakMap();

function addExact(source, translated) {
  if (typeof source === "string" && source && typeof translated === "string" && translated) {
    exactEnglish.set(source.trim(), translated);
  }
}

function registerGameCopy() {
  const standardCards = createCardPool();
  const economyCards = createCardPool({ economy: true });
  for (const card of standardCards) {
    const translated = CARD_EN[card.id];
    if (!translated) continue;
    addExact(card.name, translated[0]);
    addExact(card.flavor, translated[2]);
    addExact(card.effect?.description, translated[1]);
    addExact(card.effect?.description?.replace(/【[^】]+】\s*/gu, "").trim(), translated[1]);
  }
  for (const card of economyCards) {
    const translated = CARD_EN[card.id];
    if (!translated) continue;
    addExact(card.name, translated[4] || translated[0]);
    addExact(card.flavor, translated[2]);
    addExact(card.effect?.description, translated[3] || translated[1]);
    addExact(card.effect?.description?.replace(/【[^】]+】\s*/gu, "").trim(), translated[3] || translated[1]);
  }
  for (const item of createItemCatalogPool()) {
    const translated = ITEM_EN[item.id];
    if (!translated) continue;
    addExact(item.name, translated[0]);
    addExact(item.role, translated[1]);
    addExact(item.description, translated[2]);
  }
  for (const [mode, label] of Object.entries(MODE_LABELS)) addExact(label, MODE_EN[mode]);
  for (const entry of STANDARD_DIFFICULTY_STEPS) {
    addExact(entry.name, DIFFICULTY_EN[entry.level]?.[0]);
    addExact(entry.description, DIFFICULTY_EN[entry.level]?.[1]);
  }
  for (const entry of MUTATION_LIBRARY) {
    addExact(entry.name, MUTATION_EN[entry.id]?.[0]);
    addExact(entry.description, MUTATION_EN[entry.id]?.[1]);
    addExact(`${entry.icon} ${entry.name}`, MUTATION_EN[entry.id]?.[0]);
  }
  for (const entry of RULE_LIBRARY) {
    addExact(entry.name, RULE_EN[entry.id]?.[0]);
    addExact(entry.description, RULE_EN[entry.id]?.[1]);
  }
  for (const entry of QUEST_LIBRARY) {
    const translated = QUEST_EN[entry.id];
    if (!translated) continue;
    addExact(entry.name, translated[0]);
    addExact(entry.risk, translated[1]);
    addExact(entry.penalty?.description, translated[2]);
    addExact(entry.condition?.description, translated[3]);
  }
  for (const [keyword, description] of Object.entries(KEYWORD_LIBRARY)) {
    addExact(description, KEYWORD_EN[keyword]);
  }

  const entityNames = [
    ...standardCards.map((card) => [card.name, CARD_EN[card.id]?.[0]]),
    ...economyCards.map((card) => [card.name, CARD_EN[card.id]?.[4] || CARD_EN[card.id]?.[0]]),
    ...createItemCatalogPool().map((item) => [item.name, ITEM_EN[item.id]?.[0]]),
    ...Object.entries(MODE_LABELS).map(([mode, label]) => [label, MODE_EN[mode]]),
    ...MUTATION_LIBRARY.map((entry) => [entry.name, MUTATION_EN[entry.id]?.[0]]),
    ...QUEST_LIBRARY.map((entry) => [entry.name, QUEST_EN[entry.id]?.[0]]),
  ].filter(([, translated]) => translated);
  phraseEnglish.push(...entityNames);
  phraseEnglish.push(...Object.entries(COMMON_EN));
  phraseEnglish.push(...PHRASE_EN);
  phraseEnglish.sort((a, b) => b[0].length - a[0].length);
}

registerGameCopy();

const dynamicEnglish = Object.freeze([
  // Tutorial copy. These are built from templates in main.js/ui.js, so they can
  // only be matched by shape once rendered.
  [/^教学\s*(\d+)\/(\d+)$/u, (_, current, total) => `Tutorial ${current}/${total}`],
  [/^第\s*5\s*轮\s*([\d,]+)\s*分，第\s*10\s*轮\s*([\d,]+)\s*分，第\s*15\s*轮\s*([\d,]+)\s*分。$/u,
    (_, first, second, third) => `Round 5: ${first}. Round 10: ${second}. Round 15: ${third}.`],
  [/^任一门槛没达到，本局结束。现在先盯住：第\s*(\d+)\s*轮\s*([\d,]+)\s*分。$/u,
    (_, round, target) => `Miss any threshold and the run ends. For now, focus on Round ${round}: ${target}.`],
  [/^「(.+)」可以吃。向下拖动它。$/u, (_, card) => `“${translateCore(card)}” is edible. Drag it down.`],
  [/^「(.+)」不能吃。向上拖动它。$/u, (_, card) => `“${translateCore(card)}” is inedible. Drag it up.`],
  [/^「(.+)」不能吃。先左右拖动，把它后置。$/u,
    (_, card) => `“${translateCore(card)}” is inedible. Drag sideways to postpone it.`],
  [/^右下角“吃\s*([+−-]?\d+)”是这张牌的基础吃分。$/u,
    (_, value) => `“Eat ${value}” at the lower right is this card's base eat score.`],
  [/^左下角“弃\s*([+−-]?\d+)”是这张牌的基础弃分。$/u,
    (_, value) => `“Discard ${value}” at the lower left is this card's base discard score.`],
  [/^第\s*(\d+)\s*轮赠礼$/u, (_, round) => `Round ${round} Gift`],
  // Card gallery and item catalog labels.
  [/^(.+)，吃牌\s*([+−-]?\d+)\s*分，弃牌\s*([+−-]?\d+)\s*分$/u,
    (_, card, eat, discard) => `${translateCore(card)}, eat ${eat} score, discard ${discard} score`],
  [/^商店中可能出售$/u, () => `Sold in the shop`],
  [/^第\s*(\d+)\s*轮起可能出售$/u, (_, round) => `Sold from Round ${round}`],
  [/^第\s*(\d+)\s*轮起至第\s*(\d+)\s*轮可能出售$/u, (_, from, to) => `Sold from Round ${from} to Round ${to}`],
  [/^基础价格\s*(\d+)\s*金币$/u, (_, price) => `Base price ${price} Gold`],
  [/^基础价格\s*随稀有度\s*金币$/u, () => `Base price varies by rarity`],
  [/^第\s*(\d+)\s*轮起至第\s*(\d+)\s*轮$/u, (_, from, to) => `Round ${from} to Round ${to}`],
  [/^第\s*(\d+)\s*轮起$/u, (_, round) => `From Round ${round}`],
  [/^(.+)(任务|合约)$/u, (_, tier, kind) => `${translateCore(tier)} ${kind === "任务" ? "Quest" : "Contract"}`],
  [/^(.+)：本轮可连续获得两张新牌。$/u, (_, name) => `${translateCore(name)}: draw two new cards in a row this round.`],
  // Draft, fusion, shop and plate feedback built from templates in main.js/ui.js.
  [/^融合完成\s*[·・]\s*「(.+)」加入牌组$/u, (_, card) => `Fusion complete · “${translateCore(card)}” joins your deck`],
  [/^已选择「(.+)」\s*[·・]\s*再选一张完成融合$/u, (_, card) => `Selected “${translateCore(card)}” · Choose one more to fuse`],
  [/^「(.+)」加入牌组$/u, (_, card) => `“${translateCore(card)}” joins your deck`],
  [/^购入「(.+)」，已加入永久牌组。$/u, (_, card) => `Bought “${translateCore(card)}” — added to your permanent deck.`],
  [/^购入道具「(.+)」。$/u, (_, item) => `Bought item “${translateCore(item)}”.`],
  [/^末牌「(.+)」立即登场$/u, (_, card) => `Last card “${translateCore(card)}” enters play immediately`],
  [/^后置「(.+)」$/u, (_, card) => `Postponed “${translateCore(card)}”`],
  [/^餐盘上限提升至\s*(\d+)。$/u, (_, value) => `Plate capacity raised to ${value}.`],
  [/^金币不足，刷新需要\s*(\d+)。$/u, (_, cost) => `Not enough Gold — a reroll costs ${cost}.`],
  [/^支付\s*(\d+)\s*金币刷新。$/u, (_, cost) => `Paid ${cost} Gold to reroll.`],
  [/^理牌托盘：后置\s*\+1（剩余\s*(\d+)\s*次）$/u, (_, left) => `Sorting Tray: Postpone +1 (${left} left)`],
  [/^自动重洗\s*(\d+)\s*次\s*[·・]\s*后置标记不会清除$/u, (_, count) => `Auto Reshuffle ×${count} · Postpone marks are kept`],
  [/^确认消耗\s*1\s*枚删牌标记删除「(.+)」？此操作不可撤销。$/u,
    (_, card) => `Spend 1 Remove Token to delete “${translateCore(card)}”? This cannot be undone.`],
  [/^(免费|支付\s*\d+\s*金币)删除「(.+)」？此操作不可撤销。$/u,
    (_, cost, card) => `${translateCore(cost)} to delete “${translateCore(card)}”? This cannot be undone.`],
  [/^(\d+)\s*张牌洗牌并落入餐盘$/u, (_, count) => `${count} cards shuffled onto the plate`],
  [/^通关难度\s*(\d+)\s*解锁$/u, (_, level) => `Unlocked by clearing Difficulty ${level}`],
  [/^(\d+)\/(\d+)\s*局$/u, (_, done, total) => `${done}/${total} runs`],
  [/^(\d+)\/(\d+)\s*次通关$/u, (_, done, total) => `${done}/${total} clears`],
  [/^(\d+)\/(\d+)\s*次商店通关$/u, (_, done, total) => `${done}/${total} Shop clears`],
  [/^(\d+)\/(\d+)\s*次无尽通关$/u, (_, done, total) => `${done}/${total} Endless clears`],
  [/^(.+)记录$/u, (_, type) => `${translateCore(type)} Records`],
  [/^查看(.+)完整卡牌：(.+)$/u, (_, card, detail) => `View the full card for ${translateCore(card)}: ${translateCore(detail)}`],
  [/^查看道具(.+)：(.+)$/u, (_, item, detail) => `View item ${translateCore(item)}: ${translateCore(detail)}`],
  [/^查看道具（(\d+)\s*件）$/u, (_, count) => `View items (${count})`],
  [/^(.+)，(吃牌|弃牌|后置)，加(\d+)分$/u, (_, card, action, value) => `${translateCore(card)}, ${translateCore(action)}, +${value} score`],
  [/^(.+)，(吃牌|弃牌|后置)，减(\d+)分$/u, (_, card, action, value) => `${translateCore(card)}, ${translateCore(action)}, -${value} score`],
  [/^▲(\d+)\s*[·・]\s*原\s*(\d+)$/u, (_, now, before) => `▲${now} · was ${before}`],
  [/^▼(\d+)\s*[·・]\s*原\s*(\d+)$/u, (_, now, before) => `▼${now} · was ${before}`],
  [/^当前\s*([\d,]+)\s*分\s*[·・]\s*继续构筑直到你主动离开$/u,
    (_, score) => `Currently ${score} · Keep building until you choose to leave`],
  [/^首要目标：尽量获得高分\s*[·・]\s*前 15 轮阶段目标\s*(.+)\s*[·・]\s*无尽第\s*(\d+)\s*轮累计\s*([\d,]+)\s*分$/u,
    (_, targets, round, score) => `Main goal: score as high as possible · Round 1-15 targets: ${targets} · Endless Round ${round} total: ${score}`],
  [/^第\s*(\d+)\s*轮$/u, (_, round) => `Round ${round}`],
  [/^轮次\s*(\d+)\/(\d+)$/u, (_, round, total) => `Round ${round}/${total}`],
  [/^已解锁\s*(\d+)\s*\/\s*(\d+)$/u, (_, unlocked, total) => `Unlocked ${unlocked} / ${total}`],
  [/^最高可挑战\s*[·・]\s*难度\s*(\d+)$/u, (_, level) => `Highest Available · Difficulty ${level}`],
  [/^先通关\s*(\d+)$/u, (_, level) => `Clear Difficulty ${level} first`],
  [/^(\d+)\s*张卡牌$/u, (_, count) => `${count} cards`],
  [/^(\d+)\s*张$/u, (_, count) => `${count} cards`],
  [/^(\d+)\s*件道具$/u, (_, count) => `${count} items`],
  [/^本轮\s*([+−-]?\d+)$/u, (_, score) => `Round ${score}`],
  [/^本轮已后置\s*(\d+)\/(\d+)\s*次$/u, (_, used, limit) => `Postponed ${used}/${limit} this round`],
  [/^本轮已后置\s*(\d+)\s*次，可继续后置$/u, (_, used) => `Postponed ${used} times this round · No limit`],
  [/^本轮已后置\s*(\d+)\s*次\s*[·・]\s*每张最多\s*(\d+)\s*次$/u, (_, used, limit) => `Postponed ${used} this round · Max ${limit} per card`],
  [/^双程传菜带\s*[·・]\s*同一张牌最多后置\s*(\d+)\s*次$/u, (_, limit) => `Two-Way Serving Belt · Max ${limit} postpones per card`],
  [/^当前牌已后置\s*(\d+)\/(\d+)\s*次$/u, (_, used, limit) => `Current card postponed ${used}/${limit}`],
  [/^侧滑或点击：把当前牌移动到餐盘末尾；每张最多\s*(\d+)\s*次$/u, (_, limit) => `Swipe sideways or tap to move this card to the end · Max ${limit} per card`],
  [/^「(.+)」本轮已达到后置次数上限$/u, (_, card) => `“${translateCore(card)}” has reached its postpone limit this round`],
  [/^(.+)\s*[·・]\s*难度\s*(\d+)$/u, (_, mode, level) => `${translateCore(mode)} · Difficulty ${level}`],
  [/^首要目标：尽量获得高分\s*[·・]\s*第 5 \/ 10 \/ 15 轮累计目标\s*([\d,]+) \/ ([\d,]+) \/ ([\d,]+)\s*[·・]\s*当前需在第\s*(\d+)\s*轮达到\s*([\d,]+)\s*分（已有\s*([\d,]+)）$/u,
    (_, first, second, third, round, target, score) => `Main goal: score as high as possible · Round 5 / 10 / 15 targets: ${first} / ${second} / ${third} · Reach ${target} total by Round ${round} (currently ${score})`],
  [/^标准模式\s*[·・]\s*难度\s*(\d+)：限制逐层累计。本层为“(.+)”——(.+)$/u,
    (_, level, name, description) => `Standard Mode · Difficulty ${level}: modifiers stack. Current level: “${translateCore(name)}” — ${translateCore(description)}`],
  [/^累计\s*([\d,]+)\s*\/\s*目标\s*([\d,]+)\s*分$/u, (_, score, target) => `Total ${score} / Target ${target}`],
  [/^距离第\s*(\d+)\s*轮目标还有\s*(\d+)\s*轮$/u, (_, milestone, rounds) => `${rounds} rounds until the Round ${milestone} milestone`],
  [/^第\s*(\d+)\s*轮累计达到\s*([\d,]+)\s*分$/u, (_, round, target) => `Reach ${target} total score by Round ${round}`],
  [/^当前\s*([\d,]+)\s*分$/u, (_, score) => `Current: ${score}`],
  [/^刷新\s*[·・]\s*(\d+)$/u, (_, count) => `Reroll · ${count}`],
  [/^免费\s*(\d+)\s*[·・]\s*标记\s*(\d+)$/u, (_, free, tokens) => `Free ${free} · Tokens ${tokens}`],
  [/^删牌费用\s*(\d+)$/u, (_, cost) => `Removal cost ${cost}`],
  [/^吃\s*([+−-]?\d+)\s*\/\s*弃\s*([+−-]?\d+)$/u, (_, eat, discard) => `Eat ${eat} / Discard ${discard}`],
  [/^吃\s*([+−-]?\d+)$/u, (_, value) => `Eat ${value}`],
  [/^弃\s*([+−-]?\d+)$/u, (_, value) => `Discard ${value}`],
  [/^([+−-]?\d+)\s*分$/u, (_, value) => `${value} score`],
  [/^([+−-]?\d+)\s*金币$/u, (_, value) => `${value} Gold`],
  [/^↳\s*(.+)$/u, (_, label) => `↳ ${translateCore(label)}`],
  [/^餐盘上限永久\s*\+1\s*[·・]\s*当前\s*(\d+)$/u, (_, value) => `Plate capacity permanently +1 · Now ${value}`],
  [/^删牌标记\s*\+1\s*[·・]\s*当前\s*(\d+)$/u, (_, value) => `Remove Token +1 · Now ${value}`],
  [/^自动重洗\s*[·・]\s*(\d+)\s*张牌回到餐盘$/u, (_, count) => `Auto Reshuffle · ${count} cards returned to the plate`],
  [/^(.+)：水果连击\s*×([\d.]+)$/u, (_, card, combo) => `${translateCore(card)}: Fruit Combo ×${combo}`],
  [/^(.+)：金币\s*\+([\d.]+)$/u, (_, item, amount) => `${translateCore(item)}: Gold +${amount}`],
  [/^(.+)：商店免费刷新\s*\+([\d.]+)$/u, (_, item, amount) => `${translateCore(item)}: Free Shop Reroll +${amount}`],
  [/^(.+)：刷新标记\s*\+([\d.]+)$/u, (_, item, amount) => `${translateCore(item)}: Reroll Token +${amount}`],
  [/^(.+)：删牌标记\s*\+([\d.]+)$/u, (_, item, amount) => `${translateCore(item)}: Remove Token +${amount}`],
  [/^(.+)：(.+)(吃分|弃分)永久\s*\+([\d.]+)$/u, (_, item, card, stat, amount) => `${translateCore(item)}: ${translateCore(card)} permanently gains +${amount} ${stat === "吃分" ? "Eat" : "Discard"}`],
  [/^(.+)：牌堆顶插入沼气火\s*×(\d+)$/u, (_, item, count) => `${translateCore(item)}: Insert ${count} Biogas Flame card${count === "1" ? "" : "s"} on top of the pile`],
  [/^(.+)：(.+)吃分永久\s*\+([\d.]+)$/u, (_, item, card, amount) => `${translateCore(item)}: ${translateCore(card)} permanently gains +${amount} Eat`],
  [/^(.+)：最高错误食性连击\s*(\d+)，\+([\d.]+)$/u, (_, item, combo, amount) => `${translateCore(item)}: Best Wrong Edibility streak ${combo}, +${amount}`],
  [/^(.+)：(\d+)\s*种类别，\+([\d.]+)$/u, (_, item, count, amount) => `${translateCore(item)}: ${count} categories, +${amount}`],
  [/^(.+)：「(.+)」冷藏一轮，返回时吃分\s*\+([\d.]+)$/u, (_, item, card, amount) => `${translateCore(item)}: Chill “${translateCore(card)}” for one round; it returns with +${amount} Eat`],
  [/^(.+)：吃、弃、后置齐全，\+([\d.]+)$/u, (_, item, amount) => `${translateCore(item)}: Eat, Discard, and Postpone completed, +${amount}`],
  [/^(.+)：(.+)变成兔子$/u, (_, item, card) => `${translateCore(item)}: ${translateCore(card)} became Rabbit`],
  [/^(.+)：(.+)专场结束，道具自毁$/u, (_, item, type) => `${translateCore(item)}: ${translateCore(type)} event ended; item consumed`],
  [/^(.+)：保护「(.+)」，本次不被摧毁$/u, (_, item, card) => `${translateCore(item)}: protected “${translateCore(card)}” from this destruction`],
  [/^(.+)：额外生成临时「(.+)」$/u, (_, item, card) => `${translateCore(item)}: generated an extra temporary “${translateCore(card)}”`],
  [/^冷藏周转箱：「(.+)」返回，吃分永久\s*\+([\d.]+)$/u, (_, card, amount) => `Refrigerated Turnover Crate: “${translateCore(card)}” returned with permanent Eat +${amount}`],
  [/^半熟果盘：水果连击从\s*(\d+)\s*开始$/u, (_, combo) => `Half-Ripe Fruit Bowl: Fruit Combo starts at ${combo}`],
  [/^(.+)：本轮之后没有硬吃，判词兑现\s*\+([\d.]+)$/u, (_, card, amount) => `${translateCore(card)}: no Wrong Edibility this round; verdict pays +${amount}`],
  [/^(.+)：本轮未进入牌堆，吃分永久\s*\+([\d.]+)$/u, (_, card, amount) => `${translateCore(card)}: stayed out of the pile and permanently gains +${amount} Eat`],
  [/^(.+)：轮末融化，吃分\s*([+−-]?\d+)$/u, (_, card, amount) => `${translateCore(card)}: melts at round end, Eat ${amount}`],
  [/^经典任务\s*[·・]\s*(.+)$/u, (_, task) => `Classic Task · ${translateCore(task)}`],
  [/^条约\s*[·・]\s*(.+)$/u, (_, contract) => `Contract · ${translateCore(contract)}`],
  [/^已达成\s*[·・]\s*永久得分倍率\s*×([\d.]+)$/u, (_, multiplier) => `Completed · Permanent score multiplier ×${multiplier}`],
  [/^已达成\s*[·・]\s*\+([\d.]+)\s*金币$/u, (_, amount) => `Completed · +${amount} Gold`],
  [/^金币\s*[·・]\s*(8|12)\s*秒清盘$/u, (_, seconds) => `Gold · Cleared within ${seconds}s`],
  [/^(.+)\s*等待选牌$/u, (_, item) => `${translateCore(item)}: choose a card`],
  [/^(.+)\s*等待选择类别$/u, (_, item) => `${translateCore(item)}: choose a category`],
  [/^(.+)\s*已生效$/u, (_, item) => `${translateCore(item)} is active`],
  [/^本局异变：(.+)[。.]?$/u, (_, mutation) => `Mutation: ${translateCore(mutation.replace(/[。.]$/u, ""))}.`],
  [/^无尽模式：道具可以重复获得；每\s*5\s*轮扩容并获得删牌标记，餐盘最多\s*(\d+)\s*张；累计\s*1,000,000\s*分通关。$/u,
    (_, capacity) => `Endless Mode: items can stack. Every 5 rounds, expand the plate and gain a Remove Token; plate capacity is capped at ${capacity}. Reach 1,000,000 total score to clear.`],
  [/^(\d+)\s*\/\s*(\d+)\s*张$/u, (_, count, maximum) => `${count} / ${maximum} cards`],
  [/^(\d+)\s*张留在牌组$/u, (_, count) => `${count} cards remain in the deck`],
  [/^(\d+)\s*枚$/u, (_, count) => `${count}`],
  [/^删除\s*[·・]\s*(\d+)\s*枚标记$/u, (_, count) => `Remove · ${count} Token${count === "1" ? "" : "s"}`],
  [/^再经过一轮可移除（第\s*(\d+)\s*轮轮末）$/u, (_, round) => `Removable after one more round (end of Round ${round})`],
  [/^当前有\s*(\d+)\s*枚删牌标记；点击卡牌下方按钮即可删除。$/u, (_, count) => `You have ${count} Remove Token${count === "1" ? "" : "s"}. Use the button beneath a card to remove it.`],
  [/^(\d+)\s*件永久道具$/u, (_, count) => `${count} Permanent Item${count === "1" ? "" : "s"}`],
  [/^查看本局已获得的\s*(\d+)\s*件永久道具$/u, (_, count) => `View ${count} permanent item${count === "1" ? "" : "s"} obtained this run`],
  [/^查看已获得道具，共\s*(\d+)\s*件$/u, (_, count) => `View owned items · ${count} total`],
  [/^查看永久牌组（(\d+)\s*张）$/u, (_, count) => `View permanent deck (${count} cards)`],
  [/^查看道具（(\d+)\s*件）$/u, (_, count) => `View items (${count})`],
  [/^已结算\s*([\d,]+)；本轮已确定\s*([+−-]?[\d,]+)；轮末效果与倍率尚未计入$/u,
    (_, settled, round) => `Settled ${settled} · Current round ${round} · Round-end effects and multipliers not yet included`],
  [/^(本轮|下轮预计)登场\s*(\d+)\s*张；永久牌组\s*(\d+)\s*张$/u,
    (_, timing, plate, deck) => `${timing === "本轮" ? "This round" : "Next round"}: ${plate} cards on the plate · ${deck} cards in the permanent deck`],
  [/^第\s*(\d+)\s*轮进行中$/u, (_, round) => `Round ${round} in progress`],
  [/^第\s*(\d+)\s*轮\s*[·・]\s*(.+)$/u, (_, round, detail) => `Round ${round} · ${translateCore(detail)}`],
  [/^(\d+)\s*条并行条约$/u, (_, count) => `${count} Active Contract${count === "1" ? "" : "s"}`],
  [/^已完成\s*(\d+)\s*个任务$/u, (_, count) => `${count} task${count === "1" ? "" : "s"} completed`],
  [/^当前\s*×([\d.]+)$/u, (_, multiplier) => `Current ×${multiplier}`],
  [/^达成后\s*×([\d.]+)$/u, (_, multiplier) => `On completion ×${multiplier}`],
  [/^第\s*(\d+|本)\s*轮接取\s*[·・]\s*已尝试\s*(\d+)\s*轮$/u,
    (_, round, attempts) => `Accepted in ${round === "本" ? "this round" : `Round ${round}`} · Attempted for ${attempts} round${attempts === "1" ? "" : "s"}`],
  [/^(基础|进阶|后期)(任务|合约)\s*[·・]\s*第\s*(\d+)\s*轮起$/u,
    (_, tier, kind, round) => `${{ 基础: "Basic", 进阶: "Advanced", 后期: "Late-Game" }[tier]} ${kind === "任务" ? "Task" : "Contract"} · From Round ${round}`],
  [/^永久\s*×([\d.]+)$/u, (_, multiplier) => `Permanent ×${multiplier}`],
  [/^\+(\d+)\s*金币$/u, (_, amount) => `+${amount} Gold`],
  [/^(.+)（([\d,]+)\s*分）$/u, (_, requirement, target) => `${translateCore(requirement)} (${target} score)`],
  [/^已删除「(.+)」。还剩\s*(\d+)\s*枚删牌标记。$/u,
    (_, card, count) => `Removed “${translateCore(card)}”. ${count} Remove Token${count === "1" ? "" : "s"} remaining.`],
  [/^本轮第\s*(\d+)\s*次选牌$/u, (_, step) => `Draft ${step} This Round`],
  [/^查看(.+)详情，再决定是否领取$/u, (_, item) => `Inspect ${translateCore(item)}, then decide whether to take it`],
  [/^免费刷新\s*[·・]\s*(\d+)$/u, (_, count) => `Free Reroll · ${count}`],
  [/^刷新\s*[·・]\s*(\d+)\s*枚标记$/u, (_, count) => `Reroll · ${count} Token${count === "1" ? "" : "s"}`],
  [/^选择一张(.+)牌$/u, (_, type) => `Choose a ${translateCore(type)} Card`],
  [/^(.+)会立即消耗；选中的卡牌永久加入牌组。$/u, (_, item) => `${translateCore(item)} is consumed immediately. The chosen card is added permanently to your deck.`],
  [/^(.+)：选择强化类别$/u, (_, item) => `${translateCore(item)}: Choose a Category to Boost`],
  [/^下一轮所选类别的每张牌结算时额外\s*\+([\d.]+)\s*分，随后道具自毁。$/u,
    (_, bonus) => `Next round, every card in the chosen category gains +${bonus} at settlement. Then this item is destroyed.`],
  [/^下一轮每张\s*\+([\d.]+)$/u, (_, bonus) => `Next round: +${bonus} per card`],
  [/^(\d+)\s*张不会在下轮登场$/u, (_, count) => `${count} cards will stay out of the next plate`],
  [/^(.+)专柜$/u, (_, type) => `${translateCore(type)} Shelf`],
  [/^餐盘已满\s*[·・]\s*(\d+)\/(\d+)$/u, (_, current, max) => `Plate at Maximum · ${current}/${max}`],
  [/^永久扩容\s*\+1\s*[·・]\s*\$(\d+)$/u, (_, cost) => `Expand Permanently +1 · $${cost}`],
  [/^当前\s*(\d+)\s*张\s*→\s*(\d+)\s*张(?:\s*[·・]\s*优惠\s*-([\d.]+))?$/u,
    (_, current, next, discount) => `Current ${current} cards → ${next} cards${discount ? ` · Discount -${discount}` : ""}`],
  [/^免费刷新\s*[·・]\s*剩余\s*(\d+)$/u, (_, count) => `Free Reroll · ${count} remaining`],
  [/^刷新商品\s*[·・]\s*\$(\d+)$/u, (_, cost) => `Reroll Shop · $${cost}`],
  [/^基础\s*\$([\d.]+)\s*[·・]\s*优惠\s*-([\d.]+)$/u, (_, base, discount) => `Base $${base} · Discount -${discount}`],
  [/^基础价\s*([\d.]+)；优惠\s*([\d.]+)$/u, (_, base, discount) => `Base price ${base}; discount ${discount}`],
  [/^删除\s*\$([\d.]+)$/u, (_, cost) => `Remove $${cost}`],
  [/^(.+)：支付\s*([\d.]+)\s*金币从永久牌组中删除，不返还金币$/u,
    (_, card, cost) => `${translateCore(card)}: pay ${cost} Gold to remove it from the permanent deck. Gold is not refunded.`],
  [/^本轮为第\s*(\d+)\s*轮目标结算$/u, (_, round) => `Round ${round} milestone check`],
  [/^第\s*(\d+)\s*轮结算前累计达到\s*([\d,]+)\s*分$/u, (_, round, target) => `Reach ${target} total score before Round ${round} settlement`],
  [/^当前\s*([\d,]+)\s*[·・]\s*还差\s*([\d,]+)\s*[·・]\s*剩余\s*(\d+)\s*轮(?:\s*[·・]\s*已有\s*(\d+)\s*条并行条约)?$/u,
    (_, score, needed, rounds, contracts) => `Current ${score} · Need ${needed} more · ${rounds} round${rounds === "1" ? "" : "s"} left${contracts === undefined ? "" : ` · ${contracts} active contract${contracts === "1" ? "" : "s"}`}`],
  [/^累计\s*([\d,]+)\s*分\s*[·・]\s*第\s*(\d+)\s*轮$/u, (_, score, round) => `Total ${score} · Round ${round}`],
  [/^本轮\s*(\d+)\s*张牌\s*[·・]\s*得分一览$/u, (_, count) => `This Round · ${count} Cards · Score Review`],
  [/^逐牌计分\s*(\d+)\s*\/\s*(\d+)$/u, (_, current, total) => `Card-by-Card Scoring ${current} / ${total}`],
  [/^快速上菜\s*(\d+)\s*\/\s*(\d+)$/u, (_, current, total) => `Rapid Service ${current} / ${total}`],
  [/^确认结算\s*[·・]\s*(.+)$/u, (_, next) => `Confirm Results · ${translateCore(next)}`],
  [/^最终得分\s*([\d,]+)，记录已保存到本机。$/u, (_, score) => `Final score: ${score}. Your record has been saved locally.`],
  [/^(.+)，(吃牌|弃牌)，(加|减)([\d,]+)分$/u,
    (_, card, action, direction, score) => `${translateCore(card)}, ${action === "吃牌" ? "Eat" : "Discard"}, ${direction === "加" ? "gain" : "lose"} ${score} score`],
  [/^本阶段需要\s*([\d,]+)\s*分，当前为\s*([\d,]+)\s*分。$/u, (_, target, score) => `This milestone requires ${target} score; you currently have ${score}.`],
  [/^餐盘上限提升至\s*(\d+)$/u, (_, capacity) => `Plate capacity increased to ${capacity}`],
  [/^刷新标记增至\s*(\d+)$/u, (_, count) => `Reroll Tokens increased to ${count}`],
  [/^(.+)。接下来(.+)。$/u, (_, gifts, next) => `${translateCore(gifts)}. Next: ${translateCore(next)}.`],
  [/^(.+)：(.+)$/u, (_, subject, detail) => `${translateCore(subject)}: ${translateCore(detail)}`],
]);

function translateRegistered(source) {
  const exact = exactEnglish.get(source);
  if (exact) return exact;
  for (const [pattern, replacement] of dynamicEnglish) {
    if (pattern.test(source)) return source.replace(pattern, replacement);
  }
  return null;
}

function translateDelimited(source) {
  const parts = source.split(/\s*[·・]\s*/u);
  const translated = [];
  let changed = false;
  for (let index = 0; index < parts.length;) {
    let match = null;
    let matchEnd = index + 1;
    // Prefer the longest registered phrase. Item roles such as
    // “生成 · 临时复制” are themselves structured labels and must not be
    // destroyed by splitting every dot into unrelated fragments.
    for (let end = parts.length; end > index; end -= 1) {
      const candidate = parts.slice(index, end).join(" · ");
      const candidateTranslation = translateRegistered(candidate);
      if (!candidateTranslation) continue;
      match = candidateTranslation;
      matchEnd = end;
      changed = changed || candidateTranslation !== candidate;
      break;
    }
    if (match === null) {
      match = translateCore(parts[index]);
      changed = changed || match !== parts[index];
    }
    translated.push(match);
    index = matchEnd;
  }
  return changed ? translated.join(" · ") : null;
}

function translateCore(source) {
  const core = String(source ?? "");
  if (!core || locale !== LANGUAGES.EN) return core;
  const trimmed = core.trim();
  const registered = translateRegistered(trimmed);
  if (registered) return core.replace(trimmed, registered);
  if (/[·・]/u.test(trimmed)) {
    const translatedParts = translateDelimited(trimmed);
    if (translatedParts) return core.replace(trimmed, translatedParts);
  }
  let translated = core;
  for (const [from, to] of phraseEnglish) translated = translated.replaceAll(from, to);
  // Phrase substitution is a last resort and is only trustworthy when it clears
  // the whole string. A partial hit produces half-translated text such as
  // “不要Eat我喵！”, which reads as broken rather than as untranslated copy.
  // Keeping the Chinese leaves the gap visible and lets the i18n coverage test
  // point at the exact string that needs a COMMON_EN or dynamicEnglish entry.
  return HAS_CHINESE.test(translated) ? core : translated;
}

export function translate(source) {
  return translateCore(source);
}

export function getLocale() {
  return locale;
}

function localizeTextNode(node) {
  if (!node?.nodeValue || node.parentElement?.closest("script, style, [data-i18n-ignore]")) return;
  const current = node.nodeValue;
  const previous = textRecords.get(node);
  const source = previous && current === previous.output ? previous.source : current;
  const output = locale === LANGUAGES.EN ? translateCore(source) : source;
  textRecords.set(node, { source, output });
  if (current !== output) node.nodeValue = output;
}

function localizeAttributes(element) {
  if (!(element instanceof Element) || element.closest("[data-i18n-ignore]")) return;
  const names = ["title", "aria-label", "placeholder"];
  let records = attributeRecords.get(element);
  if (!records) {
    records = new Map();
    attributeRecords.set(element, records);
  }
  for (const name of names) {
    if (!element.hasAttribute(name)) continue;
    const current = element.getAttribute(name) ?? "";
    const previous = records.get(name);
    const source = previous && current === previous.output ? previous.source : current;
    const output = locale === LANGUAGES.EN ? translateCore(source) : source;
    records.set(name, { source, output });
    if (current !== output) element.setAttribute(name, output);
  }
}

function localizeTree(root) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    localizeTextNode(root);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) localizeAttributes(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) localizeTextNode(node);
    else localizeAttributes(node);
    node = walker.nextNode();
  }
}

export function refreshLocalization(root = globalThis.document) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale === LANGUAGES.EN ? "en" : "zh-CN";
  document.documentElement.dataset.language = locale;
  localizeTree(root);
}

export function setLocale(nextLocale) {
  locale = nextLocale === LANGUAGES.EN ? LANGUAGES.EN : LANGUAGES.ZH;
  refreshLocalization();
  if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
    window.dispatchEvent(new CustomEvent("cardeater:languagechange", { detail: { language: locale } }));
  }
  return locale;
}

export function startLocalization(root = globalThis.document) {
  if (typeof document === "undefined") return () => {};
  refreshLocalization(root);
  if (observer) return () => observer?.disconnect();
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") localizeTextNode(mutation.target);
      if (mutation.type === "attributes") localizeAttributes(mutation.target);
      for (const node of mutation.addedNodes ?? []) localizeTree(node);
    }
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["title", "aria-label", "placeholder"],
  });
  return () => {
    observer?.disconnect();
    observer = null;
  };
}
