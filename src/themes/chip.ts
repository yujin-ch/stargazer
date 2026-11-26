/**
 * Small WebAudio sound kit shared by themes: soft bells and plucks through a shared
 * starlit reverb, UI taps, and the night ambience (wind, crickets, a slow space hum, far twinkles).
 */
let ctx: AudioContext | null = null;
let muted = false;
let bus: { dry: GainNode; wet: GainNode } | null = null;
export function setMuted(m: boolean) { muted = m; syncAmbience(); }
export function isMuted() { return muted; }
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AC) ctx = new AC();
  }
  if (ctx && ctx.state === "suspended") void ctx.resume();
  syncAmbience();
}

/** Dry + reverb busses into a gentle limiter, built on first use. */
function out(ac: AudioContext) {
  if (bus) return bus;
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
  comp.connect(ac.destination);
  const dry = ac.createGain(); dry.connect(comp);
  // a long, dark, airy tail: decaying stereo noise as the impulse
  const len = Math.floor(ac.sampleRate * 2.6), ir = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) { lp += ((Math.random() * 2 - 1) - lp) * 0.35; d[i] = lp * Math.pow(1 - i / len, 2.4); }
  }
  const verb = ac.createConvolver(); verb.buffer = ir;
  const wet = ac.createGain(); wet.gain.value = 0.9;
  const pre = ac.createDelay(0.2); pre.delayTime.value = 0.03;
  wet.connect(pre).connect(verb).connect(comp);
  bus = { dry, wet };
  return bus;
}

