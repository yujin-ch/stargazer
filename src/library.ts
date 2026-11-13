import type { BandIndex } from "./config";
import { parseSheet, renderSprite, toRGBA, SIZE } from "./art/board";

/**
 * Every object comes from a theme file in src/art/themes/<theme>.txt, drawn on the drawing board
 * (src/art/board.ts). One theme is played per day; see dayTheme() in daily.ts.
 */
const SHEETS = import.meta.glob("./art/themes/*.txt", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export interface SkyObject {
  id: string;
  sprite: number;
  theme: string;
  band: BandIndex;
  names: string[];
  /** Names that are accepted but not worth showing (slang, rude double meanings). */
  hidden: string[];
}

/** Display names for theme ids (file names). */
export const THEME_NAMES: Record<string, string> = { animals: "Animals", birds: "Birds", bugs: "Bugs" };

const defs = Object.entries(SHEETS)
  .sort(([a], [b]) => a.localeCompare(b))
  .flatMap(([path, text]) => parseSheet(text, path.match(/([^/]+)\.txt$/)![1]));

export const SPRITE_SIZE = SIZE;
export const SPRITE_COLS = 16;
export const OBJECTS: SkyObject[] = defs.map((d, i) => {
  const names = d.names.map((n) => n.replace(/^~/, ""));
  return {
    id: `${d.theme}:${d.id}`,
    sprite: i,
    theme: d.theme,
    band: (d.band - 1) as BandIndex,
    names,
    hidden: d.names.filter((n) => n.startsWith("~")).map((n) => n.slice(1)),
  };
});
/** Theme ids that have objects, in file order. */
export const THEMES: string[] = [...new Set(OBJECTS.map((o) => o.theme))];
export const themeName = (id: string) => THEME_NAMES[id] ?? id.replace(/^./, (c) => c.toUpperCase());
/** Names to show players as "also known as". */
export const shownNames = (o: SkyObject) => o.names.slice(1).filter((n) => !o.hidden.includes(n));
export const BY_ID = new Map(OBJECTS.map((o) => [o.id, o]));

/** Render every sprite into one atlas canvas (browser only). */
export function buildAtlas(): HTMLCanvasElement {
  const rows = Math.ceil(defs.length / SPRITE_COLS);
  const c = document.createElement("canvas");
  c.width = SPRITE_COLS * SIZE;
  c.height = rows * SIZE;
  const g = c.getContext("2d")!;
  defs.forEach((d, i) => {
    const img = new ImageData(toRGBA(renderSprite(d.src)) as Uint8ClampedArray<ArrayBuffer>, SIZE, SIZE);
    g.putImageData(img, (i % SPRITE_COLS) * SIZE, Math.floor(i / SPRITE_COLS) * SIZE);
  });
  return c;
}
