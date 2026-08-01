const RECORD_KEY = "cardeater.run-history.v1";
const TUTORIAL_KEY = "cardeater.story-tutorial.v1";
const SETTINGS_KEY = "cardeater.settings.v1";
const RUN_SAVE_KEY = "cardeater.active-run.v2";
const PROGRESSION_KEY = "cardeater.progression.v1";
const SHOP_TUTORIAL_KEY = "cardeater.shop-tutorial.v1";
const DEFAULT_SETTINGS = Object.freeze({ music: true, effects: true, font_size: "medium", random_start: false, home_theme: "night" });

const EMPTY_PROGRESSION = Object.freeze({ runs_played: 0, victories: 0, shop_victories: 0, endless_victories: 0, god: false, mode_victories: Object.freeze({}) });

function normalizeProgression(value = {}) {
  return { ...EMPTY_PROGRESSION, ...value, mode_victories: { ...(value?.mode_victories ?? {}) } };
}

function getModeVictories(records) {
  return records.reduce((counts, record) => {
    if (record?.outcome === "victory" && record?.mode) counts[record.mode] = (counts[record.mode] ?? 0) + 1;
    return counts;
  }, {});
}

function loadProgression() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROGRESSION_KEY) ?? "null");
    if (saved) {
      const progress = normalizeProgression(saved);
      if (Object.keys(progress.mode_victories).length === 0) progress.mode_victories = getModeVictories(loadRecords());
      return progress;
    }
  } catch { /* Fall through to legacy records. */ }
  const records = loadRecords();
  const modeVictories = getModeVictories(records);
  return normalizeProgression({
    ...EMPTY_PROGRESSION,
    runs_played: records.length,
    victories: records.filter((record) => record?.outcome === "victory").length,
    shop_victories: records.filter((record) => record?.outcome === "victory" && record?.mode === "shop").length,
    endless_victories: records.filter((record) => record?.outcome === "victory" && record?.mode === "endless").length,
    god: records.some((record) => record?.outcome === "victory" && record?.mode === "endless"),
    mode_victories: modeVictories,
  });
}

function saveProgression(value) {
  const safe = normalizeProgression(value);
  try { localStorage.setItem(PROGRESSION_KEY, JSON.stringify(safe)); } catch { /* Storage may be disabled. */ }
  return safe;
}

function recordRunProgress(record) {
  const progress = loadProgression();
  progress.runs_played += 1;
  if (record?.outcome === "victory") {
    progress.victories += 1;
    if (record?.mode) progress.mode_victories[record.mode] = (progress.mode_victories[record.mode] ?? 0) + 1;
  }
  if (record?.outcome === "victory" && record?.mode === "shop") progress.shop_victories += 1;
  if (record?.outcome === "victory" && record?.mode === "endless") {
    progress.endless_victories += 1;
    progress.god = true;
  }
  return saveProgression(progress);
}

function getUnlocks() {
  const progress = loadProgression();
  return {
    random_start: progress.runs_played >= 1,
    prep: progress.runs_played >= 2,
    shop: progress.victories >= 1,
    contract_shop: progress.shop_victories >= 1,
    endless: progress.victories >= 1,
    hard: progress.victories >= 1,
    god: Boolean(progress.god),
  };
}

