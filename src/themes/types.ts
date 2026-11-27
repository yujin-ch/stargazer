/**
 * A theme is everything about the look and sound. Game rules never read from it.
 * To add a theme: copy src/themes/pixel-space, change it, and point src/themes/index.ts at it.
 */
export interface FrameState {
  /** Under ten seconds left. */
  alert: boolean;
  /** 0..1 strength of a flash when something is named (strongest for a zoom answer). */
  flash: number;
  /** Turn of the focus ring, in radians: it twists as each object is brought into focus. */
  focus: number;
  /** A ring of light spreading from the centre after a hit: 0..1 progress, or -1 for none. */
  ripple: number;
  /** Colour of that ring. */
  rippleColor: string;
}

export interface Theme {
  id: string;
  /** Game name shown on screens and in the share text. */
  title: string;
  tagline: string;
  /** Names for the five difficulty bands. */
  bandNames: readonly [string, string, string, string, string];
  /** One colour per band, used for labels, results and the star chart. */
  bandColors: readonly [string, string, string, string, string];
  /** Emoji shown at the top of the share text. */
  shareIcon: string;
  /** Logical resolution of the viewer canvas (square); it is scaled up with crisp pixels. */
  viewSize: number;
  /** How many logical pixels one sprite pixel takes at full view. */
  spriteScale: number;
  /** Paint the viewer background (inside the frame). */
  drawBackdrop(ctx: CanvasRenderingContext2D, timeMs: number): void;
  /** Paint the frame on top of everything and mask outside it. */
  drawFrame(ctx: CanvasRenderingContext2D, timeMs: number, state: FrameState): void;
  /** Animated page background, called once with a full-screen canvas. */
  startPageBackground(canvas: HTMLCanvasElement): void;
  sounds: {
    /** combo = answers in a row, so the sound can climb. */
    correct(bonus: boolean, combo: number, band?: number): void;
    comboBreak(): void;
    /** A Black Hole object just appeared. */
    blackHole?(): void;
    /** A new personal best. */
    best(): void;
    skip(): void;
    tick(): void;
    end(): void;
    start(): void;
  };
  /** Colours for particles when an object is named. */
  sparkColors: readonly string[];
  credits: string;
}
