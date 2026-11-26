import { CONFIG, type BandIndex } from "./config";
import { parseTheme, renderSprite, toRGBA, SIZE, type SheetMeta, type SpriteDef } from "./art/board";

/**
 * Every picture comes from a file in src/art/themes/<theme>.txt, drawn on the drawing board
 * (src/art/board.ts). A theme can draw its own pictures, reuse pictures from any other file
 * ("= animals:shark"), or build rebus items out of several ("+ library:sun, library:flower").
 * Files marked "% library" only hold pictures for other themes. One theme is played per day.
 */
const SHEETS = import.meta.glob("./art/themes/*.txt", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** Photo plates: one strip per object, 8 tiles of PHOTO_TILE px (final photo, then coarser and coarser). */
const PHOTO_URLS = import.meta.glob("./art/photos/*.png", { query: "?url", import: "default", eager: true }) as Record<string, string>;
export const PHOTO_TILE = 80;
export const PHOTO_STAGES = 8;

export type ItemKind = "single" | "rebus" | "pair" | "photo";

export interface SkyObject {
  id: string;
  /** Unique number for this object (used for seeding and caches). */
  sprite: number;
  theme: string;
  band: BandIndex;
  names: string[];
  /** Names that are accepted but not worth showing (slang, rude double meanings). */
  hidden: string[];
  kind: ItemKind;
  /** The pictures it is made of, as keys into the picture table. */
  parts: string[];
  /** Why it belongs in its theme (shown after the run). */
  note: string;
}

export interface ThemeInfo extends SheetMeta { id: string }

const parsed = Object.entries(SHEETS)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, text]) => parseTheme(text, path.match(/([^/]+)\.txt$/)![1]));

/** Every drawable picture, keyed "theme:id". */
const PICTURES = new Map<string, SpriteDef>();
for (const { defs } of parsed) for (const d of defs) PICTURES.set(`${d.theme}:${d.id}`, d);

function resolve(key: string, seen = new Set<string>()): string {
  const d = PICTURES.get(key);
  if (!d) throw new Error(`unknown picture "${key}"`);
  if (d.use && !d.src.trim()) {
    if (seen.has(key)) throw new Error(`picture loop at "${key}"`);
    seen.add(key);
    return resolve(d.use, seen);
  }
  return key;
}

export const THEME_INFO: ThemeInfo[] = parsed.filter((p) => !p.meta.library).map((p) => ({ id: p.defs[0]?.theme ?? "", ...p.meta }));
const INFO = new Map(THEME_INFO.map((t) => [t.id, t]));

export const SPRITE_SIZE = SIZE;
const photoThemes = new Set(parsed.filter((p) => p.meta.photo).map((p) => p.defs[0]?.theme));
export const OBJECTS: SkyObject[] = parsed
  .filter((p) => !p.meta.library)
  .flatMap((p) => p.defs)
  .map((d, i) => {
    const kind: ItemKind = d.parts ? "rebus" : d.pair ? "pair" : photoThemes.has(d.theme) ? "photo" : "single";
    const parts = (d.parts ?? d.pair ?? [`${d.theme}:${d.id}`]).map((k) => resolve(k));
    return {
      id: `${d.theme}:${d.id}`,
      sprite: i,
      theme: d.theme,
      band: (d.band - 1) as BandIndex,
      names: d.names.map((n) => n.replace(/^~/, "")),
      hidden: d.names.filter((n) => n.startsWith("~")).map((n) => n.slice(1)),
      kind,
      parts,
      note: d.note,
    };
  });
