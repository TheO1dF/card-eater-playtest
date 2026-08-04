import { GAME_MODES } from "./config.js";
import { CARD_EDIBILITY, getCardById } from "./data.js";
import { addItem } from "./items.js";

export const MUTATION_IDS = Object.freeze({
  CAT_ARMY: "cat_army",
  EAT_FEAST: "eat_feast",
  START_FROM_STAR: "start_from_star",
  ANIMAL_FRIENDS: "animal_friends",
  DARKNESS: "darkness",
  SPEED_SERVICE: "speed_service",
  RETURN_CLASSIC: "return_classic",
  FUSION_CARDS: "fusion_cards",
});

export const MUTATION_LIBRARY = Object.freeze([
  Object.freeze({ id: MUTATION_IDS.CAT_ARMY, name: "猫猫大军", description: "初始牌组中的所有卡牌均变为橘猫。", icon: "猫" }),
  Object.freeze({ id: MUTATION_IDS.EAT_FEAST, name: "大吃特吃", description: "吃牌获得的分数翻倍；弃牌不能获得正分，但负分依然扣除。", icon: "吃" }),
  Object.freeze({ id: MUTATION_IDS.START_FROM_STAR, name: "从星开始", description: "初始牌组只有一张星星；每次轮末连续进行两次卡牌三选一。", icon: "星" }),
  Object.freeze({ id: MUTATION_IDS.ANIMAL_FRIENDS, name: "动物伙伴", description: "轮末卡牌三选一只会出现动物牌。", icon: "兽" }),
  Object.freeze({ id: MUTATION_IDS.DARKNESS, name: "不见光明", description: "每轮所有餐盘卡牌均以卡背朝上进行，必须凭记忆与判断处理。", icon: "暗" }),
  Object.freeze({ id: MUTATION_IDS.SPEED_SERVICE, name: "争分夺秒", description: "开局获得永久道具“极速出餐灯”。", icon: "速" }),
  Object.freeze({ id: MUTATION_IDS.RETURN_CLASSIC, name: "重回经典", description: "每轮开始前从三个任务中选择一个；达成后获得可叠加的永久得分倍率。", icon: "约" }),
  Object.freeze({ id: MUTATION_IDS.FUSION_CARDS, name: "融合卡牌", description: "轮末进行两次三选一；选中的两张牌会融合为一张，名称、点数、效果与卡图合并。", icon: "融" }),
]);

const MUTATION_BY_ID = Object.freeze(Object.fromEntries(MUTATION_LIBRARY.map((entry) => [entry.id, entry])));
const RARITY_RANK = Object.freeze({ "普通": 0, "罕见": 1, "稀有": 2, "传奇": 3, "诅咒": 0 });
const RARITY_BY_RANK = Object.freeze(["普通", "罕见", "稀有", "传奇"]);

export function isMutationMode(stateOrMode) {
  return (typeof stateOrMode === "string" ? stateOrMode : stateOrMode?.mode) === GAME_MODES.MUTATION;
}

export function getMutation(id) {
  return MUTATION_BY_ID[id] ?? null;
}

export function pickRandomMutation(random = Math.random) {
  return MUTATION_LIBRARY[Math.min(MUTATION_LIBRARY.length - 1, Math.floor(random() * MUTATION_LIBRARY.length))];
}

function ownedCard(source, index, createId) {
  return {
    ...source,
    synergy_tags: [...(source.synergy_tags ?? [])],
    effect: source.effect ? { ...source.effect, keywords: [...(source.effect.keywords ?? [])] } : null,
    uuid: createId(source, index),
  };
}

export function initializeMutationRun(state, mutationId, options = {}) {
  if (!isMutationMode(state)) return null;
  const random = options.random ?? Math.random;
  const createId = options.create_id ?? ((card, index) => `${card.id}-mutation-${Date.now()}-${index}`);
  const mutation = getMutation(mutationId) ?? pickRandomMutation(random);
  state.mutation_id = mutation.id;
  state.mutation_history ??= [];
  state.mutation_task_history ??= [];
  state.active_mutation_task = null;
  state.mutation_draft_picks_remaining = 0;
  state.pending_fusion_card_id = null;

  if (mutation.id === MUTATION_IDS.CAT_ARMY) {
    const cat = getCardById("A001");
    state.deck = state.deck.map((_, index) => ownedCard(cat, index, createId));
  } else if (mutation.id === MUTATION_IDS.START_FROM_STAR) {
    const star = getCardById("C001");
    state.deck = [ownedCard(star, 0, createId)];
  } else if (mutation.id === MUTATION_IDS.SPEED_SERVICE) {
    addItem(state, "C12");
  }

  return mutation;
}

