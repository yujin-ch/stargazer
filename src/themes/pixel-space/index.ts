import type { Theme, FrameState } from "../types";
import { blip } from "../chip";

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

const rimCache = new Map<boolean, HTMLCanvasElement>();
function rim(alert: boolean): HTMLCanvasElement {
  const hit = rimCache.get(alert);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = V;
  const ctx = c.getContext("2d")!;
  const ring = (r0: number, r1: number, col: string) => {
    ctx.fillStyle = col;
    for (let y = -r1; y < r1; y++) {
      const yy = (y + 0.5) * (y + 0.5);
      const wo = Math.floor(Math.sqrt(Math.max(0, r1 * r1 - yy)));
      const wi = yy < r0 * r0 ? Math.floor(Math.sqrt(r0 * r0 - yy)) : 0;
      if (wo <= wi) continue;
      ctx.fillRect(C - wo, C + y, wo - wi, 1);
      ctx.fillRect(C + wi, C + y, wo - wi, 1);
    }
  };
  ring(R, R + 2, "#181425");
  ring(R + 2, R + 5, alert ? "#a22633" : "#5a6988");
  ring(R + 5, R + 6, alert ? "#e43b44" : "#8b9bb4");
  ring(R + 6, R + 7, "#3a4466");
  ring(R + 7, R + 8, "#181425");
  // focus-ring notches, like the grip on a real eyepiece
  ctx.fillStyle = alert ? "#73172a" : "#3a4466";
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 18) {
    ctx.fillRect(Math.round(C + Math.cos(a) * (R + 3.5)), Math.round(C + Math.sin(a) * (R + 3.5)), 1, 1);
  }
  // highlight glint on the rim
  ctx.fillStyle = "#c0cbdc";
  for (let a = 3.6; a < 4.4; a += 0.03) ctx.fillRect(Math.round(C + Math.cos(a) * (R + 3.5)), Math.round(C + Math.sin(a) * (R + 3.5)), 1, 1);
  // glass reflection
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  for (let a = 3.75; a < 4.25; a += 0.02) ctx.fillRect(Math.round(C + Math.cos(a) * (R - 6)), Math.round(C + Math.sin(a) * (R - 6)), 2, 1);
  rimCache.set(alert, c);
  return c;
}

export const pixelSpace: Theme = {
  id: "pixel-space",
  title: "Stargazer",
  tagline: "One minute at the telescope. Name what drifts by.",
  bandNames: ["Full Moon", "Shooting Star", "Nebula", "Black Hole"],
  // silver moonlight, comet cyan, nebula pink, the orange glow round a black hole
  bandColors: ["#dbe2ee", "#2ce8f5", "#e07ab8", "#feae34"],
  shareIcon: "🔭",
  viewSize: V,
  spriteScale: 2,
  sparkColors: ["#fee761", "#feae34", "#2ce8f5", "#ffffff", "#f6757a"],

  drawBackdrop(ctx, t) {
    ctx.clearRect(0, 0, V, V);
    disc(ctx, R, "#181425");
    disc(ctx, R - 6, "#1b1a33");
    disc(ctx, R - 14, "#202243");
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
    disc(ctx, 40, "#8b9bb4");
    ctx.globalAlpha = 0.14;
    disc(ctx, 32, "#c0cbdc");
    ctx.globalAlpha = 1;
  },

  drawFrame(ctx, t, state: FrameState) {
    if (state.flash > 0) {
      ctx.globalAlpha = 0.4 * state.flash;
      disc(ctx, R, "#ffffff");
      ctx.globalAlpha = 1;
    }
    // reticle ticks at the compass points
    ctx.fillStyle = "#3a4466";
    ctx.fillRect(C - 0.5, C - R + 3, 1, 5);
    ctx.fillRect(C - 0.5, C + R - 8, 1, 5);
    ctx.fillRect(C - R + 3, C - 0.5, 5, 1);
    ctx.fillRect(C + R - 8, C - 0.5, 5, 1);
    // mask everything outside the glass
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    disc(ctx, R, "#000");
    ctx.restore();
    // metal rim: drawn once per colour state into an offscreen canvas, then stamped each frame
    const pulse = state.alert && Math.floor(t / 500) % 2 === 0;
    ctx.drawImage(rim(pulse), 0, 0);
  },

  startPageBackground(canvas) {
    const g = canvas.getContext("2d")!;
    const scale = 3;
    let stars: { x: number; y: number; p: number; c: string; s: number }[] = [];
    const resize = () => {
      canvas.width = Math.ceil(window.innerWidth / scale);
      canvas.height = Math.ceil(window.innerHeight / scale);
      const n = Math.floor((canvas.width * canvas.height) / 90);
      stars = Array.from({ length: n }, (_, i) => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        p: Math.random() * 6.28,
        c: ["#5a6988", "#8b9bb4", "#c0cbdc", "#2ce8f5", "#b55088", "#fee761"][i % 6],
        s: Math.random() < 0.06 ? 2 : 1,
      }));
    };
    resize();
    window.addEventListener("resize", resize);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frame = (t: number) => {
      g.fillStyle = "#0e0d1f";
      g.fillRect(0, 0, canvas.width, canvas.height);
      for (const s of stars) {
        const tw = reduce ? 1 : (Math.sin(t / 900 + s.p) + 1) / 2;
        g.globalAlpha = 0.25 + 0.75 * tw;
        g.fillStyle = s.c;
        g.fillRect(Math.floor(s.x), Math.floor(s.y), s.s, s.s);
      }
      g.globalAlpha = 1;
      if (!reduce) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  },

  sounds: {
    correct: (bonus, combo) => {
      const k = 2 ** (Math.min(combo, 12) / 12); // climbs a semitone per answer in a row
      if (bonus) blip([660, 880, 1320, 1760].map((f) => f * k), 0.05);
      else blip([660, 990].map((f) => f * k), 0.06);
    },
    best: () => blip([784, 988, 1175, 1568], 0.09, "square", 0.09),
    comboBreak: () => blip([392, 330, 262], 0.06, "triangle", 0.1),
    skip: () => blip([300, 200], 0.07, "triangle", 0.12),
    tick: () => blip([1200], 0.03, "square", 0.04),
    end: () => blip([880, 660, 440, 330], 0.11, "triangle", 0.12),
    start: () => blip([440, 660, 880], 0.08),
  },

  credits: "Pixel art drawn for this game on the Stargazer drawing board. Fonts: Press Start 2P and VT323 (SIL Open Font License).",
};
