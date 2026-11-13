import { CONFIG } from "./config";
import { mulberry32 } from "./daily";
import type { SkyObject } from "./library";

/**
 * "Everyone else", until real scores are collected: a crowd of simulated players runs tonight's
 * exact sky. Each has their own eye (how much they recognise) and speed (how fast they read and type),
 * spread the way a real crowd is: most middling, a few very quick, a few slow. Swap crowdScores for
 * real score data once there is a server.
 */
export const CROWD_IS_SIMULATED = true;

/** How sure a typical player is to know an object in each band, and how long they look before typing. */
const KNOW = [0.97, 0.86, 0.66, 0.5];
const LOOK = [1.1, 1.8, 2.6, 3.2];

function gauss(rand: () => number) {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

/** Score one simulated player against a sky. */
function play(sky: SkyObject[], eye: number, speed: number, rand: () => number): number {
  let t = 0, score = 0, combo = 0;
  for (const o of sky) {
    const band = CONFIG.bands[o.band];
    const know = Math.min(0.995, 1 - (1 - KNOW[o.band]) / eye);
    const look = (LOOK[o.band] / speed) * (0.7 + rand() * 0.6);
    if (rand() < know) {
      const type = (0.35 + o.names[0].length * 0.16) / speed;
      const at = look + type;
      if (t + at > CONFIG.runSeconds) break;
      t += at;
      combo++;
      const extra = CONFIG.combo.reduce((e, c) => (combo >= c.at ? c.extra : e), 0);
      score += (band.pullBack > 0 && at < band.pullBack ? band.zoomedPoints : band.points) + extra;
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
export function crowdScores(sky: SkyObject[], seed: number, n = 400): number[] {
  const rand = mulberry32(seed * 2654435761 + 97);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const eye = Math.exp(gauss(rand) * 0.45);
    const speed = Math.exp(gauss(rand) * 0.3);
    out.push(play(sky, eye, speed, rand));
  }
  return out.sort((a, b) => a - b);
}

/** Share of the crowd you beat, 0..1 (ties count half). */
export function beatShare(scores: number[], mine: number): number {
  let below = 0, tie = 0;
  for (const s of scores) { if (s < mine) below++; else if (s === mine) tie++; }
  return (below + tie / 2) / scores.length;
}
