/** Tiny WebAudio chiptune helper shared by themes. */
let ctx: AudioContext | null = null;
let muted = false;
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
export function blip(notes: number[], step = 0.06, type: OscillatorType = "square", vol = 0.08) {
  if (muted || !ctx) return;
  const t0 = ctx.currentTime;
  notes.forEach((f, i) => {
    const o = ctx!.createOscillator();
    const g = ctx!.createGain();
    o.type = type;
    o.frequency.value = f;
    const s = t0 + i * step;
    g.gain.setValueAtTime(vol, s);
    g.gain.exponentialRampToValueAtTime(0.0001, s + step * 1.6);
    o.connect(g).connect(ctx!.destination);
    o.start(s);
    o.stop(s + step * 1.7);
  });
}

// ---------------------------------------------------------------- night ambience: wind in the grass, far-off crickets

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
  // crickets: a few quick high chirps now and then
  const timer = window.setInterval(() => {
    if (muted || !ambWanted || Math.random() > 0.4) return;
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
