import type { Theme } from "./themes/types";
import { SPRITE_SIZE, objectImage, photoStage, photoHi, picturesReady, PHOTO_STAGES, PHOTO_TILE, type SkyObject } from "./library";
import { CONFIG, type ConditionId } from "./config";

const PAD = 5; // transparent margin so blur can spread
const BLUR_LEVELS = 9;
const MAX_SIGMA = 2.4;
const ENTER_MS = 200;

interface Prepared {
  levels: HTMLCanvasElement[]; // index 0 = sharp
  /** Picture size without padding (a rebus is wider than one sprite). */
  w: number;
  h: number;
  /** Shrink factor so wide pictures still fit the eyepiece. */
  fit: number;
  focal: { x: number; y: number };
  /** Photo plates reveal by depixelating through fixed stages instead of blurring. */
  photo: boolean;
  /** The developed photo at high resolution, faded in over the plate once it has fully depixelated. */
  hi: HTMLImageElement | null;
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
  private cache = new Map<number, Prepared>();
  private active: Active | null = null;
  private leaving: Leaving[] = [];
  private sparks: Spark[] = [];
  private flashAt = -1e9;
  private flashK = 1;
  private rippleAt = -1e9;
  private rippleColor = "#fee761";
  /** Turn of the focus ring: it twists a little more for each object as it is brought into focus. */
  private turn = 0;
  private shownCount = 0;
  /** Set by the game each frame. */
  alert = false;
  /** Tonight's sky condition. */
  condition: ConditionId = "clear";
  private scratch: HTMLCanvasElement | null = null;
  private shutterAt = -1;
  closeShutter(now: number) { this.shutterAt = now; this.active = null; }
  readonly V: number;
  /** A full-resolution layer over the pixel canvas, for the developed photo. */
  private hiLayer: HTMLCanvasElement;
  private hiShown = false;

