const EDIBLE = "edible";
const INEDIBLE = "inedible";

// 本轮合约只奖励金币，不修改牌面、不增加得分倍率，也不会跨轮保留。
export const RULE_LIBRARY = Object.freeze([
  { id: "perfect-sort", name: "完美分类", description: "可食用牌全部吃、不可食用牌全部弃", scope: "perfect_sort", gold_reward: 3, difficulty: 2 },
  { id: "no-negative", name: "无伤清台", description: "本轮没有任何负分行动", scope: "no_negative_action", gold_reward: 3, difficulty: 2 },
  { id: "eat-four", name: "四口开胃", description: "本轮至少吃 4 张牌", scope: "min_eat", count: 4, gold_reward: 2, difficulty: 1 },
  { id: "discard-four", name: "四次整理", description: "本轮至少弃 4 张牌", scope: "min_discard", count: 4, gold_reward: 2, difficulty: 1 },
  { id: "balanced", name: "营养均衡", description: "吃与弃都有发生，且数量相差不超过 1", scope: "balanced_actions", gold_reward: 3, difficulty: 2 },
  { id: "alternate-four", name: "吃弃四拍", description: "连续 4 次交替吃与弃", scope: "alternating_actions", count: 4, gold_reward: 3, difficulty: 2 },
  { id: "fruit-combo-three", name: "水果三连", description: "本轮水果连击达到 3", scope: "min_fruit_combo", count: 3, target_type: "水果", gold_reward: 3, difficulty: 2 },
  { id: "fruit-combo-five", name: "水果盛宴", description: "本轮水果连击达到 5", scope: "min_fruit_combo", count: 5, target_type: "水果", gold_reward: 6, difficulty: 4, min_round: 3 },
  { id: "eat-fruit-three", name: "每日水果", description: "本轮至少吃 3 张水果", scope: "min_eat_target", count: 3, target_type: "水果", gold_reward: 3, difficulty: 2 },
  { id: "discard-animal-two", name: "动物巡游", description: "本轮至少弃 2 张动物", scope: "min_discard_target", count: 2, target_type: "动物", gold_reward: 3, difficulty: 2 },
  { id: "drink-two", name: "畅饮时刻", description: "本轮至少吃 2 张饮料", scope: "min_eat_target", count: 2, target_type: "饮料", gold_reward: 4, difficulty: 3, min_round: 2 },
  { id: "dessert-two", name: "甜点储蓄", description: "本轮至少弃 2 张甜点", scope: "min_discard_target", count: 2, target_type: "甜点", gold_reward: 3, difficulty: 2 },
  { id: "celestial-two", name: "仰望星空", description: "本轮至少弃 2 张星体", scope: "min_discard_target", count: 2, target_type: "星体", gold_reward: 4, difficulty: 3, min_round: 2 },
  { id: "postpone-effect-one", name: "后置联动", description: "本轮至少触发 1 次【后置】相关卡牌效果", scope: "min_postpone_effect", count: 1, requires_keyword: "后置", gold_reward: 3, difficulty: 2 },
  { id: "postpone-effect-two", name: "精密调度", description: "本轮至少触发 2 次【后置】相关卡牌效果", scope: "min_postpone_effect", count: 2, requires_keyword: "后置", gold_reward: 5, difficulty: 4, min_round: 3 },
  { id: "destroy-one", name: "有舍有得", description: "本轮通过【摧毁】移除至少 1 张牌", scope: "min_destroyed", count: 1, requires_keyword: "摧毁", gold_reward: 4, difficulty: 3, min_round: 2 },
  { id: "generate-one", name: "新成员", description: "本轮通过【生成】加入至少 1 张牌", scope: "min_generated", count: 1, requires_keyword: "生成", gold_reward: 4, difficulty: 3, min_round: 2 },
  { id: "grow-two", name: "长期投资", description: "本轮至少发生 2 次永久点数变化", scope: "min_grown", count: 2, requires_keyword: "成长", gold_reward: 3, difficulty: 2, min_round: 2 },
  { id: "four-types", name: "四类餐盘", description: "本轮处理至少 4 种不同类别", scope: "min_unique_action_types", count: 4, gold_reward: 3, difficulty: 2 },
  { id: "first-eat-last-discard", name: "先尝后清", description: "第一张吃、最后一张弃", scope: "first_last_actions", first_action: "eat", last_action: "discard", gold_reward: 4, difficulty: 3, min_round: 2 },
  { id: "first-discard-last-eat", name: "先清后宴", description: "第一张弃、最后一张吃", scope: "first_last_actions", first_action: "discard", last_action: "eat", gold_reward: 4, difficulty: 3, min_round: 2 },
  { id: "discard-food-two", name: "忍痛留存", description: "主动弃掉至少 2 张可食用牌", scope: "min_discard_food", count: 2, gold_reward: 4, difficulty: 3, min_round: 2 },
  { id: "hard-eat-two", name: "反着来", description: "本轮至少进行 2 次错误食性处理", scope: "min_wrong_edibility", count: 2, gold_reward: 3, difficulty: 2 },
  { id: "hard-eat-four", name: "铁胃挑战", description: "本轮至少进行 4 次错误食性处理", scope: "min_wrong_edibility", count: 4, gold_reward: 6, difficulty: 4, min_round: 3 },
  { id: "raw-score-35", name: "火力达标", description: "本轮牌面与效果达到 35 分", scope: "round_card_score", score: 35, gold_reward: 4, difficulty: 3, min_round: 3 },
  { id: "raw-score-70", name: "火力全开", description: "本轮牌面与效果达到 70 分", scope: "round_card_score", score: 70, gold_reward: 7, difficulty: 5, min_round: 6 },
]);

