/**
 * Pixel-art effects: glows and washes drawn with ordered (Bayer) dithering on a fixed pixel grid,
 * instead of smooth radial gradients and blur. Full-screen washes are built at startup (and on resize)
 * as crisp images, then handed to the stylesheet as CSS variables.
 */

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** threshold in (0, 1) for a cell, from the 4×4 Bayer matrix */
export const bayer = (x: number, y: number) => (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

/** A colour stop: position 0..1 along the radius, then r, g, b (0..255) and alpha (0..1). */
export type Stop = [number, number, number, number, number];

/** Pick a colour at radius t: one of the two neighbouring stops, chosen by dither, and its alpha stepped in quarters. */
function sample(stops: Stop[], t: number, th: number): [number, number, number, number] | null {
  if (t <= stops[0][0]) { const s = stops[0]; return s[4] > 0 ? [s[1], s[2], s[3], s[4]] : null; }
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
  const a = stops[i], b = stops[i + 1];
  const f = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0] || 1)));
  const s = f > th ? b : a;
  // alpha: blend the two stops' alphas, then step it to quarters with the same dither
  const al = a[4] + (b[4] - a[4]) * f;
  const q = Math.floor(al * 4 + th) / 4;
  return q > 0 ? [s[1], s[2], s[3], Math.min(1, q)] : null;
}

/**
 * Draw a dithered radial wash into a 2D context at `cell` px per art pixel.
 * (cx, cy) is the centre, rx/ry the radii at which t = 1.
 */
