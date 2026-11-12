import type { RunResult } from "./storage";
import type { Theme } from "./themes/types";

export function shareText(r: RunResult, theme: Theme, url: string): string {
  const sym = { named: "🟦", zoomed: "⭐", skipped: "⬛" } as const;
  const marks = r.items.map((i) => sym[i.outcome]);
  const rows: string[] = [];
  for (let i = 0; i < marks.length; i += 10) rows.push(marks.slice(i, i + 10).join(""));
  const device = r.device === "touch" ? "📱" : "⌨️";
  return [
    `${theme.title} #${r.puzzle} ${theme.shareIcon}`,
    `${r.score} pts · ${r.named} named · ${r.skipped} skipped ${device}`,
    ...rows,
    url,
  ].join("\n");
}

export async function share(text: string): Promise<"shared" | "copied" | "failed"> {
  const touch = window.matchMedia("(pointer: coarse)").matches;
  if (touch && navigator.share) {
    try { await navigator.share({ text }); return "shared"; } catch (e) { if ((e as Error).name === "AbortError") return "failed"; }
  }
  try { await navigator.clipboard.writeText(text); return "copied"; } catch { /* fall through */ }
  const ta = document.createElement("textarea");
  ta.value = text; document.body.appendChild(ta); ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  return ok ? "copied" : "failed";
}
