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
}
interface Saved { days: Record<string, RunResult>; muted?: boolean; seenHelp?: boolean }

const KEY = "stargazer:v1";

function read(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Saved;
  } catch { /* storage blocked */ }
  return { days: {} };
}
function write(s: Saved) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export const store = {
  today(date: string): RunResult | undefined { return read().days[date]; },
  save(r: RunResult) { const s = read(); s.days[r.date] = r; write(s); },
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
    const days = Object.values(read().days);
    const best = days.reduce((m, d) => Math.max(m, d.score), 0);
    const streak = this.streakThrough(today) || this.streakThrough(today - 1);
    return { played: days.length, best, streak };
  },
};
