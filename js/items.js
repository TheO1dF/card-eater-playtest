import { GAME_CONFIG, GAME_MODES } from "./config.js";
import { createShopCardPool, getCardById } from "./data.js";
import { safeAdd, safeProduct } from "./numbers.js";
import { queueRoundGold } from "./economy.js";
import { getRemainingCardCount } from "./round-pile.js";
import { changePermanentCard } from "./permanent-points.js";
import { EFFECT_LAYERS, createEffectProcessor } from "./effect-processor.js";

const CARD_POOL_ITEMS = Object.freeze([
  ["A1", "果摊兑换券", "水果", "水果选牌"],
  ["A2", "热餐取餐券", "快餐", "快餐选牌"],
  ["A3", "甜点礼盒券", "甜点", "甜点选牌"],
  ["A4", "饮品兑换券", "饮料", "饮料选牌"],
  ["A5", "星象观测券", "星体", "星体选牌"],
  ["A6", "贵宾介绍信", "人物", "人物选牌"],
  ["A7", "动物领养证", "动物", "动物选牌"],
  ["A8", "万用提货单", "通用", "通用选牌"],
]);

const RARITY_WEIGHT = Object.freeze({ "普通": 12, "罕见": 6, "稀有": 3, "传奇": 1 });

const defineItem = (definition, iconIndex) => Object.freeze({
  icon_atlas: "meta-atlas.webp",
  icon_columns: 4,
  icon_rows: 4,
  icon_x: (iconIndex % 16) % 4,
  icon_y: Math.floor((iconIndex % 16) / 4),
  builds: Object.freeze([...(definition.builds ?? ["sequence"])]),
  ...definition,
  effect: Object.freeze({ ...definition.effect }),
});

