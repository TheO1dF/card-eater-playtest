const RECORD_KEY = "cardeater.run-history.v1";
const TUTORIAL_KEY = "cardeater.story-tutorial.v1";
const SETTINGS_KEY = "cardeater.settings.v1";
const DEFAULT_SETTINGS = Object.freeze({ music: true, effects: true, font_size: "medium" });

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
  };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(safe)); } catch { /* Storage may be disabled. */ }
  return safe;
}

export const browserPlatform = Object.freeze({
  now: () => Date.now(),
  random: () => Math.random(),
  create_id: makeId,
  vibrate: (pattern = 8) => globalThis.navigator?.vibrate?.(pattern),
  load_records: loadRecords,
  save_record: saveRecord,
  has_completed_run: hasCompletedRun,
  load_tutorial_complete: loadTutorialComplete,
  save_tutorial_complete: saveTutorialComplete,
  load_settings: loadSettings,
  save_settings: saveSettings,
});