  constructor(private canvas: HTMLCanvasElement, private theme: Theme) {
    this.hiLayer = document.createElement("canvas");
    this.hiLayer.className = "hi-layer";
    this.hiLayer.setAttribute("aria-hidden", "true");
    canvas.insertAdjacentElement("afterend", this.hiLayer);
    this.V = theme.viewSize;
    canvas.width = this.V;
    canvas.height = this.V;
    this.ctx = canvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Coarsest photo stage each band starts from (index into the plate: 7 = 6 px ... 3 = 24 px). */
  private static PHOTO_START = [4, 5, 6, 7];

  load(objs: SkyObject[] = [], hi = true): Promise<void> {
    return picturesReady(objs, hi);
  }

  /** The object's outline only, in shadow: for catalogue entries not found yet. */
  silhouette(o: SkyObject, scale = 2): HTMLCanvasElement {
    const c = this.spriteCanvas(o, scale), g = c.getContext("2d")!;
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = "#2e2648";
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  /** Draw an object's picture (sharp) into a small canvas, for results lists. */
  spriteCanvas(o: SkyObject, scale = 2): HTMLCanvasElement {
    const img = objectImage(o);
    const c = document.createElement("canvas");
    const k = o.kind === "photo" ? SPRITE_SIZE / PHOTO_TILE * 1.25 : 1;
    c.width = Math.round(img.width * scale * k); c.height = Math.round(img.height * scale * k);
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.drawImage(img, 0, 0, c.width, c.height);
    if (img.width > img.height) c.classList.add("wide");
    return c;
  }

  prepare(o: SkyObject): Prepared {
    const hit = this.cache.get(o.sprite);
    if (hit) return hit;
    const img = objectImage(o);
    const w = img.width, h = img.height, PW = w + PAD * 2, PH = h + PAD * 2;
    const base = document.createElement("canvas");
    base.width = PW; base.height = PH;
    const bg = base.getContext("2d")!;
    bg.drawImage(img, PAD, PAD);
    const src = bg.getImageData(0, 0, PW, PH);

    // focal point = centre of mass of opaque pixels; also collect pixels for sparks
    let sx = 0, sy = 0, n = 0;
    const opaque: Prepared["opaque"] = [];
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
      const i = (y * PW + x) * 4;
      if (src.data[i + 3] > 128) {
        sx += x; sy += y; n++;
        if (o.kind === "photo" ? x % 3 === 0 && y % 3 === 0 && (x + y) % 2 === 0 : (x + y * 3) % 5 === 0) opaque.push({ x: x - PAD, y: y - PAD, c: `rgb(${src.data[i]},${src.data[i + 1]},${src.data[i + 2]})` });
      }
    }
    const focal = n ? { x: sx / n - PAD, y: sy / n - PAD } : { x: w / 2, y: h / 2 };

    const levels: HTMLCanvasElement[] = [base];
    const photo = o.kind === "photo";
    if (photo) for (let l = 1; l < PHOTO_STAGES; l++) {
      const c = document.createElement("canvas");
      c.width = PW; c.height = PH;
      c.getContext("2d")!.drawImage(photoStage(o, l), PAD, PAD);
      levels.push(c);
    }
    else for (let l = 1; l < BLUR_LEVELS; l++) {
      const sigma = (MAX_SIGMA * l) / (BLUR_LEVELS - 1);
      const c = document.createElement("canvas");
      c.width = PW; c.height = PH;
      c.getContext("2d")!.putImageData(gaussian(src, PW, PH, sigma), 0, 0);
      levels.push(c);
    }
    // a photo plate shows a little bigger than a drawing, at one photo pixel per screen pixel
    const fit = photo ? 0.5 : Math.min(1, (SPRITE_SIZE * 1.45) / w);
    const prep = { levels, focal, opaque, w, h, fit, photo, hi: photo ? photoHi(o) : null };
    this.cache.set(o.sprite, prep);
    return prep;
  }

  show(obj: SkyObject, now: number) {
    this.active = { obj, prep: this.prepare(obj), appear: now };
    this.shownCount++;
  }

  /** Warm the cache for the next few objects so there is no hitch. */
  preload(objs: SkyObject[]) { for (const o of objs) this.prepare(o); }

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
    const kind = big ? "named" : how;
    if (!this.active) return;
    const a = this.active;
    if (kind === "named") {
      this.flashAt = now; this.flashK = big ? 1 : 0.45;
      this.rippleAt = now; this.rippleColor = big ? "#fee761" : this.theme.bandColors[a.obj.band];
    }
    this.leaving.push({ prep: a.prep, start: now, kind });
    if (kind === "named" && !REDUCED) {
      const scale = this.theme.spriteScale * a.prep.fit, C = this.V / 2;
      for (const p of a.prep.opaque) {
        const x = C + (p.x - a.prep.w / 2) * scale, y = C + (p.y - a.prep.h / 2) * scale;
        const ang = Math.atan2(y - C, x - C) + (Math.random() - 0.5) * 0.8;
        const sp = (0.03 + Math.random() * 0.07) * (big ? 1.6 : 1);
        this.sparks.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, c: Math.random() < 0.3 ? this.theme.sparkColors[Math.floor(Math.random() * this.theme.sparkColors.length)] : p.c, born: now, life: 450 + Math.random() * 350 });
      }
    }
    this.active = null;
  }

  /** The sprite image for this frame, with tonight's condition applied. */
  private conditioned(a: Active, level: number, lift: number, t: number, now: number): HTMLCanvasElement {
    const src = a.prep.levels[level];
    if (this.condition !== "eclipse" || lift >= 1) return src;
    const PW = src.width, PH = src.height;
    if (!this.scratch) this.scratch = document.createElement("canvas");
    const s = this.scratch;
    if (s.width !== PW || s.height !== PH) { s.width = PW; s.height = PH; }
    const g = s.getContext("2d")!;
    g.clearRect(0, 0, PW, PH);
    g.globalCompositeOperation = "source-over";
    g.drawImage(src, 0, 0);
    // backlit silhouette: solid pale shape that gives way to colour as the eclipse passes
    g.globalCompositeOperation = "source-atop";
    g.globalAlpha = 1 - lift;
    g.fillStyle = "#d9def0";
    g.fillRect(0, 0, PW, PH);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    void t; void now;
    return s;
  }

  /** Match the high-resolution layer to the pixel canvas's on-screen size, and clear it. */
  private syncHi(): CanvasRenderingContext2D {
    const L = this.hiLayer, cv = this.canvas, css = cv.clientWidth, px = Math.round(css * Math.min(2, window.devicePixelRatio || 1));
    if (L.width !== px || L.height !== px) { L.width = px; L.height = px; }
    // sit exactly on the pixel canvas, wherever the layout has put it
    const w = `${css}px`, l = `${cv.offsetLeft}px`, t = `${cv.offsetTop}px`;
    if (L.style.width !== w) L.style.width = L.style.height = w;
    if (L.style.left !== l) L.style.left = l;
    if (L.style.top !== t) L.style.top = t;
    const hg = L.getContext("2d")!;
    hg.imageSmoothingEnabled = true;
    hg.imageSmoothingQuality = "high";
    return hg;
  }

  draw(now: number) {
    const g = this.ctx, V = this.V, C = V / 2;
    let hiDraw: (() => void) | null = null;
    if (this.hiShown) { this.hiLayer.getContext("2d")!.clearRect(0, 0, this.hiLayer.width, this.hiLayer.height); this.hiShown = false; }
    this.theme.drawBackdrop(g, now);
    const scale = this.theme.spriteScale;

    // leaving objects
    this.leaving = this.leaving.filter((l) => now - l.start < 400);
    for (const l of this.leaving) {
      const p = (now - l.start) / 400;
      const img = l.prep.levels[0], k = scale * l.prep.fit;
      g.save();
      if (l.kind === "named") {
        g.globalAlpha = 1 - p;
        const sw = img.width * k * (1 + p * 0.4), sh = img.height * k * (1 + p * 0.4);
        g.drawImage(img, Math.round(C - sw / 2), Math.round(C - sh / 2 - p * 30), sw, sh);
      } else {
        g.globalAlpha = (1 - p) * 0.6;
        const sw = img.width * k * (1 - p * 0.5), sh = img.height * k * (1 - p * 0.5);
        g.drawImage(img, Math.round(C - sw / 2 - p * 50), Math.round(C - sh / 2 + p * 40), sw, sh);
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
      // drawings sharpen out of a blur; photo plates depixelate, one stage at a time
      const level = a.prep.photo
        ? Math.round((1 - e) * Viewer.PHOTO_START[a.obj.band])
        : Math.min(BLUR_LEVELS - 1, Math.round((blur / MAX_SIGMA) * (BLUR_LEVELS - 1)));
      const fx = a.prep.focal.x + (a.prep.w / 2 - a.prep.focal.x) * e;
      const fy = a.prep.focal.y + (a.prep.h / 2 - a.prep.focal.y) * e;
      const px = scale * a.prep.fit * zoom; // logical px per sprite px
      const t = (now - a.appear) / 1000;
      const bobX = REDUCED ? 0 : Math.sin(t * 1.3) * 1.5, bobY = REDUCED ? 0 : Math.sin(t * 1.9 + 1) * 2;
      const slide = REDUCED ? 0 : (1 - ease(enter)) * 70;
      const x = C - (fx + PAD) * px + bobX + slide;
      const y = C - (fy + PAD) * px + bobY;
      // how far the night's condition has lifted: 0 until the zoom ends, then up to 1 over revealAfter seconds
      const cond = CONFIG.conditions.find((c) => c.id === this.condition)!;
      const settle = (ENTER_MS / 1000) + band.pullBack;
      const lift = cond.revealAfter ? clamp01((t - settle) / cond.revealAfter) : 1;
      const img = this.conditioned(a, level, lift, t, now);
      const DW = Math.round(img.width * px), DH = Math.round(img.height * px);
      g.globalAlpha = enter;
      if (this.condition === "keyhole" && lift < 1) {
        // a small window wanders over the object, then opens up
        const r = V * (0.17 + 0.5 * lift * lift);
        const wx = C + Math.sin(t * 1.1 + a.obj.sprite) * V * 0.16, wy = C + Math.sin(t * 1.7 + a.obj.sprite * 2) * V * 0.13;
        g.save();
        g.beginPath(); g.arc(Math.round(wx), Math.round(wy), r, 0, Math.PI * 2); g.clip();
        g.drawImage(img, Math.round(x), Math.round(y), DW, DH);
        g.restore();
        g.strokeStyle = "rgba(44, 232, 245, 0.35)"; g.lineWidth = 2;
        g.beginPath(); g.arc(Math.round(wx), Math.round(wy), r, 0, Math.PI * 2); g.stroke();
      } else if (this.condition === "meteor" && lift < 1) {
        // 4x4-pixel tiles start scattered and fall into place as the zoom pulls back
        const T = 4, k = 1 - ease(clamp01(t / (settle + cond.revealAfter)));
        for (let ty = 0; ty < img.height / T; ty++) for (let tx = 0; tx < img.width / T; tx++) {
          const h = ((a.obj.sprite + 1) * 9301 + ty * 49297 + tx * 233280) % 1000 / 1000;
          const h2 = ((a.obj.sprite + 7) * 4513 + tx * 7919 + ty * 104729) % 1000 / 1000;
          const ox = (h - 0.5) * V * 1.1 * k, oy = (h2 - 0.65) * V * 1.1 * k;
          const sx = tx * T, sy = ty * T, d = T * px;
          g.drawImage(img, sx, sy, T, T, Math.round(x + sx * px + ox), Math.round(y + sy * px + oy), Math.ceil(d), Math.ceil(d));
        }
      } else {
        g.drawImage(img, Math.round(x), Math.round(y), DW, DH);
      }
      g.globalAlpha = 1;
      hiDraw = () => {
        const hi = a.prep.hi;
        const fade = clamp01((e - 0.9) / 0.1) * enter;
        if (!hi || !hi.complete || !hi.naturalWidth || fade <= 0 || level > 0) return;
        const hg = this.syncHi(), s = this.hiLayer.width / V;
        hg.globalAlpha = fade;
        hg.drawImage(hi, (x + PAD * px) * s, (y + PAD * px) * s, a.prep.w * px * s, a.prep.h * px * s);
        hg.globalAlpha = 1;
      };
    }

    const drawHi = hiDraw as (() => void) | null;
    if (drawHi) { drawHi(); this.hiShown = true; }

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
    // the focus ring turns as the object comes into focus
    const target = this.shownCount * 0.6 + (this.active ? ease(this.pullProgress(now)) * 0.8 : 0.8);
    this.turn += REDUCED ? target - this.turn : (target - this.turn) * 0.12;
    const rp = (now - this.rippleAt) / 380;
    this.theme.drawFrame(g, now, {
      alert: this.alert,
      flash: this.flashK * Math.max(0, 1 - (now - this.flashAt) / 140),
      focus: this.turn,
      ripple: rp >= 0 && rp < 1 && !REDUCED ? rp : -1,
      rippleColor: this.rippleColor,
    });
  }
}

