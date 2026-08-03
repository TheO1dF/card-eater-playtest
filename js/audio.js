const AudioContext = window.AudioContext || window.webkitAudioContext;
const BPM = 128;
const STEP_SECONDS = 60 / BPM / 4;
const LOOKAHEAD_SECONDS = 0.16;
const THEME_CROSSFADE_SECONDS = 1.4;
const MUSIC_THEMES = Object.freeze({
  day: Object.freeze({
    mode: "C major / warm lydian",
    chords: Object.freeze([
      { root: 36, notes: [48, 52, 55, 59] }, // Cmaj7
      { root: 41, notes: [53, 57, 60, 64] }, // Fmaj7
      { root: 45, notes: [57, 60, 64, 67] }, // Am7
      { root: 43, notes: [55, 59, 62, 64] }, // G6
    ]),
    bassFilter: 840,
    motionFilter: 2050,
    motionType: "triangle",
    padFilter: 1380,
    padTypes: ["sine", "triangle", "sine"],
  }),
  night: Object.freeze({
    mode: "E minor / mysterious add9",
    chords: Object.freeze([
      { root: 40, notes: [52, 55, 59, 66] }, // Em(add9)
      { root: 36, notes: [48, 52, 54, 59] }, // Cmaj7(#11)
      { root: 33, notes: [45, 48, 52, 59] }, // Am9
      { root: 35, notes: [47, 52, 54, 57] }, // B7sus4
    ]),
    bassFilter: 620,
    motionFilter: 1550,
    motionType: "square",
    padFilter: 780,
    padTypes: ["sawtooth", "triangle", "sawtooth"],
  }),
});

let audioCtx = null;
let isBGMPlaying = false;
let bgmRequested = false;
let unlockPromise = null;
let bgmTimer = null;
let masterBgmGain = null;
let musicCompressor = null;
let musicBuses = null;
let noiseBuffer = null;
let transportStart = 0;
let nextStepTime = 0;
let transportStep = 0;
let actionEnergy = 0;
let bgmTheme = "night";
let effectCount = 0;
let lastEffect = null;
let lastUiVariant = null;
const lastUiVariantByType = new Map();
const uiVariantHistory = [];
const uiSoundBags = new Map();

const UI_SOUND_VARIANTS = Object.freeze({
  "ui-click": Object.freeze([
    Object.freeze({ note: 60, end: 64, voice: "square" }),
    Object.freeze({ note: 62, end: 67, voice: "triangle" }),
    Object.freeze({ note: 64, end: 69, voice: "square" }),
    Object.freeze({ note: 67, end: 72, voice: "triangle" }),
    Object.freeze({ note: 69, end: 74, voice: "square" }),
  ]),
  "ui-toggle": Object.freeze([
    Object.freeze({ note: 55, end: 62, voice: "triangle" }),
    Object.freeze({ note: 57, end: 64, voice: "sine" }),
    Object.freeze({ note: 59, end: 67, voice: "triangle" }),
    Object.freeze({ note: 62, end: 69, voice: "sine" }),
  ]),
  "ui-confirm": Object.freeze([
    Object.freeze({ note: 48, end: 55, voice: "triangle" }),
    Object.freeze({ note: 50, end: 57, voice: "square" }),
    Object.freeze({ note: 52, end: 60, voice: "triangle" }),
    Object.freeze({ note: 55, end: 64, voice: "square" }),
  ]),
});

const midi = (note) => 440 * (2 ** ((note - 69) / 12));

function nextUiSoundVariant(type) {
  const variants = UI_SOUND_VARIANTS[type] ?? UI_SOUND_VARIANTS["ui-click"];
  let bag = uiSoundBags.get(type) ?? [];
  if (bag.length === 0) {
    bag = variants.map((_, index) => index);
    for (let index = bag.length - 1; index > 0; index -= 1) {
      const target = Math.floor(Math.random() * (index + 1));
      [bag[index], bag[target]] = [bag[target], bag[index]];
    }
    if (bag.length > 1 && bag.at(-1) === lastUiVariantByType.get(type)) {
      [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
    }
  }
  const variantIndex = bag.pop();
  uiSoundBags.set(type, bag);
  lastUiVariantByType.set(type, variantIndex);
  lastUiVariant = `${type}:${variantIndex}`;
  uiVariantHistory.push(lastUiVariant);
  if (uiVariantHistory.length > 16) uiVariantHistory.shift();
  return variants[variantIndex];
}

export function initAudio() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    noiseBuffer = audioCtx.createBuffer(1, Math.ceil(audioCtx.sampleRate * 0.5), audioCtx.sampleRate);
    const noise = noiseBuffer.getChannelData(0);
    for (let index = 0; index < noise.length; index += 1) noise[index] = Math.random() * 2 - 1;
  }
  return audioCtx;
}

