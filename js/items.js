import { safeAdd } from "./numbers.js";
import { getCardById } from "./data.js";

const defineItem = (definition, iconIndex) => Object.freeze({
  rarity: "培养道具",
  icon_atlas: "meta-atlas.webp",
  icon_columns: 4,
  icon_rows: 4,
  icon_x: iconIndex % 4,
  icon_y: Math.floor(iconIndex / 4),
  ...definition,
  builds: Object.freeze([...(definition.builds ?? [])]),
  effect: Object.freeze({ ...definition.effect }),
  cultivation: Object.freeze({ ...definition.cultivation }),
});

export const ITEM_LIBRARY = Object.freeze([
  defineItem({ id: "BI001", name: "三格果篮", role: "水果 · 无限培养", builds: ["fruit"], description: "连续吃水果时，额外获得连击数，初始最多 +2 分。", essence_description: "每次培养都会永久提高连击奖励上限。", effect: { kind: "fruit_basket" }, cultivation: { kind: "fruit_eaten", target: 6, growth: 2, repeatable: true } }, 0),
  defineItem({ id: "BI002", name: "果核标本", role: "水果 → 生成", builds: ["fruit", "generate"], bridge: true, description: "每轮水果连击首次达到 3 时 +4 分。", essence_description: "精华突破后，同时生成一张弱化梨子。", effect: { kind: "fruit_specimen" }, cultivation: { kind: "fruit_milestone", target: 3, max_level: 1 } }, 1),
  defineItem({ id: "BI003", name: "果皮引信", role: "摧毁 → 水果", builds: ["fruit", "destroy"], bridge: true, description: "每摧毁 1 张牌储存 1 层果火；下次吃水果时全部引爆，每层 +3 分。", essence_description: "精华突破后，每层果火改为 +5 分。", effect: { kind: "fruit_fuse" }, cultivation: { kind: "destroyed", target: 5, max_level: 1 } }, 2),
  defineItem({ id: "BI004", name: "厨余发酵罐", role: "摧毁 → 生成 · 无限培养", builds: ["generate", "destroy"], bridge: true, description: "每累计摧毁 3 张牌，向永久牌组生成一张弱化梨子。", essence_description: "突破后梨子不再弱化；继续培养会永久提高新梨子的点数。", effect: { kind: "compost_fermenter" }, cultivation: { kind: "destroyed", target: 5, growth: 4, repeatable: true } }, 3),
  defineItem({ id: "BI005", name: "回收烙印", role: "生成 → 得分", builds: ["generate", "destroy"], bridge: true, description: "生成牌或弱化牌结算时额外 +3 分。", essence_description: "精华突破后改为 +7 分。", effect: { kind: "recycle_brand" }, cultivation: { kind: "generated_resolved", target: 5, max_level: 1 } }, 4),
  defineItem({ id: "BI006", name: "焚化账本", role: "摧毁 · 无限培养", builds: ["destroy"], description: "轮末时，本轮每摧毁 1 张牌额外 +2 分。", essence_description: "每次培养都会使每张摧毁牌的轮末收益永久 +1。", effect: { kind: "incineration_ledger" }, cultivation: { kind: "destroyed", target: 8, growth: 5, repeatable: true } }, 5),
  defineItem({ id: "BI007", name: "红字修复簿", role: "降低 → 恢复 · 无限培养", builds: ["reduce", "restore"], bridge: true, description: "每恢复 1 点红色降幅，本次额外 +1 分。", essence_description: "每次培养都会永久提高恢复点数的得分倍率。", effect: { kind: "repair_ledger" }, cultivation: { kind: "restored", target: 8, growth: 4, repeatable: true } }, 6),
  defineItem({ id: "BI008", name: "锈蚀弹簧", role: "降低 → 正确处理", builds: ["reduce", "correct"], bridge: true, description: "卡牌点数降低时储存锈力；正确处理牌时最多释放 2 点锈力，每点 +1 分。", essence_description: "精华突破后最多释放 4 点，且每点 +2 分。", effect: { kind: "rust_spring" }, cultivation: { kind: "rust_spent", target: 8, max_level: 1 } }, 7),
  defineItem({ id: "BI009", name: "裂纹金缮", role: "恢复 → 成长", builds: ["restore", "growth"], bridge: true, description: "累计完成 3 次恢复后，当前牌较高的一面永久 +1。", essence_description: "精华突破后，每次发生恢复都会令当前牌两面永久 +1。", effect: { kind: "kintsugi_growth" }, cultivation: { kind: "restore_events", target: 3, max_level: 1 } }, 8),
  defineItem({ id: "BI010", name: "铁胃通行证", role: "硬吃 · 规则改写", builds: ["hard"], wild: true, description: "每轮第一次硬吃时，抵消牌面的负分。", essence_description: "精华突破后，每轮第 3 次硬吃会把牌面负分翻为正分。", effect: { kind: "iron_pass" }, cultivation: { kind: "hard_actions", target: 6, max_level: 1 } }, 9),
  defineItem({ id: "BI011", name: "辣油量杯", role: "硬吃 · 无限培养", builds: ["hard"], description: "连续硬吃时获得连击奖励，初始最多 +2 分。", essence_description: "每次培养都会永久提高硬吃连击奖励上限。", effect: { kind: "chili_measure" }, cultivation: { kind: "hard_actions", target: 6, growth: 3, repeatable: true } }, 10),
  defineItem({ id: "BI012", name: "反常餐巾", role: "正确处理 → 硬吃", builds: ["correct", "hard"], bridge: true, description: "正确处理牌会储存 1 层保险；硬吃时消耗 1 层并 +4 分。", essence_description: "精华突破后可储存 2 层，保险奖励改为 +7 分。", effect: { kind: "odd_napkin" }, cultivation: { kind: "insurance_spent", target: 4, max_level: 1 } }, 11),
  defineItem({ id: "BI013", name: "回转餐车", role: "后置 · 无限培养", builds: ["postpone", "sequence"], wild: true, description: "同一张牌每轮可以后置 2 次。", essence_description: "首次突破后允许无限后置；继续培养会让每次后置直接得分。", effect: { kind: "turntable_cart" }, cultivation: { kind: "postponed", target: 8, growth: 4, repeatable: true } }, 12),
  defineItem({ id: "BI014", name: "三拍出餐钟", role: "节奏 · 无限培养", builds: ["sequence"], wild: true, description: "每轮第 3、6、9…次行动额外 +4 分。", essence_description: "每次培养都会使节拍奖励永久 +2。", effect: { kind: "serving_metronome" }, cultivation: { kind: "rhythm_triggers", target: 4, growth: 2, repeatable: true } }, 13),
  defineItem({ id: "BI015", name: "双向餐叉", role: "交替 · 无限培养", builds: ["sequence", "correct"], bridge: true, description: "吃与弃交替时额外 +2 分。", essence_description: "每次培养都会使交替奖励永久 +1。", effect: { kind: "alternating_fork" }, cultivation: { kind: "alternations", target: 6, growth: 3, repeatable: true } }, 14),
]);

