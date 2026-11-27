import type { Theme, FrameState } from "../types";
import { blip, bell, whoosh } from "../chip";
import { livingSky } from "./sky";

const V = 120; // logical viewer size
const R = 52; // inner radius of the eyepiece glass
const C = V / 2;

// Stars inside the eyepiece, fixed positions, gentle twinkle and drift.
const innerStars = Array.from({ length: 46 }, (_, i) => ({
  x: (i * 73.13) % V,
  y: (i * 41.71 + (i % 7) * 13) % V,
  p: (i * 0.37) % 1,
  c: ["#c0cbdc", "#8b9bb4", "#2ce8f5", "#fee761"][i % 4],
}));

function disc(ctx: CanvasRenderingContext2D, r: number, color: string) {
  // pixel-stepped filled circle
  // one path, one fill: compositing modes then apply to the whole disc at once
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let y = -r; y < r; y++) {
    const w = Math.floor(Math.sqrt(r * r - (y + 0.5) * (y + 0.5)));
    ctx.rect(C - w, C + y, w * 2, 1);
  }
  ctx.fill();
}

/** Lighten (k > 1) or darken (k < 1) a hex colour. */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(k > 1 ? v + (255 - v) * (k - 1) : v * k)));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

// the eyepiece is a brass tube: dark inner lip, bright bevel, knurled focus ring, outer bevel, shadow
const BRASS = ["#2a1a0c", "#f2d38a", "#a8742e", "#a8742e", "#a8742e", "#a8742e", "#d6a656", "#3a2410"];
// under ten seconds the brass heats to copper-red
const HOT = ["#2a0c0c", "#ffc2a8", "#b0402e", "#b0402e", "#b0402e", "#b0402e", "#e0704e", "#3a1010"];
const LIGHT = -2.3; // light falls from the upper left

const rimCache = new Map<boolean, HTMLCanvasElement>();
function rim(alert: boolean): HTMLCanvasElement {
  const hit = rimCache.get(alert);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = V;
  const ctx = c.getContext("2d")!;
  const cols = alert ? HOT : BRASS;
  for (let y = 0; y < V; y++) for (let x = 0; x < V; x++) {
    const dx = x + 0.5 - C, dy = y + 0.5 - C, d = Math.hypot(dx, dy);
    if (d < R || d >= R + 8) continue;
    const band = Math.floor(d - R), a = Math.atan2(dy, dx);
    const light = Math.cos(a - LIGHT);
    // metal catches the light on one side and falls into shadow on the other; the lips stay dark
    const k = band === 0 || band === 7 ? 1 + light * 0.15 : light > 0 ? 1 + light * 0.45 : 1 + light * 0.45;
    ctx.fillStyle = shade(cols[band], k);
    ctx.fillRect(x, y, 1, 1);
  }
  // glass reflection, a soft arc on the upper left
  ctx.fillStyle = "rgba(255, 240, 210, 0.10)";
  for (let a = 3.75; a < 4.25; a += 0.02) ctx.fillRect(Math.round(C + Math.cos(a) * (R - 6)), Math.round(C + Math.sin(a) * (R - 6)), 2, 1);
  ctx.fillStyle = "rgba(255, 240, 210, 0.06)";
  for (let a = 3.9; a < 4.1; a += 0.02) ctx.fillRect(Math.round(C + Math.cos(a) * (R - 10)), Math.round(C + Math.sin(a) * (R - 10)), 1, 1);
  rimCache.set(alert, c);
  return c;
}

/** The glass darkens toward its edge, like looking down a tube. */
let vignette: HTMLCanvasElement | null = null;
function glassVignette(): HTMLCanvasElement {
  if (vignette) return vignette;
  const c = document.createElement("canvas");
  c.width = c.height = V;
  const ctx = c.getContext("2d")!;
  for (let y = 0; y < V; y++) for (let x = 0; x < V; x++) {
    const d = Math.hypot(x + 0.5 - C, y + 0.5 - C);
    if (d >= R || d < R - 7) continue;
    // stepped, so it stays pixel-art
    const a = [0.06, 0.1, 0.14, 0.2, 0.28, 0.36, 0.45][Math.floor(d - (R - 7))];
    ctx.fillStyle = `rgba(10, 6, 16, ${a})`;
    ctx.fillRect(x, y, 1, 1);
  }
  vignette = c;
  return c;
}

/** The knurled grip of the focus ring: drawn each frame so it can turn. */
function knurl(ctx: CanvasRenderingContext2D, turn: number, alert: boolean) {
  const n = 40;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + turn;
    const light = Math.cos(a - LIGHT);
    ctx.fillStyle = alert ? (light > 0 ? "#6a1c14" : "#3a0c08") : light > 0 ? "#6b4512" : "#3d2408";
    for (let r = R + 2.5; r < R + 6; r += 1) ctx.fillRect(Math.round(C + Math.cos(a) * r - 0.5), Math.round(C + Math.sin(a) * r - 0.5), 1, 1);
    // a bright edge on the lit side of each ridge
    if (light > 0.2) {
      ctx.fillStyle = alert ? "rgba(255, 200, 170, 0.55)" : "rgba(255, 236, 180, 0.55)";
      const b = a + 0.035;
      ctx.fillRect(Math.round(C + Math.cos(b) * (R + 4) - 0.5), Math.round(C + Math.sin(b) * (R + 4) - 0.5), 1, 1);
    }
  }
}