export function unlockAudio() {
  if (audioCtx?.state === "running") return Promise.resolve(audioCtx);
  if (unlockPromise) return unlockPromise;
  const context = initAudio();
  unlockPromise = context.resume()
    .then(() => {
      unlockPromise = null;
      if (bgmRequested) toggleBGM(true);
      return context;
    })
    .catch(() => {
      unlockPromise = null;
      return context;
    });
  return unlockPromise;
}

function routeWithPan(source, destination, pan = 0) {
  if (!audioCtx.createStereoPanner || pan === 0) {
    source.connect(destination);
    return;
  }
  const panner = audioCtx.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  source.connect(panner);
  panner.connect(destination);
}

function synthTone({
  frequency,
  end = frequency,
  duration = 0.16,
  volume = 0.13,
  type = "square",
  delay = 0,
  startTime = null,
  attack = 0.012,
  filter = 0,
  pan = 0,
  destination = null,
}) {
  if (!audioCtx) initAudio();
  const start = startTime ?? audioCtx.currentTime + delay;
  const target = destination ?? audioCtx.destination;
  const oscillator = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(Math.max(24, frequency), start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(24, end), start + duration);
  gain.gain.setValueAtTime(0.001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), start + Math.min(attack, duration * 0.4));
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  if (filter > 0) {
    const lowpass = audioCtx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.setValueAtTime(filter, start);
    lowpass.frequency.exponentialRampToValueAtTime(Math.max(180, filter * 0.58), start + duration);
    oscillator.connect(lowpass);
    lowpass.connect(gain);
  } else {
    oscillator.connect(gain);
  }
  routeWithPan(gain, target, pan);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.025);
}