export function getRoundDraftPickCount(state) {
  if (!isMutationMode(state)) return 1;
  return [MUTATION_IDS.START_FROM_STAR, MUTATION_IDS.FUSION_CARDS].includes(state.mutation_id) ? 2 : 1;
}

export function filterMutationDraftPool(state, pool) {
  if (!isMutationMode(state)) return pool;
  let filtered = pool;
  if (state.mutation_id === MUTATION_IDS.ANIMAL_FRIENDS) {
    filtered = filtered.filter((card) => card.type === "动物");
  }
  if (state.mutation_id === MUTATION_IDS.FUSION_CARDS && state.pending_fusion_card_id) {
    filtered = filtered.filter((card) => card.id !== state.pending_fusion_card_id);
  }
  return filtered;
}

export function applyMutationActionScore(state, action, points) {
  if (!isMutationMode(state) || state.mutation_id !== MUTATION_IDS.EAT_FEAST) return points;
  return action === "eat" ? points * 2 : Math.min(0, points);
}

export function getMutationTaskMultiplier(rule) {
  const difficulty = Math.max(1, Number(rule?.difficulty) || 1);
  return difficulty >= 5 ? 1.2 : difficulty >= 4 ? 1.15 : difficulty >= 3 ? 1.1 : 1.05;
}

function cloneFusionEffect(effect, componentId) {
  if (!effect) return null;
  return {
    ...effect,
    keywords: [...(effect.keywords ?? [])],
    fusion_component_id: componentId,
  };
}

function fusionArtPart(card) {
  return {
    id: card.id,
    art_file: card.art_file,
    runtime_art_mode: card.runtime_art_mode,
    runtime_atlas: card.runtime_atlas,
    runtime_columns: card.runtime_columns,
    runtime_rows: card.runtime_rows,
    runtime_x: card.runtime_x,
    runtime_y: card.runtime_y,
    sprite_hue: card.sprite_hue,
    sprite_scale: card.sprite_scale,
  };
}

export function createFusionCard(first, second) {
  if (!first || !second) return null;
  const rank = Math.max(RARITY_RANK[first.rarity] ?? 0, RARITY_RANK[second.rarity] ?? 0);
  const components = [first, second]
    .flatMap((card) => card.effect?.kind === "fusion"
      ? card.effect.components ?? []
      : card.effect ? [{ source_id: card.id, source_name: card.name, effect: cloneFusionEffect(card.effect, card.id) }] : []);
  const descriptions = components.map((component) => component.effect?.description).filter(Boolean);
  return {
    id: `FUSION-${first.id}-${second.id}`,
    name: `${first.name}·${second.name}`,
    rarity: RARITY_BY_RANK[rank],
    type: first.type === second.type ? first.type : "融合",
    edibility: first.edibility === second.edibility ? first.edibility : CARD_EDIBILITY.INEDIBLE,
    eat_points: (first.eat_points ?? 0) + (second.eat_points ?? 0),
    discard_points: (first.discard_points ?? 0) + (second.discard_points ?? 0),
    base_eat_points: (first.base_eat_points ?? first.eat_points ?? 0) + (second.base_eat_points ?? second.eat_points ?? 0),
    base_discard_points: (first.base_discard_points ?? first.discard_points ?? 0) + (second.base_discard_points ?? second.discard_points ?? 0),
    role: first.role === second.role ? first.role : "engine",
    synergy_tags: [...new Set([...(first.synergy_tags ?? []), ...(second.synergy_tags ?? []), "融合"])],
    flavor: descriptions.length ? descriptions.map((description, index) => `${index + 1}. ${description}`).join("；") : "两张卡牌融合后的新卡。",
    effect: components.length ? { kind: "fusion", description: descriptions.join("；"), keywords: [...new Set(components.flatMap((component) => component.effect?.keywords ?? []))], components } : null,
    art_file: null,
    runtime_art_mode: "fusion",
    fusion_parts: [fusionArtPart(first), fusionArtPart(second)],
    sprite_hue: 0,
    sprite_scale: 1,
    min_draft_round: Number.POSITIVE_INFINITY,
  };
}
