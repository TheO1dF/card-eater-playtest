import { CARD_ROLES } from "./balance.js";
import { normalizeEffect } from "./keywords.js";

const EDIBLE = "edible";
const INEDIBLE = "inedible";
const { BASELINE, SETUP, PAYOFF, SACRIFICE, ENGINE, ECONOMY } = CARD_ROLES;

const V017_ART_IDS = new Set([
  "F001", "F002", "F003", "F004", "F005", "F006", "F007", "F008", "F009", "F010", "F011", "F012", "F013",
  "K001", "K002", "K003", "K004", "K005", "K006", "K007", "K008", "K009", "K010", "K011", "K012",
  "D001", "D002", "D003", "D004", "D005", "D006", "D007", "D008", "D009", "D010", "D011",
  "B001", "B002", "B003", "B004", "B005", "B006", "B007", "B008", "B009", "B010", "B011", "B012",
  "A001", "A002", "A003", "A004", "A005", "A006", "A007", "A008", "A009", "A010", "A011", "A012",
  "C001", "C002", "C003", "C004", "C005", "C006", "C007", "C008", "C009", "C010", "C011",
  "P001", "P002", "P003", "P004", "P005", "P006", "P007", "P008", "P009", "P010",
  "U001", "U002", "U003", "U004", "U005", "U006", "U007", "U008",
]);

function card(definition) {
  const eatPoints = definition.eat_points;
  const discardPoints = definition.discard_points;
  return {
    synergy_tags: [],
    min_draft_round: definition.rarity === "传奇" ? 7 : definition.rarity === "稀有" ? 3 : 1,
    ...definition,
    base_eat_points: eatPoints,
    base_discard_points: discardPoints,
    effect: normalizeEffect(definition.effect),
    art_file: V017_ART_IDS.has(definition.id)
      ? `cards/v017/${definition.id.toLowerCase()}-v3.png`
      : definition.art_file ?? `cards/${definition.id.toLowerCase()}.webp`,
    runtime_art_mode: "individual",
    runtime_atlas: null,
    runtime_columns: 1,
    runtime_rows: 1,
    runtime_x: 0,
    runtime_y: 0,
    sprite_hue: definition.sprite_hue ?? 0,
    sprite_scale: definition.sprite_scale ?? 1,
  };
}