function noiseHit({ startTime, duration, volume, highpass, destination, pan = 0 }) {
  const source = audioCtx.createBufferSource();
  const filter = audioCtx.createBiquadFilter();
  const gain = audioCtx.createGain();
  source.buffer = noiseBuffer;
  filter.type = "highpass";
  filter.frequency.setValueAtTime(highpass, startTime);
  gain.gain.setValueAtTime(Math.max(0.001, volume), startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  source.connect(filter);
  filter.connect(gain);
  routeWithPan(gain, destination, pan);
  source.start(startTime);
  source.stop(startTime + duration + 0.02);
}

function ensureMusicGraph() {
  if (masterBgmGain) return;
  masterBgmGain = audioCtx.createGain();
  musicCompressor = audioCtx.createDynamicsCompressor();
  musicCompressor.threshold.value = -18;
  musicCompressor.knee.value = 12;
  musicCompressor.ratio.value = 4;
  musicCompressor.attack.value = 0.005;
  musicCompressor.release.value = 0.18;
  masterBgmGain.gain.value = 0.001;
  masterBgmGain.connect(musicCompressor);
  musicCompressor.connect(audioCtx.destination);
  const bus = (volume, destination = masterBgmGain) => {
    const gain = audioCtx.createGain();
    gain.gain.value = volume;
    gain.connect(destination);
    return gain;
  };
  const themeBus = (theme) => {
    const mix = bus(theme === bgmTheme ? 1 : 0.0001);
    return {
      mix,
      bass: bus(0.58, mix),
      harmony: bus(0.36, mix),
      motion: bus(0.42, mix),
    };
  };
  musicBuses = {
    drums: bus(0.72),
    response: bus(0.62),
    themes: {
      day: themeBus("day"),
      night: themeBus("night"),
    },
  };
}

function kick(startTime, accent = 1) {
  synthTone({ frequency: 132, end: 45, duration: 0.19, volume: 0.16 * accent, type: "sine", startTime, attack: 0.004, destination: musicBuses.drums });
  synthTone({ frequency: 760, end: 120, duration: 0.025, volume: 0.028 * accent, type: "square", startTime, attack: 0.002, destination: musicBuses.drums });
}

function snare(startTime, accent = 1) {
  noiseHit({ startTime, duration: 0.12, volume: 0.07 * accent, highpass: 1050, destination: musicBuses.drums, pan: 0.04 });
  synthTone({ frequency: 185, end: 108, duration: 0.085, volume: 0.035 * accent, type: "triangle", startTime, destination: musicBuses.drums });
}

function hat(startTime, open = false, pan = 0) {
  noiseHit({ startTime, duration: open ? 0.11 : 0.032, volume: open ? 0.026 : 0.015, highpass: 5800, destination: musicBuses.drums, pan });
}

function bass(startTime, note, destination, theme, duration = STEP_SECONDS * 1.55, accent = 1) {
  synthTone({ frequency: midi(note), end: midi(note) * 0.995, duration, volume: 0.072 * accent, type: "triangle", filter: theme.bassFilter, startTime, destination });
  synthTone({ frequency: midi(note - 12), duration: duration * 0.78, volume: 0.025 * accent, type: "sine", startTime, destination });
}

function pluck(startTime, note, accent = 1, pan = 0, destination = musicBuses.response, theme = MUSIC_THEMES[bgmTheme]) {
  synthTone({ frequency: midi(note), end: midi(note) * 0.997, duration: STEP_SECONDS * 1.15, volume: 0.032 * accent, type: theme.motionType, filter: theme.motionFilter, startTime, attack: 0.004, pan, destination });
}

function pad(startTime, notes, destination, theme) {
  notes.slice(0, 3).forEach((note, index) => {
    synthTone({
      frequency: midi(note),
      end: midi(note) * 1.002,
      duration: STEP_SECONDS * 14.5,
      volume: 0.018,
      type: theme.padTypes[index],
      filter: theme.padFilter,
      startTime,
      attack: 0.16,
      pan: (index - 1) * 0.32,
      destination,
    });
  });
}

function chordForStep(stepNumber, themeName = bgmTheme) {
  const theme = MUSIC_THEMES[themeName] ?? MUSIC_THEMES.night;
  return theme.chords[Math.floor(stepNumber / 16) % theme.chords.length];
}

function scheduleThemeStep(startTime, stepNumber, themeName) {
  const position = stepNumber % 16;
  const bar = Math.floor(stepNumber / 16);
  const theme = MUSIC_THEMES[themeName];
  const buses = musicBuses.themes[themeName];
  const chord = chordForStep(stepNumber, themeName);
  const active = Math.min(1, actionEnergy / 1.5);

  const bassOffsets = { 0: 0, 4: 0, 8: 7, 12: bar % 2 === 0 ? 12 : 7 };
  if (Object.hasOwn(bassOffsets, position)) bass(startTime, chord.root + bassOffsets[position], buses.bass, theme, undefined, position === 12 ? 0.9 : 1);
  if (position === 0) pad(startTime, chord.notes, buses.harmony, theme);

  if (position % 2 === 0) {
    const arpIndex = (position / 2 + bar) % chord.notes.length;
    const octave = position >= 8 && bar % 4 === 3 ? 12 : 0;
    const beatAccent = position % 4 === 0 ? 1 : 0.76;
    pluck(startTime, chord.notes[arpIndex] + octave, (0.46 + active * 0.48) * beatAccent, position % 4 === 0 ? -0.22 : 0.22, buses.motion, theme);
  }
  if (bar % 4 === 3 && position === 14) pluck(startTime, chord.notes[3] + 12, 0.72, 0, buses.motion, theme);
}

function scheduleMusicStep(startTime, stepNumber) {
  const position = stepNumber % 16;
  const bar = Math.floor(stepNumber / 16);
  const active = Math.min(1, actionEnergy / 1.5);

  if (position % 4 === 0) kick(startTime, position === 0 ? 1.12 : 0.88);
  if (position === 4 || position === 12) snare(startTime, position === 12 ? 1.08 : 1);
  if (position % 2 === 0) hat(startTime, position === 14 && bar % 4 === 3, position % 4 === 0 ? -0.24 : 0.24);
  if (active > 0.34 && position % 2 === 1) hat(startTime, false, position % 4 === 1 ? -0.38 : 0.38);

  scheduleThemeStep(startTime, stepNumber, "day");
  scheduleThemeStep(startTime, stepNumber, "night");

  actionEnergy = Math.max(0, actionEnergy - 0.045);
}

function scheduleBGM() {
  if (!audioCtx || !isBGMPlaying || !musicBuses) return;
  while (nextStepTime < audioCtx.currentTime + LOOKAHEAD_SECONDS) {
    scheduleMusicStep(nextStepTime, transportStep);
    nextStepTime += STEP_SECONDS;
    transportStep += 1;
  }
}

function quantizedActionResponse(type, strength) {
  if (!isBGMPlaying || !audioCtx || !musicBuses) return;
  actionEnergy = Math.min(3, actionEnergy + 0.42 + Math.min(12, strength) * 0.035);
  const earliest = audioCtx.currentTime + 0.025;
  const gridStep = Math.max(0, Math.ceil((earliest - transportStart) / STEP_SECONDS));
  const startTime = Math.max(earliest, transportStart + gridStep * STEP_SECONDS);
  const chord = chordForStep(gridStep);
  const responseGain = Math.min(1.45, 0.8 + strength * 0.035);
  if (type === "eat") {
    synthTone({ frequency: midi(chord.notes[1] + 12), end: midi(chord.notes[2] + 12), duration: STEP_SECONDS * 1.45, volume: 0.044 * responseGain, type: "square", filter: 2600, startTime, attack: 0.004, pan: 0.18, destination: musicBuses.response });
  } else if (type === "discard") {
    synthTone({ frequency: midi(chord.notes[2]), end: midi(chord.root), duration: STEP_SECONDS * 1.25, volume: 0.05 * responseGain, type: "triangle", filter: 1200, startTime, attack: 0.004, pan: -0.18, destination: musicBuses.response });
  } else if (type === "postpone") {
    const theme = MUSIC_THEMES[bgmTheme];
    pluck(startTime, chord.notes[0] + 12, 0.72, -0.24, musicBuses.response, theme);
    pluck(startTime + STEP_SECONDS, chord.notes[2] + 12, 0.62, 0.24, musicBuses.response, theme);
  }
}

function chord(frequencies, options = {}) {
  frequencies.forEach((frequency, index) => synthTone({ frequency, delay: index * 0.025, ...options }));
}

export function playSound(type, strength = 1) {
  if (!audioCtx || audioCtx.state !== "running") return false;
  effectCount += 1;
  lastEffect = type;
  const magnitude = Math.max(1, Math.min(1_000_000, Math.abs(Number(strength) || 1)));
  const safe = Math.min(24, magnitude);
  if (type === "eat") {
    const scale = [329.63, 392, 440, 493.88, 587.33, 659.25];
    const base = scale[Math.min(scale.length - 1, Math.floor((safe - 1) / 2))];
    synthTone({ frequency: base, end: base * 1.5, duration: 0.17, volume: 0.15, type: "sine" });
    quantizedActionResponse(type, safe);
  } else if (type === "discard") {
    const scale = [246.94, 220, 196, 164.81];
    const base = scale[Math.min(scale.length - 1, Math.floor((safe - 1) / 3))];
    synthTone({ frequency: base, end: base * 0.5, duration: 0.18, volume: 0.13, type: "triangle" });
    quantizedActionResponse(type, safe);
  } else if (type === "postpone") {
    synthTone({ frequency: 329.63, end: 493.88, duration: 0.09, volume: 0.08, type: "triangle" });
    synthTone({ frequency: 493.88, end: 329.63, duration: 0.09, volume: 0.07, type: "triangle", delay: 0.085 });
    quantizedActionResponse(type, safe);
  } else if (type === "effect") {
    synthTone({ frequency: 659.25, end: 987.77, duration: 0.13, volume: 0.065, type: "square" });
  } else if (type === "combo") {
    const base = Math.min(1174.66, 493.88 * (2 ** (Math.min(10, safe) / 18)));
    chord([base, base * 1.25, base * 1.5], { end: base * 1.8, duration: 0.18, volume: 0.05, type: "square" });
    actionEnergy = Math.min(3, actionEnergy + 0.45);
  } else if (type === "score-reveal") {
    const thresholds = [1, 2, 3, 5, 8, 12, 20, 35, 60, 100];
    const tier = Math.min(9, thresholds.findIndex((threshold) => magnitude <= threshold));
    const resolvedTier = tier < 0 ? 9 : tier;
    const notes = [60, 62, 64, 67, 69, 72, 74, 77, 81, 84];
    const base = midi(notes[resolvedTier]);
    synthTone({ frequency: base, end: base * 1.08, duration: 0.18 + resolvedTier * 0.012, volume: 0.075 + resolvedTier * 0.005, type: resolvedTier >= 5 ? "square" : "triangle", filter: 2100 + resolvedTier * 280, attack: 0.003 });
    synthTone({ frequency: base * 2, end: base * 1.5, duration: 0.09, volume: 0.028 + resolvedTier * 0.002, type: "square", delay: 0.025, filter: 3100 });
    if (resolvedTier >= 3) synthTone({ frequency: midi(notes[resolvedTier] + 7), end: midi(notes[resolvedTier] + 12), duration: 0.22, volume: 0.05, type: "triangle", delay: 0.055 });
    if (resolvedTier >= 7) chord([base, base * 1.25, base * 1.5], { duration: 0.3, volume: 0.045, type: "square", delay: 0.09, filter: 3400 });
    actionEnergy = Math.min(3, actionEnergy + 0.18 + resolvedTier * 0.08);
  } else if (type === "score-negative") {
    const depth = Math.min(7, Math.floor(Math.log2(magnitude + 1)));
    const start = midi(55 - depth * 2);
    synthTone({ frequency: start, end: Math.max(55, start * .42), duration: 0.24, volume: 0.1, type: "triangle", filter: 1100 });
    synthTone({ frequency: start * .5, end: 48, duration: 0.18, volume: 0.045, type: "square", delay: 0.04, filter: 720 });
  } else if (type === "score-review") {
    const tier = magnitude >= 100 ? 4 : magnitude >= 50 ? 3 : magnitude >= 30 ? 2 : magnitude >= 20 ? 1 : 0;
    const root = [55, 57, 60, 64, 67][tier];
    [0, 4, 7, 12].forEach((offset, index) => synthTone({ frequency: midi(root + offset), duration: 0.25 + index * .035, volume: 0.045, type: tier >= 3 ? "square" : "triangle", delay: index * .065, filter: 2400 + tier * 300 }));
  } else if (type === "receipt-tick") {
    const base = 392 + Math.min(8, safe) * 18;
    synthTone({ frequency: base, end: base * 1.08, duration: 0.055, volume: 0.035, type: "square", filter: 1900 });
  } else if (type === "grade-stamp") {
    const tier = Math.min(5, safe);
    synthTone({ frequency: 94, end: 52, duration: 0.18, volume: 0.18, type: "sawtooth", filter: 900 });
    chord([midi(48 + tier * 2), midi(55 + tier * 2), midi(60 + tier * 2)], { duration: 0.36, volume: 0.065, type: tier >= 4 ? "square" : "triangle", delay: 0.07, filter: 2400 });
  } else if (type === "ui-click") {
    const variant = nextUiSoundVariant(type);
    synthTone({ frequency: midi(variant.note), end: midi(variant.end), duration: 0.045, volume: 0.038, type: variant.voice, filter: 2600, attack: 0.002 });
    synthTone({ frequency: midi(variant.note + 12), end: midi(variant.end - 2), duration: 0.035, volume: 0.018, type: "triangle", delay: 0.018, filter: 3400 });
  } else if (type === "ui-toggle") {
    const variant = nextUiSoundVariant(type);
    synthTone({ frequency: midi(variant.note), end: midi(variant.end), duration: 0.07, volume: 0.045, type: variant.voice, filter: 2400, attack: 0.002 });
    synthTone({ frequency: midi(variant.note + 12), end: midi(variant.end + 5), duration: 0.06, volume: 0.022, type: "square", delay: 0.035, filter: 3600 });
  } else if (type === "ui-confirm") {
    const variant = nextUiSoundVariant(type);
    synthTone({ frequency: midi(variant.note), end: midi(variant.end), duration: 0.085, volume: 0.052, type: variant.voice, filter: 2500, attack: 0.002 });
    synthTone({ frequency: midi(variant.note + 12), end: midi(variant.end + 12), duration: 0.1, volume: 0.032, type: "square", delay: 0.045, filter: 3900 });
  } else if (type === "reroll") {
    chord([293.66, 392, 493.88], { end: 783.99, duration: 0.16, volume: 0.075, type: "triangle" });
  } else if (type === "draft") {
    chord([440, 554.37, 659.25], { end: 880, duration: 0.22, volume: 0.085, type: "square" });
  } else if (type === "item") {
    chord([329.63, 493.88, 659.25, 987.77], { end: 1046.5, duration: 0.3, volume: 0.07, type: "sine" });
  } else if (type === "essence") {
    chord([392, 523.25, 659.25, 783.99], { end: 1174.66 + safe * 12, duration: 0.42, volume: 0.08, type: "sine" });
    synthTone({ frequency: 1174.66, end: 1760, duration: 0.28, volume: 0.065, type: "square", delay: 0.18 });
  } else if (type === "deal") {
    const cards = Math.min(10, Math.max(4, safe));
    for (let index = 0; index < cards; index += 1) {
      synthTone({
        frequency: 196 + index * 18,
        end: 293.66 + index * 24,
        duration: 0.075,
        volume: 0.047,
        type: "triangle",
        delay: index * 0.072,
      });
    }
  } else if (type === "milestone") {
    chord([392, 523.25, 659.25], { end: 783.99, duration: 0.28, volume: 0.068, type: "triangle" });
  } else if (type === "error" || type === "damage") {
    synthTone({ frequency: 164.81, end: 48, duration: 0.3, volume: 0.2, type: "sawtooth", filter: 1500 });
  }
  return true;
}

export function toggleBGM(play) {
  bgmRequested = Boolean(play);
  if (!play && !audioCtx) return false;
  if (play && (!audioCtx || audioCtx.state !== "running")) return false;
  ensureMusicGraph();
  if (play && !isBGMPlaying) {
    isBGMPlaying = true;
    transportStep = 0;
    actionEnergy = 0;
    transportStart = audioCtx.currentTime + 0.055;
    nextStepTime = transportStart;
    masterBgmGain.gain.cancelScheduledValues(audioCtx.currentTime);
    masterBgmGain.gain.setValueAtTime(Math.max(0.001, masterBgmGain.gain.value), audioCtx.currentTime);
    masterBgmGain.gain.exponentialRampToValueAtTime(0.42, audioCtx.currentTime + 0.32);
    scheduleBGM();
    bgmTimer = window.setInterval(scheduleBGM, 25);
  } else if (!play && isBGMPlaying) {
    isBGMPlaying = false;
    window.clearInterval(bgmTimer);
    bgmTimer = null;
    masterBgmGain.gain.cancelScheduledValues(audioCtx.currentTime);
    masterBgmGain.gain.setValueAtTime(Math.max(0.001, masterBgmGain.gain.value), audioCtx.currentTime);
    masterBgmGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);
  }
  return isBGMPlaying;
}

