import { safeAdd } from "./numbers.js";
import { getCardById } from "./data.js";

const item = (definition, iconIndex) => Object.freeze({
  icon_atlas: "meta-atlas.webp",
  icon_columns: 4,
  icon_rows: 4,
  icon_x: iconIndex % 4,
  icon_y: Math.floor(iconIndex / 4),
  ...definition,
});

const shopItem = (definition, iconIndex) => Object.freeze({
  icon_atlas: "shop-items-atlas-v013.webp",
  icon_columns: 6,
  icon_rows: 4,
  icon_x: iconIndex % 6,
  icon_y: Math.floor(iconIndex / 6),
  ...definition,
});

export const ITEM_LIBRARY = Object.freeze([
  item({
    id: "IT001", name: "重启按钮", rarity: "高级道具", role: "主动",
    description: "牌组不超过 10 张时，每轮获得 1 次重洗。",
    effect: { kind: "round_reshuffle_charge", charges: 1, max_deck_size: 10 },
  }, 0),
  item({
    id: "IT002", name: "回收钱包", rarity: "高级道具", role: "经济",
    description: "每轮每弃 3 张牌获得 2 金币，最多触发 3 次。",
    effect: { kind: "discard_gold_every", count: 3, gold: 2, max_triggers: 3 },
  }, 1),
  item({
    id: "IT003", name: "冥王星仪", rarity: "高级道具", role: "位置",
    description: "每轮最后一张牌若被弃掉，额外 +5 分。",
    effect: { kind: "last_discard_bonus", bonus: 5 },
  }, 2),
  item({
    id: "IT004", name: "袖珍食谱", rarity: "高级道具", role: "小牌组",
    description: "牌组不超过 8 张时，本轮最终得分 ×1.25。",
    effect: { kind: "deck_size_multiplier", maximum: 8, multiplier: 1.25 },
  }, 3),
  item({
    id: "IT005", name: "优惠打印机", rarity: "高级道具", role: "商店",
    description: "每间商店获得 1 次免费刷新；刷新后仍会提高后续价格。",
    effect: { kind: "free_shop_reroll", count: 1 },
  }, 4),
  item({
    id: "IT006", name: "苦味勋章", rarity: "高级道具", role: "牺牲",
    description: "吃下负分牌后的下一张牌额外 +4 分。",
    effect: { kind: "after_negative_eat_bonus", bonus: 4 },
  }, 5),
  item({
    id: "IT007", name: "无底封条", rarity: "高级道具", role: "大牌组",
    description: "牌组达到 14 张时，本轮最终得分 ×1.05。",
    effect: { kind: "deck_size_multiplier", minimum: 14, multiplier: 1.05 },
  }, 6),
  item({
    id: "IT008", name: "任务王冠", rarity: "高级道具", role: "通用",
    description: "永久使每轮最终得分 ×1.1。",
    effect: { kind: "global_multiplier", multiplier: 1.1 },
  }, 7),
  item({
    id: "IT009", name: "拆解徽记", rarity: "高级道具", role: "摧毁",
    description: "本轮至少【摧毁】1 张牌时，最终得分 ×1.15。",
    effect: { kind: "destroyed_multiplier", minimum: 1, multiplier: 1.15 },
  }, 0),
  item({
    id: "IT010", name: "万花镜", rarity: "高级道具", role: "多样性",
    description: "每轮每种类别首次出现时，该牌额外 +2 分。",
    effect: { kind: "first_type_bonus", bonus: 2 },
  }, 1),
  item({
    id: "IT011", name: "孵化灯", rarity: "高级道具", role: "生成",
    description: "由【生成】加入牌组的卡牌额外 +3 分。",
    effect: { kind: "generated_card_bonus", bonus: 3 },
  }, 2),
  item({
    id: "IT012", name: "节奏鞋", rarity: "高级道具", role: "交替",
    description: "行动与前一张牌的吃/弃不同时，额外 +2 分。",
    effect: { kind: "alternating_action_bonus", bonus: 2 },
  }, 3),
  shopItem({
    id: "IT101", name: "魔法帽", rarity: "普通道具", role: "动物生成", shop_price: 12, min_shop_round: 3, max_shop_round: 8,
    description: "轮次结束时，将牌组中随机 1 张非兔子牌变为兔子。",
    effect: { kind: "round_end_transform", target_card_id: "A004" },
  }, 0),
  shopItem({
    id: "IT102", name: "水果旗", rarity: "普通道具", role: "水果连击", shop_price: 6,
    description: "连续吃水果时，每张额外 +1 分。",
    effect: { kind: "fruit_combo_bonus", bonus: 1 },
  }, 1),
  shopItem({
    id: "IT103", name: "快餐纸袋", rarity: "普通道具", role: "厌食转化", shop_price: 4,
    description: "弃掉已经发生【厌食】的快餐时，额外 +1 分。",
    effect: { kind: "anorexia_discard_bonus", bonus: 1 },
  }, 2),
  shopItem({
    id: "IT104", name: "糖霜罐", rarity: "普通道具", role: "甜点留存", shop_price: 7, min_shop_round: 1,
    description: "甜点被弃掉触发【留存】时，永久成长额外 +1。",
    effect: { kind: "retention_growth_bonus", amount: 1 },
  }, 3),
  shopItem({
    id: "IT105", name: "投币吸管", rarity: "普通道具", role: "饮料经济", shop_price: 4, min_shop_round: 2, max_shop_round: 8,
    description: "每轮第一次吃掉并摧毁饮料时，结算金币 +1。",
    effect: { kind: "drink_first_gold", gold: 1 },
  }, 4),
  shopItem({
    id: "IT106", name: "兽牙项圈", rarity: "普通道具", role: "动物吞食", shop_price: 8, min_shop_round: 3,
    description: "动物通过【摧毁】吞食上一张牌时，弃分永久成长额外 +1。",
    effect: { kind: "devour_growth_bonus", amount: 1 },
  }, 5),
  shopItem({
    id: "IT107", name: "黄铜星图", rarity: "普通道具", role: "星体机制", shop_price: 4, min_shop_round: 2,
    description: "每轮第一张星体牌额外 +2 分。",
    effect: { kind: "first_type_bonus", target_type: "星体", bonus: 2 },
  }, 6),
  shopItem({
    id: "IT108", name: "工会徽章", rarity: "普通道具", role: "人物经济", shop_price: 4, min_shop_round: 2, max_shop_round: 10,
    description: "每轮第一次弃掉人物牌时，结算金币 +1。",
    effect: { kind: "first_type_gold", target_type: "人物", action: "discard", gold: 1 },
  }, 7),
  shopItem({
    id: "IT109", name: "候补餐签", rarity: "普通道具", role: "餐盘外联动", shop_price: 4, min_shop_round: 2,
    description: "若餐盘外还有同类别牌，每轮该类别首次处理时额外 +1 分。",
    effect: { kind: "reserve_matching_type_bonus", bonus: 1, once_per_type: true },
  }, 8),
  shopItem({
    id: "IT110", name: "排餐夹", rarity: "普通道具", role: "后置", shop_price: 4, min_shop_round: 2,
    description: "曾被【后置】的牌本轮结算时额外 +1 分。",
    effect: { kind: "postponed_card_bonus", bonus: 1 },
  }, 9),
  shopItem({
    id: "IT111", name: "回卷发条", rarity: "普通道具", role: "自动重洗", shop_price: 20, min_shop_round: 8, max_shop_round: 12,
    description: "牌组不超过 10 张时，每轮自动重洗次数 +1；可叠加。",
    effect: { kind: "round_reshuffle_charge", charges: 1, max_deck_size: 10 },
  }, 10),
  shopItem({
    id: "IT112", name: "优惠打印机", rarity: "普通道具", role: "刷新经济", shop_price: 6, min_shop_round: 4, max_shop_round: 9,
    description: "每间商店获得 1 次免费刷新，免费刷新仍会推进后续价格。",
    effect: { kind: "free_shop_reroll", count: 1 },
  }, 11),
  shopItem({
    id: "IT113", name: "夜市会员卡", rarity: "普通道具", role: "商店经济", shop_price: 8, min_shop_round: 5, max_shop_round: 10,
    description: "商店卡牌价格额外 -1，最低仍为 1 金币。",
    effect: { kind: "shop_price_discount", amount: 1 },
  }, 12),
  shopItem({
    id: "IT114", name: "餐盘量尺", rarity: "普通道具", role: "扩容经济", shop_price: 5, min_shop_round: 2, max_shop_round: 9,
    description: "餐盘扩容费用永久 -1，最低仍为 1 金币。",
    effect: { kind: "plate_upgrade_discount", amount: 1 },
  }, 13),
  shopItem({
    id: "IT115", name: "连击钱旗", rarity: "普通道具", role: "水果经济", shop_price: 4, min_shop_round: 3, max_shop_round: 10,
    description: "每轮水果连击首次达到 3 时，结算金币 +1。",
    effect: { kind: "fruit_combo_first_gold", threshold: 3, gold: 1 },
  }, 14),
  shopItem({
    id: "IT116", name: "甜点礼盒", rarity: "普通道具", role: "留存爆发", shop_price: 5, min_shop_round: 4,
    description: "吃下吃分达到 10 的甜点时，额外 +2 分。",
    effect: { kind: "dessert_burst_bonus", threshold: 10, bonus: 2 },
  }, 15),
  shopItem({
    id: "IT117", name: "纸果篮", rarity: "普通道具", role: "生成循环", shop_price: 5, min_shop_round: 2,
    description: "每轮开始时，若牌组中没有本物品生成的牌，则生成 1 张【弱化】苹果。",
    effect: { kind: "round_generate_weakened", card_id: "F001" },
  }, 16),
  shopItem({
    id: "IT118", name: "苦差零钱袋", rarity: "普通道具", role: "风险刷新", shop_price: 5, min_shop_round: 3, max_shop_round: 9,
    description: "每轮首次选择牌面负分的一侧时，随后商店获得 1 次免费刷新。",
    effect: { kind: "negative_action_free_reroll", count: 1 },
  }, 17),
  shopItem({
    id: "IT119", name: "随身盐盒", rarity: "普通道具", role: "小牌组", shop_price: 3, min_shop_round: 1,
    description: "牌组不超过 8 张时，每轮首次吃牌与首次弃牌各额外 +1 分。",
    effect: { kind: "compact_first_each_bonus", maximum: 8, bonus: 1 },
  }, 18),
  shopItem({
    id: "IT120", name: "铁胃糖", rarity: "普通道具", role: "硬吃", shop_price: 4, min_shop_round: 1,
    description: "每轮第一次错误食性处理额外 +2 分。",
    effect: { kind: "wrong_edibility_first_bonus", bonus: 2 },
  }, 19),
  shopItem({
    id: "IT121", name: "保温软垫", rarity: "普通道具", role: "候补收割", shop_price: 6, min_shop_round: 4,
    description: "本轮至少有 4 张牌未登上餐盘时，最终得分 ×1.05。",
    effect: { kind: "reserve_threshold_multiplier", minimum: 4, multiplier: 1.05 },
  }, 20),
  shopItem({
    id: "IT122", name: "独份餐签", rarity: "普通道具", role: "单卡", shop_price: 4, min_shop_round: 2,
    description: "牌组中仅有 1 张该类别的牌时，处理它额外 +2 分。",
    effect: { kind: "singleton_type_bonus", bonus: 2 },
  }, 21),
  shopItem({
    id: "IT123", name: "尾单夹", rarity: "普通道具", role: "位置", shop_price: 4, min_shop_round: 1,
    description: "每轮最后一张牌按正确食性处理时，额外 +2 分。",
    effect: { kind: "last_correct_action_bonus", bonus: 2 },
  }, 22),
  shopItem({
    id: "IT124", name: "逆向弹簧", rarity: "普通道具", role: "反向选择", shop_price: 3, min_shop_round: 2,
    description: "选择两项牌面中较低的一侧时，额外 +1 分。",
    effect: { kind: "lower_side_bonus", bonus: 1 },
  }, 23),
]);

