export type Outcome = "named" | "zoomed" | "skipped";
export interface ItemResult { id: string; outcome: Outcome; typed: string; points: number }
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
  /** Longest run of answers without a skip. */
  bestCombo?: number;
}
interface Saved { days: Record<string, RunResult>; muted?: boolean; seenHelp?: boolean; catalogue?: string[] }

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
  get muted() { return !!read().muted; },
  set muted(m: boolean) { const s = read(); s.muted = m; write(s); },
  /** Days in a row played up to and including `puzzle`. */
  streakThrough(puzzle: number): number {
    const have = new Set(Object.values(read().days).map((d) => d.puzzle));
    let n = 0;
    while (have.has(puzzle - n)) n++;
    return n;
  },
  stats(today: number) {
    const days = Object.values(read().days).filter((d) => !d.partial);
    const best = days.reduce((m, d) => Math.max(m, d.score), 0);
    const streak = this.streakThrough(today) || this.streakThrough(today - 1);
    return { played: days.length, best, streak };
  },
};
