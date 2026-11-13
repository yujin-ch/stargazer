/**
 * The drawing board: every sprite in the game is a short list of shapes in this little language,
 * rendered on the same 32x32 grid with the same palette, shading and outline. That keeps the
 * whole set in one consistent pixel style, and makes new sprites quick to add or fix.
 *
 *   e cx cy rx ry COLOR        filled ellipse
 *   c cx cy r COLOR            filled circle
 *   r x y w h COLOR            filled rectangle
 *   p COLOR x,y x,y x,y ...    filled polygon
 *   l COLOR x,y x,y [w]        line, w pixels thick (default 1)
 *   d COLOR x,y x,y ...        single pixels (eyes, spots, highlights)
 *
 * COLOR is a palette name. "brown" draws the base shade with automatic light top-left and dark
 * bottom-right rims; "brown.l", "brown.d" and "brown!" draw that exact shade flat, with no shading.
 * Lines and dots are always flat. Later shapes draw over earlier ones. A dark outline goes round
 * the whole silhouette at the end. Keep shapes inside 1..30 so the outline fits.
 */

export const SIZE = 32;

export const PALETTE: Record<string, [string, string, string]> = {
  // name: [light, base, dark]
  brown: ["#c28569", "#8a5a3b", "#5a3a28"],
  tan: ["#ead4aa", "#d9a066", "#b86f50"],
  cream: ["#fff7e0", "#ead4aa", "#c9a77c"],
  orange: ["#feae34", "#f77622", "#be4a2f"],
  yellow: ["#fff4a3", "#fee761", "#feae34"],
  red: ["#f6757a", "#e43b44", "#a22633"],
  pink: ["#ffc2cc", "#f6a0b0", "#d16d8a"],
  magenta: ["#e07ab8", "#b55088", "#7a2f5e"],
  green: ["#8fde5d", "#3e8948", "#265c42"],
  lime: ["#d4f07a", "#9bd34a", "#5a9a35"],
  teal: ["#7fefe0", "#2ab5a8", "#16707a"],
  blue: ["#7cc6f5", "#2f8fd8", "#1d5a9e"],
  sky: ["#c8eeff", "#8fd3ff", "#4fa6e0"],
  navy: ["#4a5a9a", "#2c3a73", "#1b2450"],
  purple: ["#a884d8", "#7a52b3", "#4f3380"],
  grey: ["#dbe2ee", "#a6b3c8", "#6e7d99"],
  slate: ["#8b9bb4", "#5a6988", "#3a4466"],
  black: ["#4a4f6a", "#2a2d42", "#181425"],
  white: ["#ffffff", "#f2f0fa", "#c8cde0"],
  gold: ["#ffe9a3", "#f2c14e", "#c48a2c"],
  skin: ["#ffd9c2", "#f2b28c", "#c98060"],
};
export const OUTLINE = "#181425";

type Px = string | null;