export function ditherRadial(g: CanvasRenderingContext2D, w: number, h: number, cx: number, cy: number, rx: number, ry: number, stops: Stop[], cell = 1) {
  const cw = Math.ceil(w / cell), ch = Math.ceil(h / cell);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const px = (x + 0.5) * cell, py = (y + 0.5) * cell;
    const t = Math.hypot((px - cx) / rx, (py - cy) / ry);
    if (t > 1 && stops[stops.length - 1][4] === 0) continue;
    const c = sample(stops, t, bayer(x, y));
    if (!c) continue;
    g.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${c[3]})`;
    g.fillRect(x * cell, y * cell, cell, cell);
  }
}

/** Quantise an image already drawn in a canvas to coarse steps per channel, with ordered dither (no smooth ramps). */
export function posterize(c: HTMLCanvasElement, step = 10) {
  const g = c.getContext("2d")!, im = g.getImageData(0, 0, c.width, c.height), d = im.data;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const th = bayer(x, y), o = (y * c.width + x) * 4;
    for (let k = 0; k < 3; k++) d[o + k] = Math.min(255, Math.floor(d[o + k] / step + th) * step);
    d[o + 3] = d[o + 3] < 8 ? 0 : Math.min(255, Math.floor(d[o + 3] / 64 + th) * 64);
  }
  g.putImageData(im, 0, 0);
}

const hexRgb = (h: string): [number, number, number] => { const n = parseInt(h.replace("#", ""), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
/** shorthand: a stop from a hex colour */
export const st = (t: number, hex: string, a: number): Stop => [t, ...hexRgb(hex), a];

/** radii of a CSS `ellipse farthest-corner` at (cx, cy) in a w×h box */
function farEllipse(w: number, h: number, cx: number, cy: number): [number, number] {
  const rx0 = Math.max(1, Math.min(cx, w - cx)), ry0 = Math.max(1, Math.min(cy, h - cy));
  const dx = Math.max(cx, w - cx), dy = Math.max(cy, h - cy);
  const k = Math.hypot(dx / rx0, dy / ry0);
  return [rx0 * k, ry0 * k];
}

interface Wash { name: string; shape: "ellipse" | "circle"; at: [number, number]; stops: Stop[]; size?: number }

// the stylesheet's full-screen washes, as dithered versions of the radial gradients they replace
const WASHES: Wash[] = [
  // Black Hole night: darkens toward the edges, an ember ring between
  { name: "--fx-vignette", shape: "ellipse", at: [0.5, 0.42], stops: [st(0, "#000000", 0), st(0.5, "#000000", 0), st(0.7, "#be4a2f", 0.14), st(1, "#07060f", 0.75)] },
  // a hit: a ring of light in the band's colour (white here; the stylesheet colours it through a mask)
  { name: "--fx-hit", shape: "circle", at: [0.5, 0.42], stops: [st(0, "#ffffff", 0), st(0.18, "#ffffff", 0), st(0.6, "#ffffff", 0.4), st(1, "#ffffff", 0.75)] },
  // the Singularity: everything but the eyepiece falls into black
  { name: "--fx-sing", shape: "ellipse", at: [0.5, 0.42], stops: [st(0, "#281446", 0), st(0.3, "#281446", 0.1), st(0.7, "#05030c", 0.92), st(1, "#000000", 1)] },
  // a Black Hole named: the sky flares amber and violet
  { name: "--fx-bh", shape: "ellipse", at: [0.5, 0.45], stops: [st(0, "#feae34", 0), st(0.18, "#feae34", 0), st(0.45, "#feae34", 0.28), st(0.75, "#8c3cc8", 0.32), st(1, "#280a3c", 0.5)] },
  // the Singularity caught: a white core rolling out into violet
  { name: "--fx-catch", shape: "circle", at: [0.5, 0.45], stops: [st(0, "#ffffff", 1), st(0.1, "#ffffff", 0.9), st(0.28, "#d9c2ff", 0.55), st(0.5, "#783cdc", 0.35), st(0.75, "#140828", 0)] },
  // the little haze behind a picture in the universe card (fixed size)
  { name: "--fx-pic", shape: "circle", at: [0.5, 0.5], size: 170, stops: [st(0, "#503c82", 0.35), st(0.7, "#503c82", 0)] },
];

const urls = new Map<string, string>();

function buildWash(wa: Wash, W: number, H: number, cell: number): Promise<void> {
  const w = wa.size ?? W, h = wa.size ?? H;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  const cx = w * wa.at[0], cy = h * wa.at[1];
  let rx: number, ry: number;
  if (wa.size) rx = ry = w / 2;
  else if (wa.shape === "circle") rx = ry = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
  else [rx, ry] = farEllipse(w, h, cx, cy);
  ditherRadial(g, w, h, cx, cy, rx, ry, wa.stops, cell);
  return new Promise((res) => c.toBlob((b) => {
    if (b) {
      const u = URL.createObjectURL(b), old = urls.get(wa.name);
      urls.set(wa.name, u);
      document.documentElement.style.setProperty(wa.name, `url("${u}")`);
      if (old) setTimeout(() => URL.revokeObjectURL(old), 2000);
    }
    res();
  }));
}

/** Build the dithered washes now and again whenever the window changes size. */
export function initPixelFx(cell = 4) {
  let W = 0, H = 0, timer = 0;
  const build = () => {
    const w = window.innerWidth, h = window.innerHeight;
    if (w === W && h === H) return;
    const first = !W;
    W = w; H = h;
    // the fixed-size one only needs building once
    for (const wa of WASHES) if (!wa.size || first) void buildWash(wa, w, h, wa.size ? 2 : cell);
  };
  // idle, so the first frame of the game isn't held up
  const idle = (window as unknown as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 50));
  idle(build);
  window.addEventListener("resize", () => { clearTimeout(timer); timer = window.setTimeout(build, 250); });
}

const spriteCache = new Map<string, HTMLCanvasElement>();
/** a dithered glow sprite, r art pixels in radius, cached */
function glowSprite(r: number, stops: Stop[]): HTMLCanvasElement {
  const key = r + ":" + stops.join("|");
  let c = spriteCache.get(key);
  if (c) return c;
  if (spriteCache.size > 200) spriteCache.clear();
  c = document.createElement("canvas");
  c.width = c.height = r * 2;
  ditherRadial(c.getContext("2d")!, r * 2, r * 2, r, r, r, r, stops, 1);
  spriteCache.set(key, c);
  return c;
}

/**
 * Draw a dithered round glow of radius R (in the context's own units) centred on (cx, cy),
 * with art pixels `cell` units across. Replaces a createRadialGradient fill.
 */
export function drawGlow(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, stops: Stop[], cell = 2) {
  const r = Math.max(2, Math.ceil(R / cell)), spr = glowSprite(r, stops), s = r * cell;
  const was = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = false;
  g.drawImage(spr, Math.round((cx - s) / cell) * cell, Math.round((cy - s) / cell) * cell, s * 2, s * 2);
  g.imageSmoothingEnabled = was;
}

/** Fill the rows y0..y1 (between x0 and x1) with a vertical ramp from colour a to b, in four dithered steps. */
export function ditherV(g: CanvasRenderingContext2D, x0: number, x1: number, y0: number, y1: number, a: string, b: string) {
  const A = hexRgb(a), B = hexRgb(b), steps = 4;
  const col = (k: number) => `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * (k / steps))).join(",")})`;
  const cols = Array.from({ length: steps + 1 }, (_, k) => col(k));
  const h = Math.max(1, y1 - y0);
  for (let y = Math.floor(y0); y < y1; y++) for (let x = Math.floor(x0); x < x1; x++) {
    const f = ((y - y0) / h) * steps, k = Math.min(steps, Math.floor(f + bayer(x, y)));
    g.fillStyle = cols[k]; g.fillRect(x, y, 1, 1);
  }
}
