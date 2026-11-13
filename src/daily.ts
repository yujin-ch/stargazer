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

/** The theme everyone plays on a puzzle number: themes take turns, one per day. */
export function dayTheme(puzzle: number): string {
  return THEMES[(((puzzle - 1) % THEMES.length) + THEMES.length) % THEMES.length];
}

/** The objects of one theme. */
export const themePool = (themeId: string) => OBJECTS.filter((o) => o.theme === themeId);

/**
 * The sky for a puzzle number, drawn from that day's theme. Each band walks through its own shuffled deck, so an
 * object never repeats until every object in that band has been used once.
 */
export function dailySky(puzzle: number, tier = 0, pool: SkyObject[] = themePool(dayTheme(puzzle))): SkyObject[] {
  // each theme only comes round every THEMES.length days, so count its own days
  const day = Math.floor(Math.max(0, puzzle - 1) / THEMES.length);
  const sky: SkyObject[] = [];
  CONFIG.tiers[tier].perBand.forEach((k, band) => {
    const items = pool.filter((o) => o.band === band).sort((a, b) => a.id.localeCompare(b.id));
    const L = items.length;
    const decks = new Map<number, SkyObject[]>();
    const deck = (cycle: number) => {
      let d = decks.get(cycle);
      if (!d) { d = shuffled(items, mulberry32(hash(`stargazer:${pool[0]?.theme}:t${tier}:${band}:${cycle}`))); decks.set(cycle, d); }
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
  return sky;
}

/** A random sky for practice runs. */
export function practiceSky(tier = 0, pool: SkyObject[] = themePool(THEMES[Math.floor(Math.random() * THEMES.length)])): SkyObject[] {
  const rand = mulberry32((Math.random() * 2 ** 32) >>> 0);
  return CONFIG.tiers[tier].perBand.flatMap((k, band) => shuffled(pool.filter((o) => o.band === band), rand).slice(0, k));
}