function hexToRgb(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function resolve(color: string): { base: string; light?: string; dark?: string } {
  const m = color.match(/^([a-z]+)(\.l|\.d|!)?$/);
  if (!m || !PALETTE[m[1]]) throw new Error(`unknown colour "${color}"`);
  const [l, b, d] = PALETTE[m[1]];
  if (m[2] === ".l") return { base: l };
  if (m[2] === ".d") return { base: d };
  if (m[2] === "!") return { base: b };
  return { base: b, light: l, dark: d };
}

/** Render one sprite's source to a 32x32 grid of hex colours (null = transparent). */
export function renderSprite(src: string): Px[] {
  const g: Px[] = new Array(SIZE * SIZE).fill(null);
  const lines = src.split("\n").map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean);
  for (const line of lines) {
    const [op, ...rest] = line.split(/\s+/);
    const mask = new Uint8Array(SIZE * SIZE);
    const set = (x: number, y: number) => {
      x = Math.round(x); y = Math.round(y);
      if (x >= 0 && y >= 0 && x < SIZE && y < SIZE) mask[y * SIZE + x] = 1;
    };
    let color: string;
    let flat = false;
    if (op === "e" || op === "c") {
      const [cx, cy, rx, ry0] = rest.slice(0, op === "e" ? 4 : 3).map(Number);
      const ry = op === "e" ? ry0 : rx;
      color = rest[op === "e" ? 4 : 3];
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        const dx = (x + 0.5 - cx) / (rx + 0.01), dy = (y + 0.5 - cy) / (ry + 0.01);
        if (dx * dx + dy * dy <= 1) mask[y * SIZE + x] = 1;
      }
    } else if (op === "r") {
      const [x0, y0, w, h] = rest.slice(0, 4).map(Number);
      color = rest[4];
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y);
    } else if (op === "p") {
      color = rest[0];
      const pts = rest.slice(1).map((s) => s.split(",").map(Number));
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        if (inPoly(x + 0.5, y + 0.5, pts)) mask[y * SIZE + x] = 1;
      }
      // make thin polygons still show up: also plot the edges
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
        plotLine(ax, ay, bx, by, 1, set);
      }
    } else if (op === "l") {
      color = rest[0];
      const pts = rest.slice(1).filter((s) => s.includes(",")).map((s) => s.split(",").map(Number));
      const w = rest.length > 1 && !rest[rest.length - 1].includes(",") ? Number(rest[rest.length - 1]) : 1;
      for (let i = 0; i + 1 < pts.length; i++) plotLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w, set);
      flat = true;
    } else if (op === "d") {
      color = rest[0];
      for (const s of rest.slice(1)) { const [x, y] = s.split(",").map(Number); set(x, y); }
      flat = true;
    } else throw new Error(`unknown shape "${op}" in: ${line}`);

    const c = resolve(color);
    let area = 0;
    for (let i = 0; i < mask.length; i++) area += mask[i];
    const shade = !flat && c.light && c.dark && area >= 12;
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      if (!mask[i]) continue;
      let col = c.base;
      if (shade) {
        const at = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < SIZE && yy < SIZE && mask[yy * SIZE + xx];
        if (!at(x + 1, y) || !at(x, y + 1)) col = c.dark!;
        else if (!at(x - 1, y) || !at(x, y - 1)) col = c.light!;
      }
      g[i] = col;
    }
  }
  // outline round the silhouette
  const out = g.slice();
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (g[y * SIZE + x]) continue;
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const xx = x + dx, yy = y + dy;
      return xx >= 0 && yy >= 0 && xx < SIZE && yy < SIZE && g[yy * SIZE + xx];
    });
    if (near) out[y * SIZE + x] = OUTLINE;
  }
  return out;
}

function inPoly(x: number, y: number, pts: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function plotLine(x0: number, y0: number, x1: number, y1: number, w: number, set: (x: number, y: number) => void) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  const r = (w - 1) / 2;
  for (let k = 0; k <= n; k++) {
    const x = x0 + ((x1 - x0) * k) / n, y = y0 + ((y1 - y0) * k) / n;
    for (let oy = -Math.floor(r); oy <= Math.ceil(r); oy++) for (let ox = -Math.floor(r); ox <= Math.ceil(r); ox++) set(x + ox, y + oy);
  }
}

/** Render to RGBA bytes. */
export function toRGBA(px: Px[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(SIZE * SIZE * 4);
  px.forEach((h, i) => {
    if (!h) return;
    const [r, g, b] = hexToRgb(h);
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = 255;
  });
  return out;
}

export interface SpriteDef { id: string; theme: string; band: number; names: string[]; src: string }

/**
 * Parse a theme file:
 *   @fox | 1 | fox, red fox, vixen
 *   e 16 20 9 6 orange
 *   ...
 */
export function parseSheet(text: string, theme: string): SpriteDef[] {
  const defs: SpriteDef[] = [];
  let cur: SpriteDef | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("@")) {
      const [id, band, names] = line.slice(1).split("|").map((s) => s.trim());
      cur = { id, theme, band: Number(band), names: names.split(",").map((s) => s.trim()).filter(Boolean), src: "" };
      defs.push(cur);
    } else if (cur && line.trim() && !line.trim().startsWith("//")) cur.src += line + "\n";
  }
  return defs;
}
