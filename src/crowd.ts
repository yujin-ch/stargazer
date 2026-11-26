import { CONFIG, answerPoints, type ConditionId } from "./config";
import { mulberry32 } from "./daily";
import type { SkyObject } from "./library";

/**
 * "Everyone else" is a set bell curve for each night: no scores are collected or stored.
 * A crowd of simulated players runs tonight's exact sky (each with their own eye and speed, spread the way
 * a real crowd is), and the night's curve is the mean and spread of their scores. Same curve for everyone.
 */
export interface Curve { mean: number; sd: number }

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

/** Tonight's bell curve: the mean and spread of the simulated crowd, rounded so it reads cleanly. */
export function dayCurve(sky: SkyObject[], seed: number, condition: ConditionId = "clear"): Curve {
  const s = crowdScores(sky, seed, condition);
  const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / (s.length || 1));
  return { mean: Math.round(mean / 5) * 5, sd: Math.max(10, Math.round(sd / 5) * 5) };
}

/** Normal CDF (Abramowitz-Stegun). */
export function ncdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Share of the night's curve below your score, 0..1. */
export function beatShare(c: Curve, mine: number): number {
  return ncdf((mine - c.mean) / c.sd);
}
