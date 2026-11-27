import { drawGlow, st } from "./pixelfx";
/**
 * The live map in the corner of the eyepiece: tonight's little star system, filling in as you play. Each answer
 * shrinks out of the middle into its orbit (Moons close in, Black Holes at the edge); skips are grey dashes on the rim.
 * The same system appears in Your Universe afterwards.
 */
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const RADII = [0.17, 0.245, 0.315, 0.385, 0.46, 0];
/** The Black Hole orbit stays hidden until you catch one; the Singularity has no orbit, it lands on the star itself. */
const SECRET_FROM = 4;

interface Dot { band: number; a0: number; r: number; born: number; sprite: HTMLCanvasElement | null }

export class MiniMap {
  private dots: Dot[] = [];
  private skips: { a: number; born: number }[] = [];
  private raf = 0;
  private n = [0, 0, 0, 0, 0, 0];
  private level = 0;
  private shownLevel = 0;
  private pulse = -9;
  private quake = -9;
  constructor(private c: HTMLCanvasElement, private colors: readonly string[]) {}

  start() {
    const step = (now: number) => {
      if (!this.c.isConnected) return;
      this.draw(now);
      this.raf = requestAnimationFrame(step);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(step);
  }
  stop() { cancelAnimationFrame(this.raf); }

  add(band: number, sprite: HTMLCanvasElement | null) {
    const k = this.n[band]++;
    this.pulse = performance.now();
    if (band >= 4) this.quake = performance.now();
    this.dots.push({ band, a0: -Math.PI / 2 + k * 2.39996 + band * 0.7, r: RADII[band] ? RADII[band] + ((k % 3) - 1) * 0.018 : 0, born: performance.now(), sprite });
    this.c.parentElement?.classList.remove("ping"); void this.c.offsetWidth; this.c.parentElement?.classList.add("ping");
  }
  /** The adaptive difficulty level (0..3): the orbit the next object will come from glows. */
  setLevel(l: number) { this.level = l; }
  skip() { this.skips.push({ a: -Math.PI / 2 + this.skips.length * 0.55, born: performance.now() }); }

  private draw(now: number) {
    const c = this.c, dpr = Math.min(2, window.devicePixelRatio || 1);
    const S = c.clientWidth;
    if (!S) return;
    if (c.width !== Math.round(S * dpr)) { c.width = c.height = Math.round(S * dpr); }
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    const t = REDUCED ? 0 : now / 1000;
    // a Black Hole find shakes the little system
    const qa = (now - this.quake) / 900, shake = qa < 1 && !REDUCED ? (1 - qa) * S * 0.03 : 0;
    const cx = S / 2 + Math.sin(now * 0.09) * shake, cy = S / 2 + Math.cos(now * 0.11) * shake;
    this.shownLevel += (this.level - this.shownLevel) * 0.08;
    // orbits; the one the next object comes from glows and slowly turns
    RADII.forEach((r, b) => {
      if (!r || (b >= SECRET_FROM && !this.n[b])) return;
      const near = Math.max(0, 1 - Math.abs(this.shownLevel - b));
      g.globalAlpha = 0.14 + near * 0.5; g.strokeStyle = this.colors[b]; g.lineWidth = 1 + near * 1.5;
      if (near > 0.3) g.setLineDash([3, 4]);
      g.lineDashOffset = -t * 8;
      g.beginPath(); g.arc(cx, cy, r * S, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    });
    // tonight's star: brighter as the system fills, flaring on each find
    const pa = (now - this.pulse) / 600, flare = pa < 1 ? (1 - pa) : 0;
    const sr = S * (0.045 + Math.min(0.04, this.dots.length * 0.002)) * (1 + flare * 0.6 + (REDUCED ? 0 : Math.sin(t * 2.2) * 0.06));
    g.globalAlpha = 1;
    drawGlow(g, cx, cy, sr * (4 + flare * 3), [st(0, "#ffecaa", 0.95), st(1, "#ffaa50", 0)], 2);
    g.fillStyle = "#fff6d8"; g.beginPath(); g.arc(cx, cy, sr, 0, Math.PI * 2); g.fill();
    if (qa < 1) {
      g.globalAlpha = (1 - qa) * 0.9; g.strokeStyle = this.colors[4]; g.lineWidth = 2;
      g.beginPath(); g.arc(cx, cy, S * (0.1 + qa * 0.45), 0, Math.PI * 2); g.stroke();
    }
    // skips on the rim
    for (const s of this.skips) {
      const age = (now - s.born) / 400;
      g.globalAlpha = age < 1 ? 1 : 0.6; g.strokeStyle = age < 1 ? "#ff6b6b" : "#7a7290"; g.lineWidth = 2;
      g.beginPath(); g.arc(cx, cy, S * 0.495, s.a - 0.08, s.a + 0.08); g.stroke();
    }
    // finds fly in from the eyepiece (up and to the left) along a little comet trail
    const pos = this.dots.map((d) => {
      const age = (now - d.born) / 800, e = Math.min(1, age), ease = 1 - Math.pow(1 - e, 3);
      const a = d.a0 + (REDUCED ? 0 : (t - d.born / 1000) * (0.35 / (Math.max(d.r, 0.08) * 4)));
      const tx = cx + Math.cos(a) * d.r * S, ty = cy + Math.sin(a) * d.r * S;
      return { d, x: -S * 0.2 + (tx + S * 0.2) * ease, y: -S * 0.2 + (ty + S * 0.2) * ease, ease, age };
    });
    if (pos.length > 1) {
      g.globalAlpha = 0.3; g.strokeStyle = "#f2d38a"; g.lineWidth = 1; g.setLineDash([2, 3]);
      g.beginPath(); pos.filter((p) => p.age >= 1).forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke(); g.setLineDash([]);
    }
    for (const p of pos) {
      const { d } = p;
      if (p.age < 1) {
        const trail = g.createLinearGradient(-S * 0.2, -S * 0.2, p.x, p.y);
        trail.addColorStop(0, "rgba(255,255,255,0)"); trail.addColorStop(1, this.colors[d.band]);
        g.globalAlpha = 0.8 * (1 - p.ease * 0.5); g.strokeStyle = trail; g.lineWidth = 2;
        g.beginPath(); g.moveTo(p.x - (p.x + S * 0.2) * 0.35, p.y - (p.y + S * 0.2) * 0.35); g.lineTo(p.x, p.y); g.stroke();
      }
      // the find's own picture as its icon, in a little band-coloured bubble
      const r = S * [0.05, 0.055, 0.06, 0.065, 0.06, 0.075][d.band] * (p.age < 1.3 ? 1 + Math.max(0, 1.3 - p.age) * 0.9 : 1);
      g.globalAlpha = 1;
      g.fillStyle = d.band >= 4 ? "#05030a" : "rgba(20,14,40,0.9)";
      g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
      if (d.sprite && r > 3) {
        const k = (r * 1.7) / Math.max(d.sprite.width, d.sprite.height);
        g.save(); g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.clip();
        g.imageSmoothingEnabled = d.sprite.width > 60;
        g.drawImage(d.sprite, p.x - (d.sprite.width * k) / 2, p.y - (d.sprite.height * k) / 2, d.sprite.width * k, d.sprite.height * k);
        g.restore();
      }
      g.strokeStyle = this.colors[d.band]; g.lineWidth = d.band >= 4 ? 1.6 : 1.1;
      g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.stroke();
      if (p.age < 1.2) { g.globalAlpha = Math.max(0, 1.2 - p.age) * 0.9; g.strokeStyle = "#fee761"; g.lineWidth = 1; g.beginPath(); g.arc(p.x, p.y, r + 2 + p.age * 8, 0, Math.PI * 2); g.stroke(); }
    }
    g.globalAlpha = 1;
  }
}
