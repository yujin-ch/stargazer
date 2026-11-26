import type { RunResult } from "./storage";
import type { Theme } from "./themes/types";
import { themeName, themeInfo, BY_ID } from "./library";
import { dayTheme } from "./daily";

/** How the run sits against tonight's crowd: share of players beaten (0..1), and whether that crowd is real. */
export interface Standing { beat: number; live: boolean; players: number }

/** One glyph per object you met, in order: the band's sky glyph when named, a cloud when skipped. */
const BAND_GLYPH = ["🌕", "🌠", "🌌", "🕳️"] as const;

/** A title for how the night went, from the share of the crowd you out-spotted. */
export function nightTitle(beat: number): string {
  if (beat >= 0.95) return "🏆 Eagle-eyed";
  if (beat >= 0.75) return "🌟 Sharp-eyed";
  if (beat >= 0.45) return "🔭 Keen watcher";
  if (beat >= 0.2) return "🌙 Steady watcher";
  return "☁️ Cloudy night";
}

/**
 * The text a player shares: date and sky, score, the run as a strip of sky glyphs (difficulty of each object named,
 * clouds for skips, so it shows how far and how hard you got without spoiling any answer), a title, and an invite.
 */
export function shareText(r: RunResult, theme: Theme, url: string, standing: Standing | null): string {
  const date = new Date(r.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const themeId = dayTheme(r.puzzle);
  const sky = themeInfo(themeId)?.mystery ? "Mystery link" : themeName(themeId);
  const glyphs = r.items.map((it) => (it.outcome === "skipped" ? "☁️" : BAND_GLYPH[BY_ID.get(it.id)?.band ?? 0]));
  const rows: string[] = [];
  for (let i = 0; i < glyphs.length; i += 10) rows.push(glyphs.slice(i, i + 10).join(""));
  const zooms = r.items.filter((it) => it.outcome === "zoomed").length;
  const facts = [`${r.named} spotted`, ...(zooms ? [`✨${zooms} zoomed`] : []), ...(r.skipped ? [`${r.skipped} clouded`] : [])];
  const title = standing ? `${nightTitle(standing.beat)}${standing.live ? ` · top ${Math.max(1, Math.round((1 - standing.beat) * 100))}% tonight` : ""}` : "";
  return [
    `${theme.shareIcon} ${theme.title} · ${date}`,
    `${sky} · ${r.score} pts`,
    ...rows,
    facts.join(" · "),
    ...(r.link ? [r.link.ok ? "🔗 Found the hidden link" : "🔗 Missed the hidden link"] : []),
    ...(title ? [title] : []),
    "",
    `Can you spot more? ${url}`,
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