/** Separable gaussian blur on premultiplied RGBA. */
function gaussian(src: ImageData, PW: number, PH: number, sigma: number): ImageData {
  const r = Math.ceil(sigma * 2.5);
  const k: number[] = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); sum += v; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const pm = new Float32Array(PW * PH * 4);
  for (let i = 0; i < PW * PH; i++) {
    const a = src.data[i * 4 + 3] / 255;
    pm[i * 4] = src.data[i * 4] * a; pm[i * 4 + 1] = src.data[i * 4 + 1] * a; pm[i * 4 + 2] = src.data[i * 4 + 2] * a; pm[i * 4 + 3] = a;
  }
  const pass = (inp: Float32Array, dx: number, dy: number) => {
    const out = new Float32Array(PW * PH * 4);
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
      let a0 = 0, a1 = 0, a2 = 0, a3 = 0;
      for (let j = -r; j <= r; j++) {
        const xx = x + j * dx, yy = y + j * dy;
        if (xx < 0 || yy < 0 || xx >= PW || yy >= PH) continue;
        const w = k[j + r], i = (yy * PW + xx) * 4;
        a0 += inp[i] * w; a1 += inp[i + 1] * w; a2 += inp[i + 2] * w; a3 += inp[i + 3] * w;
      }
      const o = (y * PW + x) * 4;
      out[o] = a0; out[o + 1] = a1; out[o + 2] = a2; out[o + 3] = a3;
    }
    return out;
  };
  const res = pass(pass(pm, 1, 0), 0, 1);
  const out = new ImageData(PW, PH);
  for (let i = 0; i < PW * PH; i++) {
    const a = res[i * 4 + 3];
    // posterize alpha a little to keep a pixel-art feel
    const qa = Math.round(a * 4) / 4;
    out.data[i * 4 + 3] = qa * 255;
    if (a > 0) { out.data[i * 4] = res[i * 4] / a; out.data[i * 4 + 1] = res[i * 4 + 1] / a; out.data[i * 4 + 2] = res[i * 4 + 2] / a; }
  }
  return out;
}