const ITEM_BY_ID = Object.freeze(Object.fromEntries(ITEM_LIBRARY.map((entry) => [entry.id, entry])));

function cloneItem(source) {
  return source ? {
    ...source,
    builds: [...(source.builds ?? [])],
    effect: { ...source.effect },
    cultivation: { ...source.cultivation },
  } : null;
}

function createOwnedItem(source, saved = {}) {
  return {
    ...cloneItem(source),
    level: Math.max(0, Number(saved.level) || 0),
    cultivation_progress: Math.max(0, Number(saved.cultivation_progress) || 0),
    charges: Math.max(0, Number(saved.charges) || 0),
    buffer: Math.max(0, Number(saved.buffer) || 0),
    trigger_count: Math.max(0, Number(saved.trigger_count) || 0),
  };
}

export function getItemById(id) {
  return cloneItem(ITEM_BY_ID[id]);
}

export function createItemPool() {
  return ITEM_LIBRARY.map(cloneItem);
}

export function createShopItemPool() {
  return createItemPool();
}

function deckBuilds(state) {
  const builds = new Set(["correct", "sequence"]);
  const cards = state.deck ?? [];
  if (cards.filter((card) => card.type === "水果").length >= 2) builds.add("fruit");
  const searchable = cards.map((card) => `${card.effect?.kind ?? ""} ${(card.synergy_tags ?? []).join(" ")}`).join(" ");
  if (/生成|generate|copy/.test(searchable)) builds.add("generate");
  if (/摧毁|destroy|弱化/.test(searchable)) builds.add("destroy");
  if (/降低|降幅|drain|decay|debuff|融化/.test(searchable)) builds.add("reduce");
  if (/恢复|净化|restore|purify/.test(searchable)) builds.add("restore");
  if (/硬吃|wrong|anorexia/.test(searchable)) builds.add("hard");
  if (/后置|postpone/.test(searchable)) builds.add("postpone");
  if ((state.round?.wrong_edibility_count ?? 0) > 0) builds.add("hard");
  if ((state.round?.destroyed_count ?? 0) > 0) builds.add("destroy");
  if ((state.round?.generated_count ?? 0) > 0) builds.add("generate");
  if ((state.round?.postpone_count ?? 0) > 0) builds.add("postpone");
  return builds;
}

