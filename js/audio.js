const AudioContext = window.AudioContext || window.webkitAudioContext;
const BPM = 128;
const STEP_SECONDS = 60 / BPM / 4;
const LOOKAHEAD_SECONDS = 0.16;
const CHORDS = Object.freeze([
  { root: 40, notes: [52, 55, 59, 64] }, // E minor
  { root: 36, notes: [48, 52, 55, 59] }, // C major 7
  { root: 43, notes: [50, 55, 59, 62] }, // G major
  { root: 38, notes: [50, 54, 57, 62] }, // D major
]);

let audioCtx = null;
let isBGMPlaying = false;
let bgmTimer = null;
let masterBgmGain = null;
let musicCompressor = null;
let musicBuses = null;
let noiseBuffer = null;
let transportStart = 0;
let nextStepTime = 0;
let transportStep = 0;
let actionEnergy = 0;

const midi = (note) => 440 * (2 ** ((note - 69) / 12));

export function initAudio() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    noiseBuffer = audioCtx.createBuffer(1, Math.ceil(audioCtx.sampleRate * 0.5), audioCtx.sampleRate);
    const noise = noiseBuffer.getChannelData(0);
    for (let index = 0; index < noise.length; index += 1) noise[index] = Math.random() * 2 - 1;
  }
  if (audioCtx.state === "suspended") void audioCtx.resume();
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
  const bus = (volume) => {
    const gain = audioCtx.createGain();
    gain.gain.value = volume;
    gain.connect(masterBgmGain);
    return gain;
  };
  musicBuses = {
    drums: bus(0.72),
    bass: bus(0.58),
    harmony: bus(0.36),
    motion: bus(0.42),
    response: bus(0.62),
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

function bass(startTime, note, duration = STEP_SECONDS * 1.55, accent = 1) {
  synthTone({ frequency: midi(note), end: midi(note) * 0.995, duration, volume: 0.072 * accent, type: "triangle", filter: 680, startTime, destination: musicBuses.bass });
  synthTone({ frequency: midi(note - 12), duration: duration * 0.78, volume: 0.025 * accent, type: "sine", startTime, destination: musicBuses.bass });
}

function pluck(startTime, note, accent = 1, pan = 0) {
  synthTone({ frequency: midi(note), end: midi(note) * 0.997, duration: STEP_SECONDS * 1.15, volume: 0.032 * accent, type: "square", filter: 2300, startTime, attack: 0.004, pan, destination: musicBuses.motion });
}

function pad(startTime, notes) {
  notes.slice(0, 3).forEach((note, index) => {
    synthTone({
      frequency: midi(note),
      end: midi(note) * 1.002,
      duration: STEP_SECONDS * 14.5,
      volume: 0.018,
      type: index === 1 ? "triangle" : "sawtooth",
      filter: 920,
      startTime,
      attack: 0.16,
      pan: (index - 1) * 0.32,
      destination: musicBuses.harmony,
    });
  });
}

function chordForStep(stepNumber) {
  return CHORDS[Math.floor(stepNumber / 16) % CHORDS.length];
}

function scheduleMusicStep(startTime, stepNumber) {
  const position = stepNumber % 16;
  const bar = Math.floor(stepNumber / 16);
  const chord = chordForStep(stepNumber);
  const active = Math.min(1, actionEnergy / 1.5);

  if (position % 4 === 0) kick(startTime, position === 0 ? 1.12 : 0.88);
  if (position === 4 || position === 12) snare(startTime, position === 12 ? 1.08 : 1);
  if (position % 2 === 0) hat(startTime, position === 14 && bar % 4 === 3, position % 4 === 0 ? -0.24 : 0.24);
  if (active > 0.34 && position % 2 === 1) hat(startTime, false, position % 4 === 1 ? -0.38 : 0.38);

  const bassOffsets = { 2: 0, 6: 0, 10: 7, 14: bar % 2 === 0 ? 12 : 7 };
  if (Object.hasOwn(bassOffsets, position)) bass(startTime, chord.root + bassOffsets[position], undefined, position === 14 ? 0.84 : 1);
  if (position === 0) pad(startTime, chord.notes);

  if (position % 2 === 1) {
    const arpIndex = ((position - 1) / 2 + bar) % chord.notes.length;
    const octave = position >= 9 && bar % 4 === 3 ? 12 : 0;
    pluck(startTime, chord.notes[arpIndex] + octave, 0.5 + active * 0.52, position % 4 === 1 ? -0.3 : 0.3);
  }
  if (bar % 4 === 3 && position === 15) pluck(startTime, chord.notes[3] + 12, 0.72, 0);

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
    pluck(startTime, chord.notes[0] + 12, 0.72, -0.24);
    pluck(startTime + STEP_SECONDS, chord.notes[2] + 12, 0.62, 0.24);
  }
}

function chord(frequencies, options = {}) {
  frequencies.forEach((frequency, index) => synthTone({ frequency, delay: index * 0.025, ...options }));
}

export function playSound(type, strength = 1) {
  initAudio();
  const safe = Math.max(1, Math.min(24, Number(strength) || 1));
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
}

export function toggleBGM(play) {
  initAudio();
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
}

export function getAudioStatus() {
  return {
    context_state: audioCtx?.state ?? "uninitialized",
    bgm_playing: isBGMPlaying,
    bpm: BPM,
    layers: musicBuses ? 5 : 0,
    action_sync: "immediate-plus-quantized-response",
  };
}
