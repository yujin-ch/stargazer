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
  /** Objects per band in the daily sky, in order: clear, distant, deep space. */
  perBand: [10, 15, 15] as const,
  bands: [
    // startZoom: how far in the telescope starts; pullBack: seconds to reach full view;
    // startBlur: how out of focus it starts, in sprite pixels (0 = sharp, max 2.4); points / zoomedPoints.
    { startZoom: 1, pullBack: 0, startBlur: 0, points: 1, zoomedPoints: 1 },
    { startZoom: 2, pullBack: 3, startBlur: 0.6, points: 2, zoomedPoints: 3 },
    { startZoom: 4, pullBack: 4, startBlur: 1.4, points: 3, zoomedPoints: 5 },
  ],
  /** Typo tolerance: one wrong, missing, extra or swapped letter on answers this long or longer. */
  typoMinLength: 6,
  /** When a match is also the start of a longer listed name ("book"/"books"), wait this long before accepting. */
  longerNameWaitMs: 280,
} as const;

export type BandIndex = 0 | 1 | 2;
