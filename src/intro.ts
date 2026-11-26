/**
 * The front door: a telescope on a hill under the stars. Pressing the button flies the camera into
 * the eyepiece and out into the Star Atlas.
 *
 * The scene is not a picture that gets scaled up. Every frame is drawn fresh by a tiny pixel
 * rasteriser at a fixed pixel size, through a camera (centre, zoom, roll). So the closer the camera
 * gets, the more pixels each thing gets, and small details (brass bands, bolts, knurled knobs, the
 * rubber ridges on the eyecup, the coating on the glass, the stars inside it) fade in through an
 * ordered dither as they become big enough to see.
 *
 * Motion: a short anticipation (the camera eases back a touch while the title lifts away), then an
 * accelerating zoom in log space with a gentle roll and star streaks scaled by speed, then a
 * crossfade into the atlas while the camera keeps drifting forward and slows to a stop.
 */
import { mulberry32 } from "./daily";
import { arrival } from "./atlas";

const LINES = [
  "PEER INTO THE UNIVERSE",
  "LOOK UP",
  "POINT THE TELESCOPE",
  "OPEN THE DOME",
  "FIND TONIGHT'S STAR",
  "WIPE THE LENS",
  "SEARCH THE SKY",
  "CHART THE NIGHT",
  "TAKE A LOOK",
];

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// timing (ms)
const ANTICIPATE = 260;
const ZOOM = 1350;
const FADE = 460;
const BACK = 1500;

// ---------------------------------------------------------------- the pixel rasteriser

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const cache = new Map<string, number>();
function rgb(hex: string): number {
  let v = cache.get(hex);
  if (v === undefined) {
    const n = parseInt(hex.slice(1), 16);
    v = ((255 << 24) | ((n & 255) << 16) | (n & 0xff00) | ((n >> 16) & 255)) >>> 0;
    cache.set(hex, v);
  }
  return v;
}

interface Cam { x: number; y: number; s: number; r: number }

class Raster {
  w = 1; h = 1;
  buf = new Uint32Array(1);
  img: ImageData | null = null;
  cam: Cam = { x: 0, y: 0, s: 1, r: 0 };
  private cos = 1; private sin = 0;
  constructor(private g: CanvasRenderingContext2D) {}
  resize(w: number, h: number) {
    this.w = w; this.h = h;
    this.img = this.g.createImageData(w, h);
    this.buf = new Uint32Array(this.img.data.buffer);
  }
  use(c: Cam) { this.cam = c; this.cos = Math.cos(c.r); this.sin = Math.sin(c.r); }
  /** world → screen */
  sx(x: number, y: number) { const c = this.cam, dx = (x - c.x) * c.s, dy = (y - c.y) * c.s; return this.w / 2 + dx * this.cos - dy * this.sin; }
  sy(x: number, y: number) { const c = this.cam, dx = (x - c.x) * c.s, dy = (y - c.y) * c.s; return this.h / 2 + dx * this.sin + dy * this.cos; }
  /** screen → world */
  wx(px: number, py: number) { const dx = px - this.w / 2, dy = py - this.h / 2; return this.cam.x + (dx * this.cos + dy * this.sin) / this.cam.s; }
  wy(px: number, py: number) { const dx = px - this.w / 2, dy = py - this.h / 2; return this.cam.y + (-dx * this.sin + dy * this.cos) / this.cam.s; }
  /** A pixel, with alpha done as an ordered dither so everything stays crisp. */
  px(x: number, y: number, col: number, a = 1) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    if (a < 1 && BAYER[((y & 3) << 2) | (x & 3)] >= a) return;
    this.buf[y * this.w + x] = col;
  }
  /** Filled polygon in screen space, sampled at pixel centres. */
  polyS(xs: number[], ys: number[], col: number, a = 1) {
    if (a <= 0) return;
    let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
    for (let i = 0; i < ys.length; i++) { y0 = Math.min(y0, ys[i]); y1 = Math.max(y1, ys[i]); x0 = Math.min(x0, xs[i]); x1 = Math.max(x1, xs[i]); }
    if (x1 < 0 || y1 < 0 || x0 > this.w || y0 > this.h) return;
    const ya = Math.max(0, Math.floor(y0)), yb = Math.min(this.h - 1, Math.ceil(y1));
    const n = xs.length, cut: number[] = [];
    for (let y = ya; y <= yb; y++) {
      const cy = y + 0.5;
      cut.length = 0;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const yi = ys[i], yj = ys[j];
        if ((yi <= cy) !== (yj <= cy)) cut.push(xs[i] + ((cy - yi) / (yj - yi)) * (xs[j] - xs[i]));
      }
      cut.sort((p, q) => p - q);
      for (let k = 0; k + 1 < cut.length; k += 2) {
        const xa = Math.max(0, Math.ceil(cut[k] - 0.5)), xb = Math.min(this.w - 1, Math.floor(cut[k + 1] - 0.5));
        for (let x = xa; x <= xb; x++) this.px(x, y, col, a);
      }
    }
  }
  /** Filled polygon in world space: flat list x0,y0,x1,y1,... */
  poly(pts: number[], col: string, a = 1) {
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < pts.length; i += 2) { xs.push(this.sx(pts[i], pts[i + 1])); ys.push(this.sy(pts[i], pts[i + 1])); }
    this.polyS(xs, ys, rgb(col), a);
  }
  /** A thick segment in world space. */
  seg(x0: number, y0: number, x1: number, y1: number, wd: number, col: string, a = 1) {
    const L = Math.hypot(x1 - x0, y1 - y0) || 1, nx = (-(y1 - y0) / L) * (wd / 2), ny = ((x1 - x0) / L) * (wd / 2);
    this.poly([x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny], col, a);
  }
  /**
   * An ellipse in world space with axes e1 (radius r1) and e2 = perpendicular (radius r2). Each pixel
   * inside calls shade(p, q, x, y) with p, q in -1..1 along the two axes; it returns a colour or 0.
   */
  ellipse(cx: number, cy: number, e1x: number, e1y: number, r1: number, r2: number, shade: (p: number, q: number, x: number, y: number) => number) {
    const R = Math.max(r1, r2) * this.cam.s + 1;
    const scx = this.sx(cx, cy), scy = this.sy(cx, cy);
    const xa = Math.max(0, Math.floor(scx - R)), xb = Math.min(this.w - 1, Math.ceil(scx + R));
    const ya = Math.max(0, Math.floor(scy - R)), yb = Math.min(this.h - 1, Math.ceil(scy + R));
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      const dx = this.wx(x + 0.5, y + 0.5) - cx, dy = this.wy(x + 0.5, y + 0.5) - cy;
      const p = (dx * e1x + dy * e1y) / r1, q = (-dx * e1y + dy * e1x) / r2;
      if (p * p + q * q > 1) continue;
      const c = shade(p, q, x, y);
      if (c) this.buf[y * this.w + x] = c;
    }
  }
  disc(cx: number, cy: number, r: number, col: string, a = 1) {
    if (a <= 0) return;
    const c = rgb(col);
    this.ellipse(cx, cy, 1, 0, r, r, (_p, _q, x, y) => (a >= 1 || BAYER[((y & 3) << 2) | (x & 3)] < a ? c : 0));
  }
  flush() { this.g.putImageData(this.img!, 0, 0); }
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => { v = clamp01(v); return v * v * (3 - 2 * v); };

