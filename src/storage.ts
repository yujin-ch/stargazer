export type Outcome = "named" | "zoomed" | "skipped";
export interface ItemResult {
  id: string; outcome: Outcome; typed: string; points: number;
  /** Seconds into the run (on the clock, skips included) when it was answered or skipped. */
  t?: number;
}
export interface RunResult {
  puzzle: number;
  date: string;
  score: number;
  named: number;
  zoomed: number;
  skipped: number;
  items: ItemResult[];
  device: "keyboard" | "touch";
  /** Streak tier the run was played at. */
  tier?: number;
  /** Set while a daily run is still going (saved after every object). */
  partial?: boolean;
  /** Mystery link nights: the one guess at what connected the sky, and whether it was right. */
  link?: { guess: string; ok: boolean; bonus: number };
  /** Points for seconds left when the whole sky was named. */
  clearedBonus?: number;
  /** Longest run of answers without a skip. */
  bestCombo?: number;
}
interface Saved { days: Record<string, RunResult>; /** A friend's score for one night, from a shared link. */ friend?: { date: string; score: number }; muted?: boolean; seenHelp?: boolean; catalogue?: string[]; noHaptics?: boolean; noAmbience?: boolean }

const KEY = "stargazer:v1";

function read(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Saved;
      if (s && typeof s === "object" && s.days && typeof s.days === "object") return s;
    }
  } catch { /* storage blocked */ }
  return { days: {} };
}
function write(s: Saved) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export const store = {
  today(date: string): RunResult | undefined { return read().days[date]; },
  save(r: RunResult) { const s = read(); s.days[r.date] = r; write(s); },
  /** Every object ever named, in any run. */
  catalogue(): Set<string> { return new Set(read().catalogue ?? []); },
  addToCatalogue(ids: string[]): number {
    const s = read();
    const before = new Set(s.catalogue ?? []);
    const fresh = ids.filter((id) => !before.has(id));
    s.catalogue = [...before, ...fresh];
    write(s);
    return fresh.length;
  },
  /** The score a friend shared for this night, if a shared link brought one. */
  friend(date: string): number | null { const f = read().friend; return f && f.date === date ? f.score : null; },
  setFriend(date: string, score: number) { const s = read(); s.friend = { date, score }; write(s); },
  get muted() { return !!read().muted; },
  /** Little vibrations on hits and skips (phones that support it). On unless turned off. */
  get haptics() { return !read().noHaptics; },
  set haptics(on: boolean) { const s = read(); s.noHaptics = !on; write(s); },
  /** Night sounds (wind, crickets) under the game. On unless turned off; silent when muted. */
  get ambience() { return !read().noAmbience; },
  set ambience(on: boolean) { const s = read(); s.noAmbience = !on; write(s); },
  set muted(m: boolean) { const s = read(); s.muted = m; write(s); },
  /** Days in a row played up to and including `puzzle`. */
  streakThrough(puzzle: number): number {
    const have = new Set(Object.values(read().days).map((d) => d.puzzle));
    let n = 0;
    while (have.has(puzzle - n)) n++;
    return n;
  },
  bestBefore(date: string): number {
    return Object.values(read().days).filter((d) => d.date !== date).reduce((m, d) => Math.max(m, d.score), 0);
  },
  stats(today: number) {
    const days = Object.values(read().days);
    const best = days.reduce((m, d) => Math.max(m, d.score), 0);
    const streak = this.streakThrough(today) || this.streakThrough(today - 1);
    return { played: days.length, best, streak };
  },
};
