'use strict';
/* =====================================================================
   SCP：RX · 收容失效  —  02 音效层
   全部使用 WebAudio 程序化合成，零外部音频资源。
   ===================================================================== */
const AudioSys = (() => {
  let ctx = null, master = null, sfxGain = null, ambGain = null;
  let noiseBuf = null, ready = false;
  let ambient = null;

  function init() {
    if (ready) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = SETTINGS.vol; master.connect(ctx.destination);
      sfxGain = ctx.createGain(); sfxGain.gain.value = 1.0; sfxGain.connect(master);
      ambGain = ctx.createGain(); ambGain.gain.value = 0.5; ambGain.connect(master);
      // 噪声源（2 秒白噪声，循环使用）
      const n = ctx.sampleRate * 2;
      noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      ready = true;
    } catch (e) { console.warn('音频初始化失败', e); }
  }
  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }
  function setVol(v) { SETTINGS.vol = v; if (master) master.gain.value = v; }

  // 距离衰减
  function atten(dist, maxD) {
    if (dist == null) return 1;
    return clamp(1 - dist / (maxD || 60), 0, 1) ** 1.6;
  }

  function noise(dur, { gain = 0.3, type = 'lowpass', freq = 1200, q = 1, decay = true, delay = 0, at = 1 } = {}) {
    if (!ready) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain * at, t + 0.004);
    if (decay) g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(sfxGain);
    s.start(t); s.stop(t + dur + 0.02);
    return { f, g, t, s };
  }
  function tone(freq, dur, { gain = 0.2, type = 'sine', delay = 0, slideTo = null, at = 1 } = {}) {
    if (!ready) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain * at, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(sfxGain);
    o.start(t); o.stop(t + dur + 0.02);
    return { o, g };
  }

  // ---------- 枪声 ----------
  function gunshot(kind, dist) {
    if (!ready) return;
    const at = atten(dist, 90);
    if (at <= 0.01) return;
    switch (kind) {
      case 'pistol':
        noise(0.11, { gain: 0.34, freq: 2600, q: 0.9, at });
        tone(180, 0.07, { gain: 0.16, type: 'square', slideTo: 60, at });
        break;
      case 'smg':
        noise(0.10, { gain: 0.32, freq: 3000, q: 1.0, at });
        tone(200, 0.06, { gain: 0.14, type: 'square', slideTo: 70, at });
        break;
      case 'rifle':
        noise(0.16, { gain: 0.46, freq: 1900, q: 0.8, at });
        noise(0.05, { gain: 0.3, freq: 5200, q: 0.6, at });
        tone(150, 0.10, { gain: 0.22, type: 'sawtooth', slideTo: 48, at });
        break;
      case 'mg':
        noise(0.19, { gain: 0.52, freq: 1500, q: 0.7, at });
        tone(115, 0.12, { gain: 0.26, type: 'sawtooth', slideTo: 40, at });
        break;
      case 'shotgun':
        noise(0.30, { gain: 0.55, freq: 900, q: 0.5, at });
        tone(95, 0.20, { gain: 0.3, type: 'sawtooth', slideTo: 35, at });
        break;
      default:
        noise(0.12, { gain: 0.36, freq: 2200, q: 0.9, at });
    }
  }
  // 消音器版本
  function suppressed(dist) {
    if (!ready) return;
    const at = atten(dist, 26);
    noise(0.07, { gain: 0.16, freq: 900, q: 1.4, at });
    tone(320, 0.05, { gain: 0.08, type: 'triangle', slideTo: 120, at });
  }

  function dryFire() { noise(0.04, { gain: 0.16, freq: 4200, q: 2 }); tone(1400, 0.03, { gain: 0.05, type: 'square' }); }
  function reload(stage) {
    if (!ready) return;
    if (stage === 'magout') { noise(0.06, { gain: 0.2, freq: 1800, q: 2.4 }); tone(520, 0.05, { gain: 0.07, type: 'square', slideTo: 300 }); }
    else if (stage === 'magin') { noise(0.08, { gain: 0.24, freq: 1200, q: 2.0 }); tone(360, 0.06, { gain: 0.09, type: 'square', slideTo: 520 }); }
    else { noise(0.05, { gain: 0.26, freq: 2600, q: 3 }); tone(700, 0.04, { gain: 0.08, type: 'square' }); }
  }
  function bolt() { noise(0.09, { gain: 0.24, freq: 2200, q: 2.2 }); tone(480, 0.06, { gain: 0.08, type: 'square', slideTo: 260 }); }

  // ---------- 反馈音 ----------
  function hitmark(head) {
    if (!ready) return;
    tone(head ? 1900 : 1450, 0.05, { gain: 0.14, type: 'square', slideTo: head ? 2400 : 1100 });
  }
  function killConfirm() {
    tone(880, 0.07, { gain: 0.13, type: 'triangle' });
    tone(1320, 0.10, { gain: 0.11, type: 'triangle', delay: 0.06 });
  }
  function hurt() {
    if (!ready) return;
    noise(0.18, { gain: 0.3, freq: 500, q: 0.7 });
    tone(90, 0.16, { gain: 0.2, type: 'sawtooth', slideTo: 50 });
  }
  function pickup() { tone(760, 0.07, { gain: 0.12, type: 'triangle' }); tone(1140, 0.09, { gain: 0.1, type: 'triangle', delay: 0.05 }); }
  function uiClick() { tone(560, 0.04, { gain: 0.09, type: 'square', slideTo: 700 }); }
  function uiBack() { tone(420, 0.05, { gain: 0.08, type: 'square', slideTo: 260 }); }
  function uiHover() { tone(980, 0.025, { gain: 0.05, type: 'sine' }); }
  function alarm() {
    if (!ready) return;
    tone(680, 0.5, { gain: 0.12, type: 'sine', slideTo: 900 });
    tone(680, 0.5, { gain: 0.12, type: 'sine', slideTo: 900, delay: 0.7 });
  }
  function door(open) {
    if (!ready) return;
    noise(0.5, { gain: 0.2, freq: open ? 700 : 500, q: 0.6 });
    tone(open ? 120 : 90, 0.45, { gain: 0.12, type: 'sawtooth', slideTo: open ? 200 : 60 });
  }
  function beep(hi) { tone(hi ? 1400 : 800, 0.09, { gain: 0.12, type: 'square' }); }

  // ---------- SCP 音效 ----------
  function scpRoar(kind, dist) {
    if (!ready) return;
    const at = atten(dist, 70);
    if (at <= 0.02) return;
    switch (kind) {
      case '096': // 尖锐、非人的嘶鸣
        tone(420, 1.5, { gain: 0.26 * at, type: 'sawtooth', slideTo: 1400 });
        noise(1.4, { gain: 0.2 * at, freq: 3000, q: 0.8 });
        break;
      case '682': // 低频巨兽咆哮
        tone(58, 2.0, { gain: 0.34 * at, type: 'sawtooth', slideTo: 34 });
        noise(1.9, { gain: 0.26 * at, freq: 400, q: 0.5 });
        break;
      case '939': // 拟声：扭曲的人声碎片
        for (let i = 0; i < 4; i++) {
          tone(rand(260, 620), 0.22, { gain: 0.15 * at, type: 'triangle', delay: i * 0.24, slideTo: rand(180, 700) });
        }
        break;
      case '173': // 石料摩擦
        noise(0.35, { gain: 0.24 * at, freq: 1500, q: 0.6 });
        break;
      case '106': // 黏稠的滴落
        tone(110, 0.9, { gain: 0.22 * at, type: 'sine', slideTo: 44 });
        noise(0.8, { gain: 0.16 * at, freq: 260, q: 0.5 });
        break;
      case '049': // 平静但错位的低语
        for (let i = 0; i < 3; i++) tone(rand(150, 240), 0.5, { gain: 0.12 * at, type: 'sine', delay: i * 0.34, slideTo: rand(120, 200) });
        break;
      default:
        tone(220, 1.0, { gain: 0.2 * at, type: 'sawtooth', slideTo: 90 });
    }
  }
  // 3114 骨骼咔哒
  function boneClick(dist) { noise(0.05, { gain: 0.16 * atten(dist, 40), freq: 3200, q: 3 }); }
  // 966 的失眠嗡鸣
  function sleepDrone() {
    if (!ready) return;
    tone(74, 1.8, { gain: 0.1, type: 'sine' });
    tone(111, 1.6, { gain: 0.06, type: 'sine', delay: 0.1 });
  }
  function hallucinate() {
    if (!ready) return;
    for (let i = 0; i < 3; i++) tone(rand(900, 2200), 0.14, { gain: 0.05, type: 'sine', delay: i * 0.11 });
  }

  // ---------- 环境音（低频设施底噪） ----------
  function startAmbient() {
    if (!ready || ambient) return;
    const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 47;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 71;
    const g = ctx.createGain(); g.gain.value = 0.06;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 0.03;
    lfo.connect(lg); lg.connect(g.gain);
    o1.connect(g); o2.connect(g); g.connect(ambGain);
    o1.start(); o2.start(); lfo.start();
    // 风噪
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220; f.Q.value = 0.4;
    const wg = ctx.createGain(); wg.gain.value = 0.05;
    s.connect(f); f.connect(wg); wg.connect(ambGain); s.start();
    ambient = { o1, o2, g, s, wg };
  }
  function stopAmbient() {
    if (!ambient) return;
    try { ambient.o1.stop(); ambient.o2.stop(); ambient.s.stop(); } catch (e) { }
    ambient = null;
  }
  // 紧张度 0..1 提升环境音张力
  function setTension(t) {
    if (!ready || !ambient) return;
    ambient.g.gain.value = 0.06 + t * 0.10;
    ambient.wg.gain.value = 0.05 + t * 0.06;
  }

  return {
    init, resume, setVol, ready: () => ready,
    gunshot, suppressed, dryFire, reload, bolt,
    hitmark, killConfirm, hurt, pickup, uiClick, uiBack, uiHover,
    alarm, door, beep, scpRoar, boneClick, sleepDrone, hallucinate,
    startAmbient, stopAmbient, setTension,
  };
})();

bootMark('audio');
