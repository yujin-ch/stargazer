// Every tuning knob in one place. Change numbers here, not in game code.
/** The public address, from VITE_SITE_URL (see .env): change it there when the custom domain arrives. */
export const SITE_URL: string = (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/$/, "") || (typeof location !== "undefined" ? location.origin : "");
/** A tip page (Ko-fi or similar); empty hides the tip link. */
export const TIP_URL: string = (import.meta.env.VITE_TIP_URL as string | undefined) ?? "";

export const CONFIG = {
  /** Length of a run in seconds. */
  runSeconds: 60,
  /** Seconds taken off the clock by a skip. */
  skipCost: 2,
  /** Seconds added to the clock for each correct answer, by band (moon, planet, nebula, black hole). */
  timeBonus: [1, 1, 2, 3],
  /** Countdown before the clock starts. */
  countdownSeconds: 3,
  /** Themes take turns in this order, one per night (any theme file not listed joins the end). */
  themeOrder: ["animals", "teeth", "birds", "rebus", "bugs", "secret", "photos"],
  /** Puzzle #1 is this local date. */
  launchDate: "2026-11-12",
  /** The first real nightly sky; nights before it were test runs while the game was being built. */
  firstNight: "2026-11-27",
  /**
   * The sky everyone gets (yujin, 11-26: one sky for everyone, no harder streak skies).
   * perBand = objects from each band of the day's theme, in order: clear, distant, deep space, uncharted
   * (a band with fewer objects just gives what it has). Kept as a list so a future mode can add its own.
   */
  tiers: [
    { name: "Stargazer", minStreak: 0, perBand: [3, 8, 12, 6] },
  ],
  /** How fast the hard objects take over after the easy opener: the share of hard picks starts at
   *  rampStart and grows by rampStep per object until every pick is hard (while any are left). */
  rampStart: 0.3,
  rampStep: 0.07,
  /** Adaptive difficulty during a run: how far each outcome moves the level (0 = Moon ... 3 = Black Hole).
   *  The next object comes from the band nearest the level, so a streak climbs fast and a skip drops back fast. */
  adapt: { named: 0.6, zoomed: 0.85, skipped: -1.2 },
  bands: [
    // startZoom: how far in the telescope starts; pullBack: seconds to reach full view;
    // startBlur: how out of focus it starts, in sprite pixels (0 = sharp, max 2.4); points / zoomedPoints.
    // points double with each band, so difficulty always matters most; a zoom answer is worth half again
    { startZoom: 1.6, pullBack: 1.8, startBlur: 0.4, points: 10, zoomedPoints: 15 },
    { startZoom: 2.2, pullBack: 2.4, startBlur: 0.7, points: 20, zoomedPoints: 30 },
    { startZoom: 3, pullBack: 3, startBlur: 1.1, points: 40, zoomedPoints: 60 },
    { startZoom: 3.5, pullBack: 3.3, startBlur: 1.3, points: 80, zoomedPoints: 120 },
  ],
  /**
   * Sky conditions: one per night, the same for everyone, picked by the night number.
   * revealAfter: seconds after the zoom finishes before the condition lifts completely.
   */
  /** Sky conditions are switched off for now (yujin, 11-14): every night is clear and none is shown. */
  conditionsOn: false,
  conditions: [
    { id: "clear", name: "Clear skies", blurb: "Nothing in the way tonight.", revealAfter: 0 },
    { id: "eclipse", name: "Eclipse", blurb: "Only silhouettes, until the light comes back.", revealAfter: 1.5 },
    { id: "keyhole", name: "Keyhole", blurb: "A small window drifts across each one.", revealAfter: 2 },
    { id: "meteor", name: "Meteor shower", blurb: "Each one falls in pieces and pulls itself together.", revealAfter: 0.5 },
  ],
  /** Bonus for guessing a Mystery link night's theme at the end. */
  linkBonus: 100,
  /** Points for each second left when the whole sky is named early. */
  clearedPerSecond: 5,
  /** "Steady hand" combo: answers in a row without a skip multiply each answer's points (so hard finds gain most). */
  combo: [
    { at: 3, mult: 1.1 },
    { at: 6, mult: 1.25 },
    { at: 10, mult: 1.5 },
  ],
  /** Typo tolerance: one wrong, missing, extra or swapped letter on listed names this long or longer
   *  (what you typed may be one letter shorter). */
  typoMinLength: 6,
  /** After a correct answer, keys typed within this window that don't start a name for the new object are dropped. */
  graceMs: 350,
  /** When a match is also the start of a longer listed name ("book"/"books"), wait this long before accepting. */
  longerNameWaitMs: 280,
  /** Same idea for a plain plural ("cake" while "cakes" is also fine): a shorter wait. */
  pluralWaitMs: 170,
} as const;

/** Points for one answer: the band's points (or zoom points), times the steady-hand multiplier for this many in a row. */
export function answerPoints(band: number, zoomed: boolean, inARow: number): number {
  const b = CONFIG.bands[band];
  const mult = CONFIG.combo.reduce((m, c) => (inARow >= c.at ? c.mult : m), 1);
  return Math.round((zoomed ? b.zoomedPoints : b.points) * mult);
}

export type BandIndex = 0 | 1 | 2 | 3;
export type ConditionId = (typeof CONFIG.conditions)[number]["id"];

/** Tier index for a streak (days in a row played, not counting today). */
export function tierFor(streak: number): number {
  let t = 0;
  CONFIG.tiers.forEach((tier, i) => { if (streak >= tier.minStreak) t = i; });
  return t;
}
