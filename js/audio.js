// js/audio.js
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

export function initAudio() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

export function playSound(type, streak) {
  if (!audioCtx) initAudio();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  
  const safeStreak = Math.max(1, Math.min(24, Number.isFinite(Number(streak)) ? Number(streak) : 1));
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  
  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  
  const now = audioCtx.currentTime;
  
  if (type === 'eat') {
    // 吃牌音效：清脆的滴答声，随着连续吃，音调越来越高 (半音阶上升)
    osc.type = 'sine';
    const baseFreq = Math.min(8000, 440 * Math.pow(1.06, safeStreak - 1)); // 有上限的半音阶，避免长局 AudioParam 溢出
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, now + 0.1);
    
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.3, now + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    
    osc.start(now);
    osc.stop(now + 0.2);
  } 
  else if (type === 'discard') {
    // 弃牌音效：短促的低频风声，连续弃牌也会有微妙的变化
    osc.type = 'triangle';
    const baseFreq = 200 + (safeStreak * 10);
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.5, now + 0.15);
    
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.2, now + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    
    osc.start(now);
    osc.stop(now + 0.2);
  } 
  else if (type === 'effect') {
    // 效果触发叠一层短促高音，让“启动 → 收割”在听觉上也有确认感。
    osc.type = 'square';
    const baseFreq = Math.min(8000, 660 * Math.pow(1.035, Math.min(safeStreak, 8) - 1));
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.32, now + 0.12);

    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.1, now + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

    osc.start(now);
    osc.stop(now + 0.16);
  }
  else if (type === 'error' || type === 'damage') {
    // 吃到负分牌的音效：刺耳的锯齿波
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.3);
    
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.4, now + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    
    osc.start(now);
    osc.stop(now + 0.3);
  }
}

// --- BGM 引擎 (幸运房东 动感肉鸽风) ---
let isBGMPlaying = false;
let bgmTimer;
let masterBgmGain;
let step = 0;

function scheduleBGM() {
  if (!audioCtx || !isBGMPlaying) return;
  const time = audioCtx.currentTime; 
  
  // 16步音序器：构成 2个小节 的 8分音符洗脑循环
  // 经典放克走向: Dm7 -> G7 (极具律动感的弹拨贝斯)
  const bassSeq =[
    73.42, 0, 110.00, 0, 73.42, 0, 130.81, 0, // Dm7 贝斯线
    98.00, 0, 146.83, 0, 98.00, 0, 87.31,  0  // G7 贝斯线
  ];
  
  // 两个极具跳跃感的轻爵士和弦 (F-A-C, F-G-B)
  const chordSeq1 =[174.61, 220.00, 261.63]; 
  const chordSeq2 =[174.61, 196.00, 246.94]; 

  // 1. 鼓点 (Hi-hat)：每个半拍敲击一次，提供向前推进的动能
  const oscH = audioCtx.createOscillator();
  const gainH = audioCtx.createGain();
  oscH.type = 'square'; // 用极短的方波模拟闭镲声
  oscH.frequency.setValueAtTime(8000, time);
  oscH.connect(gainH); gainH.connect(masterBgmGain);
  gainH.gain.setValueAtTime(0, time);
  gainH.gain.linearRampToValueAtTime(0.02, time + 0.01);
  gainH.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
  oscH.start(time); oscH.stop(time + 0.05);

  // 2. 贝斯音 (Bass)：正拍演奏，浑厚有力
  const bassFreq = bassSeq[step];
  if (bassFreq) {
    const oscB = audioCtx.createOscillator();
    const gainB = audioCtx.createGain();
    oscB.type = 'triangle'; // 三角波能提供极其饱满有弹性的低音
    oscB.frequency.setValueAtTime(bassFreq, time);
    oscB.connect(gainB); gainB.connect(masterBgmGain);
    gainB.gain.setValueAtTime(0, time);
    gainB.gain.linearRampToValueAtTime(0.4, time + 0.01);
    gainB.gain.exponentialRampToValueAtTime(0.001, time + 0.25); // 快速衰减模拟拨弦
    oscB.start(time); oscB.stop(time + 0.3);
  }

  // 3. 电子和弦 (Chords)：全都在“反拍”演奏，营造摇摆抖腿感！
  if (step % 2 !== 0) { 
    const chords = step < 8 ? chordSeq1 : chordSeq2;
    chords.forEach(freq => {
      const oscC = audioCtx.createOscillator();
      const gainC = audioCtx.createGain();
      oscC.type = 'sine'; // 正弦波模拟水滴般圆润的合成器
      oscC.frequency.setValueAtTime(freq, time);
      oscC.connect(gainC); gainC.connect(masterBgmGain);
      gainC.gain.setValueAtTime(0, time);
      gainC.gain.linearRampToValueAtTime(0.08, time + 0.01);
      gainC.gain.exponentialRampToValueAtTime(0.001, time + 0.1); // 极度短促
      oscC.start(time); oscC.stop(time + 0.15);
    });
  }

  step = (step + 1) % 16;
}

export function toggleBGM(play) {
  if (!audioCtx) initAudio();
  
  if (play && !isBGMPlaying) {
    isBGMPlaying = true;
    masterBgmGain = audioCtx.createGain();
    masterBgmGain.gain.value = 0.5; // BGM 主音量，调低不抢吃牌音效
    masterBgmGain.connect(audioCtx.destination);
    
    step = 0;
    // 设定速度约为 130 BPM 的八分音符 (极其适合轻快肉鸽节奏)
    bgmTimer = setInterval(scheduleBGM, 230);

  } else if (!play && isBGMPlaying) {
    isBGMPlaying = false;
    clearInterval(bgmTimer);
    if (masterBgmGain) {
      // 关停时做个平滑的 0.5s 淡出
      masterBgmGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.5);
    }
  }
}

export function getAudioStatus() {
  return {
    context_state: audioCtx?.state ?? "uninitialized",
    bgm_playing: isBGMPlaying,
  };
}