function takeRandom(pool, predicate, selected, random) {
  const candidates = pool.filter((item) => !selected.some((picked) => picked.id === item.id) && predicate(item));
  if (candidates.length === 0) return null;
  return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
}

export function randomDraftItems(state, count = 3, random = Math.random) {
  const seen = new Set([
    ...(state.items ?? []).map((entry) => entry.id),
    ...(state.item_history ?? []).map((entry) => entry.item_id),
  ]);
  const pool = createItemPool().filter((entry) => !seen.has(entry.id));
  const activeBuilds = deckBuilds(state);
  const selected = [];
  const relevant = takeRandom(
    pool,
    (item) => !item.bridge && !item.wild && item.builds.some((build) => activeBuilds.has(build)),
    selected,
    random,
  ) ?? takeRandom(pool, (item) => !item.bridge && !item.wild, selected, random);
  if (relevant) selected.push(relevant);
  const bridge = takeRandom(pool, (item) => item.bridge && !item.wild && item.builds.some((build) => activeBuilds.has(build)), selected, random)
    ?? takeRandom(pool, (item) => item.bridge && !item.wild, selected, random);
  if (bridge) selected.push(bridge);
  const wildcard = takeRandom(pool, (item) => item.wild, selected, random);
  if (wildcard) selected.push(wildcard);
  while (selected.length < count) {
    const fallback = takeRandom(pool, () => true, selected, random);
    if (!fallback) break;
    selected.push(fallback);
  }
  return selected.slice(0, count);
}

export function hydrateOwnedItems(state) {
  state.items = (state.items ?? [])
    .map((saved) => ITEM_BY_ID[saved.id] ? createOwnedItem(ITEM_BY_ID[saved.id], saved) : null)
    .filter(Boolean);
  return state.items;
}

export function addItem(state, id) {
  if (state.items.some((entry) => entry.id === id)) return false;
  const source = ITEM_BY_ID[id];
  if (!source) return false;
  state.items.push(createOwnedItem(source));
  return true;
}

export function chooseItem(state, selection) {
  const entry = typeof selection === "string" ? getItemById(selection) : cloneItem(selection);
  if (!entry) return { success: false, reason: "not_found" };
  state.item_history ??= [];
  state.item_history.push({ round: state.current_round, item_id: entry.id, consumed: false });
  if (!addItem(state, entry.id)) return { success: false, reason: "duplicate" };
  return { success: true, item: entry, message: `${entry.name} 开始培养` };
}