export const pixelSpace: Theme = {
  id: "pixel-space",
  title: "Stargazer",
  tagline: "One minute at the telescope. Name what drifts by.",
  // in order of distance, so harder reads as further out
  bandNames: ["Moon", "Planet", "Comet", "Nebula", "Black Hole"],
  // silver moonlight, planet cyan, comet green, nebula pink, the orange glow round a black hole
  bandColors: ["#dbe2ee", "#2ce8f5", "#a8f08a", "#e07ab8", "#feae34"],
  shareIcon: "🔭",
  viewSize: V,
  spriteScale: 2,
  sparkColors: ["#fee761", "#feae34", "#2ce8f5", "#ffffff", "#f6757a"],

  drawBackdrop(ctx, t) {
    ctx.clearRect(0, 0, V, V);
    disc(ctx, R, "#17112a");
    disc(ctx, R - 6, "#1b1533");
    disc(ctx, R - 14, "#211a3f");
    for (const s of innerStars) {
      const x = Math.floor((s.x + t * 0.002) % V);
      const tw = (Math.sin(t / 500 + s.p * 6.28) + 1) / 2;
      if (tw < 0.25) continue;
      ctx.fillStyle = s.c;
      ctx.globalAlpha = 0.35 + tw * 0.65;
      ctx.fillRect(x, Math.floor(s.y), 1, 1);
    }
    ctx.globalAlpha = 1;
    // a soft moonlit halo so dark objects still read
    ctx.globalAlpha = 0.16;
    disc(ctx, 40, "#9a8fb4");
    ctx.globalAlpha = 0.14;
    disc(ctx, 32, "#e0d2dc");
    ctx.globalAlpha = 1;
  },

  drawFrame(ctx, t, state: FrameState) {
    if (state.flash > 0) {
      ctx.globalAlpha = 0.45 * state.flash;
      disc(ctx, R, "#fff6dc");
      ctx.globalAlpha = 1;
    }
    // a ring of light spreads out from the centre after a hit
    if (state.ripple >= 0 && state.ripple < 1) {
      const r = 8 + state.ripple * (R - 8);
      ctx.globalAlpha = (1 - state.ripple) * 0.85;
      ctx.strokeStyle = state.rippleColor;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(C, C, r, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = (1 - state.ripple) * 0.35;
      ctx.beginPath(); ctx.arc(C, C, r * 0.7, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(glassVignette(), 0, 0);
    // reticle ticks at the compass points
    ctx.fillStyle = "#4a3a5c";
    ctx.fillRect(C - 0.5, C - R + 3, 1, 5);
    ctx.fillRect(C - 0.5, C + R - 8, 1, 5);
    ctx.fillRect(C - R + 3, C - 0.5, 5, 1);
    ctx.fillRect(C + R - 8, C - 0.5, 5, 1);
    // mask everything outside the glass
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    disc(ctx, R, "#000");
    ctx.restore();
    // brass rim: drawn once per colour state into an offscreen canvas, then stamped each frame; the grip turns on top
    const pulse = state.alert && Math.floor(t / 500) % 2 === 0;
    ctx.drawImage(rim(pulse), 0, 0);
    knurl(ctx, state.focus, pulse);
  },

  startPageBackground(canvas) {
    livingSky(canvas);
  },

  sounds: {
    correct: (bonus, combo, band = 0) => {
      const k = 2 ** (Math.min(combo, 12) / 12); // climbs a semitone per answer in a row
      // harder finds ring out with more notes: Moon one bell, Planet two, Comet a bright pair, Nebula a shimmer, Black Hole a boom and a chord
      const chord = [[784], [659, 988], [740, 1109, 1480], [659, 880, 1319], [523, 784, 1047, 1568]][band].map((f) => f * k);
      chord.forEach((f, i) => bell(f, i * 0.055, 0.05 - i * 0.006, 1 + band * 0.32, (i % 2 ? 0.3 : -0.3) * (band ? 1 : 0)));
      blip([chord[0] * 2], 0.04, "square", 0.05);
      if (band === 4) { blip([110, 82], 0.12, "sine", 0.14); whoosh(false, 0.7, 0.06); }
      if (bonus) [1, 1.25, 1.5, 2].forEach((m, i) => bell(chord[chord.length - 1] * m, 0.12 + i * 0.05, 0.02, 0.8, 0.5));
    },
    best: () => [784, 988, 1175, 1568].forEach((f, i) => bell(f, i * 0.1, 0.05, 1.8)),
    comboBreak: () => blip([392, 330, 262], 0.07, "triangle", 0.08),
    blackHole: () => { blip([220, 165, 110, 82], 0.1, "sawtooth", 0.08); whoosh(false, 1.2, 0.07); },
    skip: () => { blip([300, 200], 0.07, "triangle", 0.1); whoosh(true, 0.35, 0.04); },
    tick: () => blip([1200], 0.03, "square", 0.05),
    end: () => { [880, 659, 523, 392].forEach((f, i) => bell(f, i * 0.14, 0.045, 2)); whoosh(false, 1.2, 0.05); },
    start: () => { whoosh(true, 0.8, 0.07); [440, 659, 880].forEach((f, i) => bell(f, 0.25 + i * 0.09, 0.045, 1.4)); },
  },

  credits: "Pixel art drawn for this game on the Stargazer drawing board. Fonts: Press Start 2P and VT323 (SIL Open Font License).",
};