export function setBGMTheme(theme, { immediate = false } = {}) {
  const selected = theme === "day" ? "day" : "night";
  bgmTheme = selected;
  if (!audioCtx || !musicBuses?.themes) return bgmTheme;

  const now = audioCtx.currentTime;
  const timeConstant = immediate ? 0.005 : THEME_CROSSFADE_SECONDS / 4.6;
  Object.entries(musicBuses.themes).forEach(([name, buses]) => {
    const target = name === selected ? 1 : 0.0001;
    buses.mix.gain.cancelScheduledValues(now);
    buses.mix.gain.setTargetAtTime(target, now, timeConstant);
  });
  return bgmTheme;
}

export function getAudioStatus() {
  return {
    context_state: audioCtx?.state ?? "uninitialized",
    bgm_playing: isBGMPlaying,
    bgm_requested: bgmRequested,
    bpm: BPM,
    layers: musicBuses ? 5 : 0,
    theme: bgmTheme,
    mode: MUSIC_THEMES[bgmTheme].mode,
    theme_transition: `continuous-${THEME_CROSSFADE_SECONDS}s-crossfade`,
    transport_step: transportStep,
    action_sync: "immediate-plus-quantized-response",
    groove_alignment: "kick-bass-melody-even-grid",
    effect_count: effectCount,
    last_effect: lastEffect,
    last_ui_variant: lastUiVariant,
    ui_variant_history: [...uiVariantHistory],
  };
}