export function getCultivationTarget(entry) {
  const base = Math.max(1, entry.cultivation?.target ?? 1);
  if (!entry.cultivation?.repeatable) return base;
  return base + Math.max(0, entry.level ?? 0) * Math.max(0, entry.cultivation.growth ?? 0);
}

export function isCultivationComplete(entry) {
  return Number.isFinite(entry.cultivation?.max_level) && (entry.level ?? 0) >= entry.cultivation.max_level;
}

export function getItemLevelLabel(entry) {
  if ((entry.level ?? 0) <= 0) return "培养中";
  if (entry.cultivation?.repeatable) return `精华 Lv.${entry.level}`;
  return "精华完成";
}

export function getItemProgressText(entry) {
  if (isCultivationComplete(entry)) return "精华效果已永久解锁";
  return `${entry.cultivation_progress ?? 0} / ${getCultivationTarget(entry)}`;
}

export function getCurrentItemDescription(entry) {
  const level = Math.max(0, entry.level ?? 0);
  switch (entry.id) {
    case "BI001": return `连续吃水果时额外 +连击数，当前上限 +${2 + level}。`;
    case "BI002": return level > 0 ? "每轮水果连击首次达到 3 时 +6 分，并生成一张弱化梨子。" : entry.description;
    case "BI003": return `摧毁牌储存果火；下次吃水果时每层 +${level > 0 ? 5 : 3} 分。`;
    case "BI004": return level > 0 ? `每摧毁 3 张牌生成梨子，新梨子两面额外 +${Math.max(0, level - 1)}。` : entry.description;
    case "BI005": return `生成牌或弱化牌结算时额外 +${level > 0 ? 7 : 3} 分。`;
    case "BI006": return `轮末每张被摧毁牌额外 +${2 + level} 分。`;
    case "BI007": return `每恢复 1 点红色降幅，本次额外 +${1 + level} 分。`;
    case "BI008": return level > 0 ? "点数降低时储存锈力；正确处理时最多释放 4 点，每点 +2 分。" : entry.description;
    case "BI009": return level > 0 ? "每次发生恢复，当前牌两面永久 +1。" : entry.description;
    case "BI010": return level > 0 ? "每轮首次硬吃抵消负分；第 3 次硬吃将牌面负分翻为正分。" : entry.description;
    case "BI011": return `连续硬吃获得连击奖励，当前上限 +${2 + level}。`;
    case "BI012": return level > 0 ? "正确处理最多储存 2 层保险；硬吃消耗一层并 +7 分。" : entry.description;
    case "BI013": return level > 0 ? `同一张牌可无限后置；每次后置 +${level} 分。` : entry.description;
    case "BI014": return `每轮第 3、6、9…次行动额外 +${4 + level * 2} 分。`;
    case "BI015": return `吃与弃交替时额外 +${2 + level} 分。`;
    default: return entry.description;
  }
}

function cultivate(entry, amount, events) {
  if (amount <= 0 || isCultivationComplete(entry)) return;
  entry.cultivation_progress = safeAdd(entry.cultivation_progress ?? 0, amount);
  while (!isCultivationComplete(entry)) {
    const target = getCultivationTarget(entry);
    if (entry.cultivation_progress < target) break;
    entry.cultivation_progress -= target;
    entry.level = safeAdd(entry.level ?? 0, 1);
    events.push({
      item_id: entry.id,
      name: entry.name,
      level: entry.level,
      repeatable: Boolean(entry.cultivation.repeatable),
      message: entry.level === 1 ? `${entry.name} · 精华突破` : `${entry.name} · 培养至 Lv.${entry.level}`,
    });
    if (isCultivationComplete(entry)) entry.cultivation_progress = 0;
  }
}

function isCorrectAction(action, card) {
  return (card.edibility === "edible" && action === "eat")
    || (card.edibility === "inedible" && action === "discard");
}

function isWrongAction(action, card) {
  return !isCorrectAction(action, card);
}

