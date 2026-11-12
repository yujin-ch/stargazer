/** Tiny WebAudio chiptune helper shared by themes. */
let ctx: AudioContext | null = null;
let muted = false;
export function setMuted(m: boolean) { muted = m; }
export function isMuted() { return muted; }
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AC) ctx = new AC();
  }
  if (ctx && ctx.state === "suspended") void ctx.resume();
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
