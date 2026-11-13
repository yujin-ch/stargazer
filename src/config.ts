// Every tuning knob in one place. Change numbers here, not in game code.
export const CONFIG = {
  /** Length of a run in seconds. */
  runSeconds: 60,
  /** Seconds taken off the clock by a skip. */
  skipCost: 2,
  /** Countdown before the clock starts. */
  countdownSeconds: 3,
  /** Puzzle #1 is this local date. */
  launchDate: "2026-11-12",
  /**
   * Streak tiers. Your streak going into today picks your tier; everyone in the same tier
   * gets the same sky. perBand = objects from each band, in order: clear, distant, deep space, uncharted.
   */
  tiers: [
    { name: "Stargazer", minStreak: 0, perBand: [10, 15, 15, 0] },
    { name: "Astronomer", minStreak: 3, perBand: [6, 12, 15, 7] },
    { name: "Deep-sky hunter", minStreak: 7, perBand: [3, 9, 14, 14] },
  ],
  bands: [
    // startZoom: how far in the telescope starts; pullBack: seconds to reach full view;
    // startBlur: how out of focus it starts, in sprite pixels (0 = sharp, max 2.4); points / zoomedPoints.
    { startZoom: 1, pullBack: 0, startBlur: 0, points: 1, zoomedPoints: 1 },
    { startZoom: 2, pullBack: 3, startBlur: 0.6, points: 2, zoomedPoints: 3 },
    { startZoom: 3, pullBack: 4, startBlur: 1.1, points: 3, zoomedPoints: 5 },
    { startZoom: 3.5, pullBack: 4.5, startBlur: 1.3, points: 4, zoomedPoints: 6 },
  ],
  /** "Steady hand" combo: answers in a row without a skip. Extra points per answer at each threshold. */
  combo: [
    { at: 3, extra: 1 },
    { at: 6, extra: 2 },
    { at: 10, extra: 3 },
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

export type BandIndex = 0 | 1 | 2 | 3;

/** Tier index for a streak (days in a row played, not counting today). */
export function tierFor(streak: number): number {
  let t = 0;
  CONFIG.tiers.forEach((tier, i) => { if (streak >= tier.minStreak) t = i; });
  return t;
}