function generatedCard(state, entry, cardId = "F009", options = {}) {
  const template = getCardById(cardId);
  if (!template) return null;
  state.item_serial = safeAdd(state.item_serial ?? 0, 1);
  const pointBonus = Math.max(0, options.point_bonus ?? 0);
  const weakened = Boolean(options.weakened);
  const card = {
    ...template,
    synergy_tags: [...(template.synergy_tags ?? [])],
    effect: template.effect ? { ...template.effect, keywords: [...(template.effect.keywords ?? [])] } : null,
    eat_points: safeAdd(template.eat_points ?? 0, pointBonus),
    discard_points: safeAdd(template.discard_points ?? 0, pointBonus),
    generated_from: `item:${entry.id}`,
    generated_label: entry.name,
    weakened,
    status_keywords: weakened ? ["弱化"] : [],
    uuid: `${template.id}-${entry.id}-${state.current_round}-${state.item_serial}`,
  };
  state.deck.push(card);
  state.round.generated_count = safeAdd(state.round.generated_count ?? 0, 1);
  return card;
}

function addBonus(result, entry, amount, detail = null) {
  if (!amount) return;
  result.flat_bonus = safeAdd(result.flat_bonus, amount);
  result.messages.push(detail ?? `${entry.name} +${amount}`);
}

export function resolveItemActionEffects(state, action, card) {
  const result = { flat_bonus: 0, messages: [], markers: {} };
  const correct = isCorrectAction(action, card);
  const wrong = !correct;
  const fruitChain = action === "eat" && card.type === "水果"
    ? safeAdd(state.round.item_fruit_chain ?? 0, 1)
    : 0;
  const wrongIndex = wrong ? safeAdd(state.round.wrong_edibility_count ?? 0, 1) : 0;
  const previous = state.round.actions.at(-1);
  const actionNumber = state.round.actions.length + 1;

  for (const entry of state.items ?? []) {
    const level = Math.max(0, entry.level ?? 0);
    switch (entry.effect.kind) {
      case "fruit_basket":
        if (fruitChain > 0) addBonus(result, entry, Math.min(fruitChain, 2 + level));
        break;
      case "fruit_specimen": {
        const key = `item:${entry.id}:fruit-three`;
        if (fruitChain >= 3 && !state.round.effect_trigger_counts[key]) {
          state.round.effect_trigger_counts[key] = 1;
          addBonus(result, entry, 4 + level * 2);
          result.markers[entry.id] = { kind: "fruit_milestone", amount: 1 };
        }
        break;
      }
      case "fruit_fuse":
        if (fruitChain > 0 && (entry.charges ?? 0) > 0) {
          const spent = entry.charges;
          entry.charges = 0;
          addBonus(result, entry, spent * (level > 0 ? 5 : 3), `${entry.name}：${spent} 层果火引爆`);
          result.markers[entry.id] = { kind: "fruit_fire", amount: spent };
        }
        break;
      case "recycle_brand":
        if (card.generated_from || card.weakened) addBonus(result, entry, level > 0 ? 7 : 3);
        break;
      case "rust_spring":
        if (correct && (entry.charges ?? 0) > 0) {
          const spent = Math.min(entry.charges, level > 0 ? 4 : 2);
          entry.charges -= spent;
          addBonus(result, entry, spent * (level > 0 ? 2 : 1), `${entry.name}：释放 ${spent} 点锈力`);
          result.markers[entry.id] = { kind: "rust_spent", amount: spent };
        }
        break;
      case "iron_pass":
        if (wrong) {
          const printed = action === "eat" ? card.eat_points ?? 0 : card.discard_points ?? 0;
          const loss = Math.max(0, -printed);
          if (wrongIndex === 1 && loss > 0) addBonus(result, entry, loss, `${entry.name}：抵消首次硬吃负分`);
          if (level > 0 && wrongIndex === 3 && loss > 0) {
            const alreadyCancelled = wrongIndex === 1 ? loss : 0;
            addBonus(result, entry, Math.max(0, loss * 2 - alreadyCancelled), `${entry.name}：第 3 次硬吃负分翻正`);
          }
        }
        break;
      case "chili_measure":
        if (wrong) addBonus(result, entry, Math.min(safeAdd(state.round.wrong_edibility_streak ?? 0, 1), 2 + level));
        break;
      case "odd_napkin":
        if (correct) {
          entry.charges = Math.min(level > 0 ? 2 : 1, safeAdd(entry.charges ?? 0, 1));
        } else if ((entry.charges ?? 0) > 0) {
          entry.charges -= 1;
          addBonus(result, entry, level > 0 ? 7 : 4, `${entry.name}：消耗 1 层保险`);
          result.markers[entry.id] = { kind: "insurance_spent", amount: 1 };
        }
        break;
      case "serving_metronome":
        if (actionNumber % 3 === 0) {
          addBonus(result, entry, 4 + level * 2);
          result.markers[entry.id] = { kind: "rhythm_trigger", amount: 1 };
        }
        break;
      case "alternating_fork":
        if (previous && previous.action !== action) {
          addBonus(result, entry, 2 + level);
          result.markers[entry.id] = { kind: "alternation", amount: 1 };
        }
        break;
      default:
        break;
    }
  }
  return result;
}

