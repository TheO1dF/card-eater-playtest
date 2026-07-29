import { safeAdd } from "./numbers.js";
import { getCardById } from "./data.js";

const defineItem = (definition, iconIndex) => Object.freeze({
  rarity: definition.consumable ? "一次性" : "永久",
  icon_atlas: "meta-atlas.webp",
  icon_columns: 4,
  icon_rows: 4,
  icon_x: iconIndex % 4,
  icon_y: Math.floor(iconIndex / 4),
  ...definition,
});

export const ITEM_LIBRARY = Object.freeze([
  defineItem({ id: "IT001", name: "万花镜", role: "跨类别", description: "每轮每种类别第一次登场时，该牌 +2 分。", effect: { kind: "first_type_bonus", bonus: 2 } }, 0),
  defineItem({ id: "IT002", name: "果汁机", role: "水果", description: "连续吃水果时，额外获得当前连击数，最多 +3 分。", effect: { kind: "fruit_combo_scale", maximum: 3 } }, 1),
  defineItem({ id: "IT003", name: "猫爪杯垫", role: "正确食性", description: "每轮第一次按正确食性处理卡牌时 +5 分。", effect: { kind: "first_correct_bonus", bonus: 5 } }, 2),
  defineItem({ id: "IT004", name: "真空保鲜盒", role: "生成", description: "生成或弱化的牌结算时 +4 分。", effect: { kind: "generated_bonus", bonus: 4 } }, 3),
  defineItem({ id: "IT005", name: "候补铃", role: "餐盘外", description: "餐盘外还有同类别牌时，该类别每轮第一次结算 +2 分。", effect: { kind: "reserve_type_bonus", bonus: 2 } }, 4),
  defineItem({ id: "IT006", name: "铁胃调料", role: "逆向", description: "不按食性处理卡牌时 +3 分。", effect: { kind: "wrong_edibility_bonus", bonus: 3 } }, 5),
  defineItem({ id: "IT007", name: "双面餐叉", role: "交替", description: "吃与弃交替时 +2 分。", effect: { kind: "alternating_bonus", bonus: 2 } }, 6),
  defineItem({ id: "IT008", name: "尾盘礼花", role: "位置", description: "餐盘最后一张牌按正确食性处理时 +6 分。", effect: { kind: "last_correct_bonus", bonus: 6 } }, 7),
  defineItem({ id: "IT011", name: "永动传送带", role: "排牌", description: "同一张牌每轮可以无限次后置。", effect: { kind: "unlimited_postpone" } }, 10),
  defineItem({ id: "IT012", name: "纸梨篮", role: "生成", description: "每轮开始时，若没有它生成的牌，则生成 1 张弱化梨子。", effect: { kind: "round_generate_weakened", card_id: "F009" } }, 11),
  defineItem({ id: "IT013", name: "三拍节奏器", role: "节奏", description: "每轮第 3、6、9…次行动额外 +4 分。", effect: { kind: "every_action_bonus", every: 3, bonus: 4 } }, 12),
  defineItem({ id: "IT014", name: "碎屑压分机", role: "摧毁", description: "本轮摧毁过卡牌时，最终得分 ×1.2。", effect: { kind: "destroyed_multiplier", minimum: 1, multiplier: 1.2 } }, 13),
  defineItem({ id: "IT101", name: "裁卡钳", role: "整理", consumable: true, description: "立即获得 2 枚删牌 token。", effect: { kind: "grant_delete_tokens", amount: 2 } }, 14),
  defineItem({ id: "IT102", name: "换菜单", role: "刷新", consumable: true, description: "立即获得 2 枚选牌刷新 token。", effect: { kind: "grant_reroll_tokens", amount: 2 } }, 15),
]);

const ITEM_BY_ID = Object.freeze(Object.fromEntries(ITEM_LIBRARY.map((entry) => [entry.id, entry])));

