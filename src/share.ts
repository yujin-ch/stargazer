import type { RunResult } from "./storage";
import type { Theme } from "./themes/types";
import { CONFIG } from "./config";
import { themeName } from "./library";
import { dayTheme, dayCondition } from "./daily";

export function shareText(r: RunResult, theme: Theme, url: string): string {
  const sym = { named: "🔵", zoomed: "✨", skipped: "▪️" } as const;
  const marks = r.items.map((i) => sym[i.outcome]);
  const rows: string[] = [];
  for (let i = 0; i < marks.length; i += 10) rows.push(marks.slice(i, i + 10).join(""));
  const device = r.device === "touch" ? "📱" : "⌨️";
  return [
    `${theme.shareIcon} ${theme.title} Night #${r.puzzle} · ${themeName(dayTheme(r.puzzle))} · ${dayCondition(r.puzzle).name} · ${r.score} pts${r.tier ? ` · ${CONFIG.tiers[r.tier].name} sky` : ""}`,
    `${r.named} named · ${r.skipped} skipped${(r.bestCombo ?? 0) >= CONFIG.combo[0].at ? ` · steady hand ${r.bestCombo}` : ""} ${device}`,
    ...rows,
    url,
  ].join("\n");
}

export async function share(text: string): Promise<"shared" | "copied" | "failed"> {
  const touch = window.matchMedia("(pointer: coarse)").matches;
  if (touch && navigator.share) {
    try { await navigator.share({ text }); return "shared"; } catch (e) { if ((e as Error).name === "AbortError") return "shared"; /* they closed the sheet: say nothing */ }
  }
  try { await navigator.clipboard.writeText(text); return "copied"; } catch { /* fall through */ }
  const ta = document.createElement("textarea");
  ta.value = text; document.body.appendChild(ta); ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  return ok ? "copied" : "failed";
}