function makeId(card, index = 0) {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${card?.id ?? "card"}-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadRecords() {
  try {
    const value = JSON.parse(localStorage.getItem(RECORD_KEY) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveRecord(record) {
  const records = [...loadRecords(), record]
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  try { localStorage.setItem(RECORD_KEY, JSON.stringify(records)); } catch { /* Storage may be disabled. */ }
  return records;
}

function loadTutorialComplete() {
  try { return localStorage.getItem(TUTORIAL_KEY) === "complete"; } catch { return false; }
}

function saveTutorialComplete() {
  try { localStorage.setItem(TUTORIAL_KEY, "complete"); } catch { /* Storage may be disabled. */ }
  return true;
}

function hasCompletedRun() {
  return loadRecords().some((record) => record?.outcome === "victory");
}

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    const fontSize = ["small", "medium", "large"].includes(stored?.font_size) ? stored.font_size : "medium";
    return {
      music: stored?.music !== false,
      effects: stored?.effects !== false,
      font_size: fontSize,
      random_start: stored?.random_start === true,
      home_theme: ["day", "night"].includes(stored?.home_theme) ? stored.home_theme : "night",
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings = {}) {
  const safe = {
    music: settings.music !== false,
    effects: settings.effects !== false,
    font_size: ["small", "medium", "large"].includes(settings.font_size) ? settings.font_size : "medium",
    random_start: settings.random_start === true,
    home_theme: ["day", "night"].includes(settings.home_theme) ? settings.home_theme : "night",
  };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(safe)); } catch { /* Storage may be disabled. */ }
  return safe;
}

function saveRun(state) {
  try {
    localStorage.setItem(RUN_SAVE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function migrateRunState(state) {
  if (!state || state.phase === "GameOver") return null;
  if (state.schema_version === 20) {
    state.schema_version = 21;
    state.item_serial ??= 0;
    if (state.round) {
      state.round.postpone_counts ??= Object.fromEntries(
        (state.round.postponed_uuids ?? []).map((uuid) => [uuid, 1]),
      );
      state.round.item_fruit_chain ??= 0;
    }
  }
  if (state.schema_version === 21) {
    state.schema_version = 22;
    state.items = [];
    state.item_history = [];
    state.pending_item_ids = [];
    state.pending_item_resolution = null;
    state.exiled_cards = [];
    if (state.round) {
      state.round.best_wrong_edibility_streak ??= 0;
      state.round.last_item_action ??= null;
      state.round.item_alternation_count ??= 0;
      state.round.item_destroy_protected ??= false;
      state.round.item_generation_copied ??= false;
      state.round.pending_item_messages ??= [];
    }
  }
  if (state.schema_version === 22) {
    state.schema_version = 23;
    state.free_rerolls ??= 1;
    state.reroll_tokens ??= 0;
  }
  if (state.schema_version === 23 && state.round) {
    state.round.postponed_uuids ??= [];
    state.round.postpone_counts ??= {};
    for (const uuid of state.round.postponed_uuids) {
      state.round.postpone_counts[uuid] = Math.max(1, state.round.postpone_counts[uuid] ?? 0);
    }
    for (const [uuid, count] of Object.entries(state.round.postpone_counts)) {
      if (count > 0 && !state.round.postponed_uuids.includes(uuid)) state.round.postponed_uuids.push(uuid);
    }
  }
  if (state.schema_version === 23) {
    state.schema_version = 24;
    state.random_start ??= false;
    state.prep_slot ??= null;
    state.gold ??= 0;
    state.remove_card_cost ??= 0;
    state.free_card_removals ??= 0;
    state.shop_lock_requested ??= false;
    state.shop_lock_carry ??= false;
    state.pending_shop ??= null;
    state.rare_shop_weight_bonus ??= 0;
    state.rule_history ??= [];
  }
  if (state.schema_version === 24 && state.round) {
    state.active_rules = Array.isArray(state.active_rules) ? state.active_rules : [];
    state.rule_history = Array.isArray(state.rule_history) ? state.rule_history : [];
    state.round.gold_sources ??= [];
    state.round.postponed_uuids ??= [];
    state.round.postpone_counts ??= {};
    for (const uuid of state.round.postponed_uuids) {
      state.round.postpone_counts[uuid] = Math.max(1, state.round.postpone_counts[uuid] ?? 0);
    }
    for (const [uuid, count] of Object.entries(state.round.postpone_counts)) {
      if (count > 0 && !state.round.postponed_uuids.includes(uuid)) state.round.postponed_uuids.push(uuid);
    }
  }
  return state.schema_version === 24 ? state : null;
}

function loadRun() {
  try {
    return migrateRunState(JSON.parse(localStorage.getItem(RUN_SAVE_KEY) ?? "null"));
  } catch {
    return null;
  }
}

function clearRun() {
  try { localStorage.removeItem(RUN_SAVE_KEY); } catch { return false; }
  return true;
}

export const browserPlatform = Object.freeze({
  now: () => Date.now(),
  random: () => Math.random(),
  create_id: makeId,
  load_records: loadRecords,
  save_record: saveRecord,
  has_completed_run: hasCompletedRun,
  load_progression: loadProgression,
  record_run_progress: recordRunProgress,
  get_unlocks: getUnlocks,
  load_shop_tutorial_complete: () => { try { return localStorage.getItem(SHOP_TUTORIAL_KEY) === "complete"; } catch { return false; } },
  save_shop_tutorial_complete: () => { try { localStorage.setItem(SHOP_TUTORIAL_KEY, "complete"); } catch { /* noop */ } return true; },
  load_tutorial_complete: loadTutorialComplete,
  save_tutorial_complete: saveTutorialComplete,
  load_settings: loadSettings,
  save_settings: saveSettings,
  save_run: saveRun,
  load_run: loadRun,
  clear_run: clearRun,
  has_saved_run: () => Boolean(loadRun()),
});
