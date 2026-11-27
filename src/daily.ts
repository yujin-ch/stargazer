import { CONFIG } from "./config";
import { OBJECTS, THEMES, type SkyObject } from "./library";

export function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function shuffled<T>(arr: T[], rand: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function localDateKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Puzzle number for a local date key; #1 is the launch date. */
export function puzzleNumber(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [ly, lm, ld] = CONFIG.launchDate.split("-").map(Number);
  const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ly, lm - 1, ld)) / 86400000);
  return days + 1;
}

/** Tonight's day pack (its own photo set), once loaded. */
const packs = new Map<number, SkyObject[]>();
/** Nights known to have a pack (from days/index.json), with the pack's theme, before the pack itself loads. */
const packThemes = new Map<number, string>();
export function setDayPack(puzzle: number, objs: SkyObject[]): void {
  if (objs.length) packs.set(puzzle, objs);
}
export function notePackNight(puzzle: number, theme: string): void { packThemes.set(puzzle, theme); }

/** The theme everyone plays on a puzzle number: themes take turns, one per day. */
export function dayTheme(puzzle: number): string {
  const p = packs.get(puzzle);
  if (p) return p[0].theme;
  const t = packThemes.get(puzzle);
  if (t) return t;
  return THEMES[(((puzzle - 1) % THEMES.length) + THEMES.length) % THEMES.length];
}

/** Tonight's sky condition (same for everyone). Never the same two nights running. */
const condCache = new Map<number, number>();
export function dayCondition(puzzle: number): (typeof CONFIG.conditions)[number] {
  const list = CONFIG.conditions;
  if (!CONFIG.conditionsOn) return list[0];
  const idx = (n: number): number => {
    if (n < 1) return -1;
    const hit = condCache.get(n);
    if (hit !== undefined) return hit;
    // walk forward from the last cached night so deep nights never recurse far
    let start = n;
    while (start > 1 && !condCache.has(start - 1)) start--;
    let prev = start > 1 ? condCache.get(start - 1)! : -1;
    for (let k = start; k <= n; k++) {
      let c = hash(`stargazer:cond:${k}`) % list.length;
      if (c === prev) c = (c + 1) % list.length;
      condCache.set(k, c);
      prev = c;
    }
    return condCache.get(n)!;
  };
  return list[Math.max(0, idx(puzzle))];
}

/** The objects of one theme. */
export const themePool = (themeId: string) => OBJECTS.filter((o) => o.theme === themeId && !o.id.includes("/")); // day-pack objects ("theme:date/id") only play on their own night

/** How many objects each band gives: picture themes sorted before the Comet band have none, so they keep the old mix. */
function bandCounts(pool: SkyObject[], tier: number): readonly number[] {
  const t = CONFIG.tiers[tier];
  return pool.some((o) => o.band === 2) ? t.perBand : t.perBandNoComets;
}

/**
 * The sky for a puzzle number, drawn from that day's theme. Each band walks through its own shuffled deck, so an
 * object never repeats until every object in that band has been used once.
 */
export function dailySky(puzzle: number, tier = 0, poolArg?: SkyObject[]): SkyObject[] {
  const packObjs = poolArg ? undefined : packs.get(puzzle);
  const fromPack = !!packObjs;
  const pool = poolArg ?? packObjs ?? themePool(dayTheme(puzzle));
  // each theme only comes round every THEMES.length days, so count its own days (a pack is its own first day)
  const day = fromPack ? 0 : Math.floor(Math.max(0, puzzle - 1) / THEMES.length);
  const sky: SkyObject[] = [];
  bandCounts(pool, tier).forEach((k, band) => {
    const items = pool.filter((o) => o.band === band).sort((a, b) => a.id.localeCompare(b.id));
    const L = items.length;
    const decks = new Map<number, SkyObject[]>();
    const deck = (cycle: number) => {
      let d = decks.get(cycle);
      if (!d) { d = shuffled(items, mulberry32(hash(`stargazer:${fromPack ? `pack${puzzle}` : pool[0]?.theme}:t${tier}:${band}:${cycle}`))); decks.set(cycle, d); }
      return d;
    };
    const take = Math.min(k, L);
    const used = new Set<string>();
    // when a day straddles two decks, skip anything the day already has
    for (let pos = day * take; used.size < take; pos++) {
      const o = deck(Math.floor(pos / L))[pos % L];
      if (used.has(o.id)) continue;
      used.add(o.id);
      sky.push(o);
    }
  });
  return ramp(sky);
}

/**
 * Order a sky so it gets hard fast: the easy band opens, then medium and hard objects mix,
 * with the hard share climbing each step (CONFIG.rampStart, rampStep) until it is all hard.
 */
export function ramp(sky: SkyObject[]): SkyObject[] {
  const easy = sky.filter((o) => o.band === 0);
  const mid = sky.filter((o) => o.band === 1);
  // hard picks: Comets first, then Nebula objects with Black Holes sprinkled through, a little denser toward the end
  const comet = sky.filter((o) => o.band === 2), neb = sky.filter((o) => o.band === 3), bh = sky.filter((o) => o.band === 4);
  const hard: SkyObject[] = [];
  // the first hard picks lean on comets, then comets and nebulae alternate until the comets run out
  while (comet.length && (hard.length < 2 || !neb.length)) hard.push(comet.shift()!);
  for (let k = 0; comet.length && neb.length; k++) hard.push(k % 2 ? neb.shift()! : comet.shift()!);
  let acc = 0;
  while (neb.length || bh.length) {
    acc += bh.length / (neb.length + bh.length);
    if (bh.length && (acc >= 0.999 || !neb.length) && hard.length >= 2) { hard.push(bh.shift()!); acc -= 1; }
    else if (neb.length) hard.push(neb.shift()!);
    else hard.push(bh.shift()!);
  }
  const out = easy.slice();
  let want = 0, took = 0;
  for (let step = 0; mid.length || hard.length; step++) {
    want += Math.min(1, CONFIG.rampStart + CONFIG.rampStep * step);
    const pickHard = hard.length && (!mid.length || took + 1 <= want + 0.001);
    if (pickHard) { out.push(hard.shift()!); took++; } else out.push(mid.shift()!);
  }
  return out;
}

/** A random sky for practice runs. */
export function practiceSky(tier = 0, pool: SkyObject[] = themePool(THEMES[Math.floor(Math.random() * THEMES.length)])): SkyObject[] {
  const rand = mulberry32((Math.random() * 2 ** 32) >>> 0);
  return ramp(bandCounts(pool, tier).flatMap((k, band) => shuffled(pool.filter((o) => o.band === band), rand).slice(0, k)));
}
