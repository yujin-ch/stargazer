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
  stats() {
    const days = Object.values(read().days).sort((a, b) => a.puzzle - b.puzzle);
    const best = days.reduce((m, d) => Math.max(m, d.score), 0);
    let streak = 0;
    for (let i = days.length - 1, want = days.at(-1)?.puzzle; i >= 0 && days[i].puzzle === want; i--, want!--) streak++;
    return { played: days.length, best, streak };
  },
};