const definitions = [
  ...CARD_POOL_ITEMS.map(([id, name, type, role]) => ({
    id,
    name,
    rarity: "普通",
    role: `${role} · 一次性`,
    builds: [type],
    consumable: true,
    description: `立即从${type}卡池的三张牌中选择一张加入永久牌组。`,
    effect: { kind: "card_pool_choice", card_type: type },
  })),
  { id: "B1", name: "金面天平", rarity: "传奇", role: "硬吃 · 规则改写", builds: ["hard", "sequence"], wild: true, description: "结算牌面点数时，总是使用吃分与弃分中较高的一边。", effect: { kind: "best_side" } },
  { id: "B2", name: "逆味计数器", rarity: "稀有", role: "硬吃 · 轮末得分", builds: ["hard"], description: "轮末额外获得等同于本轮最高错误食性连击数的分数。", effect: { kind: "wrong_streak_round" } },
  { id: "B3", name: "叛逆餐叉", rarity: "罕见", role: "硬吃 · 即时得分", builds: ["hard"], description: "错误食性吃牌时额外 +1 分。", effect: { kind: "wrong_eat_bonus", bonus: 1 } },
  { id: "C1", name: "三轮裁纸机", rarity: "稀有", role: "删牌 · 周期资源", builds: ["destroy"], bridge: true, description: "每经过 3 轮，获得 1 枚删牌标记。", effect: { kind: "delete_every_rounds", interval: 3, tokens: 1 } },
  { id: "C2", name: "防碎覆膜", rarity: "罕见", role: "摧毁 · 保护", builds: ["destroy"], description: "每轮第一次将要摧毁卡牌时，改为不摧毁它。", effect: { kind: "protect_first_destroy" } },
  { id: "C3", name: "双旋硬币", rarity: "普通", role: "刷新 · 一次性", builds: ["sequence"], consumable: true, description: "立即获得 2 枚刷新标记。", effect: { kind: "grant_reroll_tokens", tokens: 2 } },
  { id: "C4", name: "半熟果盘", rarity: "普通", role: "水果连击 · 起步", builds: ["fruit"], description: "每轮水果连击初始为 1。", effect: { kind: "fruit_combo_start", amount: 1 } },
  { id: "C5", name: "领队铃铛", rarity: "普通", role: "动物 · 排序", builds: ["animal", "sequence"], bridge: true, description: "若牌组中有动物，每轮随机一张动物牌必定最先出现。", effect: { kind: "animal_leads" } },
  { id: "C6", name: "八味调色盘", rarity: "普通", role: "类别 · 轮末得分", builds: ["sequence"], wild: true, description: "轮末额外获得等同于永久牌组类别数量的分数。", effect: { kind: "unique_type_round" } },
  { id: "C7", name: "双色节拍器", rarity: "普通", role: "交替 · 即时得分", builds: ["sequence"], description: "连续交替进行吃牌与弃牌时，每次额外 +1 分。", effect: { kind: "alternate_bonus", bonus: 1 } },
  { id: "C8", name: "果皮回收袋", rarity: "普通", role: "水果 · 弃牌", builds: ["fruit"], description: "弃置水果时额外 +2 分。", effect: { kind: "fruit_discard_bonus", bonus: 2 } },
  { id: "C9", name: "双层吸管", rarity: "传奇", role: "饮料 · 规则改写", builds: ["drink", "generate"], wild: true, description: "饮料的卡牌效果额外生效一次；牌面点数不会重复结算。", effect: { kind: "double_drink_effect" } },
  { id: "C10", name: "魔法帽", rarity: "罕见", role: "兔子 · 转化", builds: ["animal", "generate"], bridge: true, description: "每轮结束后，随机将永久牌组中的一张非兔子卡牌变成兔子。", effect: { kind: "magic_hat", card_id: "A004" } },
  { id: "C11", name: "梨香催熟袋", rarity: "普通", role: "水果 · 生成改写", builds: ["fruit", "generate"], bridge: true, description: "香蕉的生成效果改为生成梨，而不是苹果。", effect: { kind: "banana_pear", card_id: "F009" } },
  { id: "C12", name: "极速出餐灯", rarity: "稀有", role: "速通 · 倍率", builds: ["sequence"], wild: true, description: "在 12 秒内清空本轮餐盘时，本轮最终得分 ×1.2。", effect: { kind: "speed_clear_multiplier", threshold_ms: 12000, multiplier: 1.2 } },
  { id: "C13", name: "红字复利簿", rarity: "罕见", role: "恢复 · 永久成长", builds: ["restore", "growth"], bridge: true, description: "每当红色点数被恢复时，该项点数再永久增加本次恢复的差值。", effect: { kind: "restore_growth" } },
  { id: "C14", name: "双程传菜带", rarity: "传奇", role: "后置 · 规则改写", builds: ["postpone", "sequence"], wild: true, description: "同一张卡牌每轮可以额外后置 1 次，最多后置 2 次。", effect: { kind: "extra_postpone", extra_uses: 1 } },
  { id: "C15", name: "沼气炉", rarity: "稀有", role: "摧毁 → 生成", builds: ["destroy", "generate"], bridge: true, description: "每摧毁 1 张牌，在牌堆顶插入 1 张临时“沼气火”：可食用，吃 +8、弃 -3，结算后自毁。", effect: { kind: "destroy_spawn_gas" } },
  { id: "C16", name: "复写托盘", rarity: "稀有", role: "生成 · 临时复制", builds: ["generate"], description: "每轮第一张生成牌会额外产生一张临时无效果复制品；复制品结算后自毁且不能再被复制。", effect: { kind: "first_generation_copy" } },
  { id: "C17", name: "冷藏周转箱", rarity: "稀有", role: "水果 · 跨轮成长", builds: ["fruit", "growth"], bridge: true, description: "每轮最后吃掉的水果暂离永久牌组一轮，返回时吃分永久 +2。", effect: { kind: "fruit_sabbatical", bonus: 2 } },
  { id: "C18", name: "首尾砝码", rarity: "罕见", role: "顺序 · 牌面改写", builds: ["sequence"], wild: true, description: "每轮第一张牌的牌面得分变为 0，最后一张牌的牌面得分变为 2 倍；卡牌效果不受影响。", effect: { kind: "edge_points", last_multiplier: 2 } },
  { id: "C19", name: "专场通行证", rarity: "普通", role: "类别爆发 · 一次性", builds: ["sequence"], consumable: true, description: "立即选择 1 个类别；下一轮该类别所有卡牌结算时额外 +4 分，轮末自毁。", effect: { kind: "category_round_choice", bonus: 4 } },
  { id: "C20", name: "三式打卡器", rarity: "普通", role: "吃弃后置 · 轮末得分", builds: ["sequence", "postpone"], description: "每轮至少进行吃牌、弃牌、后置各一次后，轮末额外 +1 分。", effect: { kind: "action_trio", bonus: 1 } },
  { id: "C30", name: "反烤甜点铲", rarity: "罕见", role: "甜点 · 永久成长", builds: ["dessert", "growth"], bridge: true, description: "每次弃置甜点时，该甜点的吃分永久 +1。", effect: { kind: "dessert_discard_growth", bonus: 1 } },
];