const ITEM_BY_ID = Object.freeze(Object.fromEntries(ITEM_LIBRARY.map((entry) => [entry.id, entry])));

function cloneItem(source) {
  return source ? { ...source, effect: { ...source.effect } } : null;
}

export function getItemById(id) {
  return cloneItem(ITEM_BY_ID[id]);
}

export function createShopItemPool() {
  return ITEM_LIBRARY
    .filter((entry) => entry.rarity === "普通道具" && Number(entry.id.slice(2)) <= 124)
    .map(cloneItem);
}

export function addItem(state, id) {
  if (state.items.some((entry) => entry.id === id)) return false;
  const entry = getItemById(id);
  if (!entry) return false;
  state.items.push(entry);
  return true;
}

export function applyRoundItemSetup(state) {
  for (const entry of state.items) {
    const effect = entry.effect;
    if (effect.kind === "round_reshuffle_charge" && state.deck.length <= effect.max_deck_size) {
      state.round.reshuffle_charges += effect.charges;
    }
    if (effect.kind === "free_shop_reroll") {
      state.round.shop_free_rerolls += effect.count;
    }
    if (effect.kind === "round_generate_weakened") {
      const sourceKey = `item:${entry.id}`;
      const alreadyExists = state.deck.some((card) => card.generated_from === sourceKey);
      const template = getCardById(effect.card_id);
      if (!alreadyExists && template) {
        state.deck.push({
          ...template,
          synergy_tags: [...(template.synergy_tags ?? [])],
          effect: template.effect ? { ...template.effect, keywords: [...(template.effect.keywords ?? [])] } : null,
          generated_from: sourceKey,
          generated_label: entry.name,
          weakened: true,
          status_keywords: ["弱化"],
          uuid: `${effect.card_id}-${entry.id}-${state.current_round}`,
        });
      }
    }
  }
}

