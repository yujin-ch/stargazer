import { CONFIG, answerPoints, type ConditionId } from "./config";
import { mulberry32 } from "./daily";
import type { SkyObject } from "./library";

/**
 * "Everyone else", until real scores are collected: a crowd of simulated players runs tonight's
 * exact sky. Each has their own eye (how much they recognise) and speed (how fast they read and type),
 * spread the way a real crowd is: most middling, a few very quick, a few slow. Swap crowdScores for
 * real score data once there is a server.
 */
export const CROWD_IS_SIMULATED = true;

/** Real scores replace the simulated crowd once this many people have played the same sky. */
export const MIN_LIVE = 20;

function deviceId(): string {
  try {
    let id = localStorage.getItem("stargazer:id");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("stargazer:id", id); }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

/**
 * Tonight's real crowd from /api/scores, as sorted scores (one per player), or null when the server isn't
 * reachable (local dev, offline). Pass your score to add it; each device counts once a night.
 */
export async function liveCrowd(night: number, tier: number, score: number | null): Promise<number[] | null> {
  const sentKey = `stargazer:sent2:${night}`; // "2": the points scale changed on 2026-11-26
  let sent = false;
  try { sent = localStorage.getItem(sentKey) === "1"; } catch { /* storage blocked */ }
  try {
    const r = score !== null && !sent
      ? await fetch("/api/scores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ night, tier, score, id: deviceId() }) })
      : await fetch(`/api/scores?night=${night}&tier=${tier}`);
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return null;
    if (score !== null && !sent) try { localStorage.setItem(sentKey, "1"); } catch { /* ignore */ }
    const { scores } = (await r.json()) as { scores: Record<string, number> };
    const out: number[] = [];
    for (const [k, n] of Object.entries(scores)) for (let i = 0; i < Math.min(n, 100000); i++) out.push(Number(k));
    return out.sort((a, b) => a - b);
  } catch {
    return null;
  }
}

/** How sure a typical player is to know an object in each band, and how long they look before typing. */
const KNOW = [0.97, 0.86, 0.66, 0.5];
const LOOK = [1.1, 1.8, 2.6, 3.2];

function gauss(rand: () => number) {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

/** How much longer people stare under each sky condition. */
const SLOWER: Record<string, number> = { clear: 1, eclipse: 1.35, keyhole: 1.45, meteor: 1.25 };

/** Score one simulated player against a sky. */
function play(sky: SkyObject[], eye: number, speed: number, rand: () => number, slow: number): number {
  let t = 0, score = 0, combo = 0;
  for (const o of sky) {
    const band = CONFIG.bands[o.band];
    const know = Math.min(0.995, 1 - (1 - KNOW[o.band]) / eye);
    const look = (LOOK[o.band] / speed) * (0.7 + rand() * 0.6) * slow;
    if (rand() < know) {
      const type = (0.35 + o.names[0].length * 0.16) / speed;
      const at = look + type;
      if (t + at > CONFIG.runSeconds) break;
      t += at;
      combo++;
      score += answerPoints(o.band, band.pullBack > 0 && at < band.pullBack, combo);
    } else {
      // stare a while, then skip
      t += look + 1.5 + rand() * 2 + CONFIG.skipCost;
      combo = 0;
      if (t >= CONFIG.runSeconds) break;
    }
  }
  return score;
}

/** Sorted scores for a crowd of n players on this sky (same crowd for everyone on the same night). */
export function crowdScores(sky: SkyObject[], seed: number, condition: ConditionId = "clear", n = 400): number[] {
  const rand = mulberry32(seed * 2654435761 + 97);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const eye = Math.exp(gauss(rand) * 0.45);
    const speed = Math.exp(gauss(rand) * 0.3);
    out.push(play(sky, eye, speed, rand, SLOWER[condition] ?? 1));
  }
  return out.sort((a, b) => a - b);
}

/** Share of the crowd you beat, 0..1 (ties count half). */
export function beatShare(scores: number[], mine: number): number {
  let below = 0, tie = 0;
  for (const s of scores) { if (s < mine) below++; else if (s === mine) tie++; }
  return (below + tie / 2) / scores.length;
}