function changePermanent(state, card, stat, amount) {
  const owned = state.deck.find((candidate) => candidate.uuid === card.uuid);
  if (!owned) return 0;
  owned[stat] = safeAdd(owned[stat] ?? 0, amount);
  for (const copy of [...state.round.draw_pile, ...state.round.spent_pile, ...(state.round.reserve_cards ?? [])]) {
    if (copy.uuid === card.uuid) copy[stat] = owned[stat];
  }
  state.round.grown_count = safeAdd(state.round.grown_count ?? 0, 1);
  return amount;
}

function cultivationAmount(entry, action, card, context, marker) {
  switch (entry.cultivation.kind) {
    case "fruit_eaten": return action === "eat" && card.type === "水果" ? 1 : 0;
    case "fruit_milestone": return marker?.kind === "fruit_milestone" ? marker.amount : 0;
    case "destroyed": return context.destroyed_count ?? 0;
    case "generated_resolved": return card.generated_from || card.weakened ? 1 : 0;
    case "restored": return context.restored_points ?? 0;
    case "rust_spent": return marker?.kind === "rust_spent" ? marker.amount : 0;
    case "restore_events": return (context.restored_points ?? 0) > 0 ? 1 : 0;
    case "hard_actions": return isWrongAction(action, card) ? 1 : 0;
    case "insurance_spent": return marker?.kind === "insurance_spent" ? marker.amount : 0;
    case "rhythm_triggers": return marker?.kind === "rhythm_trigger" ? marker.amount : 0;
    case "alternations": return marker?.kind === "alternation" ? marker.amount : 0;
    default: return 0;
  }
}