function cloneItem(source) {
  return source ? { ...source, effect: { ...source.effect } } : null;
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

export function randomDraftItems(state, count = 3, random = Math.random) {
  const seen = new Set([
    ...(state.items ?? []).map((entry) => entry.id),
    ...(state.item_history ?? []).map((entry) => entry.item_id),
  ]);
  const pool = createItemPool().filter((entry) => !seen.has(entry.id));
  const result = [];
  while (result.length < count && pool.length > 0) {
    result.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  }
  if (result.length > 0 && result.every((entry) => entry.consumable)) {
    const permanent = pool.find((entry) => !entry.consumable);
    if (permanent) result[result.length - 1] = permanent;
  }
  return result;
}

export function addItem(state, id) {
  if (state.items.some((entry) => entry.id === id)) return false;
  const entry = getItemById(id);
  if (!entry || entry.consumable) return false;
  state.items.push(entry);
  return true;
}

export function chooseItem(state, selection) {
  const entry = typeof selection === "string" ? getItemById(selection) : cloneItem(selection);
  if (!entry) return { success: false, reason: "not_found" };
  state.item_history ??= [];
  state.item_history.push({ round: state.current_round, item_id: entry.id, consumed: Boolean(entry.consumable) });
  if (!entry.consumable) {
    if (!addItem(state, entry.id)) return { success: false, reason: "duplicate" };
    return { success: true, item: entry, message: `${entry.name} 已永久生效` };
  }
  if (entry.effect.kind === "grant_delete_tokens") state.delete_tokens = safeAdd(state.delete_tokens ?? 0, entry.effect.amount);
  if (entry.effect.kind === "grant_reroll_tokens") state.reroll_tokens = safeAdd(state.reroll_tokens ?? 0, entry.effect.amount);
  return { success: true, item: entry, consumed: true, message: `${entry.name} 已使用：${entry.description}` };
}

export function applyRoundItemSetup(state, options = {}) {
  const createId = options.create_id ?? ((card) => `${card.id}-item-${state.current_round}`);
  const messages = [];
  for (const entry of state.items) {
    const effect = entry.effect;
    if (effect.kind !== "round_generate_weakened") continue;
    const sourceKey = `item:${entry.id}`;
    if (state.deck.some((card) => card.generated_from === sourceKey)) continue;
    const template = getCardById(effect.card_id);
    if (!template) continue;
    state.deck.push({
      ...template,
      synergy_tags: [...(template.synergy_tags ?? [])],
      effect: template.effect ? { ...template.effect, keywords: [...(template.effect.keywords ?? [])] } : null,
      generated_from: sourceKey,
      generated_label: entry.name,
      weakened: true,
      status_keywords: ["弱化"],
      uuid: createId(template, state.deck.length),
    });
    messages.push(`${entry.name}：生成 1 张弱化梨子`);
  }
  return messages;
}

export function hasUnlimitedPostpone(state) {
  return state.items.some((entry) => entry.effect?.kind === "unlimited_postpone");
}

function isCorrectAction(action, card) {
  return (card.edibility === "edible" && action === "eat")
    || (card.edibility === "inedible" && action === "discard");
}

export function resolveItemActionEffects(state, action, card) {
  let flatBonus = 0;
  const messages = [];
  const add = (entry, amount) => {
    flatBonus = safeAdd(flatBonus, amount);
    messages.push(`${entry.name} +${amount}`);
  };
  for (const entry of state.items) {
    const effect = entry.effect;
    if (effect.kind === "first_type_bonus") {
      const key = `item:${entry.id}:type:${card.type}`;
      if (!state.round.effect_trigger_counts[key]) {
        state.round.effect_trigger_counts[key] = 1;
        add(entry, effect.bonus);
      }
    }
    if (effect.kind === "fruit_combo_scale" && action === "eat" && card.type === "水果") {
      add(entry, Math.min(effect.maximum, (state.round.fruit_combo ?? 0) + 1));
    }
    if (effect.kind === "first_correct_bonus" && isCorrectAction(action, card)) {
      const key = `item:${entry.id}:correct`;
      if (!state.round.effect_trigger_counts[key]) {
        state.round.effect_trigger_counts[key] = 1;
        add(entry, effect.bonus);
      }
    }
    if (effect.kind === "generated_bonus" && (card.generated_from || card.weakened)) add(entry, effect.bonus);
    if (effect.kind === "reserve_type_bonus" && (state.round.reserve_type_counts?.[card.type] ?? 0) > 0) {
      const key = `item:${entry.id}:reserve:${card.type}`;
      if (!state.round.effect_trigger_counts[key]) {
        state.round.effect_trigger_counts[key] = 1;
        add(entry, effect.bonus);
      }
    }
    if (effect.kind === "wrong_edibility_bonus" && !isCorrectAction(action, card)) add(entry, effect.bonus);
    if (effect.kind === "alternating_bonus") {
      const previous = state.round.actions.at(-1);
      if (previous && previous.action !== action) add(entry, effect.bonus);
    }
    if (effect.kind === "last_correct_bonus" && state.round.draw_pile.length === 1 && isCorrectAction(action, card)) add(entry, effect.bonus);
    if (effect.kind === "every_action_bonus" && (state.round.actions.length + 1) % effect.every === 0) add(entry, effect.bonus);
  }
  return { flat_bonus: flatBonus, messages };
}

export function getItemFinalMultipliers(state) {
  const multipliers = [];
  for (const entry of state.items) {
    const effect = entry.effect;
    if (effect.kind === "deck_multiplier") {
      const meetsMinimum = effect.minimum === undefined || state.deck.length >= effect.minimum;
      const meetsMaximum = effect.maximum === undefined || state.deck.length <= effect.maximum;
      if (meetsMinimum && meetsMaximum) multipliers.push({ name: entry.name, multiplier: effect.multiplier, source: "item" });
    }
    if (effect.kind === "destroyed_multiplier" && state.round.destroyed_count >= effect.minimum) {
      multipliers.push({ name: entry.name, multiplier: effect.multiplier, source: "item" });
    }
  }
  return multipliers;
}

export function applyRoundEndItems() {
  return [];
}