export const ITEM_LIBRARY = Object.freeze(definitions.map((entry, index) => defineItem(entry, index)));
const ECONOMY_ITEM_LIBRARY = Object.freeze([
  { id: "E101", name: "投币吸管", rarity: "普通", role: "饮料经济", shop_price: 4, min_shop_round: 2, max_shop_round: 8, description: "每轮第一次吃掉并摧毁饮料时，结算金币 +1。", effect: { kind: "drink_first_gold", gold: 1 } },
  { id: "E102", name: "工会徽章", rarity: "普通", role: "人物经济", shop_price: 4, min_shop_round: 2, max_shop_round: 10, description: "每轮第一次弃掉人物牌时，结算金币 +1。", effect: { kind: "first_type_gold", target_type: "人物", action: "discard", gold: 1 } },
  { id: "E103", name: "优惠打印机", rarity: "罕见", role: "刷新经济", shop_price: 6, min_shop_round: 3, description: "每间商店获得 1 次免费刷新。", effect: { kind: "free_shop_reroll", count: 1 } },
  { id: "E104", name: "夜市会员卡", rarity: "罕见", role: "商店经济", shop_price: 8, min_shop_round: 4, description: "商店卡牌价格永久 -1，最低仍为 1 金币。", effect: { kind: "shop_price_discount", amount: 1 } },
  { id: "E105", name: "餐盘量尺", rarity: "普通", role: "扩容经济", shop_price: 5, min_shop_round: 2, description: "餐盘扩容费用永久 -1，最低仍为 1 金币。", effect: { kind: "plate_upgrade_discount", amount: 1 } },
  { id: "E106", name: "连击钱旗", rarity: "罕见", role: "水果经济", shop_price: 5, min_shop_round: 3, description: "每轮水果连击首次达到 3 或以上时，结算金币 +1。", effect: { kind: "fruit_combo_first_gold", threshold: 3, gold: 1 } },
  { id: "E107", name: "苦差零钱袋", rarity: "罕见", role: "风险刷新", shop_price: 5, min_shop_round: 3, description: "每轮首次选择牌面负分的一侧时，随后商店获得 1 次免费刷新。", effect: { kind: "negative_action_free_reroll", count: 1 } },
].map((entry, index) => defineItem({ ...entry, builds: ["economy"] }, index + 8)));
const ALL_ITEMS = Object.freeze([...ITEM_LIBRARY, ...ECONOMY_ITEM_LIBRARY]);
const ITEM_BY_ID = Object.freeze(Object.fromEntries(ALL_ITEMS.map((entry) => [entry.id, entry])));

function cloneItem(source) {
  return source ? { ...source, builds: [...(source.builds ?? [])], effect: { ...source.effect } } : null;
}