// ---------------------------------------------------------------- the scene

// palette
const OUT = "#181425";
const C = {
  sky0: "#07061a", sky1: "#0b0a20", sky2: "#111230", sky3: "#191b3c",
  hillFar: "#121430", hillFarRim: "#1d2044", hill: "#181a35", hillRim: "#2c3058", grass: "#262b4f",
  steel0: "#262b44", steel1: "#3a4466", steel2: "#5a6988", steel3: "#8b9bb4", steel4: "#c0cbdc",
  brass0: "#8a5a22", brass1: "#c48a2c", brass2: "#f2c14e",
  rubber: "#1a1830", rubber2: "#2a2745", glass0: "#0b0a18", glass1: "#141634",
  gold: "#fee761", orange: "#feae34", cyan: "#2ce8f5", pink: "#e07ab8", white: "#dbe2ee",
  cat: "#0c0b1a", catRim: "#3a4466",
};

// the telescope, in world units (y down). The tube points up and to the right from a pivot.
const TH = (-36 * Math.PI) / 180;
const D = { x: Math.cos(TH), y: Math.sin(TH) };   // along the tube, towards the sky
const N = { x: D.y, y: -D.x };                     // "up" across the tube
const PIV = { x: 0, y: -6 };
const TR = 6;                                      // tube radius
const tl = (u: number, v: number) => [PIV.x + D.x * u + N.x * v, PIV.y + D.y * u + N.y * v];
const EYE_U = -45.3;                               // the eyepiece glass
const T = { x: tl(EYE_U, 0)[0], y: tl(EYE_U, 0)[1] };
const EYE_R1 = 3.6, EYE_R2 = 2.0, GLASS = 0.72;    // eyecup face radii, glass as a share of it
// roll so that the eyepiece face ends up upright on screen
const ROLL_END = -Math.PI / 2 - Math.atan2(N.y, N.x);

interface Star { x: number; y: number; f: number; c: string; ph: number; big: boolean }

