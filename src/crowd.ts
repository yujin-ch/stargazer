import { CONFIG, answerPoints, type ConditionId } from "./config";
import { mulberry32 } from "./daily";
import type { SkyObject } from "./library";

/**
 * "Everyone else" is a set bell curve for each night: no scores are collected or stored.
 * A crowd of simulated players runs tonight's exact sky (each with their own eye and speed, spread the way
 * a real crowd is), and the night's curve is the mean and spread of their scores. Same curve for everyone.
 */
export interface Curve {
  mean: number; sd: number;
  /** The crowd's score at each percentile, 0..100: scores bunch low with a long tail, so ranks come from these. */
  q?: number[];
  /** Share of the simulated crowd that met / caught the Singularity tonight. */
  singMet?: number; singCaught?: number;
}

/**
 * How sure a typical player is to know an object in each band, and how long they look before typing (seconds).
 * Set conservatively: a first-time player half-sees blurry, zoomed-in pictures, hesitates, and mistypes.
 */
const KNOW = [0.93, 0.8, 0.68, 0.52, 0.36, 0.2];
const LOOK = [1.5, 2.2, 2.6, 3.0, 3.5, 4];

function gauss(rand: () => number) {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

/** How much longer people stare under each sky condition. */
const SLOWER: Record<string, number> = { clear: 1, eclipse: 1.35, keyhole: 1.45, meteor: 1.25 };

/** Score one simulated player against a sky, with the same adaptive order the game uses. */
function play(sky: SkyObject[], eye: number, speed: number, rand: () => number, slow: number): number {
  let t = 0, score = 0, combo = 0, level = 0;
  const left = sky.filter((x) => x.band !== 5), secret = sky.filter((x) => x.band === 5);
  let bhNamed = 0, rises: SkyObject | undefined;
  let o: SkyObject | undefined = left.shift();
  while (o) {
    const band = CONFIG.bands[o.band];
    const know = Math.min(0.98, 1 - (1 - KNOW[o.band]) / eye);
    const look = (LOOK[o.band] / speed) * (0.7 + rand() * 0.7) * slow;
    let delta: number;
    if (rand() < know) {
      // typing, plus the odd typo to fix
      const type = (0.6 + o.names[0].length * 0.2) / speed + (rand() < 0.25 ? 1.2 : 0);
      const at = look + type;
      if (t + at > CONFIG.runSeconds) break;
      t += at;
      combo++;
      const zoomed = band.pullBack > 0 && at < band.pullBack;
      score += answerPoints(o.band, zoomed, combo);
      if (o.band === 5) tally.caught++;
      delta = zoomed ? CONFIG.adapt.zoomed : CONFIG.adapt.named;
      if (o.band === 4 && ++bhNamed === CONFIG.singularityAfter) rises = secret.shift();
    } else {
      // stare a while, try a wrong guess or two, then skip
      t += look + 2.5 + rand() * 3 + CONFIG.skipCost;
      combo = 0;
      if (t >= CONFIG.runSeconds) break;
      delta = CONFIG.adapt.skipped;
    }
    level = Math.max(0, Math.min(4, level + delta));
    const want = Math.round(level);
    let bi = -1, bd = 9;
    if (rises) { o = rises; rises = undefined; tally.met++; continue; }
    left.forEach((x, j) => { const d = Math.abs(x.band - want); if (d < bd) { bd = d; bi = j; } });
    o = bi >= 0 ? left.splice(bi, 1)[0] : undefined;
  }
  return score;
}

/** How many of the last simulated crowd met and caught the night's Singularity. */
const tally = { met: 0, caught: 0, n: 1 };

/** Sorted scores for a crowd of n players on this sky (same crowd for everyone on the same night). */
export function crowdScores(sky: SkyObject[], seed: number, condition: ConditionId = "clear", n = 400): number[] {
  tally.met = tally.caught = 0; tally.n = n;
  const rand = mulberry32(seed * 2654435761 + 97);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const eye = Math.exp(gauss(rand) * 0.4 - 0.1);
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
  const q = Array.from({ length: 101 }, (_, i) => s[Math.min(s.length - 1, Math.round((i / 100) * (s.length - 1)))] ?? 0);
  return { mean: Math.round(mean / 5) * 5, sd: Math.max(10, Math.round(sd / 5) * 5), q, singMet: tally.met / tally.n, singCaught: tally.caught / tally.n };
}

/** Normal CDF (Abramowitz-Stegun). */
export function ncdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Share of the night's curve below your score, 0..1. */
export function beatShare(c: Curve, mine: number): number {
  if (c.q?.length) {
    // where you'd stand in tonight's simulated crowd (interpolated between percentiles)
    const q = c.q;
    if (mine <= q[0]) return 0;
    if (mine >= q[100]) return 0.995;
    let i = 0;
    while (i < 99 && q[i + 1] <= mine) i++;
    const span = q[i + 1] - q[i];
    return Math.min(0.995, (i + (span > 0 ? (mine - q[i]) / span : 0)) / 100);
  }
  return ncdf((mine - c.mean) / c.sd);
}
