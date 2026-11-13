import type { Theme } from "./themes/types";
import { SPRITE_COLS, SPRITE_SIZE, buildAtlas, type SkyObject } from "./library";
import { CONFIG } from "./config";

const PAD = 5; // transparent margin so blur can spread
const BLUR_LEVELS = 9;
const MAX_SIGMA = 2.4;
const ENTER_MS = 200;

interface Prepared {
  levels: HTMLCanvasElement[]; // index 0 = sharp
  focal: { x: number; y: number };
  opaque: { x: number; y: number; c: string }[];
}

interface Active {
  obj: SkyObject;
  prep: Prepared;
  appear: number;
}

interface Leaving {
  prep: Prepared;
  start: number;
  kind: "named" | "skipped";
}

interface Spark { x: number; y: number; vx: number; vy: number; c: string; born: number; life: number }

const REDUCED = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const ease = (p: number) => 1 - (1 - p) * (1 - p); // fast at first, settles gently
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export class Viewer {
  private ctx: CanvasRenderingContext2D;
  private atlas!: HTMLCanvasElement;
  private cache = new Map<number, Prepared>();
  private active: Active | null = null;
  private leaving: Leaving[] = [];
  private sparks: Spark[] = [];
  private flashAt = -1e9;
  /** Set by the game each frame. */
  alert = false;
  private shutterAt = -1;
  closeShutter(now: number) { this.shutterAt = now; this.active = null; }
  readonly V: number;

  constructor(private canvas: HTMLCanvasElement, private theme: Theme) {
    this.V = theme.viewSize;
    canvas.width = this.V;
    canvas.height = this.V;
    this.ctx = canvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false;
  }

  load(): Promise<void> {
    this.atlas = buildAtlas();
    return Promise.resolve();
  }

  /** Draw one sprite (sharp) into a small canvas, for results lists. */
  spriteCanvas(index: number, scale = 2): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = c.height = SPRITE_SIZE * scale;
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    const sx = (index % SPRITE_COLS) * SPRITE_SIZE, sy = Math.floor(index / SPRITE_COLS) * SPRITE_SIZE;
    g.drawImage(this.atlas, sx, sy, SPRITE_SIZE, SPRITE_SIZE, 0, 0, c.width, c.height);
    return c;
  }

  prepare(index: number): Prepared {
    const hit = this.cache.get(index);
    if (hit) return hit;
    const S = SPRITE_SIZE, P = S + PAD * 2;
    const base = document.createElement("canvas");
    base.width = base.height = P;
    const bg = base.getContext("2d")!;
    bg.drawImage(this.atlas, (index % SPRITE_COLS) * S, Math.floor(index / SPRITE_COLS) * S, S, S, PAD, PAD, S, S);
    const src = bg.getImageData(0, 0, P, P);

    // focal point = centre of mass of opaque pixels; also collect pixels for sparks
    let sx = 0, sy = 0, n = 0;
    const opaque: Prepared["opaque"] = [];
    for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
      const i = (y * P + x) * 4;
      if (src.data[i + 3] > 128) {
        sx += x; sy += y; n++;
        if ((x + y * 3) % 5 === 0) opaque.push({ x: x - PAD, y: y - PAD, c: `rgb(${src.data[i]},${src.data[i + 1]},${src.data[i + 2]})` });
      }
    }
    const focal = n ? { x: sx / n - PAD, y: sy / n - PAD } : { x: S / 2, y: S / 2 };

    const levels: HTMLCanvasElement[] = [base];
    for (let l = 1; l < BLUR_LEVELS; l++) {
      const sigma = (MAX_SIGMA * l) / (BLUR_LEVELS - 1);
      const c = document.createElement("canvas");
      c.width = c.height = P;
      c.getContext("2d")!.putImageData(gaussian(src, P, sigma), 0, 0);
      levels.push(c);
    }
    const prep = { levels, focal, opaque };
    this.cache.set(index, prep);
    return prep;
  }

  show(obj: SkyObject, now: number) {
    this.active = { obj, prep: this.prepare(obj.sprite), appear: now };
  }

  /** Warm the cache for the next few objects so there is no hitch. */
  preload(objs: SkyObject[]) { for (const o of objs) this.prepare(o.sprite); }

  clear() { this.active = null; this.leaving = []; this.sparks = []; }

  /** 0 at first sight, 1 once the telescope has fully pulled back. */
  pullProgress(now: number): number {
    if (!this.active) return 1;
    const band = CONFIG.bands[this.active.obj.band];
    if (!band.pullBack) return 1;
    return clamp01((now - this.active.appear - ENTER_MS) / (band.pullBack * 1000));
  }

  dismiss(how: "named" | "skipped" | "zoomed", now: number) {
    const big = how === "zoomed";
    if (big) this.flashAt = now;
    const kind = big ? "named" : how;
    if (!this.active) return;
    const a = this.active;
    this.leaving.push({ prep: a.prep, start: now, kind });
    if (kind === "named" && !REDUCED) {
      const scale = this.theme.spriteScale, C = this.V / 2, S = SPRITE_SIZE;
      for (const p of a.prep.opaque) {
        const x = C + (p.x - S / 2) * scale, y = C + (p.y - S / 2) * scale;
        const ang = Math.atan2(y - C, x - C) + (Math.random() - 0.5) * 0.8;
        const sp = (0.03 + Math.random() * 0.07) * (big ? 1.6 : 1);
        this.sparks.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, c: Math.random() < 0.3 ? this.theme.sparkColors[Math.floor(Math.random() * this.theme.sparkColors.length)] : p.c, born: now, life: 450 + Math.random() * 350 });
      }
    }
    this.active = null;
  }

  draw(now: number) {
    const g = this.ctx, V = this.V, C = V / 2, S = SPRITE_SIZE, P = S + PAD * 2;
    this.theme.drawBackdrop(g, now);
    const scale = this.theme.spriteScale;

    // leaving objects
    this.leaving = this.leaving.filter((l) => now - l.start < 400);
    for (const l of this.leaving) {
      const p = (now - l.start) / 400;
      const img = l.prep.levels[0];
      g.save();
      if (l.kind === "named") {
        g.globalAlpha = 1 - p;
        const sz = P * scale * (1 + p * 0.4);
        g.drawImage(img, Math.round(C - sz / 2), Math.round(C - sz / 2 - p * 30), sz, sz);
      } else {
        g.globalAlpha = (1 - p) * 0.6;
        const sz = P * scale * (1 - p * 0.5);
        g.drawImage(img, Math.round(C - sz / 2 - p * 50), Math.round(C - sz / 2 + p * 40), sz, sz);
      }
      g.restore();
    }

    // current object
    if (this.active) {
      const a = this.active, band = CONFIG.bands[a.obj.band];
      const enter = clamp01((now - a.appear) / ENTER_MS);
      const e = ease(this.pullProgress(now));
      const zoom = band.startZoom + (1 - band.startZoom) * e;
      const blur = band.startBlur * (1 - e);
      const level = Math.min(BLUR_LEVELS - 1, Math.round((blur / MAX_SIGMA) * (BLUR_LEVELS - 1)));
      const fx = a.prep.focal.x + (S / 2 - a.prep.focal.x) * e;
      const fy = a.prep.focal.y + (S / 2 - a.prep.focal.y) * e;
      const px = scale * zoom; // logical px per sprite px
      const t = (now - a.appear) / 1000;
      const bobX = REDUCED ? 0 : Math.sin(t * 1.3) * 1.5, bobY = REDUCED ? 0 : Math.sin(t * 1.9 + 1) * 2;
      const slide = REDUCED ? 0 : (1 - ease(enter)) * 70;
      const x = C - (fx + PAD) * px + bobX + slide;
      const y = C - (fy + PAD) * px + bobY;
      g.globalAlpha = enter;
      g.drawImage(a.prep.levels[level], Math.round(x), Math.round(y), Math.round(P * px), Math.round(P * px));
      g.globalAlpha = 1;
    }

    // sparks
    this.sparks = this.sparks.filter((s) => now - s.born < s.life);
    for (const s of this.sparks) {
      const age = now - s.born;
      g.globalAlpha = 1 - age / s.life;
      g.fillStyle = s.c;
      g.fillRect(Math.round(s.x + s.vx * age), Math.round(s.y + s.vy * age + 0.00004 * age * age), 2, 2);
    }
    g.globalAlpha = 1;

    if (this.shutterAt >= 0) {
      // iris closes in six steps
      const p = Math.min(1, Math.floor(((now - this.shutterAt) / 400) * 6) / 6);
      g.fillStyle = "#07060f";
      g.beginPath();
      g.arc(V / 2, V / 2, (V / 2) * p, 0, Math.PI * 2);
      g.fill();
    }
    this.theme.drawFrame(g, now, { alert: this.alert, flash: Math.max(0, 1 - (now - this.flashAt) / 120) });
  }
}