export function getRuleUnlockRound(rule) {
  return Math.max(1, Number.isFinite(rule?.min_round) ? Math.floor(rule.min_round) : 1);
}

function matchesCard(rule, card) {
  return (!rule.target_type || card.type === rule.target_type)
    && (!rule.target_edibility || card.edibility === rule.target_edibility);
}

export function isRuleEligible(rule, deck = [], currentRound = 1) {
  if (!rule || getRuleUnlockRound(rule) > currentRound) return false;
  if (rule.requires_keyword && !deck.some((card) => card.effect?.keywords?.includes(rule.requires_keyword))) return false;
  if (deck.length === 0) return true;
  const matching = deck.filter((card) => matchesCard(rule, card)).length;
  const keywordMatching = rule.requires_keyword
    ? deck.filter((card) => card.effect?.keywords?.includes(rule.requires_keyword)).length
    : 0;
  if (rule.target_type && matching === 0) return false;
  if (["min_eat_target", "min_discard_target"].includes(rule.scope) && matching < rule.count) return false;
  if (["min_eat", "min_discard", "alternating_actions", "min_wrong_edibility"].includes(rule.scope) && deck.length < rule.count) return false;
  if (rule.scope === "min_grown" && keywordMatching < rule.count) return false;
  if (rule.scope === "min_fruit_combo") {
    const maximumCombo = deck
      .filter((card) => card.type === "水果" && card.effect?.keywords?.includes("水果连击"))
      .reduce((total, card) => total + Math.max(1, card.effect.combo_gain ?? 1), 0);
    if (maximumCombo < rule.count) return false;
  }
  return true;
}

function archetype(rule) {
  if (rule.target_type) return rule.target_type;
  if (["min_destroyed", "min_generated", "min_grown"].includes(rule.scope)) return "构筑";
  if (rule.scope === "min_wrong_edibility") return "硬吃";
  if (rule.scope.includes("postpone") || rule.scope === "first_last_actions") return "顺序";
  if (rule.scope.includes("discard")) return "弃";
  if (rule.scope.includes("eat")) return "吃";
  return "通用";
}

export function randomDraftRules(count = 3, excludedRules = [], random = Math.random, deck = [], currentRound = 1) {
  const excludedIds = new Set(excludedRules.map((rule) => rule.id));
  const pool = RULE_LIBRARY.filter((rule) => !excludedIds.has(rule.id) && isRuleEligible(rule, deck, currentRound));
  const picked = [];
  const groups = new Set();
  while (picked.length < count && pool.length > 0) {
    const diverse = pool.filter((rule) => !groups.has(archetype(rule)));
    const candidates = diverse.length ? diverse : pool;
    const index = Math.floor(random() * candidates.length);
    const selected = candidates[index] ?? candidates[0];
    pool.splice(pool.indexOf(selected), 1);
    picked.push(selected);
    groups.add(archetype(selected));
  }
  return picked;
}