export function resolveItemActionEffects(state, action, card) {
  let flatBonus = 0;
  const messages = [];
  const selectedPrinted = action === "eat" ? card.eat_points : card.discard_points;
  const otherPrinted = action === "eat" ? card.discard_points : card.eat_points;
  const isCorrectAction = (targetAction, targetCard) => (
    (targetCard.edibility === "edible" && targetAction === "eat")
    || (targetCard.edibility === "inedible" && targetAction === "discard")
  );
  for (const entry of state.items) {
    const effect = entry.effect;
    if (effect.kind === "wrong_edibility_first_bonus" && !isCorrectAction(action, card)) {
      const key = `item:${entry.id}:hard-eat`;
      if (!state.round.effect_trigger_counts[key]) {
        state.round.effect_trigger_counts[key] = 1;
        flatBonus = safeAdd(flatBonus, effect.bonus);
        messages.push(`${entry.name} +${effect.bonus}`);
      }
    }
    if (effect.kind === "last_discard_bonus" && action === "discard" && state.round.draw_pile.length === 1) {
      flatBonus = safeAdd(flatBonus, effect.bonus);
      messages.push(`${entry.name} +${effect.bonus}`);
    }
    if (effect.kind === "after_negative_eat_bonus") {
      const previous = state.round.actions.at(-1);
      if (previous?.action === "eat" && previous.points < 0) {
        flatBonus = safeAdd(flatBonus, effect.bonus);
        messages.push(`${entry.name} +${effect.bonus}`);
      }
    }
    if (effect.kind === "discard_gold_every" && action === "discard") {
      const discardCount = state.round.discard_sequence.length + 1;
      const key = `item:${entry.id}`;
      const triggers = state.round.effect_trigger_counts[key] ?? 0;
      if (discardCount % effect.count === 0 && triggers < effect.max_triggers) {
        state.round.effect_trigger_counts[key] = triggers + 1;
        state.round.pending_gold_bonus += effect.gold;
        messages.push(`${entry.name}：金币 +${effect.gold}`);
      }
    }
    if (effect.kind === "first_correct_action_bonus" && state.round.actions.length === 0) {
      if (isCorrectAction(action, card)) {
        flatBonus = safeAdd(flatBonus, effect.bonus);
        messages.push(`${entry.name} +${effect.bonus}`);
      }
    }
    if (effect.kind === "first_correct_buff_next" && state.round.actions.length === 0 && isCorrectAction(action, card)) {
      state.round.buffs.push({ kind: "flat", action: "*", target_type: "*", remaining: 1, value: effect.bonus });
      messages.push(`${entry.name}：下一张 +${effect.bonus}`);
    }
    if (effect.kind === "first_discard_gold" && action === "discard") {
      const key = `item:${entry.id}:gold`;
      if (!state.round.effect_trigger_counts[key]) {
        state.round.effect_trigger_counts[key] = 1;
        state.round.pending_gold_bonus = safeAdd(state.round.pending_gold_bonus, effect.gold);
        messages.push(`${entry.name}：金币 +${effect.gold}`);
      }
    }
    if (effect.kind === "first_type_bonus" && (!effect.target_type || effect.target_type === card.type)) {
      const key = `item:${entry.id}:type:${card.type}`;
      if (!state.round.effect_trigger_counts[key]) {
        state.round.effect_trigger_counts[key] = 1;
        flatBonus = safeAdd(flatBonus, effect.bonus);
        messages.push(`${entry.name} +${effect.bonus}`);
      }
    }
    if (effect.kind === "first_type_gold" && action === effect.action && card.type === effect.target_type) {
      const key = `item:${entry.id}:gold`;
      if (!state.round.effect_trigger_counts[key]) {
        state.round.effect_trigger_counts[key] = 1;
        state.round.pending_gold_bonus = safeAdd(state.round.pending_gold_bonus, effect.gold);
        messages.push(`${entry.name}：金币 +${effect.gold}`);
      }
    }
    if (effect.kind === "fruit_combo_bonus" && action === "eat" && card.type === "水果" && (state.round.fruit_combo ?? 0) > 0) {
      flatBonus = safeAdd(flatBonus, effect.bonus);
      messages.push(`${entry.name} +${effect.bonus}`);
    }
    if (effect.kind === "fruit_combo_first_gold" && action === "eat" && card.type === "水果") {
      const nextCombo = (state.round.fruit_combo ?? 0) + (card.effect?.combo_gain ?? 1);
      const key = `item:${entry.id}:gold`;
      if (nextCombo >= effect.threshold && !state.round.effect_trigger_counts[key]) {
        state.round.effect_trigger_counts[key] = 1;
        state.round.pending_gold_bonus = safeAdd(state.round.pending_gold_bonus, effect.gold);
        messages.push(`${entry.name}：金币 +${effect.gold}`);
      }
    }
    if (effect.kind === "anorexia_discard_bonus" && action === "discard" && card.type === "快餐"
      && (card.eat_points ?? 0) < (card.base_eat_points ?? card.eat_points ?? 0)) {
      flatBonus = safeAdd(flatBonus, effect.bonus);
      messages.push(`${entry.name} +${effect.bonus}`);
    }
    if (effect.kind === "dessert_burst_bonus" && action === "eat" && card.type === "甜点"
      && (card.eat_points ?? 0) >= effect.threshold) {
      flatBonus = safeAdd(flatBonus, effect.bonus);
      messages.push(`${entry.name} +${effect.bonus}`);
    }
    if (effect.kind === "postponed_card_bonus" && state.round.postponed_uuids?.includes(card.uuid)) {
      flatBonus = safeAdd(flatBonus, effect.bonus);
      messages.push(`${entry.name} +${effect.bonus}`);
    }
    if (effect.kind === "generated_card_bonus" && card.generated_from) {
      flatBonus = safeAdd(flatBonus, effect.bonus);
      messages.push(`${entry.name} +${effect.bonus}`);
    }
    if (effect.kind === "generated_card_gold" && card.generated_from) {
      if (effect.bonus) {
        flatBonus = safeAdd(flatBonus, effect.bonus);
        messages.push(`${entry.name} +${effect.bonus}`);
      }
      const key = `item:${entry.id}:gold`;
      if (!state.round.effect_trigger_counts[key]) {
        state.round.effect_trigger_counts[key] = 1;
        state.round.pending_gold_bonus = safeAdd(state.round.pending_gold_bonus, effect.gold);
        messages.push(`${entry.name}：金币 +${effect.gold}`);
      }
    }
    if (effect.kind === "alternating_action_bonus") {
      const previous = state.round.actions.at(-1);
      if (previous && previous.action !== action) {
        flatBonus = safeAdd(flatBonus, effect.bonus);
        messages.push(`${entry.name} +${effect.bonus}`);
      }
    }
    if (effect.kind === "keyword_card_bonus" && card.effect?.keywords?.includes(effect.keyword)) {
      flatBonus = safeAdd(flatBonus, effect.bonus);
      messages.push(`${entry.name} +${effect.bonus}`);
    }
    if (effect.kind === "keyword_first_bonus" && card.effect?.keywords?.includes(effect.keyword)) {
      const key = `item:${entry.id}:bonus`;
      if (!state.round.effect_trigger_counts[key]) {
        state.round.effect_trigger_counts[key] = 1;
        flatBonus = safeAdd(flatBonus, effect.bonus);
        messages.push(`${entry.name} +${effect.bonus}`);
      }
    }
    if (effect.kind === "keyword_first_gold" && card.effect?.keywords?.includes(effect.keyword)) {
      const key = `item:${entry.id}:gold`;
      if (!state.round.effect_trigger_counts[key]) {
        state.round.effect_trigger_counts[key] = 1;
        state.round.pending_gold_bonus = safeAdd(state.round.pending_gold_bonus, effect.gold);
        messages.push(`${entry.name}：金币 +${effect.gold}`);
      }
    }
    if (effect.kind === "keyword_first_shop_discount" && card.effect?.keywords?.includes(effect.keyword)) {
      const key = `item:${entry.id}:discount`;
      if (!state.round.effect_trigger_counts[key]) {
        state.round.effect_trigger_counts[key] = 1;
        state.round.shop_discount = safeAdd(state.round.shop_discount, effect.amount);
        messages.push(`${entry.name}：商店卡价 -${effect.amount}`);
      }
    }
    if (effect.kind === "negative_action_gold") {
      const key = `item:${entry.id}:negative`;
      if (selectedPrinted < 0 && !state.round.effect_trigger_counts[key]) {
        state.round.effect_trigger_counts[key] = 1;
        state.round.pending_gold_bonus = safeAdd(state.round.pending_gold_bonus, effect.gold);
        messages.push(`${entry.name}：金币 +${effect.gold}`);
      }
    }
    if (effect.kind === "negative_action_free_reroll" && selectedPrinted < 0) {
      const key = `item:${entry.id}:reroll`;
      if (!state.round.effect_trigger_counts[key]) {
        state.round.effect_trigger_counts[key] = 1;
        state.round.shop_free_rerolls = safeAdd(state.round.shop_free_rerolls, effect.count);
        messages.push(`${entry.name}：免费刷新 +${effect.count}`);
      }
    }
    if (effect.kind === "reserve_matching_type_bonus" && (state.round.reserve_type_counts?.[card.type] ?? 0) > 0) {
      const key = `item:${entry.id}:type:${card.type}`;
      if (!effect.once_per_type || !state.round.effect_trigger_counts[key]) {
        state.round.effect_trigger_counts[key] = 1;
        flatBonus = safeAdd(flatBonus, effect.bonus);
        messages.push(`${entry.name} +${effect.bonus}`);
      }
    }
    if (effect.kind === "reserve_last_bonus" && state.round.reserve_count > 0 && state.round.draw_pile.length === 1) {
      flatBonus = safeAdd(flatBonus, effect.bonus);
      messages.push(`${entry.name} +${effect.bonus}`);
    }
    if (effect.kind === "wrong_edibility_bonus" && action === effect.action && card.edibility === effect.target_edibility) {
      flatBonus = safeAdd(flatBonus, effect.bonus);
      messages.push(`${entry.name} +${effect.bonus}`);
    }
    if (effect.kind === "wrong_eat_buff_next_discard" && action === "eat" && card.edibility === "inedible") {
      state.round.buffs.push({ kind: "flat", action: "discard", target_type: "*", remaining: 1, value: effect.bonus });
      messages.push(`${entry.name}：下一张弃牌 +${effect.bonus}`);
    }
    if (effect.kind === "compact_first_each_bonus" && state.deck.length <= effect.maximum) {
      const key = `item:${entry.id}:${action}`;
      if (!state.round.effect_trigger_counts[key]) {
        state.round.effect_trigger_counts[key] = 1;
        flatBonus = safeAdd(flatBonus, effect.bonus);
        messages.push(`${entry.name} +${effect.bonus}`);
      }
    }
    if (effect.kind === "singleton_name_bonus" && state.deck.filter((owned) => owned.id === card.id).length === 1) {
      flatBonus = safeAdd(flatBonus, effect.bonus);
      messages.push(`${entry.name} +${effect.bonus}`);
    }
    if (effect.kind === "singleton_type_bonus" && state.deck.filter((owned) => owned.type === card.type).length === 1) {
      flatBonus = safeAdd(flatBonus, effect.bonus);
      messages.push(`${entry.name} +${effect.bonus}`);
    }
    if (effect.kind === "lower_side_bonus" && selectedPrinted < otherPrinted) {
      flatBonus = safeAdd(flatBonus, effect.bonus);
      messages.push(`${entry.name} +${effect.bonus}`);
    }
    if (effect.kind === "plate_edge_bonus" && (state.round.actions.length === 0 || state.round.draw_pile.length === 1)) {
      flatBonus = safeAdd(flatBonus, effect.bonus);
      messages.push(`${entry.name} +${effect.bonus}`);
    }
    if (effect.kind === "reserve_first_action_bonus" && state.round.reserve_count > 0 && state.round.actions.length === 0) {
      flatBonus = safeAdd(flatBonus, effect.bonus);
      messages.push(`${entry.name} +${effect.bonus}`);
    }
    if (effect.kind === "reserve_first_discard_gold" && state.round.reserve_count > 0 && action === "discard" && state.round.discard_sequence.length === 0) {
      const gold = effect.gold + (state.round.reserve_count >= (effect.threshold ?? Infinity) ? effect.extra_gold ?? 0 : 0);
      state.round.pending_gold_bonus = safeAdd(state.round.pending_gold_bonus, gold);
      messages.push(`${entry.name}：金币 +${gold}`);
    }
    if (effect.kind === "last_correct_action_bonus" && state.round.draw_pile.length === 1 && isCorrectAction(action, card)) {
      flatBonus = safeAdd(flatBonus, effect.bonus);
      messages.push(`${entry.name} +${effect.bonus}`);
    }
  }
  return { flat_bonus: flatBonus, messages };
}