// Expandable card pool. Draft rarity controls when complex cards enter the run.
const CARD_DEFS = [
  // 水果：基础水果负责教学，其余水果围绕【水果连击】。
  card({ id: "F001", name: "苹果", flavor: "一颗普通的苹果。", rarity: "普通", type: "水果", edibility: EDIBLE, eat_points: 1, discard_points: -1, role: BASELINE, shop_price_adjustment: -2, synergy_tags: ["水果", "基础"], effect: null }),
  card({ id: "F002", name: "香蕉", rarity: "普通", type: "水果", edibility: EDIBLE, eat_points: 1, discard_points: -1, role: ENGINE, synergy_tags: ["水果", "连击", "生成"], effect: { kind: "fruit_combo", description: "吃：水果连击 +1；连击达到 3 或以上时生成 1 张苹果，本轮限 1 次", trigger_action: "eat", combo_gain: 1, bonus_per_combo: 1, max_bonus: 6, generate_at: 3, generate_card_id: "F001", once_per_round: true } }),
  card({ id: "F003", name: "西瓜", rarity: "稀有", type: "水果", edibility: EDIBLE, eat_points: 2, discard_points: -1, role: PAYOFF, synergy_tags: ["水果", "连击", "收割"], effect: { kind: "fruit_combo", description: "吃：水果连击 +1；连击达到 3 时再额外 +3", trigger_action: "eat", combo_gain: 1, bonus_per_combo: 1, max_bonus: 6, threshold: 3, threshold_bonus: 3 } }),
  card({ id: "F004", name: "草莓", rarity: "罕见", type: "水果", edibility: EDIBLE, eat_points: 1, discard_points: -1, role: SETUP, synergy_tags: ["水果", "连击", "加速"], effect: { kind: "fruit_combo", description: "吃：水果连击 +2；本牌额外获得当前连击数的分数（最多 +8）", trigger_action: "eat", combo_gain: 2, bonus_per_combo: 1, max_bonus: 8 } }),
  card({ id: "F005", name: "金苹果", rarity: "普通", type: "水果", edibility: EDIBLE, eat_points: 2, discard_points: -1, role: ENGINE, synergy_tags: ["水果", "连击", "成长"], effect: { kind: "fruit_combo", description: "吃：水果连击 +1；连击达到 4 时，自身吃分永久 +1", trigger_action: "eat", combo_gain: 1, bonus_per_combo: 1, max_bonus: 8, grow_at: 4, grow_amount: 1 } }),
  card({ id: "F006", name: "腐烂苹果", rarity: "罕见", type: "水果", edibility: EDIBLE, eat_points: -1, discard_points: -2, role: SACRIFICE, synergy_tags: ["水果", "连击", "牺牲"], effect: { kind: "fruit_combo", description: "吃：水果连击 +1；若连击前为 0，本牌额外 +4，否则按连击正常加分", trigger_action: "eat", combo_gain: 1, bonus_per_combo: 1, max_bonus: 6, opener_bonus: 4 } }),
  card({ id: "F007", name: "水果拼盘", rarity: "稀有", type: "水果", edibility: EDIBLE, eat_points: 2, discard_points: -1, role: ENGINE, synergy_tags: ["水果", "连击", "生成", "弱化"], effect: { kind: "fruit_combo", description: "吃：水果连击 +2；连击达到 4 时，本轮首次随机生成 1 张【弱化】水果", trigger_action: "eat", combo_gain: 2, bonus_per_combo: 1, max_bonus: 10, generate_at: 4, generate_random_type: "水果", generate_weakened: true, once_per_round: true } }),
  card({ id: "F008", name: "火龙果", rarity: "传奇", type: "水果", edibility: EDIBLE, eat_points: 3, discard_points: -2, role: PAYOFF, synergy_tags: ["水果", "连击", "爆发"], effect: { kind: "fruit_combo", description: "吃：水果连击 +1；连击达到 5 时，水果连击加分翻倍", trigger_action: "eat", combo_gain: 1, bonus_per_combo: 1, max_bonus: 12, double_at: 5 } }),
  card({ id: "F009", name: "梨", art_file: "cards/f009-v2.png", rarity: "普通", type: "水果", edibility: EDIBLE, eat_points: 1, discard_points: -1, role: ENGINE, shop_price_adjustment: -1, synergy_tags: ["水果", "连击"], effect: { kind: "fruit_combo", description: "吃：水果连击 +1", trigger_action: "eat", combo_gain: 1, bonus_per_combo: 0, max_bonus: 0 } }),
  card({ id: "F010", name: "糖渍梅", art_file: "cards/f010-v2.png", rarity: "罕见", type: "水果", edibility: EDIBLE, eat_points: 1, discard_points: -1, role: SETUP, synergy_tags: ["水果", "连击", "修复"], effect: { kind: "fruit_combo_resume", description: "吃：水果连击 +1；若本轮曾中断连击，则从本轮最高连击恢复（恢复值最多为 5），每轮限 1 次", trigger_action: "eat", combo_gain: 1, max_resume: 5, bonus_per_combo: 1, max_bonus: 3, once_per_round: true } }),
  card({ id: "F011", name: "风干柿子", rarity: "罕见", type: "水果", edibility: EDIBLE, eat_points: 0, discard_points: -1, role: PAYOFF, synergy_tags: ["水果", "连击", "追溯"], effect: { kind: "fruit_history_bonus", description: "吃：额外增加本轮此前已吃水果数量的分数（最多 +4）", trigger_action: "eat", max_bonus: 4 } }),
  card({ id: "F012", name: "石榴", rarity: "稀有", type: "水果", edibility: EDIBLE, eat_points: 2, discard_points: -1, role: ENGINE, synergy_tags: ["水果", "摧毁", "生成"], effect: { kind: "destroy_generate_many", description: "吃：摧毁自身；下回合在牌组中生成 2 张梨", trigger_action: "eat", card_id: "F009", count: 2 } }),
  card({ id: "F013", name: "灯笼果", rarity: "普通", type: "水果", edibility: EDIBLE, eat_points: 1, discard_points: -1, role: SACRIFICE, synergy_tags: ["水果", "删牌", "摧毁"], effect: { kind: "gain_delete_token_destroy", description: "吃后摧毁自身，获得 1 枚删牌 token", trigger_action: "eat", tokens: 1 } }),

  // 快餐 ×8：普通牌不超过吃 +2；更高点数必须附带稀有度或负面代价。
  card({ id: "K001", name: "汉堡", flavor: "最普通的汉堡，也比水果更顶饱。", rarity: "普通", type: "快餐", edibility: EDIBLE, eat_points: 2, discard_points: -1, role: BASELINE, shop_price_adjustment: -1, synergy_tags: ["快餐", "基础"], effect: null }),
  card({ id: "K002", name: "拉面", rarity: "普通", type: "快餐", edibility: EDIBLE, eat_points: 2, discard_points: -1, role: ENGINE, synergy_tags: ["快餐", "厌食", "转化"], effect: { kind: "anorexia", description: "吃后自身吃分永久 -1、弃分永久 +1", trigger_action: "eat", eat_loss: 1, discard_gain: 1 } }),
  card({ id: "K003", name: "薯条", rarity: "罕见", type: "快餐", edibility: EDIBLE, eat_points: 4, discard_points: -1, role: SACRIFICE, synergy_tags: ["快餐", "厌食", "成长"], effect: { kind: "anorexia", description: "吃后自身吃分永久 -1、弃分永久 +1", trigger_action: "eat", eat_loss: 1, discard_gain: 1 } }),
  card({ id: "K004", name: "巨无霸", rarity: "稀有", type: "快餐", edibility: EDIBLE, eat_points: 4, discard_points: -2, role: SACRIFICE, synergy_tags: ["快餐", "厌食", "大牌"], effect: { kind: "anorexia", description: "吃后自身吃分永久 -2、弃分永久 +2", trigger_action: "eat", eat_loss: 2, discard_gain: 2 } }),
  card({ id: "K005", name: "发馊外卖", rarity: "罕见", type: "快餐", edibility: EDIBLE, eat_points: 3, discard_points: -2, role: ENGINE, shop_price_adjustment: -1, synergy_tags: ["快餐", "厌食", "转化"], effect: { kind: "anorexia", description: "吃后自身吃分永久 -1、弃分永久 +1；弃时额外 +3 分", trigger_action: "eat", eat_loss: 1, discard_gain: 1, discard_bonus: 3 } }),
  card({ id: "K006", name: "变味炸鸡桶", art_file: "cards/k006-v2.png", rarity: "罕见", type: "快餐", edibility: EDIBLE, eat_points: 2, discard_points: -2, role: ENGINE, shop_price_adjustment: -1, synergy_tags: ["快餐", "厌食", "转化"], effect: { kind: "bidirectional_anorexia", description: "吃：自身吃分永久 +2；弃：本次额外 +2，但自身吃分永久 -2", eat_growth: 2, discard_bonus: 2, discard_eat_loss: 2 } }),
  card({ id: "K007", name: "辣鸡翅", rarity: "稀有", type: "快餐", edibility: EDIBLE, eat_points: 3, discard_points: -1, role: ENGINE, synergy_tags: ["快餐", "厌食", "后置", "成长"], effect: { kind: "anorexia_postpone_drain", description: "吃后自身吃分永久 -1、弃分永久 +1；若本轮后置：牌堆下一张牌吃分永久 -1，自身吃分永久 +2", trigger_action: "eat", eat_loss: 1, discard_gain: 1 } }),
  card({ id: "K008", name: "三明治", art_file: "cards/k008-v2.png", rarity: "普通", type: "快餐", edibility: EDIBLE, eat_points: 2, discard_points: -2, role: ENGINE, shop_price_adjustment: -1, synergy_tags: ["快餐", "厌食", "机制"], effect: { kind: "double_anorexia", description: "双倍【厌食】（每次吃后吃分永久 -2、弃分永久 +2）；吃或弃：本轮其他快餐的【厌食】变为双倍", eat_loss: 2, discard_gain: 2 } }),
  card({ id: "K009", name: "微波便当", rarity: "普通", type: "快餐", edibility: EDIBLE, eat_points: 2, discard_points: -1, role: PAYOFF, synergy_tags: ["快餐", "位置"], effect: { kind: "early_action_bonus", description: "吃：若是本轮前三次行动之一，额外 +3 分", trigger_action: "eat", action_limit: 3, bonus: 3 } }),
  card({ id: "K010", name: "保温灯餐台", rarity: "罕见", type: "快餐", edibility: EDIBLE, eat_points: 0, discard_points: 0, role: ENGINE, synergy_tags: ["快餐", "厌食", "规模"], effect: { kind: "fast_food_anorexia_or_positive_count", description: "吃：若牌堆中还有快餐，所有快餐触发一次【厌食】（吃分永久 -1、弃分永久 +1）；弃：额外获得牌堆中吃分与弃分均为正值的牌数量分数" } }),
  card({ id: "K011", name: "隔夜餐盒", art_file: "cards/k010.webp", rarity: "罕见", type: "快餐", edibility: EDIBLE, eat_points: 1, discard_points: -1, role: ENGINE, synergy_tags: ["快餐", "后置", "成长"], effect: { kind: "postpone_mark_all_trade", description: "若本轮后置：将牌堆剩余牌全部标记为已后置；自身吃分永久降低剩余牌数量，弃分永久提高相同数量" } }),
  card({ id: "K012", name: "打包袋", art_file: "cards/k009.webp", rarity: "普通", type: "快餐", edibility: INEDIBLE, eat_points: -1, discard_points: 1, role: PAYOFF, synergy_tags: ["快餐", "厌食", "追溯"], effect: { kind: "bonus_if_degraded_history", description: "弃：若本轮此前处理过吃分低于原值的牌，本牌额外 +3", trigger_action: "discard", bonus: 3 } }),

  // 甜点：弃置【留存】吃分，达到门槛吃下后爆发并摧毁自身。
  card({ id: "D001", name: "甜甜圈", rarity: "普通", type: "甜点", edibility: EDIBLE, eat_points: 2, discard_points: -1, role: ENGINE, synergy_tags: ["甜点", "留存"], effect: { kind: "retention", description: "弃：自身吃分永久 +2；10+ 吃下时点数翻倍并摧毁自身", retain: 2, burst_threshold: 10, burst_multiplier: 2, destroy_after_burst: true } }),
  card({ id: "D002", name: "草莓蛋糕", rarity: "罕见", type: "甜点", edibility: EDIBLE, eat_points: 3, discard_points: -1, role: ENGINE, synergy_tags: ["甜点", "留存", "水果"], effect: { kind: "retention", description: "弃：吃分永久 +3；若上一张行动牌是水果，再 +2；10+ 吃下时点数翻倍并摧毁自身", retain: 3, previous_type: "水果", previous_retain_bonus: 2, burst_threshold: 10, burst_multiplier: 2, destroy_after_burst: true } }),
  card({ id: "D003", name: "焦糖布丁", rarity: "普通", type: "甜点", edibility: EDIBLE, eat_points: 2, discard_points: -1, role: ENGINE, synergy_tags: ["甜点", "留存", "后置"], effect: { kind: "retention", description: "弃：吃分永久 +1；本轮曾后置则改为 +3；10+ 吃下时点数翻倍并摧毁自身", retain: 1, postponed_retain_bonus: 2, burst_threshold: 10, burst_multiplier: 2, destroy_after_burst: true } }),
  card({ id: "D004", name: "冰淇淋", rarity: "罕见", type: "甜点", edibility: EDIBLE, eat_points: 1, discard_points: -1, role: SACRIFICE, synergy_tags: ["甜点", "留存", "大幅成长"], effect: { kind: "retention", description: "弃：吃分永久 +4（最高 12）；10+ 吃下时点数翻倍并摧毁自身", retain: 4, max_eat_points: 12, burst_threshold: 10, burst_multiplier: 2, destroy_after_burst: true } }),
  card({ id: "D005", name: "糖果", rarity: "普通", type: "甜点", edibility: EDIBLE, eat_points: 1, discard_points: -1, role: PAYOFF, synergy_tags: ["甜点", "留存", "爆发"], effect: { kind: "retention", description: "弃：吃分永久 +2；8+ 吃下时点数翻倍、额外 +3 分并摧毁自身", retain: 2, burst_threshold: 8, burst_multiplier: 2, burst_bonus: 3, destroy_after_burst: true } }),
  card({ id: "D006", name: "婚礼蛋糕", rarity: "传奇", type: "甜点", edibility: EDIBLE, eat_points: 2, discard_points: -2, role: PAYOFF, synergy_tags: ["甜点", "留存", "爆发"], effect: { kind: "retention", description: "弃：吃分永久 +5；12+ 吃下时本次得分 ×3，并摧毁自身", retain: 5, burst_threshold: 12, burst_multiplier: 3, destroy_after_burst: true } }),
  card({ id: "D007", name: "夹心饼干", rarity: "稀有", type: "甜点", edibility: EDIBLE, eat_points: 2, discard_points: -1, role: SACRIFICE, synergy_tags: ["甜点", "留存", "删牌"], effect: { kind: "retention", description: "弃：吃分永久 +2；10+ 吃下时点数翻倍，获得 1 枚删牌 token 并摧毁自身", retain: 2, burst_threshold: 10, burst_multiplier: 2, burst_delete_tokens: 1, destroy_after_burst: true } }),
  card({ id: "D008", name: "融化圣代", rarity: "罕见", type: "甜点", edibility: EDIBLE, eat_points: 2, discard_points: -1, role: SACRIFICE, synergy_tags: ["甜点", "后置", "摧毁", "成长"], effect: { kind: "postpone_destroy_buff_next", description: "若本轮后置：摧毁自身，牌堆下一张牌吃分永久 +2", amount: 2 } }),
  card({ id: "D009", name: "裱花袋", rarity: "罕见", type: "甜点", edibility: EDIBLE, eat_points: 1, discard_points: -1, role: SETUP, synergy_tags: ["甜点", "后置", "成长"], effect: { kind: "postpone_match_highest_eat", description: "若本轮后置：自身吃分永久变为牌堆剩余牌中最高的吃分" } }),
  card({ id: "D010", name: "展示蛋糕", rarity: "稀有", type: "甜点", edibility: EDIBLE, eat_points: 1, discard_points: -2, role: PAYOFF, synergy_tags: ["甜点", "牌堆", "规模"], effect: { kind: "scale_by_pile_type", description: "吃：牌堆中每有 1 张甜点，额外 +1（最多 +6）", trigger_action: "eat", target_type: "甜点", multiplier: 1, max_bonus: 6 } }),
  card({ id: "D011", name: "幸运饼干", rarity: "罕见", type: "甜点", edibility: EDIBLE, eat_points: 1, discard_points: -1, role: PAYOFF, synergy_tags: ["甜点", "预判"], effect: { kind: "forecast_tail_edibility", description: "吃：若牌堆最后一张牌可食用，额外 +3", trigger_action: "eat", target_edibility: EDIBLE, bonus: 3 } }),

  // 饮料：多数在触发后摧毁，换取直接资源或延迟到指定类别的蓄势。
  card({ id: "B001", name: "清水", rarity: "普通", type: "饮料", edibility: EDIBLE, eat_points: 1, discard_points: -1, role: SETUP, synergy_tags: ["饮料", "摧毁", "净化"], effect: { kind: "drink_consume", description: "吃后摧毁自身；只将牌组中低于原值的红色点数恢复，绿色成长保留", trigger_action: "eat", cleanse_deck: true } }),
  card({ id: "B002", name: "汽水", rarity: "普通", type: "饮料", edibility: EDIBLE, eat_points: 1, discard_points: -1, role: SETUP, synergy_tags: ["饮料", "摧毁", "快餐"], effect: { kind: "drink_consume", description: "吃后摧毁自身；下一张快餐吃牌得分 ×2，不符合条件的牌不会消除蓄势", trigger_action: "eat", buff_action: "eat", buff_target_type: "快餐", buff_multiplier: 2 } }),
  card({ id: "B003", name: "黑咖啡", rarity: "罕见", type: "饮料", edibility: EDIBLE, eat_points: 1, discard_points: -1, role: SETUP, synergy_tags: ["饮料", "摧毁", "蓄势"], effect: { kind: "drink_consume", description: "吃后摧毁自身；下一张牌额外 +4 分", trigger_action: "eat", buff_action: "*", buff_add: 4 } }),
  card({ id: "B004", name: "鲜榨果汁", rarity: "罕见", type: "饮料", edibility: EDIBLE, eat_points: 1, discard_points: -1, role: ENGINE, synergy_tags: ["饮料", "摧毁", "水果", "生成", "弱化"], effect: { kind: "drink_consume", description: "吃后摧毁自身，并随机生成 1 张【弱化】水果", trigger_action: "eat", generate_random_type: "水果", generate_weakened: true } }),
  card({ id: "B005", name: "能量饮料", rarity: "稀有", type: "饮料", edibility: EDIBLE, eat_points: 1, discard_points: -1, role: ENGINE, synergy_tags: ["饮料", "摧毁", "重洗"], effect: { kind: "drink_consume", description: "吃后摧毁自身，本轮自动重洗次数 +1", trigger_action: "eat", reshuffle_charges: 1 } }),
  card({ id: "B006", name: "牛奶", rarity: "普通", type: "饮料", edibility: EDIBLE, eat_points: 1, discard_points: -1, role: SETUP, synergy_tags: ["饮料", "摧毁", "甜点"], effect: { kind: "drink_consume", description: "吃后摧毁自身；下一张甜点得分 ×2，不符合条件的牌不会消除蓄势", trigger_action: "eat", buff_action: "*", buff_target_type: "甜点", buff_multiplier: 2 } }),
  card({ id: "B007", name: "押分瓶", art_file: "cards/b007-v2.png", rarity: "普通", type: "饮料", edibility: INEDIBLE, eat_points: 0, discard_points: 0, role: SACRIFICE, shop_price_adjustment: -1, synergy_tags: ["饮料", "后置", "成长"], effect: { kind: "postpone_decay_score", description: "若本轮后置：自身吃分与弃分永久各 -1，本轮额外 +4 分", score: 4, amount: 1 } }),
  card({ id: "B008", name: "苦味补剂", art_file: "cards/b008-v2.png", rarity: "罕见", type: "饮料", edibility: EDIBLE, eat_points: 1, discard_points: -2, role: SETUP, synergy_tags: ["饮料", "硬吃", "蓄势", "摧毁"], effect: { kind: "wrong_edibility_setup_destroy", description: "错误食性弃掉后摧毁自身；下一次错误食性处理额外 +4 分", trigger_action: "discard", bonus: 4 } }),
  card({ id: "B009", name: "药草茶", art_file: "cards/b009-v2.png", rarity: "罕见", type: "饮料", edibility: EDIBLE, eat_points: 1, discard_points: -1, role: SETUP, synergy_tags: ["饮料", "水果", "机制", "摧毁"], effect: { kind: "fruit_combo_unbreakable", description: "吃后摧毁自身；本轮水果连击不会中断", trigger_action: "eat" } }),
  card({ id: "B010", name: "续杯马克杯", rarity: "罕见", type: "饮料", edibility: EDIBLE, eat_points: 1, discard_points: -1, role: ENGINE, synergy_tags: ["饮料", "储存", "成长"], effect: { kind: "store_charges", description: "吃：储存 1 层（最多 3，跨轮保留）；弃：每层额外 +2，然后清空储存", max_charges: 3, bonus_per_charge: 2 } }),
  card({ id: "B011", name: "浓缩咖啡", art_file: "cards/b010.webp", rarity: "普通", type: "饮料", edibility: EDIBLE, eat_points: 1, discard_points: -1, role: SACRIFICE, synergy_tags: ["饮料", "删牌", "摧毁"], effect: { kind: "gain_delete_token_destroy", description: "吃后摧毁自身，获得 1 枚删牌 token", trigger_action: "eat", tokens: 1 } }),
  card({ id: "B012", name: "珍珠奶茶", art_file: "cards/b009.webp", rarity: "稀有", type: "饮料", edibility: EDIBLE, eat_points: 1, discard_points: -1, role: ENGINE, synergy_tags: ["饮料", "甜点", "复制", "生成", "弱化", "摧毁"], effect: { kind: "copy_pile_dessert_destroy", description: "吃：若牌堆中有甜点，摧毁自身并生成其中 1 张相同牌面数值的无效果【弱化】复制牌，下轮进入牌组；无甜点则不摧毁", trigger_action: "eat" } }),

  // 动物：基础动物负责教学，其余动物摧毁、成长或生成生态。
  card({ id: "A001", name: "橘猫", flavor: "是一只可爱的猫。", rarity: "普通", type: "动物", edibility: INEDIBLE, eat_points: -1, discard_points: 2, role: BASELINE, shop_price_adjustment: -2, synergy_tags: ["动物", "基础"], effect: null }),
  card({ id: "A002", name: "贪吃狗", rarity: "普通", type: "动物", edibility: INEDIBLE, eat_points: -2, discard_points: 2, role: ENGINE, synergy_tags: ["动物", "吞食", "可食用"], effect: { kind: "consume_previous_card", description: "弃：摧毁上一张可食用牌，自身弃分永久成长 1～2", trigger_action: "discard", target_edibility: EDIBLE, grow_stat: "discard_points", max_growth: 2 } }),
  card({ id: "A003", name: "疲惫猴子", art_file: "cards/a003-v2.png", rarity: "罕见", type: "动物", edibility: INEDIBLE, eat_points: -2, discard_points: 3, role: ENGINE, synergy_tags: ["动物", "生成", "水果", "弱化", "衰减"], effect: { kind: "generate_by_decay", description: "每轮首次弃：生成 1 张【弱化】香蕉，自身弃分永久 -1；降到 0 时摧毁自身", trigger_action: "discard", card_id: "F002", decay_stat: "discard_points", decay: 1, destroy_at: 0, once_per_round: true } }),
  card({ id: "A004", name: "兔子", rarity: "普通", type: "动物", edibility: INEDIBLE, eat_points: -1, discard_points: 1, role: PAYOFF, synergy_tags: ["动物", "兔子", "规模"], effect: { kind: "scale_by_deck", description: "弃：牌组中每有 1 张兔子，额外 +1（最多 +12）", trigger_action: "discard", target_id: "A004", divisor: 1, multiplier: 1, max_bonus: 12 } }),
  card({ id: "A005", name: "饕餮", rarity: "传奇", type: "动物", edibility: INEDIBLE, eat_points: -3, discard_points: 3, role: ENGINE, synergy_tags: ["动物", "吞食", "成长"], effect: { kind: "consume_next_card", description: "弃：摧毁牌堆中下一张牌，自身弃分按其较高绝对牌面永久成长 1～4", trigger_action: "discard", grow_stat: "discard_points", max_growth: 4 } }),
  card({ id: "A006", name: "蜕皮蛇", art_file: "cards/a006-v2.png", rarity: "稀有", type: "动物", edibility: INEDIBLE, eat_points: -2, discard_points: 2, role: ENGINE, synergy_tags: ["动物", "转移", "成长"], effect: { kind: "drain_pile_edible_to_self", description: "弃：牌堆中所有可食用牌吃分永久 -1，自身弃分永久 +2", trigger_action: "discard", target_loss: 1, self_gain: 2 } }),
  card({ id: "A007", name: "狐狸", rarity: "罕见", type: "动物", edibility: INEDIBLE, eat_points: -2, discard_points: 2, role: ENGINE, synergy_tags: ["动物", "生成", "水果", "弱化"], effect: { kind: "generate_random", description: "每轮首次弃：随机生成 1 张【弱化】水果", trigger_action: "discard", target_type: "水果", generate_weakened: true, once_per_round: true } }),
  card({ id: "A008", name: "乌龟", art_file: "cards/a008-v2.png", rarity: "普通", type: "动物", edibility: INEDIBLE, eat_points: -1, discard_points: 2, role: PAYOFF, shop_price_adjustment: -1, synergy_tags: ["动物", "后置", "硬吃"], effect: { kind: "postpone_penalty_comeback", description: "若本轮后置：自身弃分永久 -1；弃：若本次因弃置此牌得到 -5 分或更低，额外 +20", trigger_action: "discard", threshold: -5, bonus: 20 } }),
  card({ id: "A009", name: "理毛猫", art_file: "cards/a009-v2.png", rarity: "普通", type: "动物", edibility: INEDIBLE, eat_points: -1, discard_points: 2, role: SACRIFICE, synergy_tags: ["动物", "删牌", "摧毁"], effect: { kind: "gain_delete_token_destroy", description: "弃后摧毁自身，获得 1 枚删牌 token", trigger_action: "discard", tokens: 1 } }),
  card({ id: "A010", name: "牧羊犬", rarity: "稀有", type: "动物", edibility: INEDIBLE, eat_points: -2, discard_points: 2, role: SETUP, synergy_tags: ["动物", "后置", "成长"], effect: { kind: "postpone_buff_animal", description: "若本轮后置且牌堆中有动物：随机 1 张动物弃分永久 +1，并标记为已后置" } }),
  card({ id: "A011", name: "喜鹊", rarity: "罕见", type: "动物", edibility: INEDIBLE, eat_points: -1, discard_points: 1, role: SETUP, synergy_tags: ["动物", "蓄势"], effect: { kind: "buff_next_action", description: "弃：下一张牌额外 +3 分", trigger_action: "discard", modifier: "flat", action: "*", count: 1, add: 3 } }),
  card({ id: "A012", name: "松露猪", rarity: "稀有", type: "动物", edibility: INEDIBLE, eat_points: -2, discard_points: 2, role: PAYOFF, synergy_tags: ["动物", "规模"], effect: { kind: "scale_by_unique_deck_types", description: "弃：永久牌组每有 1 种类别，额外 +1 分（最多 +8）", trigger_action: "discard", multiplier: 1, max_bonus: 8 } }),

  // 星体：直接改写牌序、重洗、硬吃与剩余牌面。
  card({ id: "C001", name: "星星", rarity: "普通", type: "星体", edibility: INEDIBLE, eat_points: -2, discard_points: 2, role: ENGINE, synergy_tags: ["星体", "生成", "弱化", "机制"], effect: { kind: "generate_random", description: "每轮首次弃：随机生成 1 张【弱化】卡牌", trigger_action: "discard", generate_weakened: true, once_per_round: true } }),
  card({ id: "C002", name: "月亮", rarity: "罕见", type: "星体", edibility: INEDIBLE, eat_points: -2, discard_points: 2, role: ENGINE, synergy_tags: ["星体", "机制", "牌面互换"], effect: { kind: "swap_remaining_sides", description: "弃：剩余餐盘所有卡牌的吃点与弃点互换，仅持续本轮", trigger_action: "discard" } }),
  card({ id: "C003", name: "太阳", rarity: "稀有", type: "星体", edibility: INEDIBLE, eat_points: -2, discard_points: 2, role: ENGINE, synergy_tags: ["星体", "重洗", "摧毁"], effect: { kind: "celestial_sun", description: "弃后摧毁自身，本轮自动重洗次数 +1", trigger_action: "discard", charges: 1 } }),
  card({ id: "C004", name: "彗星", rarity: "普通", type: "星体", edibility: INEDIBLE, eat_points: -2, discard_points: 2, role: ENGINE, synergy_tags: ["星体", "后置", "成长"], effect: { kind: "postpone_mark_all_growth", description: "若本轮后置：将牌堆剩余牌全部标记为已后置，自身弃分永久 +1", amount: 1 } }),
  card({ id: "C005", name: "陨石", rarity: "稀有", type: "星体", edibility: INEDIBLE, eat_points: -3, discard_points: 4, role: PAYOFF, synergy_tags: ["星体", "清场", "机制"], effect: { kind: "discard_all_remaining", description: "弃：立即弃掉并结算餐盘中所有剩余牌", trigger_action: "discard" } }),
  card({ id: "C006", name: "冥王星", rarity: "传奇", type: "星体", edibility: INEDIBLE, eat_points: -2, discard_points: 2, role: PAYOFF, synergy_tags: ["星体", "预判", "规模"], effect: { kind: "scale_by_remaining", description: "弃：餐盘每有 1 张未处理牌，额外 +1 分（最多 +8）", trigger_action: "discard", multiplier: 1, max_bonus: 8 } }),
  card({ id: "C007", name: "黑洞胃", art_file: "cards/c007-v2.png", rarity: "稀有", type: "星体", edibility: INEDIBLE, eat_points: -3, discard_points: 2, role: PAYOFF, synergy_tags: ["星体", "硬吃", "爆发"], effect: { kind: "wrong_history_scale", description: "错误食性吃：本轮此前每次错误食性处理使本牌额外 +2 分", trigger_action: "eat", multiplier: 2, max_bonus: 12 } }),
  card({ id: "C008", name: "引力井", rarity: "罕见", type: "星体", edibility: INEDIBLE, eat_points: -2, discard_points: -10, role: SACRIFICE, synergy_tags: ["星体", "摧毁", "爆发"], effect: { kind: "destroy_self_score", description: "弃后摧毁自身，本次额外 +14 分", trigger_action: "discard", bonus: 14 } }),
  card({ id: "C009", name: "潮汐月", rarity: "罕见", type: "星体", edibility: INEDIBLE, eat_points: -2, discard_points: 2, role: SETUP, synergy_tags: ["星体", "后置", "成长"], effect: { kind: "buff_marked_remaining", description: "弃：牌堆中所有已后置牌本轮吃分与弃分额外 +2", trigger_action: "discard", bonus: 2 } }),
  card({ id: "C010", name: "超新星", rarity: "传奇", type: "星体", edibility: INEDIBLE, eat_points: -4, discard_points: 3, role: SACRIFICE, synergy_tags: ["星体", "摧毁", "后置"], effect: { kind: "destroy_marked_remaining", description: "弃：摧毁牌堆中 1 张已后置牌", trigger_action: "discard" } }),
  card({ id: "C011", name: "星云", rarity: "罕见", type: "星体", edibility: INEDIBLE, eat_points: -2, discard_points: 1, role: PAYOFF, synergy_tags: ["星体", "后置", "机制", "追溯"], effect: { kind: "postpone_nebula", description: "若本轮后置：剩余牌全部标记为已后置且牌背向上；此后每处理 1 张牌，本牌结算时额外 +1" } }),

  // 人物：连接其余类别，提供跨体系的生成、追溯、硬吃与经济收益。
  card({ id: "P001", name: "水果商人", art_file: "cards/p001-v2.png", rarity: "普通", type: "人物", edibility: INEDIBLE, eat_points: -2, discard_points: 2, role: PAYOFF, synergy_tags: ["人物", "水果", "追溯"], effect: { kind: "scale_by_history", description: "弃：本轮此前每吃 1 张水果，额外 +1 分（最多 +8）", trigger_action: "discard", history_action: "eat", target_type: "水果", multiplier: 1, max_bonus: 8 } }),
  card({ id: "P002", name: "风险经纪人", art_file: "cards/p002-v2.png", rarity: "罕见", type: "人物", edibility: INEDIBLE, eat_points: -2, discard_points: -3, role: SACRIFICE, shop_price_adjustment: -2, synergy_tags: ["人物", "牺牲", "爆发"], effect: { kind: "flat_action_bonus", description: "每轮首次弃时额外 +7 分", trigger_action: "discard", bonus: 7, once_per_round: true } }),
  card({ id: "P003", name: "动物管理员", art_file: "cards/p003-v2.png", rarity: "罕见", type: "人物", edibility: INEDIBLE, eat_points: -2, discard_points: 2, role: PAYOFF, synergy_tags: ["人物", "动物", "追溯"], effect: { kind: "scale_by_history", description: "弃：本轮此前每弃 1 张动物，额外 +2（最多 +8）", trigger_action: "discard", history_action: "discard", target_type: "动物", multiplier: 2, max_bonus: 8 } }),
  card({ id: "P004", name: "天文学家", art_file: "cards/p004-v2.png", rarity: "稀有", type: "人物", edibility: INEDIBLE, eat_points: -2, discard_points: 2, role: ENGINE, synergy_tags: ["人物", "星体", "生成", "弱化"], effect: { kind: "generate_random", description: "每轮首次弃：随机生成 1 张【弱化】星体", trigger_action: "discard", target_type: "星体", generate_weakened: true, once_per_round: true } }),
  card({ id: "P005", name: "魔术师", art_file: "cards/p005-v2.png", rarity: "稀有", type: "人物", edibility: INEDIBLE, eat_points: -2, discard_points: 2, role: ENGINE, synergy_tags: ["人物", "动物", "兔子", "生成", "弱化"], effect: { kind: "generate_card", description: "每轮首次弃：生成 1 张【弱化】兔子", trigger_action: "discard", card_id: "A004", generate_weakened: true, once_per_round: true } }),
  card({ id: "P006", name: "美食挑战者", art_file: "cards/p006-v2.png", rarity: "罕见", type: "人物", edibility: INEDIBLE, eat_points: -2, discard_points: 2, role: ENGINE, synergy_tags: ["人物", "硬吃", "连击"], effect: { kind: "wrong_edibility_streak", description: "错误食性吃：本轮连续错误食性次数 ×2 分（最多 +8）；正确食性会中断连击", trigger_action: "eat", bonus_per_streak: 2, max_bonus: 8 } }),
  card({ id: "P007", name: "送餐员", art_file: "cards/p007-v2.png", rarity: "普通", type: "人物", edibility: INEDIBLE, eat_points: -1, discard_points: 1, role: ENGINE, synergy_tags: ["人物", "后置", "生成", "弱化"], effect: { kind: "postpone_generate_edible", description: "若本轮后置：自身弃分永久 -1，随机生成 1 张可食用【弱化】牌" } }),
  card({ id: "P008", name: "拍卖师", rarity: "稀有", type: "人物", edibility: INEDIBLE, eat_points: -2, discard_points: 2, role: PAYOFF, synergy_tags: ["人物", "规模"], effect: { kind: "scale_by_unique_deck_types", description: "弃：牌库中每有 1 种不同类别，额外 +1（最多 +5）", trigger_action: "discard", multiplier: 1, max_bonus: 5 } }),
  card({ id: "P009", name: "策展人", rarity: "罕见", type: "人物", edibility: INEDIBLE, eat_points: -2, discard_points: 2, role: PAYOFF, synergy_tags: ["人物", "牌堆", "规模"], effect: { kind: "scale_by_pile_unique_types", description: "弃：牌堆剩余牌每有 1 种不同类别，额外 +1（最多 +5）", trigger_action: "discard", multiplier: 1, max_bonus: 5 } }),
  card({ id: "P010", name: "美食评论家", rarity: "罕见", type: "人物", edibility: INEDIBLE, eat_points: -2, discard_points: 2, role: SETUP, synergy_tags: ["人物", "硬吃", "蓄势"], effect: { kind: "prime_review", description: "弃：判定下一次出牌；错误食性则那张牌额外 +2 且本牌弃分永久 -1，正确食性则那张牌额外 +3", trigger_action: "discard", correct_bonus: 3, wrong_bonus: 2, self_loss: 1 } }),

  // 通用：净化、永久增益、硬吃与删牌资源。
  card({ id: "U001", name: "净化器", art_file: "cards/u001-v2.png", rarity: "普通", type: "通用", edibility: INEDIBLE, eat_points: -2, discard_points: 2, role: SETUP, synergy_tags: ["通用", "净化"], effect: { kind: "purify_deck", description: "弃：只将整副牌组中低于原值的红色点数恢复；绿色成长保留", trigger_action: "discard" } }),
  card({ id: "U002", name: "榨分机", art_file: "cards/u002-v2.png", rarity: "稀有", type: "通用", edibility: INEDIBLE, eat_points: -2, discard_points: 2, role: ENGINE, synergy_tags: ["通用", "转移", "成长", "水果"], effect: { kind: "drain_type_to_self", description: "每轮首次弃：每张水果吃分永久 -1；实际降低几点，自身弃分就永久增加几点", trigger_action: "discard", target_type: "水果", target_stat: "eat_points", target_loss: 1, self_stat: "discard_points", once_per_round: true } }),
  card({ id: "U003", name: "加分券", rarity: "普通", type: "通用", edibility: INEDIBLE, eat_points: -2, discard_points: 2, role: SETUP, synergy_tags: ["通用", "蓄势"], effect: { kind: "buff_next_action", description: "每轮首次弃：之后两张牌各额外 +2 分", trigger_action: "discard", modifier: "flat", action: "*", count: 2, add: 2, once_per_round: true } }),
  card({ id: "U004", name: "铁胃徽章", art_file: "cards/u004-v2.png", rarity: "普通", type: "通用", edibility: INEDIBLE, eat_points: -1, discard_points: 2, role: SETUP, synergy_tags: ["通用", "后置", "硬吃"], effect: { kind: "postpone_mark_all_wrong_eat", description: "若本轮后置：将牌堆剩余牌全部标记为已后置；本轮此后每次错误食性吃下额外 +3", bonus: 3 } }),
  card({ id: "U005", name: "理牌托盘", art_file: "cards/u005-v2.png", rarity: "罕见", type: "通用", edibility: INEDIBLE, eat_points: -1, discard_points: 1, role: SETUP, synergy_tags: ["通用", "后置", "蓄势"], effect: { kind: "buff_two_marked", description: "弃：牌堆中两张已后置牌结算时额外 +1", trigger_action: "discard", count: 2, bonus: 1 } }),
  card({ id: "U006", name: "修理工具箱", rarity: "罕见", type: "通用", edibility: INEDIBLE, eat_points: -1, discard_points: 1, role: SETUP, synergy_tags: ["通用", "净化", "蓄势"], effect: { kind: "schedule_purify", description: "每轮首次弃：下一轮开场恢复所有低于原值的红色牌面点数", trigger_action: "discard", once_per_round: true } }),
  card({ id: "U007", name: "裁切券", rarity: "罕见", type: "通用", edibility: INEDIBLE, eat_points: -1, discard_points: -1, role: SACRIFICE, synergy_tags: ["通用", "删牌", "摧毁"], effect: { kind: "choice_score_or_delete_token", description: "吃：本次额外 +4 分；弃：摧毁自身并获得 1 枚删牌 token", eat_bonus: 4, tokens: 1 } }),
  card({ id: "U008", name: "覆膜机", rarity: "稀有", type: "通用", edibility: INEDIBLE, eat_points: -2, discard_points: 1, role: SETUP, synergy_tags: ["通用", "后置", "机制"], effect: { kind: "mark_all_protect_decrease", description: "弃：将牌堆剩余牌全部标记为已后置；本轮这些牌的牌面点数不会减少，增加仍会生效", trigger_action: "discard" } }),
];

