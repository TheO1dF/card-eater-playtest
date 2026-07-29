import { GAME_CONFIG, GAME_MODES } from "./config.js";
import { createInitialDeck } from "./data.js";

export const GAME_PHASES = Object.freeze({
  INIT: "Init",
  PLAYING: "Playing",
  SCORING: "Scoring",
  CARD_DRAFT: "CardDraft",
  ITEM_DRAFT: "ItemDraft",
  NEXT_ROUND: "NextRound",
  GAME_OVER: "GameOver",
});

// Kept as an alias for older integrations.
export const GAME_STATES = GAME_PHASES;

const PHASE_TRANSITIONS = Object.freeze({
  [GAME_PHASES.INIT]: [GAME_PHASES.PLAYING],
  [GAME_PHASES.PLAYING]: [GAME_PHASES.SCORING],
  [GAME_PHASES.SCORING]: [GAME_PHASES.CARD_DRAFT, GAME_PHASES.GAME_OVER],
  [GAME_PHASES.CARD_DRAFT]: [GAME_PHASES.ITEM_DRAFT, GAME_PHASES.NEXT_ROUND],
  [GAME_PHASES.ITEM_DRAFT]: [GAME_PHASES.NEXT_ROUND],
  [GAME_PHASES.NEXT_ROUND]: [GAME_PHASES.PLAYING, GAME_PHASES.GAME_OVER],
  [GAME_PHASES.GAME_OVER]: [],
});

export function createRoundState() {
  return {
    draw_pile: [],
    action_budget: 0,
    reserve_count: 0,
    reserve_cards: [],
    reserve_type_counts: {},
    actions: [],
    eat_sequence: [],
    discard_sequence: [],
    spent_pile: [],
    buffs: [],
    final_multipliers: [],
    started_at_ms: null,
    elapsed_ms: 0,
    pending_gold_bonus: 0,
    force_discard_remaining: false,
    shop_discount: 0,
    shop_reroll_count: 0,
    shop_free_rerolls: 0,
    reshuffle_charges: 0,
    reshuffle_count: 0,
    effect_trigger_counts: {},
    consume_next_uuid: null,
    quest_flat_modifier: 0,
    quest_action_modifiers: {},
    quest_first_action_modifier: 0,
    quest_last_action_modifier: 0,
    generated_count: 0,
    destroyed_count: 0,
    grown_count: 0,
    fruit_combo: 0,
    best_fruit_combo: 0,
    fruit_combo_broken: false,
    fruit_combo_discard_shield: false,
    fruit_combo_unbreakable: false,
    double_fast_food_anorexia: false,
    double_point_change_uuids: [],
    wrong_edibility_count: 0,
    wrong_edibility_streak: 0,
    best_wrong_edibility_streak: 0,
    postponed_uuids: [],
    postpone_counts: {},
    postpone_count: 0,
    postpone_effect_triggers: 0,
    reverse_postpone_charges: 0,
    postpone_score_charges: 0,
    postpone_score_awarded: 0,
    postpone_bonus_score: 0,
    card_score_bonuses: {},
    protected_decrease_uuids: [],
    hidden_postponed_uuids: [],
    nebula_postpone_counts: {},
    wrong_eat_bonus: 0,
    pending_review: null,
    timer_paused: false,
    timer_frozen_elapsed_ms: null,
    live_elapsed_ms: 0,
    speed_threshold_extension_ms: 0,
    verdicts: [],
    next_purchase_dormant: false,
    forced_theme_type: null,
    shop_free_removals: 0,
    shop_force_price_four: false,
    shop_force_price_four_applied: false,
    slow_finish_rewards: 0,
    lock_next_stats_charges: 0,
    nebula_unresolved_since: {},
    contract_gold_reward: 0,
    speed_gold_reward: 0,
    item_fruit_chain: 0,
    last_item_action: null,
    item_alternation_count: 0,
    item_destroy_protected: false,
    item_generation_copied: false,
    pending_item_messages: [],
  };
}

export function createInitialPlayerState(options = {}) {
  const createId = options.create_id;
  const mode = options.mode ?? GAME_MODES.NORMAL;
  return {
    schema_version: GAME_CONFIG.schema_version,
    phase: GAME_PHASES.INIT,
    mode,
    current_round: 1,
    total_score: 0,
    delete_tokens: 1,
    reroll_tokens: 0,
    free_rerolls: 1,
    plate_capacity: mode === GAME_MODES.HARD ? GAME_CONFIG.initial_plate_capacity - 1 : GAME_CONFIG.initial_plate_capacity,
    plate_upgrade_count: 0,
    deck: createInitialDeck({ create_id: createId }),
    active_rules: [],
    items: [],
    item_history: [],
    item_serial: 0,
    exiled_cards: [],
    pending_draft_ids: [],
    pending_item_ids: [],
    pending_item_resolution: null,
    next_draft_forced_type: null,
    draft_resolved: false,
    item_draft_resolved: false,
    pending_summary: null,
    quest_history: [],
    pending_round_start_purify: false,
    milestone_delays: {},
    permanent_multipliers: [],
    remove_count: 0,
    draft_history: [],
    outcome: null,
    phase_history: [],
    round: createRoundState(),
  };
}

export function canTransition(from, to) {
  return PHASE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionPhase(state, nextPhase, metadata = {}) {
  if (!canTransition(state.phase, nextPhase)) {
    throw new Error(`Invalid phase transition: ${state.phase} -> ${nextPhase}`);
  }
  state.phase_history.push({ from: state.phase, to: nextPhase, ...metadata });
  state.phase = nextPhase;
  return state.phase;
}

export function resetRoundState(state) {
  state.round = createRoundState();
  return state.round;
}

export const INITIAL_PLAYER_STATE = Object.freeze(createInitialPlayerState({ create_id: (_, index) => `preview-${index}` }));

export function createGameState(options = {}) {
  return createInitialPlayerState(options);
}