/** Playable theme ids, in file order. */
const playable = THEME_INFO.map((t) => t.id).filter((id) => OBJECTS.some((o) => o.theme === id));
export const THEMES: string[] = [...(CONFIG.themeOrder as readonly string[]).filter((id) => playable.includes(id)), ...playable.filter((id) => !(CONFIG.themeOrder as readonly string[]).includes(id))];
export const themeInfo = (id: string) => INFO.get(id);
export const themeName = (id: string) => INFO.get(id)?.name ?? id.replace(/^./, (c) => c.toUpperCase());
/** What the player sees as tonight's theme during play. */
export const themeLabel = (id: string) => (INFO.get(id)?.mystery ? "???" : themeName(id));
/** Names to show players as "also known as". */
export const shownNames = (o: SkyObject) => o.names.slice(1).filter((n) => !o.hidden.includes(n));
export const BY_ID = new Map(OBJECTS.map((o) => [o.id, o]));

// ---------------------------------------------------------------- day packs

/**
 * A day pack is one night's own photo set, served as static files at days/<YYYY-MM-DD>/:
 * pack.json plus one plate strip per item (<id>.png, same format as src/art/photos).
 * Built by scripts/photos/make_day.py. When tonight has a pack, it replaces the rotating theme.
 */
export interface DayPack {
  date: string;
  theme?: string;
  items: { id: string; band: number; names: string[]; note?: string }[];
}
const PACK_URLS = new Map<string, string>();
const PACK_HI = new Map<string, string>();

/** Dates that have a pack, with their theme (public/days/index.json, written by make_day.py). */
export async function loadPackIndex(): Promise<Record<string, { theme: string }>> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}days/index.json`, { cache: "no-cache" });
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return {};
    return (await r.json()) as Record<string, { theme: string }>;
  } catch {
    return {};
  }
}

/** Fetch and register a date's pack, if there is one. Returns its objects (empty when none). */
export async function loadDayPack(dateKey: string): Promise<SkyObject[]> {
  const base = `${import.meta.env.BASE_URL}days/${dateKey}/`;
  let pack: DayPack;
  try {
    const r = await fetch(`${base}pack.json`, { cache: "no-cache" });
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return [];
    pack = (await r.json()) as DayPack;
  } catch {
    return [];
  }
  const theme = pack.theme && INFO.has(pack.theme) ? pack.theme : "photos";
  const objs: SkyObject[] = pack.items
    .filter((it) => it.id && it.names?.length && it.band >= 1 && it.band <= 4)
    .map((it, i) => {
      const id = `${theme}:${dateKey}/${it.id}`;
      PACK_URLS.set(id, `${base}${it.id}.png`);
      PACK_HI.set(id, `${base}${it.id}.hi.webp`);
      return {
        id, sprite: OBJECTS.length + i, theme, band: (it.band - 1) as BandIndex,
        names: it.names.map((n) => n.replace(/^~/, "")),
        hidden: it.names.filter((n) => n.startsWith("~")).map((n) => n.slice(1)),
        kind: "photo" as const, parts: [id], note: it.note ?? "",
      };
    })
    .map((o) => BY_ID.get(o.id) ?? o);
  const fresh = objs.filter((o) => !BY_ID.has(o.id));
  OBJECTS.push(...fresh);
  for (const o of fresh) BY_ID.set(o.id, o);
  return objs;
}

// ---------------------------------------------------------------- pictures (browser only)

const photoImgs = new Map<string, HTMLImageElement>();
function photoImg(id: string): HTMLImageElement {
  let img = photoImgs.get(id);
  if (!img) {
    const url = PACK_URLS.get(id) ?? PHOTO_URLS[`./art/photos/${id.split(":")[1]}.png`];
    if (!url) throw new Error(`no photo for "${id}"`);
    img = new Image();
    img.src = url;
    photoImgs.set(id, img);
  }
  return img;
}
const hiImgs = new Map<string, HTMLImageElement | null>();
/** The developed photo at high resolution, when the pack has one (loads in the background). */
export function photoHi(o: SkyObject): HTMLImageElement | null {
  if (hiImgs.has(o.id)) return hiImgs.get(o.id)!;
  const url = PACK_HI.get(o.id);
  let img: HTMLImageElement | null = null;
  if (url) {
    img = new Image();
    img.decoding = "async";
    img.onerror = () => hiImgs.set(o.id, null);
    img.src = url;
  }
  hiImgs.set(o.id, img);
  return img;
}

/** Wait until these objects' photo plates are decoded (drawings are always ready). */
export function picturesReady(objs: SkyObject[], hi = true): Promise<void> {
  if (hi) for (const o of objs) if (o.kind === "photo") photoHi(o);
  return Promise.all(objs.filter((o) => o.kind === "photo").map((o) => photoImg(o.id).decode().catch(() => undefined))).then(() => undefined);
}
/** Stage k of a photo plate (0 = the developed photo, 7 = coarsest), as its own canvas. */
export function photoStage(o: SkyObject, k: number): HTMLCanvasElement {
  const key = `${o.id}#${k}`;
  let c = objectCache.get(key);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = PHOTO_TILE;
  const img = photoImg(o.id);
  const draw = () => c!.getContext("2d")!.drawImage(img, k * PHOTO_TILE, 0, PHOTO_TILE, PHOTO_TILE, 0, 0, PHOTO_TILE, PHOTO_TILE);
  if (img.complete && img.naturalWidth) draw(); else img.addEventListener("load", draw, { once: true });
  objectCache.set(key, c);
  return c;
}