function createOwnedItem(source, saved = {}) {
  return {
    ...cloneItem(source),
    charges: Math.max(0, Number(saved.charges) || 0),
    trigger_count: Math.max(0, Number(saved.trigger_count) || 0),
    last_trigger_round: Number(saved.last_trigger_round) || 0,
    selected_type: saved.selected_type ?? null,
    applies_round: Number(saved.applies_round) || null,
    instance_id: saved.instance_id ?? `${source.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  };
}

export function getItemById(id) { return cloneItem(ITEM_BY_ID[id]); }
export function createItemPool() { return ITEM_LIBRARY.map(cloneItem); }
export function createShopItemPool() {
  const price = { "普通": 5, "罕见": 7, "稀有": 10, "传奇": 14 };
  return [...ITEM_LIBRARY.filter((entry) => !entry.consumable && entry.effect.kind !== "delete_every_rounds"), ...ECONOMY_ITEM_LIBRARY]
    .map(cloneItem)
    .map((entry) => ({ ...entry, shop_price: entry.shop_price ?? price[entry.rarity] ?? 6 }));
}
export function getCurrentItemDescription(entry) { return entry?.description ?? ""; }
export function getItemLevelLabel(entry) { return entry?.consumable ? "一次性" : entry?.rarity ?? "道具"; }
export function getItemProgressText() { return "获得后立即生效"; }
export function getCultivationTarget() { return 1; }
export function isCultivationComplete() { return true; }

function deckBuilds(state) {
  const builds = new Set(["sequence"]);
  const cards = state.deck ?? [];
  for (const card of cards) {
    builds.add(card.type);
    if (card.type === "水果") builds.add("fruit");
    if (card.type === "动物") builds.add("animal");
    if (card.type === "饮料") builds.add("drink");
    if (card.type === "甜点") builds.add("dessert");
  }
  const searchable = cards.map((card) => `${card.effect?.kind ?? ""} ${(card.synergy_tags ?? []).join(" ")}`).join(" ");
  if (/生成|generate|copy/.test(searchable)) builds.add("generate");
  if (/摧毁|destroy|弱化/.test(searchable)) builds.add("destroy");
  if (/恢复|净化|restore|purify/.test(searchable)) builds.add("restore");
  if (/成长|growth|grow/.test(searchable)) builds.add("growth");
  if (/硬吃|wrong/.test(searchable) || (state.round?.wrong_edibility_count ?? 0) > 0) builds.add("hard");
  if (/后置|postpone/.test(searchable) || (state.round?.postpone_count ?? 0) > 0) builds.add("postpone");
  return builds;
}

function weightedTake(pool, predicate, selected, random) {
  const candidates = pool.filter((item) => !selected.some((picked) => picked.id === item.id) && predicate(item));
  if (candidates.length === 0) return null;
  const total = candidates.reduce((sum, item) => sum + (RARITY_WEIGHT[item.rarity] ?? 1), 0);
  let roll = random() * total;
  for (const candidate of candidates) {
    roll -= RARITY_WEIGHT[candidate.rarity] ?? 1;
    if (roll <= 0) return candidate;
  }
  return candidates.at(-1);
}

export function randomDraftItems(state, count = 3, random = Math.random) {
  const seen = state.mode === GAME_MODES.ENDLESS ? new Set() : new Set([
    ...(state.items ?? []).map((entry) => entry.id),
    ...(state.item_history ?? []).map((entry) => entry.item_id),
  ]);
  const pool = createItemPool().filter((entry) => !seen.has(entry.id));
  const active = deckBuilds(state);
  const selected = [];
  const relevant = weightedTake(pool, (item) => !item.bridge && !item.wild && item.builds.some((build) => active.has(build)), selected, random)
    ?? weightedTake(pool, (item) => !item.bridge && !item.wild, selected, random);
  if (relevant) selected.push(relevant);
  const bridge = weightedTake(pool, (item) => item.bridge && item.builds.some((build) => active.has(build)), selected, random)
    ?? weightedTake(pool, (item) => item.bridge, selected, random);
  if (bridge) selected.push(bridge);
  const wild = weightedTake(pool, (item) => item.wild, selected, random);
  if (wild) selected.push(wild);
  while (selected.length < count) {
    const fallback = weightedTake(pool, () => true, selected, random);
    if (!fallback) break;
    selected.push(fallback);
  }
  return selected.slice(0, count);
}

export function hydrateOwnedItems(state) {
  state.items = (state.items ?? []).map((saved) => ITEM_BY_ID[saved.id] ? createOwnedItem(ITEM_BY_ID[saved.id], saved) : null).filter(Boolean);
  state.exiled_cards ??= [];
  return state.items;
}

export function addItem(state, id, saved = {}) {
  if (state.mode !== GAME_MODES.ENDLESS && state.items.some((entry) => entry.id === id)) return false;
  const source = ITEM_BY_ID[id];
  if (!source || source.consumable) return false;
  state.items.push(createOwnedItem(source, saved));
  return true;
}

function recordItemHistory(state, entry, consumed) {
  state.item_history ??= [];
  state.item_history.push({ round: state.current_round, item_id: entry.id, consumed });
}

export function chooseItem(state, selection) {
  const entry = typeof selection === "string" ? getItemById(selection) : cloneItem(selection);
  if (!entry) return { success: false, reason: "not_found" };
  if (state.mode !== GAME_MODES.ENDLESS && ((state.item_history ?? []).some((history) => history.item_id === entry.id) || state.items.some((owned) => owned.id === entry.id))) {
    return { success: false, reason: "duplicate" };
  }
  if (entry.effect.kind === "card_pool_choice") {
    recordItemHistory(state, entry, true);
    return { success: true, item: entry, resolution: "card_choice", card_type: entry.effect.card_type, message: `${entry.name} 等待选牌` };
  }
  if (entry.effect.kind === "grant_reroll_tokens") {
    state.reroll_tokens = safeAdd(state.reroll_tokens ?? 0, entry.effect.tokens ?? 0);
    recordItemHistory(state, entry, true);
    return { success: true, item: entry, resolution: "immediate", message: `${entry.name}：刷新标记 +${entry.effect.tokens ?? 0}` };
  }
  if (entry.effect.kind === "category_round_choice") {
    recordItemHistory(state, entry, false);
    return { success: true, item: entry, resolution: "category_choice", message: `${entry.name} 等待选择类别` };
  }
  recordItemHistory(state, entry, false);
  if (!addItem(state, entry.id)) return { success: false, reason: "duplicate" };
  return { success: true, item: entry, resolution: "permanent", message: `${entry.name} 已生效` };
}

export function activateCategoryRoundItem(state, itemId, selectedType) {
  const source = ITEM_BY_ID[itemId];
  if (!source || source.effect.kind !== "category_round_choice") return { success: false, reason: "not_found" };
  state.items.push(createOwnedItem(source, { selected_type: selectedType, applies_round: state.current_round + 1 }));
  const history = [...(state.item_history ?? [])].reverse().find((entry) => entry.item_id === itemId && !entry.consumable_resolved);
  if (history) {
    history.consumed = true;
    history.consumable_resolved = true;
    history.selected_type = selectedType;
  }
  return { success: true, message: `${source.name}：下一轮${selectedType}牌结算 +${source.effect.bonus}` };
}

function randomWeightedCards(pool, count, random) {
  const candidates = [...pool];
  const result = [];
  while (candidates.length > 0 && result.length < count) {
    const total = candidates.reduce((sum, card) => sum + (RARITY_WEIGHT[card.rarity] ?? 1), 0);
    let roll = random() * total;
    let chosenIndex = candidates.length - 1;
    for (let index = 0; index < candidates.length; index += 1) {
      roll -= RARITY_WEIGHT[candidates[index].rarity] ?? 1;
      if (roll <= 0) { chosenIndex = index; break; }
    }
    result.push(candidates.splice(chosenIndex, 1)[0]);
  }
  return result;
}

export function getItemCardOffers(type, count = 3, random = Math.random) {
  return randomWeightedCards(createShopCardPool().filter((card) => card.type === type), count, random);
}

function isCorrectAction(action, card) {
  return (card.edibility === "edible" && action === "eat") || (card.edibility === "inedible" && action === "discard");
}

function addBonus(result, item, amount, detail = null) {
  if (!amount) return;
  result.flat_bonus = safeAdd(result.flat_bonus, amount);
  result.messages.push(detail ?? `${item.name} +${amount}`);
}

export function getItemActionOverrides(state, action, card) {
  const bestSide = (state.items ?? []).some((item) => item.effect.kind === "best_side");
  const edgeItems = (state.items ?? []).filter((item) => item.effect.kind === "edge_points");
  const isLast = state.round.actions.length > 0 && getRemainingCardCount(state) === 0;
  return {
    use_best_side: bestSide,
    force_zero: edgeItems.length > 0 && state.round.actions.length === 0,
    printed_multiplier: isLast
      ? edgeItems.reduce((product, item) => safeProduct(product, item.effect.last_multiplier ?? 2), 1)
      : 1,
  };
}

export function resolveItemActionEffects(state, action, card) {
  const result = { flat_bonus: 0, messages: [], markers: {}, effect_trace: [] };
  const wrong = !isCorrectAction(action, card);
  const previousAction = state.round.last_item_action;
  const processor = createEffectProcessor();
  (state.items ?? []).forEach((item, index) => {
    processor.enqueue({
      id: `item:${item.instance_id ?? item.id}:action`,
      source: item.name,
      layer: EFFECT_LAYERS.TRIGGERED,
      timestamp: index,
      resolve() {
        switch (item.effect.kind) {
      case "wrong_eat_bonus":
        if (wrong && action === "eat") addBonus(result, item, item.effect.bonus ?? 1);
        break;
      case "alternate_bonus":
        if ((previousAction === "eat" || previousAction === "discard") && previousAction !== action) {
          state.round.item_alternation_count = safeAdd(state.round.item_alternation_count ?? 0, 1);
          addBonus(result, item, item.effect.bonus ?? 1, `${item.name}：【交替 ×${state.round.item_alternation_count}】+${item.effect.bonus ?? 1}`);
        }
        break;
      case "fruit_discard_bonus":
        if (action === "discard" && card.type === "水果") addBonus(result, item, item.effect.bonus ?? 2);
        break;
      case "category_round_choice":
        if (item.applies_round === state.current_round && card.type === item.selected_type) addBonus(result, item, item.effect.bonus ?? 4);
        break;
      case "first_type_gold": {
        const key = `item:${item.instance_id ?? item.id}:gold`;
        if (action === item.effect.action && card.type === item.effect.target_type && !state.round.effect_trigger_counts[key]) {
          state.round.effect_trigger_counts[key] = 1;
          queueRoundGold(state, item.name, item.effect.gold ?? 1, "item");
          result.messages.push(`${item.name}：金币 +${item.effect.gold ?? 1}`);
        }
        break;
      }
      case "fruit_combo_first_gold": {
        const nextCombo = (state.round.fruit_combo ?? 0) + (card.effect?.combo_gain ?? 1);
        const key = `item:${item.instance_id ?? item.id}:gold`;
        if (action === "eat" && card.type === "水果" && nextCombo >= (item.effect.threshold ?? 3) && !state.round.effect_trigger_counts[key]) {
          state.round.effect_trigger_counts[key] = 1;
          queueRoundGold(state, item.name, item.effect.gold ?? 1, "item");
          result.messages.push(`${item.name}：金币 +${item.effect.gold ?? 1}`);
        }
        break;
      }
      case "negative_action_free_reroll": {
        const printed = action === "eat" ? card.eat_points : card.discard_points;
        const key = `item:${item.instance_id ?? item.id}:reroll`;
        if (printed < 0 && !state.round.effect_trigger_counts[key]) {
          state.round.effect_trigger_counts[key] = 1;
          state.round.shop_free_rerolls = safeAdd(state.round.shop_free_rerolls, item.effect.count ?? 1);
          result.messages.push(`${item.name}：商店免费刷新 +${item.effect.count ?? 1}`);
        }
        break;
      }
          default:
            break;
        }
      },
    });
  });
  result.effect_trace = processor.resolve({ type: "item_action", action, card_uuid: card.uuid }).trace;
  return result;
}

function gasFireCard(state, item) {
  const art = getCardById("F008") ?? getCardById("F009");
  state.item_serial = safeAdd(state.item_serial ?? 0, 1);
  state.round.generated_count = safeAdd(state.round.generated_count ?? 0, 1);
  return {
    ...art,
    id: "TMP-GAS-FIRE",
    name: "沼气火",
    rarity: "稀有",
    type: "通用",
    edibility: "edible",
    eat_points: 8,
    discard_points: -3,
    base_eat_points: 8,
    base_discard_points: -3,
    effect: null,
    synergy_tags: ["临时", "生成", "摧毁"],
    status_keywords: ["临时"],
    temporary: true,
    no_item_copy: true,
    generated_from: `item:${item.id}`,
    generated_label: item.name,
    uuid: `TMP-GAS-${state.current_round}-${state.item_serial}`,
  };
}

export function resolveItemAfterActionEffects(state, action, card, entry, context = {}) {
  const result = { score_bonus: 0, messages: [], item_events: [], point_changes: [], effect_trace: [] };
  const processor = createEffectProcessor();
  (state.items ?? []).forEach((item, index) => {
    processor.enqueue({
      id: `item:${item.instance_id ?? item.id}:after-action`,
      source: item.name,
      layer: EFFECT_LAYERS.AFTERMATH,
      timestamp: index,
      resolve() {
        if (item.effect.kind === "restore_growth") {
          for (const restored of context.restored_stats ?? []) {
            const target = state.deck.find((owned) => owned.uuid === restored.card_uuid);
            if (!target) continue;
            const amount = changePermanentCard(state, target, restored.stat, restored.amount);
            if (amount > 0) {
              result.point_changes.push({ card_name: target.name, stat: restored.stat, amount });
              result.messages.push(`${item.name}：${target.name}${restored.stat === "eat_points" ? "吃分" : "弃分"}永久 +${amount}`);
            }
          }
        }
        if (item.effect.kind === "destroy_spawn_gas" && (context.destroyed_count ?? 0) > 0) {
          const currentIndex = state.round.draw_pile.findIndex((candidate) => candidate.uuid === card.uuid);
          const insertAt = currentIndex < 0 ? state.round.draw_pile.length : currentIndex;
          const generated = Array.from({ length: context.destroyed_count }, () => gasFireCard(state, item));
          state.round.draw_pile.splice(insertAt, 0, ...generated);
          result.messages.push(`${item.name}：牌堆顶插入沼气火 ×${generated.length}`);
        }
        if (item.effect.kind === "dessert_discard_growth" && action === "discard" && card.type === "甜点") {
          const amount = changePermanentCard(state, card, "eat_points", item.effect.bonus ?? 1);
          if (amount > 0) {
            result.point_changes.push({ card_name: card.name, stat: "eat_points", amount });
            result.messages.push(`${item.name}：${card.name}吃分永久 +${amount}`);
          }
        }
      },
    });
  });
  result.effect_trace = processor.resolve({ type: "item_after_action", action, card_uuid: card.uuid, entry }).trace;
  state.round.last_item_action = action;
  return result;
}

export function resolveItemPostponeEffects(state) {
  state.round.last_item_action = "postpone";
  return { score_bonus: 0, messages: [], item_events: [] };
}

export function protectFirstDestruction(state, cardUuid) {
  const item = (state.items ?? []).find((entry) => {
    if (entry.effect.kind !== "protect_first_destroy") return false;
    const key = `item:${entry.instance_id ?? entry.id}:destroy-protection`;
    return !state.round.effect_trigger_counts[key];
  });
  if (!item) return false;
  const key = `item:${item.instance_id ?? item.id}:destroy-protection`;
  state.round.effect_trigger_counts[key] = 1;
  state.round.item_destroy_protected = true;
  state.round.pending_item_messages ??= [];
  const card = state.deck.find((entry) => entry.uuid === cardUuid);
  state.round.pending_item_messages.push(`${item.name}：保护「${card?.name ?? "卡牌"}」，本次不被摧毁`);
  return true;
}

export function drainPendingItemMessages(state) {
  const messages = [...(state.round.pending_item_messages ?? [])];
  state.round.pending_item_messages = [];
  return messages;
}

export function shouldEchoDrinkEffect(state, card) {
  return getDrinkEffectRepeaters(state, card).length > 0;
}

export function getDrinkEffectRepeaters(state, card) {
  if (card?.type !== "饮料" || !card.effect) return [];
  return (state.items ?? []).filter((item) => item.effect.kind === "double_drink_effect");
}

export function getBananaGenerationCardId(state, fallback) {
  return fallback === "F001" && (state.items ?? []).some((item) => item.effect.kind === "banana_pear") ? "F009" : fallback;
}

export function maybeDuplicateGeneratedCard(state, generated) {
  if (generated?.no_item_copy || state.deck.length >= GAME_CONFIG.max_deck_size) return null;
  const items = (state.items ?? []).filter((entry) => {
    if (entry.effect.kind !== "first_generation_copy") return false;
    const key = `item:${entry.instance_id ?? entry.id}:generation-copy`;
    return !state.round.effect_trigger_counts[key];
  });
  const copies = [];
  for (const item of items) {
    if (state.deck.length >= GAME_CONFIG.max_deck_size) break;
    const key = `item:${item.instance_id ?? item.id}:generation-copy`;
    state.round.effect_trigger_counts[key] = 1;
    state.round.item_generation_copied = true;
    state.item_serial = safeAdd(state.item_serial ?? 0, 1);
    state.round.generated_count = safeAdd(state.round.generated_count ?? 0, 1);
    const copy = {
      ...generated,
      effect: null,
      synergy_tags: [...new Set([...(generated.synergy_tags ?? []), "临时", "复制"])],
      status_keywords: [...new Set([...(generated.status_keywords ?? []).filter((tag) => tag !== "弱化"), "临时", "复制"])],
      weakened: false,
      temporary: true,
      no_item_copy: true,
      generated_from: `item:${item.id}`,
      generated_label: item.name,
      uuid: `${generated.id}-TEMP-COPY-${state.current_round}-${state.item_serial}`,
    };
    state.deck.push(copy);
    copies.push(copy);
    state.round.pending_item_messages ??= [];
    state.round.pending_item_messages.push(`${item.name}：额外生成临时「${copy.name}」`);
  }
  return copies[0] ?? null;
}

function returnExiledCards(state) {
  const returning = (state.exiled_cards ?? []).filter((entry) => entry.return_round <= state.current_round);
  state.exiled_cards = (state.exiled_cards ?? []).filter((entry) => entry.return_round > state.current_round);
  const messages = [];
  for (const entry of returning) {
    const card = { ...entry.card, synergy_tags: [...(entry.card.synergy_tags ?? [])], effect: entry.card.effect ? { ...entry.card.effect, keywords: [...(entry.card.effect.keywords ?? [])] } : null };
    card.eat_points = safeAdd(card.eat_points ?? 0, entry.eat_bonus ?? 0);
    state.deck.push(card);
    messages.push(`冷藏周转箱：「${card.name}」返回，吃分永久 +${entry.eat_bonus}`);
  }
  return messages;
}

export function applyRoundItemSetup(state) {
  hydrateOwnedItems(state);
  const messages = returnExiledCards(state);
  const starters = state.items.filter((item) => item.effect.kind === "fruit_combo_start");
  if (starters.length > 0) {
    state.round.fruit_combo = starters.reduce((sum, item) => sum + (item.effect.amount ?? 1), 0);
    state.round.best_fruit_combo = Math.max(state.round.best_fruit_combo ?? 0, state.round.fruit_combo);
    messages.push(`半熟果盘：水果连击从 ${state.round.fruit_combo} 开始`);
  }
  state.round.shop_free_rerolls = safeAdd(state.round.shop_free_rerolls ?? 0, state.items
    .filter((item) => item.effect.kind === "free_shop_reroll")
    .reduce((sum, item) => sum + (item.effect.count ?? 1), 0));
  return messages;
}

export function applyRoundItemDrawSetup(state, random = Math.random) {
  const item = state.items.find((entry) => entry.effect.kind === "animal_leads");
  if (!item || state.round.draw_pile.length === 0) return [];
  const all = [...state.round.draw_pile, ...(state.round.reserve_cards ?? [])];
  const animals = all.filter((card) => card.type === "动物");
  if (animals.length === 0) return [];
  const chosen = animals[Math.min(animals.length - 1, Math.floor(random() * animals.length))];
  const topIndex = state.round.draw_pile.length - 1;
  const drawIndex = state.round.draw_pile.findIndex((card) => card.uuid === chosen.uuid);
  if (drawIndex >= 0) {
    [state.round.draw_pile[drawIndex], state.round.draw_pile[topIndex]] = [state.round.draw_pile[topIndex], state.round.draw_pile[drawIndex]];
  } else {
    const reserveIndex = state.round.reserve_cards.findIndex((card) => card.uuid === chosen.uuid);
    const replaced = state.round.draw_pile[topIndex];
    state.round.draw_pile[topIndex] = chosen;
    state.round.reserve_cards[reserveIndex] = replaced;
  }
  return [`${item.name}：「${chosen.name}」领队登场`];
}

function transformRandomCardToRabbit(state, item, random) {
  const candidates = state.deck.filter((card) => card.id !== item.effect.card_id && !card.temporary);
  if (candidates.length === 0) return null;
  const target = candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
  const template = getCardById(item.effect.card_id);
  if (!template) return null;
  const transformed = {
    ...template,
    synergy_tags: [...(template.synergy_tags ?? [])],
    effect: template.effect ? { ...template.effect, keywords: [...(template.effect.keywords ?? [])] } : null,
    uuid: target.uuid,
  };
  state.deck[state.deck.findIndex((card) => card.uuid === target.uuid)] = transformed;
  return { from: target.name, to: transformed.name };
}

export function getItemRoundEndEffects(state, random = Math.random) {
  const result = { score_bonus: 0, messages: [] };
  const magicHats = [];
  for (const item of [...(state.items ?? [])]) {
    if (item.effect.kind === "wrong_streak_round") {
      const bonus = state.round.best_wrong_edibility_streak ?? 0;
      result.score_bonus = safeAdd(result.score_bonus, bonus);
      if (bonus > 0) result.messages.push(`${item.name}：最高错误食性连击 ${bonus}，+${bonus}`);
    }
    if (item.effect.kind === "delete_every_rounds" && state.current_round % (item.effect.interval ?? 3) === 0 && item.last_trigger_round !== state.current_round) {
      item.last_trigger_round = state.current_round;
      state.delete_tokens = safeAdd(state.delete_tokens ?? 0, item.effect.tokens ?? 1);
      result.messages.push(`${item.name}：删牌标记 +${item.effect.tokens ?? 1}`);
    }
    if (item.effect.kind === "unique_type_round") {
      const bonus = new Set(state.deck.filter((card) => !card.temporary).map((card) => card.type)).size;
      result.score_bonus = safeAdd(result.score_bonus, bonus);
      result.messages.push(`${item.name}：${bonus} 种类别，+${bonus}`);
    }
    if (item.effect.kind === "magic_hat") {
      magicHats.push(item);
    }
    if (item.effect.kind === "fruit_sabbatical") {
      const lastFruit = [...state.round.actions].reverse().find((action) => action.action === "eat" && action.type === "水果");
      const index = lastFruit ? state.deck.findIndex((card) => card.uuid === lastFruit.card_uuid && !card.temporary) : -1;
      if (index >= 0) {
        const [card] = state.deck.splice(index, 1);
        state.exiled_cards ??= [];
        state.exiled_cards.push({ card, return_round: state.current_round + 2, eat_bonus: item.effect.bonus ?? 2 });
        result.messages.push(`${item.name}：「${card.name}」冷藏一轮，返回时吃分 +${item.effect.bonus ?? 2}`);
      }
    }
    if (item.effect.kind === "action_trio") {
      const actions = new Set(state.round.actions.map((entry) => entry.action));
      if (actions.has("eat") && actions.has("discard") && (state.round.postpone_count ?? 0) > 0) {
        result.score_bonus = safeAdd(result.score_bonus, item.effect.bonus ?? 1);
        result.messages.push(`${item.name}：吃、弃、后置齐全，+${item.effect.bonus ?? 1}`);
      }
    }
  }
  for (const item of magicHats) {
    const changed = transformRandomCardToRabbit(state, item, random);
    if (changed) result.messages.push(`${item.name}：${changed.from} 变成兔子`);
  }
  state.items = (state.items ?? []).filter((item) => {
    if (item.effect.kind !== "category_round_choice" || item.applies_round !== state.current_round) return true;
    result.messages.push(`${item.name}：${item.selected_type}专场结束，道具自毁`);
    return false;
  });
  return result;
}

export function getPostponeLimit(state) {
  const extraUses = (state.items ?? []).reduce((total, entry) => {
    if (entry.effect.kind !== "extra_postpone" && entry.effect.kind !== "unlimited_postpone") return total;
    return safeAdd(total, Math.max(0, Math.floor(entry.effect.extra_uses ?? 1)));
  }, 0);
  return 1 + extraUses;
}

export function hasExtraPostpone(state) { return getPostponeLimit(state) > 1; }

export function getItemFinalMultipliers(state) {
  return (state.items ?? []).flatMap((item) => {
    if (item.effect.kind !== "speed_clear_multiplier") return [];
    const elapsed = state.round.elapsed_ms ?? Number.POSITIVE_INFINITY;
    return elapsed > 0 && elapsed <= (item.effect.threshold_ms ?? 12000)
      ? [{ name: item.name, multiplier: item.effect.multiplier ?? 1.2, source: "item" }]
      : [];
  });
}

export function applyRoundEndItems(state, random = Math.random) { return getItemRoundEndEffects(state, random); }
