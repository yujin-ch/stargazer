import data from "./data/objects.json";
import type { BandIndex } from "./config";

export interface SkyObject {
  id: string;
  sprite: number;
  theme: string;
  band: BandIndex;
  names: string[];
}

export const SPRITE_SIZE: number = data.spriteSize;
export const SPRITE_COLS: number = data.cols;
export const OBJECTS: SkyObject[] = data.objects.map((o) => ({
  ...o,
  band: (o.band - 1) as BandIndex,
}));
export const BY_ID = new Map(OBJECTS.map((o) => [o.id, o]));