const pictureCache = new Map<string, HTMLCanvasElement>();
function picture(key: string): HTMLCanvasElement {
  let c = pictureCache.get(key);
  if (!c) {
    c = document.createElement("canvas");
    c.width = c.height = SIZE;
    const img = new ImageData(toRGBA(renderSprite(PICTURES.get(key)!.src)) as Uint8ClampedArray<ArrayBuffer>, SIZE, SIZE);
    c.getContext("2d")!.putImageData(img, 0, 0);
    pictureCache.set(key, c);
  }
  return c;
}

/** A small pixel "+" for rebus items. */
const PLUS = ["..XXX..", "..XWX..", "XXXWXXX", "XWWWWWX", "XXXWXXX", "..XWX..", "..XXX.."];
const GAP = 9;

const objectCache = new Map<string, HTMLCanvasElement>();
/** The full picture for an object: one sprite, or several side by side (with plus signs for a rebus). */
export function objectImage(o: SkyObject): HTMLCanvasElement {
  if (o.kind === "photo") return photoStage(o, 0);
  let c = objectCache.get(o.id);
  if (c) return c;
  const pics = o.parts.map(picture);
  if (pics.length === 1) { objectCache.set(o.id, pics[0]); return pics[0]; }
  // trim each picture's empty columns so the row stays compact
  const spans = pics.map((p) => {
    const d = p.getContext("2d")!.getImageData(0, 0, SIZE, SIZE).data;
    let l = SIZE, r = -1;
    for (let x = 0; x < SIZE; x++) for (let y = 0; y < SIZE; y++) if (d[(y * SIZE + x) * 4 + 3]) { l = Math.min(l, x); r = Math.max(r, x); }
    return r < 0 ? [0, SIZE - 1] : [l, r];
  });
  const gap = o.kind === "rebus" ? GAP : 4;
  const w = spans.reduce((s, [l, r]) => s + (r - l + 1), 0) + gap * (pics.length - 1);
  c = document.createElement("canvas");
  c.width = w; c.height = SIZE;
  const g = c.getContext("2d")!;
  let x = 0;
  pics.forEach((p, i) => {
    const [l, r] = spans[i];
    g.drawImage(p, l, 0, r - l + 1, SIZE, x, 0, r - l + 1, SIZE);
    x += r - l + 1;
    if (i < pics.length - 1) {
      if (o.kind === "rebus") {
        const ox = x + 1, oy = Math.floor(SIZE / 2) - 3;
        PLUS.forEach((row, yy) => [...row].forEach((ch, xx) => {
          if (ch === ".") return;
          g.fillStyle = ch === "W" ? "#fee761" : "#181425";
          g.fillRect(ox + xx, oy + yy, 1, 1);
        }));
      }
      x += gap;
    }
  });
  objectCache.set(o.id, c);
  return c;
}