export function getItemFinalMultipliers(state) {
  const multipliers = [];
  for (const entry of state.items) {
    const effect = entry.effect;
    if (effect.kind === "global_multiplier") {
      multipliers.push({ name: entry.name, multiplier: effect.multiplier, source: "item" });
    }
    if (effect.kind === "deck_size_multiplier") {
      const meetsMinimum = effect.minimum === undefined || state.deck.length >= effect.minimum;
      const meetsMaximum = effect.maximum === undefined || state.deck.length <= effect.maximum;
      if (meetsMinimum && meetsMaximum) {
        multipliers.push({ name: entry.name, multiplier: effect.multiplier, source: "item" });
      }
    }
    if (effect.kind === "destroyed_multiplier" && state.round.destroyed_count >= (effect.minimum ?? 1)) {
      multipliers.push({ name: entry.name, multiplier: effect.multiplier, source: "item" });
    }
    if (effect.kind === "reserve_threshold_multiplier" && state.round.reserve_count >= effect.minimum) {
      multipliers.push({ name: entry.name, multiplier: effect.multiplier, source: "item" });
    }
  }
  return multipliers;
}

export function applyRoundEndItems(state, options = {}) {
  const random = options.random ?? Math.random;
  const messages = [];
  for (const entry of state.items) {
    const effect = entry.effect;
    if (effect.kind !== "round_end_transform") continue;
    const target = getCardById(effect.target_card_id);
    if (!target) continue;
    const candidates = state.deck
      .map((card, index) => ({ card, index }))
      .filter(({ card }) => card.id !== effect.target_card_id);
    if (candidates.length === 0) continue;
    const selected = candidates[Math.floor(random() * candidates.length)];
    const previousName = selected.card.name;
    state.deck[selected.index] = {
      ...target,
      synergy_tags: [...target.synergy_tags],
      effect: target.effect ? { ...target.effect } : null,
      uuid: selected.card.uuid,
    };
    messages.push(`${entry.name}：${previousName} → ${target.name}`);
  }
  return messages;
}
