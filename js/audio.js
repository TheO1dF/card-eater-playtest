const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
let isBGMPlaying = false;
let bgmTimer = null;
let masterBgmGain = null;
let step = 0;

export function initAudio() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") void audioCtx.resume();
}

function tone({ frequency, end = frequency, duration = 0.16, volume = 0.13, type = "square", delay = 0 }) {
  if (!audioCtx) initAudio();
  const start = audioCtx.currentTime + delay;
  const oscillator = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(Math.max(24, frequency), start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(24, end), start + duration);
  gain.gain.setValueAtTime(0.001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  oscillator.connect(gain);
  gain.connect(audioCtx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function chord(frequencies, options = {}) {
  frequencies.forEach((frequency, index) => tone({ frequency, delay: index * 0.025, ...options }));
}

export function playSound(type, strength = 1) {
  initAudio();
  const safe = Math.max(1, Math.min(24, Number(strength) || 1));
  if (type === "eat") {
    const base = Math.min(1500, 420 * Math.pow(1.055, safe - 1));
    tone({ frequency: base, end: base * 1.55, duration: 0.18, volume: 0.16, type: "sine" });
  } else if (type === "discard") {
    tone({ frequency: 250 + safe * 8, end: 92, duration: 0.19, volume: 0.14, type: "triangle" });
  } else if (type === "postpone") {
    tone({ frequency: 310, end: 450, duration: 0.1, volume: 0.09, type: "triangle" });
    tone({ frequency: 450, end: 310, duration: 0.1, volume: 0.08, type: "triangle", delay: 0.09 });
  } else if (type === "effect") {
    tone({ frequency: 680, end: 960, duration: 0.13, volume: 0.07, type: "square" });
  } else if (type === "combo") {
    const base = Math.min(1200, 520 + safe * 22);
    chord([base, base * 1.25, base * 1.5], { end: base * 1.8, duration: 0.18, volume: 0.055, type: "square" });
  } else if (type === "reroll") {
    chord([280, 390, 540], { end: 760, duration: 0.16, volume: 0.08, type: "triangle" });
  } else if (type === "draft") {
    chord([440, 554, 659], { end: 880, duration: 0.22, volume: 0.09, type: "square" });
  } else if (type === "item") {
    chord([330, 494, 659, 988], { end: 1046, duration: 0.3, volume: 0.075, type: "sine" });
  } else if (type === "milestone") {
    chord([392, 523, 659], { end: 784, duration: 0.28, volume: 0.07, type: "triangle" });
  } else if (type === "error" || type === "damage") {
    tone({ frequency: 170, end: 48, duration: 0.3, volume: 0.23, type: "sawtooth" });
  }
}

function scheduleBGM() {
  if (!audioCtx || !isBGMPlaying || !masterBgmGain) return;
  const time = audioCtx.currentTime;
  const bass = [73.42, 0, 110, 0, 73.42, 0, 130.81, 0, 98, 0, 146.83, 0, 98, 0, 87.31, 0];
  const hat = audioCtx.createOscillator();
  const hatGain = audioCtx.createGain();
  hat.type = "square";
  hat.frequency.setValueAtTime(7600, time);
  hatGain.gain.setValueAtTime(0.018, time);
  hatGain.gain.exponentialRampToValueAtTime(0.001, time + 0.045);
  hat.connect(hatGain);
  hatGain.connect(masterBgmGain);
  hat.start(time);
  hat.stop(time + 0.05);
  if (bass[step]) {
    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(bass[step], time);
    gain.gain.setValueAtTime(0.32, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.24);
    oscillator.connect(gain);
    gain.connect(masterBgmGain);
    oscillator.start(time);
    oscillator.stop(time + 0.26);
  }
  step = (step + 1) % bass.length;
}

export function toggleBGM(play) {
  initAudio();
  if (play && !isBGMPlaying) {
    isBGMPlaying = true;
    masterBgmGain = audioCtx.createGain();
    masterBgmGain.gain.value = 0.42;
    masterBgmGain.connect(audioCtx.destination);
    step = 0;
    bgmTimer = window.setInterval(scheduleBGM, 230);
  } else if (!play && isBGMPlaying) {
    isBGMPlaying = false;
    window.clearInterval(bgmTimer);
    masterBgmGain?.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.35);
  }
}

export function getAudioStatus() {
  return { context_state: audioCtx?.state ?? "uninitialized", bgm_playing: isBGMPlaying };
}