export function introScreen(app: HTMLElement, opts: { title: string; sub: string; onEnter: () => void; links?: { id: string; label: string }[]; onLink?: (id: string) => void; returning?: boolean }) {
  app.innerHTML = `
  <main class="intro${opts.returning && !REDUCED ? " zooming" : ""}">
    <canvas class="intro-scene" id="intro-scene" aria-hidden="true"></canvas>
    <div class="intro-ui">
      <h1 class="wordmark">${opts.title.toUpperCase()}</h1>
      <p class="intro-sub">${opts.sub}</p>
      <button class="btn primary intro-go" id="intro-go">${LINES[Math.floor(Math.random() * LINES.length)]}</button>
    </div>
    ${opts.links?.length ? `<nav class="intro-menu" aria-label="Menu">${opts.links.map((l) => `<button class="btn" data-link="${l.id}">${l.label}</button>`).join("")}</nav>` : ""}
  </main>`;
  const root = app.querySelector(".intro") as HTMLElement;
  const cv = document.getElementById("intro-scene") as HTMLCanvasElement;
  const g = cv.getContext("2d")!;
  const R = new Raster(g);

  // viewport: a fixed pixel size, and a base scale that fits the hill on any screen
  let PX = 3, k0 = 1, C0 = { x: 0, y: 0 }, viewW = 200, viewH = 260, zEnd = 150, lastW = 0, lastH = 0;
  const size = () => {
    const W = window.innerWidth, H = window.innerHeight;
    if (W === lastW && H === lastH) return;
    lastW = W; lastH = H;
    PX = Math.max(2, Math.min(5, Math.round(Math.min(W, H) / 170)));
    const cw = Math.ceil(W / PX), ch = Math.ceil(H / PX);
    cv.width = cw; cv.height = ch;
    cv.style.width = `${cw * PX}px`; cv.style.height = `${ch * PX}px`;
    R.resize(cw, ch);
    k0 = Math.min(cw / 200, ch / 225);
    viewW = cw / k0; viewH = ch / k0;
    C0 = { x: -4, y: 46 - (0.34 * ch) / k0 };
    // zoom at which the eyepiece glass covers the whole screen (with the roll applied)
    const a = EYE_R2 * GLASS, b = EYE_R1 * GLASS;
    zEnd = (1.12 * Math.hypot(cw / 2 / a, ch / 2 / b)) / k0;
  };
  size();

  // stars: a few parallax layers spread a bit past the screen
  const rand = mulberry32(7);
  const COLS = ["#5a6988", "#8b9bb4", "#c0cbdc", "#c0cbdc", C.cyan, C.gold, C.pink];
  const stars: Star[] = Array.from({ length: 260 }, () => {
    const f = 0.12 + rand() * 0.38;
    return { x: (rand() - 0.5) * 1.5, y: rand() * 0.95 - 0.62, f, c: COLS[Math.floor(rand() * (rand() < 0.8 ? 4 : 7))], ph: rand() * 6.28, big: rand() < 0.06 };
  });
  const milky = Array.from({ length: 700 }, () => {
    const t = rand() * 1.6 - 0.8, off = (rand() - 0.5) * rand() * 0.22;
    return { x: t, y: -0.18 - t * 0.42 + off, c: rand() < 0.6 ? "#1d2044" : "#2c3058" };
  });
  // stars inside the eyepiece: what you'd see through it
  const glassStars = Array.from({ length: 240 }, () => ({
    x: (rand() - 0.5) * 2.6, y: (rand() - 0.5) * 2.6, c: COLS[Math.floor(rand() * 7)], ph: rand() * 6.28, big: rand() < 0.08,
  }));
  const trees = [-150, -138, -129, -96, 104, 118, 131, 160, 172].map((x) => ({ x, h: 7 + rand() * 7 }));
  const tufts = Array.from({ length: 40 }, () => ({ x: (rand() - 0.5) * 140, h: 0.8 + rand() * 1.4 }));
  let shoot = { at: 2200, x: 0, y: 0 };

  // camera and timeline
  let go0 = -1, fade0 = -1, raf = 0, prevLz = 0, prevT = 0, vel = 0, done = false;
  // coming back from the atlas: start inside the eyepiece and pull back out to the hill
  let back0 = opts.returning && !REDUCED ? -2 : -1;
  const cam = (t: number): Cam & { z: number; p: number } => {
    if (back0 === -2) back0 = t;
    if (back0 >= 0 && go0 < 0) {
      const q = Math.min(1, (t - back0) / BACK);
      if (q >= 1) { back0 = -1; root.classList.remove("zooming"); }
      else {
        // fast at first, then easing gently onto the hill
        const p = 1 - (1 - (1 - q) ** 3);
        const L = Math.log(zEnd);
        const z = Math.exp(L * (0.12 * p + 0.88 * p ** 3.2));
        const k = 1 - smooth(p * 1.05);
        const ox = C0.x - T.x, oy = C0.y - T.y;
        if (q > 0.55) root.classList.remove("zooming");
        return { x: T.x + ox * k, y: T.y + oy * k, s: k0 * z, r: ROLL_END * smooth((p - 0.15) / 0.85), z, p };
      }
    }
    if (go0 < 0) {
      const z = 1 + 0.006 * Math.sin(t / 2600);
      return { x: C0.x + Math.sin(t / 4100) * 0.8, y: C0.y, s: k0 * z, r: 0, z, p: 0 };
    }
    const e = t - go0;
    if (e < ANTICIPATE) {
      // anticipation: settle back a touch, slowing into the pause
      const a = 1 - (1 - e / ANTICIPATE) ** 3;
      const z = 1 - 0.055 * a;
      return { x: C0.x + (C0.x - T.x) * 0.03 * a, y: C0.y + (C0.y - T.y) * 0.03 * a, s: k0 * z, r: 0, z, p: 0 };
    }
    const p = Math.min(1, (e - ANTICIPATE) / ZOOM);
    const z0 = 0.945, L = Math.log(zEnd / z0);
    let lz: number;
    if (p < 1) lz = Math.log(z0) + L * (0.12 * p + 0.88 * p ** 3.2);  // slow in, then racing
    else {
      // follow-through: keep drifting forward and ease to a stop while the atlas fades in
      const v1 = L * (0.12 + 0.88 * 3.2) / (ZOOM / 1000), tau = 0.14, dt = (e - ANTICIPATE - ZOOM) / 1000;
      lz = Math.log(zEnd) + v1 * tau * (1 - Math.exp(-dt / tau));
    }
    const z = Math.exp(lz);
    const k = (z0 / z) * (1 - smooth(p * 1.05));
    const ox = (C0.x + (C0.x - T.x) * 0.03) - T.x, oy = (C0.y + (C0.y - T.y) * 0.03) - T.y;
    return { x: T.x + ox * k, y: T.y + oy * k, s: k0 * z, r: ROLL_END * smooth((p - 0.15) / 0.85), z, p };
  };

  const draw = (t: number) => {
    size();
    const c = cam(t);
    const z = c.z;
    const lz = Math.log(z);
    if (prevT) vel = vel * 0.5 + 0.5 * ((lz - prevLz) / Math.max(0.001, (t - prevT) / 1000));
    prevLz = lz; prevT = t;
    const lod = (lo: number, hi: number) => clamp01((z - lo) / (hi - lo));
    R.use(c);
    const w = R.w, h = R.h;
    const buf = R.buf;

    // --- sky: a dithered gradient that sinks a little as we fly in
    const sk = [rgb(C.sky0), rgb(C.sky1), rgb(C.sky2), rgb(C.sky3)];
    const horizon = Math.min(1, 0.06 / Math.sqrt(z));
    for (let y = 0; y < h; y++) {
      const v = clamp01((y / h - 0.05) / 0.85) * 3 * (1 - horizon * 2) + horizon;
      const i = Math.min(2, Math.floor(v)), fr = v - i;
      for (let x = 0; x < w; x++) buf[y * w + x] = BAYER[((y & 3) << 2) | (x & 3)] < fr ? sk[i + 1] : sk[i];
    }

    // focal point on screen: everything streams away from here while zooming
    const fx = R.sx(T.x, T.y), fy = R.sy(T.x, T.y);
    const streak = (x: number, y: number, f: number, col: number) => {
      const v = Math.max(0, vel) * f;
      if (v < 0.6) return;
      const dx = x - fx, dy = y - fy, L = Math.min(70, Math.hypot(dx, dy) * (Math.exp(v * 0.045) - 1));
      const d = Math.hypot(dx, dy) || 1;
      for (let i = 1; i <= L; i++) R.px(x - (dx / d) * i, y - (dy / d) * i, col, 0.85 * (1 - i / (L + 1)));
    };

    // --- sky layers: parallax (they zoom slower than the hill), in "screen widths" around the start view
    const skyPt = (x: number, y: number, f: number) => {
      const zf = z ** f;
      const wx = C0.x + x * viewW, wy = C0.y + y * viewH;
      const cx = c.x + (C0.x - c.x) * (1 - f), cy = c.y + (C0.y - c.y) * (1 - f);
      const dx = (wx - cx) * k0 * zf, dy = (wy - cy) * k0 * zf;
      const co = Math.cos(c.r * f), si = Math.sin(c.r * f);
      return [w / 2 + dx * co - dy * si, h / 2 + dx * si + dy * co];
    };
    for (const m of milky) { const [x, y] = skyPt(m.x, m.y, 0.15); R.px(x, y, rgb(m.c)); }
    for (const s of stars) {
      const [x, y] = skyPt(s.x, s.y, s.f);
      const tw = REDUCED ? 0.85 : 0.4 + 0.6 * ((Math.sin(t / 650 + s.ph) + 1) / 2);
      const col = rgb(s.c);
      R.px(x, y, col, tw);
      const grow = z ** s.f;
      if (s.big || grow > 2.2) {
        const arm = s.big ? Math.min(4, Math.floor(1 + grow)) : Math.min(2, Math.floor(grow - 1.2));
        for (let i = 1; i <= arm; i++) { const a = tw * (1 - i / (arm + 1)); R.px(x + i, y, col, a); R.px(x - i, y, col, a); R.px(x, y + i, col, a); R.px(x, y - i, col, a); }
      }
      streak(x, y, s.f, col);
    }

    // --- shooting star now and then while idle
    if (go0 < 0 && !REDUCED) {
      const e = t - shoot.at;
      if (e > 0 && e < 520) {
        if (shoot.x === 0) { shoot.x = w * (0.2 + rand() * 0.6); shoot.y = h * (0.06 + rand() * 0.25); }
        const k = e / 520, hx = shoot.x - k * w * 0.28, hy = shoot.y + k * w * 0.14;
        for (let i = 0; i < 14; i++) R.px(hx + i * 2, hy - i, rgb(i < 3 ? C.white : C.cyan), (1 - i / 14) * (1 - k * 0.6));
      } else if (e >= 520) shoot = { at: t + 4500 + rand() * 4000, x: 0, y: 0 };
    }

    // --- moon: craters show up as it gets bigger
    {
      const f = 0.4, [mx, my] = skyPt(0.32, -0.1, f), mr = 8 * k0 * z ** f;
      const lit = rgb("#fff4a3"), lit2 = rgb("#f2dc84"), dark = rgb("#1b1d3a"), crater = rgb("#d9c06a");
      const cr = lod(1.6, 2.6);
      const r = Math.max(5, mr), R2 = r * r;
      for (let y = Math.max(0, Math.floor(my - r)); y <= Math.min(h - 1, my + r); y++) for (let x = Math.max(0, Math.floor(mx - r)); x <= Math.min(w - 1, mx + r); x++) {
        const dx = x + 0.5 - mx, dy = y + 0.5 - my;
        if (dx * dx + dy * dy > R2) continue;
        const sx = dx - r * 0.55, sy = dy + r * 0.4;      // the shadow disc
        let col = sx * sx + sy * sy < R2 * 0.85 ? dark : (dx + dy) / r > 0.55 ? lit2 : lit;
        if (col !== dark && cr > 0) {
          for (const [cx, cy, cs] of [[-0.45, -0.1, 0.18], [-0.1, 0.5, 0.13], [-0.6, 0.38, 0.1], [0.05, -0.62, 0.09]]) {
            const ex = dx / r - cx, ey = dy / r - cy;
            if (ex * ex + ey * ey < cs * cs && BAYER[((y & 3) << 2) | (x & 3)] < cr) col = crater;
          }
        }
        buf[y * w + x] = col;
      }
    }

    // --- far hills with pines (a slower parallax layer)
    {
      const f = 0.7, zf = z ** f;
      const fc: Cam = { x: c.x + (C0.x - c.x) * (1 - f), y: c.y + (C0.y - c.y) * (1 - f), s: k0 * zf, r: c.r * f };
      R.use(fc);
      const pts: number[] = [];
      for (let x = -700; x <= 700; x += 6) pts.push(x, 36 + 7 * Math.sin(x / 57 + 1) + 4 * Math.sin(x / 19));
      R.poly([...pts, 700, 600, -700, 600], C.hillFarRim);
      const pts2 = pts.map((v, i) => (i % 2 ? v + 1.2 / fc.s : v));
      R.poly([...pts2, 700, 600, -700, 600], C.hillFar);
      for (const tr of trees) {
        const gy = 36 + 7 * Math.sin(tr.x / 57 + 1) + 4 * Math.sin(tr.x / 19);
        R.poly([tr.x, gy - tr.h, tr.x + tr.h * 0.38, gy + 1, tr.x - tr.h * 0.38, gy + 1], C.hillFar);
      }
      R.use(c);
    }

    // --- the near hill
    const hillY = (x: number) => 44 + (x * x) / 2600;
    {
      const pts: number[] = [];
      for (let x = -800; x <= 800; x += 8) pts.push(x, hillY(x));
      R.poly([...pts, 800, 900, -800, 900], C.hillRim);
      R.poly([...pts.map((v, i) => (i % 2 ? v + 1 / c.s : v)), 800, 900, -800, 900], C.hill);
      const gl = lod(2, 3.2);
      if (gl > 0) for (const tf of tufts) {
        const y = hillY(tf.x);
        R.seg(tf.x, y + 0.3, tf.x - 0.4, y - tf.h, 0.35, C.grass, gl);
        R.seg(tf.x + 0.5, y + 0.3, tf.x + 0.9, y - tf.h * 0.8, 0.35, C.grass, gl);
      }
    }

    // --- lantern glow on the ground
    const flick = REDUCED ? 0 : Math.sin(t / 90) * 0.5 + Math.sin(t / 37) * 0.3;
    const LX = -58, LY = hillY(-58);
    {
      const fadeOut = 1 / (1 + (z - 1) * 0.6);
      R.disc(LX, LY - 3, 15 + flick, C.orange, 0.06 * fadeOut);
      R.disc(LX, LY - 3, 10 + flick * 0.6, C.orange, 0.1 * fadeOut);
      R.disc(LX, LY - 3, 6 + flick * 0.3, C.orange, 0.16 * fadeOut);
    }

    // --- tripod: back leg, the cat, front legs
    const leg = (x0: number, y0: number, x1: number, y1: number, base: string, hi: string) => {
      const o = 1 / c.s;
      R.seg(x0, y0, x1, y1, 2.8 + o * 2, OUT);
      R.seg(x0, y0, x1, y1, 2.8, base);
      R.seg(x0 - 0.5, y0, x1 - 0.5, y1, 0.7, hi, lod(1.3, 2));
      R.poly([x1 - 1.8, y1 - 1.6, x1 + 1.8, y1 - 1.6, x1 + 2, y1 + 0.6, x1 - 2, y1 + 0.6], OUT);
    };
    leg(0, 3, 5, 47.5, C.steel0, C.steel1);
    // the cat, sitting on the hill, watching the moon
    {
      const cx = 27, cy = hillY(27);
      const sway = REDUCED ? 0 : Math.sin(t / 900) * 1.2;
      const rim = lod(1.4, 2.2), o = 0.9 / c.s;
      const body = (dx: number, col: string) => {
        R.ellipse(cx + dx, cy - 4, 0, 1, 4.2, 3.2, () => rgb(col));
        R.disc(cx + 1.6 + dx, cy - 9, 2.4, col);
        R.poly([cx - 0.4 + dx, cy - 10, cx + 0.6 + dx, cy - 13.2, cx + 1.8 + dx, cy - 10.6], col);
        R.poly([cx + 2 + dx, cy - 10.8, cx + 3.6 + dx, cy - 13, cx + 3.9 + dx, cy - 9.8], col);
        let px = cx - 2.6 + dx, py = cy - 1;
        for (let i = 1; i <= 5; i++) {
          const nx = cx - 2.6 - i * 1.4 + dx, ny = cy - 1 - Math.sin(i / 5 * 2.2) * (2.4 + sway) + i * 0.2;
          R.seg(px, py, nx, ny, 1.3, col); px = nx; py = ny;
        }
      };
      if (rim > 0) body(o, C.catRim);
      body(0, C.cat);
    }
    leg(0, 3, -24, 48.5, C.steel1, C.steel2);
    leg(0, 3, 22, 48.5, C.steel1, C.steel2);
    // accessory tray between the legs
    {
      const a = lod(1.8, 2.6);
      if (a > 0) {
        R.poly([-11.5, 25, 10.8, 25, 9.8, 27, -10.6, 27], C.steel0, a);
        for (const ex of [-6, -2, 2]) R.disc(ex, 24.2, 1, C.steel3, a);
      }
    }

    // --- mount head and pivot
    {
      const o = 1 / c.s;
      R.poly([-5 - o, -4 - o, 5 + o, -4 - o, 6.5 + o, 4.5 + o, -6.5 - o, 4.5 + o], OUT);
      R.poly([-5, -4, 5, -4, 6.5, 4.5, -6.5, 4.5], C.steel1);
      R.poly([-5, -4, 5, -4, 5.4, -2.6, -5.4, -2.6], C.steel2);
    }

    // --- the tube
    const rect = (u0: number, u1: number, v0: number, v1: number, col: string, a = 1) => {
      const p = [...tl(u0, v0), ...tl(u1, v0), ...tl(u1, v1), ...tl(u0, v1)];
      R.poly(p, col, a);
    };
    const o = 1 / c.s;
    // outline, body and shading
    rect(-30 - o, 40 + o, -TR - o, TR + o, OUT);
    rect(-30, 40, -TR, TR, C.steel2);
    rect(-30, 40, TR * 0.32, TR * 0.72, C.steel3);
    rect(-30, 40, TR * 0.5, TR * 0.6, C.steel4, lod(1.5, 2.4));
    rect(-30, 40, -TR, -TR * 0.42, C.steel1);
    // dew shield at the front
    rect(39 - o, 52 + o, -7.3 - o, 7.3 + o, OUT);
    rect(39, 52, -7.3, 7.3, C.steel1);
    rect(39, 52, 2.6, 5.6, C.steel2);
    rect(39, 52, -7.3, -4, C.steel0);
    // objective lens rim seen edge-on
    R.ellipse(...(tl(52.2, 0) as [number, number]), N.x, N.y, 7.3, 1.4, (p, q, x, y) => {
      const r = p * p + q * q;
      if (r > 0.6) return rgb(C.brass1);
      return BAYER[((y & 3) << 2) | (x & 3)] < (p + 1) / 2 * 0.6 ? rgb(C.glass1) : rgb(C.glass0);
    });
    // brass bands
    {
      const a = lod(1.5, 2.3);
      for (const u of [-27, 37]) {
        rect(u, u + 2, -TR - 0.3, TR + 0.3, C.brass1, a);
        rect(u, u + 2, TR * 0.35, TR * 0.75, C.brass2, a);
        rect(u, u + 2, -TR - 0.3, -TR * 0.4, C.brass0, a);
      }
    }
    // a painted star on the tube
    {
      const a = lod(3, 4.6);
      if (a > 0) {
        const [sx, sy] = tl(16, -0.6), pts: number[] = [];
        for (let i = 0; i < 10; i++) {
          const ang = -Math.PI / 2 + (i * Math.PI) / 5 + TH, rr = i % 2 ? 0.95 : 2.3;
          pts.push(sx + Math.cos(ang) * rr, sy + Math.sin(ang) * rr);
        }
        R.poly(pts, C.gold, a);
      }
    }
    // tube rings clamping it to the mount, with bolts
    for (const u of [-9, 9]) {
      rect(u - o, u + 2.6 + o, -TR - 1 - o, TR + 1 + o, OUT);
      rect(u, u + 2.6, -TR - 1, TR + 1, C.steel0);
      rect(u, u + 2.6, TR * 0.4, TR + 1, C.steel1);
      const b = lod(2.4, 3.6);
      if (b > 0) {
        const [bx, by] = tl(u + 1.3, TR + 1.6);
        R.disc(bx, by, 0.9, C.steel3, b);
        R.disc(bx - 0.25, by - 0.25, 0.35, C.steel4, b);
      }
    }
    // finder scope on top
    {
      const a = lod(1.4, 2.2);
      if (a > 0) {
        for (const u of [-6, 6]) rect(u, u + 1.6, TR, TR + 2.6, C.steel0, a);
        rect(-11 - o, 13 + o, TR + 2.4 - o, TR + 5.2 + o, OUT, a);
        rect(-11, 13, TR + 2.4, TR + 5.2, C.steel2, a);
        rect(-11, 13, TR + 4, TR + 4.8, C.steel3, a);
        rect(11, 13.5, TR + 2.1, TR + 5.5, C.steel1, a);
        rect(-11, -9.5, TR + 2.6, TR + 5, C.brass1, a * lod(2.6, 3.6));
      }
    }
    // pivot knob
    {
      R.disc(PIV.x, PIV.y, 2.8 + o, OUT);
      R.disc(PIV.x, PIV.y, 2.8, C.brass1);
      R.disc(PIV.x - 0.6, PIV.y - 0.6, 1.4, C.brass2, lod(1.2, 2));
      const k = lod(3.5, 5.5);
      if (k > 0) for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * Math.PI * 2;
        R.disc(PIV.x + Math.cos(ang) * 2.4, PIV.y + Math.sin(ang) * 2.4, 0.3, C.brass0, k);
      }
    }
    // focuser and its knob
    rect(-35.5 - o, -30 + o, -3.8 - o, 3.8 + o, OUT);
    rect(-35.5, -30, -3.8, 3.8, C.steel0);
    rect(-35.5, -30, 1, 3, C.steel2);
    {
      const [kx, ky] = tl(-32.6, -5.6);
      R.seg(...(tl(-32.6, -3.6) as [number, number]), kx, ky, 1.2, C.steel0);
      R.disc(kx, ky, 2.3 + o, OUT);
      R.disc(kx, ky, 2.3, C.steel2);
      R.disc(kx - 0.5, ky - 0.5, 1.1, C.steel3, lod(1.6, 2.4));
      const k = lod(4, 6.5);
      if (k > 0) for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2;
        R.disc(kx + Math.cos(ang) * 1.95, ky + Math.sin(ang) * 1.95, 0.22, C.steel0, k);
      }
    }
    // eyepiece barrel (chrome) and rubber eyecup
    rect(-41 - o, -35.5, -3 - o, 3 + o, OUT);
    rect(-41, -35.5, -3, 3, C.steel3);
    rect(-41, -35.5, 0.6, 2.2, C.steel4);
    rect(-41, -35.5, -3, -1.2, C.steel2);
    rect(-38.6, -38, -3, 3, C.steel1, lod(2, 3));
    {
      const a = lod(6, 9);
      if (a > 0) for (let i = 0; i < 7; i++) rect(-37.4, -37.1, -2.6 + i * 0.85, -2.3 + i * 0.85, C.steel1, a);
    }
    rect(EYE_U - o, -41, -EYE_R1 - o, EYE_R1 + o, OUT);
    rect(EYE_U, -41, -EYE_R1, EYE_R1, C.rubber);
    rect(EYE_U, -41, 1.2, 2.8, C.rubber2);
    {
      const a = lod(5, 8);
      if (a > 0) for (const u of [-42, -43, -44]) rect(u, u + 0.3, -EYE_R1, EYE_R1, "#2e2b4c", a);
    }

    // --- the eyepiece face and its glass: where we are going
    const gla = rgb(C.glass0), glb = rgb(C.glass1), rim1 = rgb(C.rubber), rim2 = rgb(C.rubber2), rim3 = rgb("#3a3760");
    const coat = lod(7, 12), glintK = clamp01(lz / Math.log(10));
    const purple = rgb("#3d2a63"), green = rgb("#1f4d4a"), shine = rgb(C.white), shine2 = rgb(C.steel3);
    const nebula = rgb("#231a3e");
    const neb = lod(12, 30);
    R.ellipse(T.x, T.y, N.x, N.y, EYE_R1 + o, EYE_R2 + o, () => rgb(OUT));
    R.ellipse(T.x, T.y, N.x, N.y, EYE_R1, EYE_R2, (p, q, x, y) => {
      const r = Math.hypot(p, q), bay = BAYER[((y & 3) << 2) | (x & 3)];
      if (r > GLASS) return r > 0.93 ? rim1 : r > 0.86 ? (p > 0 ? rim3 : rim2) : rim1;
      const gp = p / GLASS, gq = q / GLASS, rr = gp * gp + gq * gq;
      let col = bay < 0.25 + 0.5 * rr ? glb : gla;
      if (neb > 0) {
        // a faint nebula behind the stars, like the atlas
        const n = Math.sin(gp * 3.1 + 1) * Math.sin(gq * 2.3 - 0.5) + Math.sin(gp * 5.7 - gq * 4.1) * 0.4;
        if (n > 0.35 && bay < neb * 0.55) col = nebula;
      }
      if (coat > 0) {
        const ang = Math.atan2(gq, gp);
        if (rr > 0.5 && rr < 0.78 && ang > 1.9 && ang < 2.9 && bay < coat * 0.85) col = purple;
        if (rr > 0.42 && rr < 0.66 && ang > -1.3 && ang < -0.4 && bay < coat * 0.7) col = green;
      }
      // the glint slides off towards the rim as we approach (it's a reflection, not in the glass)
      const gx = 0.42 + glintK * 0.5, gy = -0.38 - glintK * 0.25, gs = 0.2 * (1 - glintK * 0.6);
      const ex = (gp - gx) / gs, ey = (gq - gy) / (gs * 0.6);
      if (ex * ex + ey * ey < 1) col = bay < 1 - glintK * 0.7 ? shine : col;
      else if (((gp - gx * 0.6) / 0.07) ** 2 + ((gq - gy * 0.4) / 0.07) ** 2 < 1 && bay < 0.6 * (1 - glintK)) col = shine2;
      return col;
    });
    // stars seen through the glass; you see more of them the closer you get, as through a window
    {
      const a = lod(8, 18);
      if (a > 0) {
        const Apx = EYE_R1 * GLASS * c.s, Aend = EYE_R1 * GLASS * k0 * zEnd;
        const spread = Apx * (Apx / Aend) ** -0.32;
        const inGlass = (x: number, y: number) => {
          const dx = R.wx(x + 0.5, y + 0.5) - T.x, dy = R.wy(x + 0.5, y + 0.5) - T.y;
          const p = (dx * N.x + dy * N.y) / (EYE_R1 * GLASS), q = (-dx * N.y + dy * N.x) / (EYE_R2 * GLASS);
          return p * p + q * q < 0.96;
        };
        for (const s of glassStars) {
          const x = fx + s.x * spread, y = fy + s.y * spread;
          if (x < 0 || y < 0 || x >= w || y >= h || !inGlass(x, y)) continue;
          const tw = a * (0.5 + 0.5 * ((Math.sin(t / 500 + s.ph) + 1) / 2));
          const col = rgb(s.c);
          R.px(x, y, col, tw);
          if (s.big && spread > 30) for (let i = 1; i <= 2; i++) { const b = tw * (1 - i / 3); R.px(x + i, y, col, b); R.px(x - i, y, col, b); R.px(x, y + i, col, b); R.px(x, y - i, col, b); }
          streak(x, y, 0.55, col);
        }
        // tonight's star, waiting right in the middle
        const b = lod(14, 40);
        if (b > 0) {
          const arm = Math.round(2 + b * Math.min(14, Apx * 0.05));
          const gold = rgb(C.gold), glow = rgb(C.orange);
          const gr = Math.round(arm * 0.7);
          for (let y = -gr; y <= gr; y++) for (let x = -gr; x <= gr; x++) if (x * x + y * y <= gr * gr) R.px(fx + x, fy + y, glow, b * 0.22 * (1 - Math.hypot(x, y) / (gr + 1)) * 2);
          for (let i = -arm; i <= arm; i++) { const k = b * (1 - Math.abs(i) / (arm + 1)); R.px(fx + i, fy, gold, k); R.px(fx, fy + i, gold, k); }
          for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) R.px(fx + x, fy + y, gold, b);
        }
      }
    }

    // --- the lantern, in front
    {
      const a = lod(2.4, 3.8);
      const o2 = 1 / c.s;
      R.poly([LX - 3 - o2, LY - 7 - o2, LX + 3 + o2, LY - 7 - o2, LX + 3.4 + o2, LY + o2, LX - 3.4 - o2, LY + o2], OUT);
      R.poly([LX - 3, LY - 7, LX + 3, LY - 7, LX + 3.4, LY, LX - 3.4, LY], C.brass1);
      R.poly([LX - 2.2, LY - 6, LX + 2.2, LY - 6, LX + 2.4, LY - 1.2, LX - 2.4, LY - 1.2], flick > 0.3 ? C.gold : "#fff1a8");
      R.disc(LX, LY - 3.2 + flick * 0.15, 1 + flick * 0.15, C.orange, 0.9);
      R.poly([LX - 2.6, LY - 7, LX + 2.6, LY - 7, LX + 1.4, LY - 9, LX - 1.4, LY - 9], C.brass0);
      R.seg(LX - 1.6, LY - 9.2, LX, LY - 11.6, 0.5, C.brass1);
      R.seg(LX, LY - 11.6, LX + 1.6, LY - 9.2, 0.5, C.brass1);
      if (a > 0) {
        R.seg(LX, LY - 6, LX, LY - 1.2, 0.45, C.brass0, a);
        R.seg(LX - 2.3, LY - 3.6, LX + 2.3, LY - 3.6, 0.45, C.brass0, a);
        R.poly([LX - 3.4, LY - 1, LX + 3.4, LY - 1, LX + 3.4, LY, LX - 3.4, LY], C.brass2, a);
      }
    }

    R.flush();
    if (!done && !REDUCED) raf = requestAnimationFrame(draw);
    // hand over once the glass fills the screen
    if (go0 >= 0 && fade0 < 0 && t - go0 >= ANTICIPATE + ZOOM) handOver(t);
    if (fade0 >= 0 && t - fade0 > FADE + 60) stop();
  };

  const stop = () => {
    done = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("pointerdown", skip, true);
    cv.remove();
  };
  // the canvas stays on top (in <body>) and fades out while the atlas arrives underneath
  const handOver = (t: number) => {
    fade0 = t;
    document.body.appendChild(cv);
    cv.classList.add("intro-out");
    arrival.forward = true;
    opts.onEnter();
    requestAnimationFrame(() => cv.classList.add("gone"));
  };
  const skip = () => {
    if (go0 < 0 || fade0 >= 0) return;
    go0 = performance.now() - ANTICIPATE - ZOOM;
  };

  raf = requestAnimationFrame(draw);

  root.querySelectorAll<HTMLButtonElement>("[data-link]").forEach((b) => (b.onclick = () => opts.onLink?.(b.dataset.link!)));
  const go = document.getElementById("intro-go") as HTMLButtonElement;
  go.focus({ preventScroll: true });
  go.onclick = () => {
    if (go0 >= 0 || back0 !== -1) return;
    if (REDUCED) { cancelAnimationFrame(raf); opts.onEnter(); return; }
    go0 = performance.now();
    root.classList.add("zooming");
    // tap again to skip the flight
    setTimeout(() => window.addEventListener("pointerdown", skip, true), 50);
  };
}

// debug hook for frame-by-frame checks
export const INTRO_TIMING = { ANTICIPATE, ZOOM, FADE };
