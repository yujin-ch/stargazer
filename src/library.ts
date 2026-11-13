import data from "./data/objects.json";
import type { BandIndex } from "./config";

export interface SkyObject {
  id: string;
  sprite: number;
  theme: string;
  band: BandIndex;
  names: string[];
  /** Names that are accepted but not worth showing (slang, rude double meanings). */
  hidden: string[];
}

export const SPRITE_SIZE: number = data.spriteSize;
export const SPRITE_COLS: number = data.cols;
export const OBJECTS: SkyObject[] = data.objects.map((o) => ({
  ...o,
  hidden: o.hidden ?? [],
  band: (o.band - 1) as BandIndex,
}));
/** Names to show players as "also known as". */
export const shownNames = (o: SkyObject) => o.names.slice(1).filter((n) => !o.hidden.includes(n));
export const BY_ID = new Map(OBJECTS.map((o) => [o.id, o]));
