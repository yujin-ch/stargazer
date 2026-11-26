/**
 * The picture that goes with a share: 1080 x 1350 (a phone-friendly portrait), drawn on a canvas.
 * It shows the night, the score, your constellation and the strip of difficulties, never an answer.
 */
import type { RunResult } from "./storage";
import type { Theme } from "./themes/types";
import { BY_ID } from "./library";
import { mulberry32 } from "./daily";

export interface CardInput {
  r: RunResult;
  theme: Theme;
  /** Tonight's sky name as shown to players (empty on a plain daily sky; "Mystery link" on a link night). */
  sky: string;
  /** Your run drawn as a constellation, small; it is scaled up crisp. */
  constellation: HTMLCanvasElement;
  /** The title for the night ("Keen watcher"), without its emoji. */
  title: string;
  streak: number;
  /** Address shown at the bottom, without https://. */
  host: string;
}

const W = 1080, H = 1350;

export async function drawShareCard(o: CardInput): Promise<HTMLCanvasElement> {
  try { await Promise.all([document.fonts.load('40px "Press Start 2P"'), document.fonts.load('40px "VT323"')]); } catch { /* fall back */ }
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  // sky: stepped bands from ink to plum, stars, a rosy horizon
  const bands = ["#0e0b1e", "#110c24", "#140e29", "#18102e", "#1c1232", "#221536", "#2a1838", "#34203c"];
  bands.forEach((col, i) => { g.fillStyle = col; g.fillRect(0, (i * H) / bands.length, W, H / bands.length + 1); });
  const rand = mulberry32(o.r.puzzle * 131 + 5);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = ["#6a6488", "#9a93b4", "#d8cfe6", "#2ce8f5", "#fee761"][Math.floor(rand() * 5)];
    const s = rand() < 0.12 ? 6 : 3;
    g.globalAlpha = 0.4 + rand() * 0.6;
    g.fillRect(Math.floor(rand() * W / 3) * 3, Math.floor(rand() * H / 3) * 3, s, s);
  }
  g.globalAlpha = 1;
  const text = (t: string, x: number, y: number, font: string, color: string, shadow = 6) => {
    g.font = font; g.textAlign = "center"; g.textBaseline = "alphabetic";
    g.fillStyle = "#000"; g.fillText(t, x + shadow, y + shadow);
    g.fillStyle = color; g.fillText(t, x, y);
  };
  const date = new Date(o.r.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  text(o.theme.title.toUpperCase(), W / 2, 140, '64px "Press Start 2P"', "#fee761");
  text(o.sky ? `${date} · ${o.sky}` : date, W / 2, 215, '54px "VT323"', "#f3ead8", 3);
  text(String(o.r.score), W / 2, 380, '128px "Press Start 2P"', "#fee761", 8);
  text("POINTS", W / 2, 440, '28px "Press Start 2P"', "#a39bb8", 4);
  // the constellation in a brass frame
  const k = Math.min(840 / o.constellation.width, 520 / o.constellation.height);
  const fw = Math.round(o.constellation.width * k), fh = Math.round(o.constellation.height * k), fx = (W - fw) / 2, fy = 475;
  g.fillStyle = "#3a2410"; g.fillRect(fx - 18, fy - 18, fw + 36, fh + 36);
  g.fillStyle = "#c99a4a"; g.fillRect(fx - 12, fy - 12, fw + 24, fh + 24);
  g.fillStyle = "#f2d38a"; g.fillRect(fx - 12, fy - 12, fw + 24, 6);
  g.fillStyle = "#2a1a0c"; g.fillRect(fx - 4, fy - 4, fw + 8, fh + 8);
  g.drawImage(o.constellation, fx, fy, fw, fh);
  // one square per object: its difficulty colour, dim for a skip
  const items = o.r.items, per = Math.min(15, Math.max(1, items.length)), sz = 42, gap = 10;
  const rows = Math.ceil(items.length / per);
  let y = fy + fh + 56;
  items.forEach((it, i) => {
    const row = Math.floor(i / per), col = i % per, inRow = Math.min(per, items.length - row * per);
    const x = W / 2 - (inRow * (sz + gap) - gap) / 2 + col * (sz + gap), yy = y + row * (sz + gap);
    const band = BY_ID.get(it.id)?.band ?? 0;
    g.fillStyle = "#000"; g.fillRect(x + 5, yy + 5, sz, sz);
    g.fillStyle = it.outcome === "skipped" ? "#3a3350" : o.theme.bandColors[band];
    g.fillRect(x, yy, sz, sz);
    if (it.outcome === "zoomed") { g.fillStyle = "#fee761"; g.fillRect(x + sz / 2 - 6, yy + sz / 2 - 6, 12, 12); }
  });
  y += rows * (sz + gap) + 56;
  text(o.title.toUpperCase() + (o.streak >= 2 ? ` · ${o.streak}-NIGHT STREAK` : ""), W / 2, Math.min(y, H - 130), '30px "Press Start 2P"', "#f2d38a", 4);
  text(o.host, W / 2, H - 50, '44px "VT323"', "#2ce8f5", 3);
  return c;
}

export function cardBlob(c: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((res) => c.toBlob((b) => res(b), "image/png"));
}