/** Separable gaussian blur on premultiplied RGBA. */
function gaussian(src: ImageData, P: number, sigma: number): ImageData {
  const r = Math.ceil(sigma * 2.5);
  const k: number[] = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); sum += v; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const pm = new Float32Array(P * P * 4);
  for (let i = 0; i < P * P; i++) {
    const a = src.data[i * 4 + 3] / 255;
    pm[i * 4] = src.data[i * 4] * a; pm[i * 4 + 1] = src.data[i * 4 + 1] * a; pm[i * 4 + 2] = src.data[i * 4 + 2] * a; pm[i * 4 + 3] = a;
  }
  const pass = (inp: Float32Array, dx: number, dy: number) => {
    const out = new Float32Array(P * P * 4);
    for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
      let a0 = 0, a1 = 0, a2 = 0, a3 = 0;
      for (let j = -r; j <= r; j++) {
        const xx = x + j * dx, yy = y + j * dy;
        if (xx < 0 || yy < 0 || xx >= P || yy >= P) continue;
        const w = k[j + r], i = (yy * P + xx) * 4;
        a0 += inp[i] * w; a1 += inp[i + 1] * w; a2 += inp[i + 2] * w; a3 += inp[i + 3] * w;
      }
      const o = (y * P + x) * 4;
      out[o] = a0; out[o + 1] = a1; out[o + 2] = a2; out[o + 3] = a3;
    }
    return out;
  };
  const res = pass(pass(pm, 1, 0), 0, 1);
  const out = new ImageData(P, P);
  for (let i = 0; i < P * P; i++) {
    const a = res[i * 4 + 3];
    // posterize alpha a little to keep a pixel-art feel
    const qa = Math.round(a * 4) / 4;
    out.data[i * 4 + 3] = qa * 255;
    if (a > 0) { out.data[i * 4] = res[i * 4] / a; out.data[i * 4 + 1] = res[i * 4 + 1] / a; out.data[i * 4 + 2] = res[i * 4 + 2] / a; }
  }
  return out;
}