interface Tone { at?: number; dur?: number; vol?: number; type?: OscillatorType; attack?: number; wet?: number; slide?: number; detune?: number; pan?: number }
/** One note: a quick attack and a long exponential fall, partly sent to the reverb. */
function tone(f: number, o: Tone = {}) {
  if (muted || !ctx) return;
  const ac = ctx, b = out(ac);
  const s = ac.currentTime + (o.at ?? 0), dur = o.dur ?? 0.5, vol = o.vol ?? 0.06, atk = o.attack ?? 0.005;
  const osc = ac.createOscillator(), g = ac.createGain();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(f, s);
  if (o.slide) osc.frequency.exponentialRampToValueAtTime(f * o.slide, s + dur);
  if (o.detune) osc.detune.value = o.detune;
  g.gain.setValueAtTime(0.0001, s);
  g.gain.linearRampToValueAtTime(vol, s + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
  let node: AudioNode = g;
  if (o.pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = o.pan; g.connect(p); node = p; }
  osc.connect(g);
  node.connect(b.dry);
  const send = ac.createGain(); send.gain.value = o.wet ?? 0.35; node.connect(send).connect(b.wet);
  osc.start(s); osc.stop(s + dur + 0.05);
}

/** A glassy bell: a sine with a quiet, slightly sharp overtone. */
export function bell(f: number, at = 0, vol = 0.05, dur = 1.4, pan = 0) {
  tone(f, { at, vol, dur, pan, wet: 0.55 });
  tone(f * 2.76, { at, vol: vol * 0.25, dur: dur * 0.4, pan, wet: 0.6 });
  tone(f * 1.002, { at, vol: vol * 0.4, dur, pan: -pan, detune: 6, wet: 0.5 });
}

/** A filtered noise swoosh: up (opening) or down (closing). */
export function whoosh(up = true, dur = 0.6, vol = 0.07) {
  if (muted || !ctx) return;
  const ac = ctx, b = out(ac), s = ac.currentTime;
  const len = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource(); src.buffer = buf;
  const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(up ? 300 : 2400, s);
  bp.frequency.exponentialRampToValueAtTime(up ? 2600 : 260, s + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, s);
  g.gain.linearRampToValueAtTime(vol, s + dur * 0.55);
  g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
  src.connect(bp).connect(g);
  g.connect(b.dry);
  const send = ac.createGain(); send.gain.value = 0.6; g.connect(send).connect(b.wet);
  src.start(s);
}

/** Kept for the old chip sounds: a run of quick notes. */
export function blip(notes: number[], step = 0.06, type: OscillatorType = "square", vol = 0.08) {
  notes.forEach((f, i) => tone(f, { at: i * step, dur: step * 1.6, type, vol: type === "square" || type === "sawtooth" ? vol * 0.5 : vol, wet: 0.2 }));
}

export type UiSound = "tap" | "confirm" | "back" | "open" | "toggle" | "star" | "dive" | "key" | "nope" | "warm";
let keyN = 0, lastKey = 0;
/** Sounds for touching the interface. Kept short and quiet so they sit under the game. */
export function ui(kind: UiSound) {
  if (muted || !ctx) return;
  switch (kind) {
    case "tap": // a soft wooden knock
      tone(520, { dur: 0.09, vol: 0.07, type: "triangle", slide: 0.6, wet: 0.15 });
      tone(1560, { dur: 0.03, vol: 0.015, wet: 0.1 });
      break;
    case "confirm": // a rising pair of bells
      bell(659, 0, 0.04, 0.9); bell(988, 0.07, 0.04, 1.1);
      tone(330, { dur: 0.12, vol: 0.05, type: "triangle", wet: 0.1 });
      break;
    case "back":
      tone(440, { dur: 0.12, vol: 0.06, type: "triangle", slide: 0.7, wet: 0.2 });
      tone(330, { at: 0.06, dur: 0.16, vol: 0.05, type: "triangle", slide: 0.8, wet: 0.25 });
      break;
    case "open": // a little brass latch
      tone(784, { dur: 0.06, vol: 0.04, type: "triangle", wet: 0.2 });
      tone(1175, { at: 0.04, dur: 0.25, vol: 0.025, wet: 0.4 });
      break;
    case "toggle":
      tone(600, { dur: 0.05, vol: 0.05, type: "square", wet: 0.1 });
      tone(900, { at: 0.05, dur: 0.06, vol: 0.03, type: "square", wet: 0.1 });
      break;
    case "star": { // a twinkle from a pentatonic sky
      const P = [784, 880, 1047, 1175, 1319, 1568];
      bell(P[Math.floor(Math.random() * P.length)], 0, 0.035, 1.2, Math.random() - 0.5);
      break;
    }
    case "dive":
      whoosh(true, 0.9, 0.08); bell(523, 0.35, 0.03, 1.8); bell(784, 0.45, 0.025, 1.8);
      break;
    case "key": { // a typewriter-soft tick, never twice in 25 ms
      const now = performance.now(); if (now - lastKey < 25) return; lastKey = now;
      tone(1800 + (keyN++ % 5) * 90, { dur: 0.025, vol: 0.012, type: "triangle", wet: 0.05 });
      break;
    }
    case "nope":
      tone(180, { dur: 0.16, vol: 0.08, type: "triangle", slide: 0.7, wet: 0.1 });
      break;
    case "warm": // you're on the right track
      tone(1047, { dur: 0.35, vol: 0.012, wet: 0.6 });
      break;
  }
}

// ---------------------------------------------------------------- night ambience

let ambWanted = false;
let amb: { gain: GainNode; timer: number } | null = null;

/** Turn the night sounds on or off (they also stay silent while muted, and until audio is unlocked). */
export function setAmbience(on: boolean) { ambWanted = on; syncAmbience(); }

function syncAmbience() {
  if (!ctx) return;
  const want = ambWanted && !muted;
  if (want && !amb) amb = startAmbience(ctx);
  if (amb) amb.gain.gain.setTargetAtTime(want ? 1 : 0, ctx.currentTime, want ? 1.2 : 0.25);
}

function startAmbience(ac: AudioContext) {
  const master = ac.createGain();
  master.gain.value = 0;
  master.connect(ac.destination);
  const b = out(ac);
  const verbSend = ac.createGain(); verbSend.gain.value = 0.5;
  master.connect(verbSend).connect(b.wet);
  // wind: soft filtered noise that swells and falls
  const len = ac.sampleRate * 3, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) { last = (last + (Math.random() * 2 - 1) * 0.06) * 0.985; d[i] = last * 3; }
  const noise = ac.createBufferSource();
  noise.buffer = buf; noise.loop = true;
  const bp = ac.createBiquadFilter();
  bp.type = "lowpass"; bp.frequency.value = 520;
  const wind = ac.createGain();
  wind.gain.value = 0.05;
  const lfo = ac.createOscillator(), lfoAmt = ac.createGain();
  lfo.frequency.value = 0.07; lfoAmt.gain.value = 0.03;
  lfo.connect(lfoAmt).connect(wind.gain);
  noise.connect(bp).connect(wind).connect(master);
  noise.start(); lfo.start();
  // space hum: a low open fifth, gently detuned, breathing through a slow filter
  const hum = ac.createGain(); hum.gain.value = 0.018;
  const hf = ac.createBiquadFilter(); hf.type = "lowpass"; hf.frequency.value = 380; hf.Q.value = 3;
  const hl = ac.createOscillator(), hla = ac.createGain();
  hl.frequency.value = 0.035; hla.gain.value = 220;
  hl.connect(hla).connect(hf.frequency);
  for (const [f, det] of [[55, 0], [82.4, 4], [110, -5], [164.8, 7]] as const) {
    const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.detune.value = det;
    o.connect(hf); o.start();
  }
  hf.connect(hum).connect(master); hl.start();
  // crickets now and then, and once in a while a far-off twinkle
  const P = [523, 587, 659, 784, 880, 1047, 1175, 1319];
  const timer = window.setInterval(() => {
    if (muted || !ambWanted) return;
    if (Math.random() < 0.12) bell(P[Math.floor(Math.random() * P.length)], Math.random(), 0.01, 2.4, Math.random() * 1.6 - 0.8);
    if (Math.random() > 0.4) return;
    const t0 = ac.currentTime + Math.random() * 0.3, f = 4200 + Math.random() * 900, n = 2 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = "sine"; o.frequency.value = f;
      const s = t0 + k * 0.07;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.012, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.04);
      o.connect(g).connect(master);
      o.start(s); o.stop(s + 0.05);
    }
  }, 900);
  return { gain: master, timer };
}