// Seven unique teaching cards: four edible, three inedible. Both fruits teach
// the combo immediately; three effect-free cards keep the opening readable.
const STARTER_IDS = Object.freeze(["F002", "F003", "K001", "D001", "A001", "A008", "A004"]);

function cloneCard(source) {
  return {
    ...source,
    synergy_tags: [...source.synergy_tags],
    effect: source.effect ? { ...source.effect, keywords: [...(source.effect.keywords ?? [])] } : null,
  };
}

function fallbackId(source, index) {
  return `${source.id}-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 7)}`;
}

export const CARD_EDIBILITY = Object.freeze({ EDIBLE, INEDIBLE });
export const CARD_TYPES = Object.freeze({
  FRUIT: "水果", FASTFOOD: "快餐", DESSERT: "甜点", DRINK: "饮料",
  CELESTIAL: "星体", PERSON: "人物", ANIMAL: "动物", UTILITY: "通用",
});

export const CARD_LIBRARY = Object.freeze(CARD_DEFS.reduce((library, source) => {
  library[source.id] = Object.freeze(cloneCard(source));
  return library;
}, {}));

export function createInitialDeck(options = {}) {
  const createId = options.create_id ?? fallbackId;
  return STARTER_IDS.map((id, index) => {
    const source = CARD_LIBRARY[id];
    return { ...cloneCard(source), uuid: createId(source, index) };
  });
}

export function createCardPool() { return CARD_DEFS.map(cloneCard); }

// Compatibility alias for data exporters from the classic prototype.
export function createShopCardPool() { return createCardPool(); }

export function getCardById(id) {
  const source = CARD_LIBRARY[id];
  return source ? cloneCard(source) : null;
}