export function resolveItemAfterActionEffects(state, action, card, entry, context = {}) {
  const result = { score_bonus: 0, messages: [], item_events: [], point_changes: [] };
  state.round.item_fruit_chain = action === "eat" && card.type === "水果"
    ? safeAdd(state.round.item_fruit_chain ?? 0, 1)
    : 0;

  for (const item of state.items ?? []) {
    const levelBefore = Math.max(0, item.level ?? 0);
    const marker = entry.item_markers?.[item.id];
    switch (item.effect.kind) {
      case "fruit_specimen":
        if (marker?.kind === "fruit_milestone" && levelBefore > 0) {
          const generated = generatedCard(state, item, "F009", { weakened: true });
          if (generated) result.messages.push(`${item.name}：生成弱化梨子`);
        }
        break;
      case "fruit_fuse":
        if ((context.destroyed_count ?? 0) > 0) {
          item.charges = Math.min(12, safeAdd(item.charges ?? 0, context.destroyed_count));
          result.messages.push(`${item.name}：果火 ${item.charges} 层`);
        }
        break;
      case "compost_fermenter": {
        item.buffer = safeAdd(item.buffer ?? 0, context.destroyed_count ?? 0);
        while (item.buffer >= 3) {
          item.buffer -= 3;
          const generated = generatedCard(state, item, "F009", {
            weakened: levelBefore === 0,
            point_bonus: Math.max(0, levelBefore - 1),
          });
          if (generated) result.messages.push(`${item.name}：发酵生成${generated.weakened ? "弱化" : ""}梨子`);
        }
        break;
      }
      case "repair_ledger":
        if ((context.restored_points ?? 0) > 0) {
          const bonus = context.restored_points * (1 + levelBefore);
          result.score_bonus = safeAdd(result.score_bonus, bonus);
          result.messages.push(`${item.name}：恢复兑现 +${bonus}`);
        }
        break;
      case "rust_spring":
        if ((context.reduced_points ?? 0) > 0) {
          item.charges = Math.min(24, safeAdd(item.charges ?? 0, context.reduced_points));
          result.messages.push(`${item.name}：储存锈力至 ${item.charges}`);
        }
        break;
      case "kintsugi_growth":
        if ((context.restored_points ?? 0) > 0) {
          if (levelBefore > 0) {
            const eat = changePermanent(state, card, "eat_points", 1);
            const discard = changePermanent(state, card, "discard_points", 1);
            if (eat || discard) {
              result.point_changes.push({ card_name: card.name, stat: "eat_points", amount: eat });
              result.point_changes.push({ card_name: card.name, stat: "discard_points", amount: discard });
              result.messages.push(`${item.name}：${card.name} 两面永久 +1`);
            }
          } else {
            item.buffer = safeAdd(item.buffer ?? 0, 1);
            if (item.buffer >= 3) {
              item.buffer -= 3;
              const stat = (card.eat_points ?? 0) >= (card.discard_points ?? 0) ? "eat_points" : "discard_points";
              const amount = changePermanent(state, card, stat, 1);
              if (amount) {
                result.point_changes.push({ card_name: card.name, stat, amount });
                result.messages.push(`${item.name}：${card.name} 较高一面永久 +1`);
              }
            }
          }
        }
        break;
      default:
        break;
    }
    cultivate(item, cultivationAmount(item, action, card, context, marker), result.item_events);
  }
  return result;
}

export function resolveItemPostponeEffects(state) {
  const result = { score_bonus: 0, messages: [], item_events: [] };
  for (const item of state.items ?? []) {
    if (item.effect.kind !== "turntable_cart") continue;
    const levelBefore = Math.max(0, item.level ?? 0);
    if (levelBefore > 0) {
      result.score_bonus = safeAdd(result.score_bonus, levelBefore);
      result.messages.push(`${item.name} +${levelBefore}`);
    }
    cultivate(item, 1, result.item_events);
  }
  return result;
}

export function getItemRoundEndEffects(state) {
  const result = { score_bonus: 0, messages: [] };
  for (const item of state.items ?? []) {
    if (item.effect.kind !== "incineration_ledger" || (state.round.destroyed_count ?? 0) <= 0) continue;
    const bonus = state.round.destroyed_count * (2 + Math.max(0, item.level ?? 0));
    result.score_bonus = safeAdd(result.score_bonus, bonus);
    result.messages.push(`${item.name}：${state.round.destroyed_count} 张摧毁牌 +${bonus}`);
  }
  return result;
}

export function applyRoundItemSetup(state) {
  hydrateOwnedItems(state);
  return [];
}

export function getPostponeLimit(state) {
  const cart = (state.items ?? []).find((entry) => entry.effect?.kind === "turntable_cart");
  if (!cart) return 1;
  return (cart.level ?? 0) > 0 ? Infinity : 2;
}

export function hasUnlimitedPostpone(state) {
  return getPostponeLimit(state) === Infinity;
}

export function getItemFinalMultipliers() {
  return [];
}

export function applyRoundEndItems(state) {
  return getItemRoundEndEffects(state);
}
