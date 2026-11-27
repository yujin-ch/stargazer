/**
 * Turn a player's photo into the two pictures the telescope needs, in the browser (nothing is uploaded until the sky
 * is sent): a plate strip of 8 tiles of PHOTO_TILE px (the sharp photo, then coarser and coarser stages snapped to the
 * game's palette, like scripts/photos/build_photos.py makes for the nightly skies) and a 448 px sharp photo.
 * Redrawing through a canvas also drops the photo's hidden data (camera, date, GPS location).
 * Community photos keep their own background (yujin, 11-27): the whole square shows in the eyepiece.
 */
import { PALETTE } from "./art/board";
import { PHOTO_TILE, PHOTO_STAGES } from "./library";

/** Pixel sizes of the coarse stages (stage 1..7); stage 0 is the sharp photo. Same as build_photos.py. */
const STAGES = [48, 32, 24, 16, 12, 8, 6];
const HI = 448;

const COLS = [...new Set(Object.values(PALETTE).flat())].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
const lab = (rgb: number[]) => {
  const c = rgb.map((v) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; });
  const x = (c[0] * 0.4124 + c[1] * 0.3576 + c[2] * 0.1805) / 0.9505, y = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722, z = (c[0] * 0.0193 + c[1] * 0.1192 + c[2] * 0.9505) / 1.089;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
};
const COLS_LAB = COLS.map(lab);
const d2 = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** k-means the pixels to k colours, then snap each colour to the nearest palette colour. */
function snap(px: number[][], k: number): number[][] {
  const L = px.map(lab);
  k = Math.min(k, L.length);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cent = Array.from({ length: k }, () => L[Math.floor(rnd() * L.length)].slice());
  const lb = new Array(L.length).fill(0);
  for (let it = 0; it < 12; it++) {
    L.forEach((p, i) => { let b = 0, bd = Infinity; cent.forEach((c, j) => { const d = d2(p, c); if (d < bd) { bd = d; b = j; } }); lb[i] = b; });
    for (let j = 0; j < k; j++) {
      const m = L.filter((_, i) => lb[i] === j);
      if (m.length) cent[j] = [0, 1, 2].map((a) => m.reduce((s, p) => s + p[a], 0) / m.length);
    }
  }
  const pal = cent.map((c) => { let b = 0, bd = Infinity; COLS_LAB.forEach((p, j) => { const d = d2(c, p); if (d < bd) { bd = d; b = j; } }); return COLS[b]; });
  return lb.map((j) => pal[j]);
}

function canvas(w: number, h = w) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }

/** Load a picked file as a bitmap (any format the browser can read). */
export async function loadPhoto(file: File): Promise<ImageBitmap> {
  if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|gif|avif|heic)$/i.test(file.name)) throw new Error("That file isn't a picture.");
  if (file.size > 25e6) throw new Error("That picture is too big (over 25 MB).");
  try { return await createImageBitmap(file); } catch { throw new Error("This browser can't open that picture. Try a JPG or PNG."); }
}

/** The square to use: centred, with an optional pan (-1..1 on the long side) and zoom (1 = the whole short side). */
export interface Crop { pan: number; zoom: number }
export function cropSquare(img: ImageBitmap, crop: Crop = { pan: 0, zoom: 1 }, side = HI): HTMLCanvasElement {
  const s = Math.min(img.width, img.height) / Math.max(1, crop.zoom);
  const wide = img.width >= img.height;
  const slackX = img.width - s, slackY = img.height - s;
  const sx = wide ? (slackX / 2) * (1 + crop.pan) : slackX / 2, sy = wide ? slackY / 2 : (slackY / 2) * (1 + crop.pan);
  const c = canvas(side);
  const g = c.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(img, sx, sy, s, s, 0, 0, side, side);
  return c;
}

/** Shrink step by step (halving), which looks much better than one big jump. */
function shrink(src: HTMLCanvasElement, n: number): HTMLCanvasElement {
  let cur = src;
  while (cur.width / 2 >= n * 1.5) { const h = canvas(Math.round(cur.width / 2)); const g = h.getContext("2d")!; g.imageSmoothingQuality = "high"; g.drawImage(cur, 0, 0, h.width, h.height); cur = h; }
  const out = canvas(n); const g = out.getContext("2d")!; g.imageSmoothingQuality = "high"; g.drawImage(cur, 0, 0, n, n);
  return out;
}

/** The plate strip (PHOTO_STAGES tiles, sharp first) as a canvas. */
export function plateStrip(square: HTMLCanvasElement): HTMLCanvasElement {
  const T = PHOTO_TILE;
  const strip = canvas(T * PHOTO_STAGES, T);
  const g = strip.getContext("2d")!;
  g.imageSmoothingEnabled = true;
  g.drawImage(shrink(square, T), 0, 0);
  STAGES.forEach((n, i) => {
    const small = shrink(square, n);
    const sg = small.getContext("2d")!;
    const id = sg.getImageData(0, 0, n, n);
    const px: number[][] = [];
    for (let p = 0; p < n * n; p++) {
      const r = id.data[p * 4], gg = id.data[p * 4 + 1], b = id.data[p * 4 + 2], m = (r + gg + b) / 3;
      px.push([r, gg, b].map((v) => Math.max(0, Math.min(255, m + (v - m) * 1.2)))); // a touch more colour, as the nightly plates
    }
    const k = n <= 8 ? 5 : n <= 12 ? 8 : n <= 24 ? 12 : 16;
    snap(px, k).forEach((c, p) => { id.data[p * 4] = c[0]; id.data[p * 4 + 1] = c[1]; id.data[p * 4 + 2] = c[2]; id.data[p * 4 + 3] = 255; });
    sg.putImageData(id, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(small, (i + 1) * T, 0, T, T);
  });
  return strip;
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't encode the picture."))), type, q));

/** Both pictures for one object, ready to upload. WebP where the browser can write it (Safari can't: PNG then). */
export async function preparePhoto(img: ImageBitmap, crop: Crop): Promise<{ strip: Blob; hi: Blob; preview: HTMLCanvasElement }> {
  const square = cropSquare(img, crop, HI);
  const strip = plateStrip(square);
  let hi = await toBlob(square, "image/webp", 0.82);
  if (hi.type !== "image/webp") hi = await toBlob(square, "image/png");
  return { strip: await toBlob(strip, "image/png"), hi, preview: strip };
}
