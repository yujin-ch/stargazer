/**
 * The live map in the corner of the eyepiece: tonight's little star system, filling in as you play. Each answer
 * shrinks out of the middle into its orbit (Moons close in, Black Holes at the edge); skips are grey dashes on the rim.
 * The same system appears in Your Universe afterwards.
 */
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const RADII = [0.2, 0.3, 0.38, 0.46];

interface Dot { band: number; a0: number; r: number; born: number; sprite: HTMLCanvasElement | null }

export class MiniMap {
  private dots: Dot[] = [];
  private skips: { a: number; born: number }[] = [];
  private raf = 0;
  private n = [0, 0, 0, 0];
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
    this.dots.push({ band, a0: -Math.PI / 2 + k * 2.39996 + band * 0.7, r: RADII[band] + ((k % 3) - 1) * 0.018, born: performance.now(), sprite });
    this.c.parentElement?.classList.remove("ping"); void this.c.offsetWidth; this.c.parentElement?.classList.add("ping");
  }
  skip() { this.skips.push({ a: -Math.PI / 2 + this.skips.length * 0.55, born: performance.now() }); }

  private draw(now: number) {
    const c = this.c, dpr = Math.min(2, window.devicePixelRatio || 1);
    const S = c.clientWidth;
    if (!S) return;
    if (c.width !== Math.round(S * dpr)) { c.width = c.height = Math.round(S * dpr); }
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    const cx = S / 2, cy = S / 2, t = REDUCED ? 0 : now / 1000;
    // orbits
    g.lineWidth = 1;
    RADII.forEach((r, b) => { g.globalAlpha = 0.16; g.strokeStyle = this.colors[b]; g.beginPath(); g.arc(cx, cy, r * S, 0, Math.PI * 2); g.stroke(); });
    // tonight's star, brighter as the system fills
    const sr = S * (0.045 + Math.min(0.04, this.dots.length * 0.002));
    const glow = g.createRadialGradient(cx, cy, 0, cx, cy, sr * 4);
    glow.addColorStop(0, "rgba(255,236,170,0.9)"); glow.addColorStop(1, "rgba(255,170,80,0)");
    g.globalAlpha = 1; g.fillStyle = glow; g.fillRect(cx - sr * 4, cy - sr * 4, sr * 8, sr * 8);
    g.fillStyle = "#fff6d8"; g.beginPath(); g.arc(cx, cy, sr, 0, Math.PI * 2); g.fill();
    // skips on the rim
    for (const s of this.skips) {
      g.globalAlpha = 0.6; g.strokeStyle = "#7a7290"; g.lineWidth = 2;
      g.beginPath(); g.arc(cx, cy, S * 0.495, s.a - 0.08, s.a + 0.08); g.stroke();
    }
    // the constellation so far
    const pos = this.dots.map((d) => {
      const age = (now - d.born) / 700, e = Math.min(1, age), ease = 1 - Math.pow(1 - e, 3);
      const a = d.a0 + (REDUCED ? 0 : (t - d.born / 1000) * (0.35 / (d.r * 4)));
      return { d, x: cx + Math.cos(a) * d.r * S * ease, y: cy + Math.sin(a) * d.r * S * ease, ease, age };
    });
    if (pos.length > 1) {
      g.globalAlpha = 0.28; g.strokeStyle = "#f2d38a"; g.lineWidth = 1; g.setLineDash([2, 3]);
      g.beginPath(); pos.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke(); g.setLineDash([]);
    }
    for (const p of pos) {
      const { d } = p;
      if (p.age < 1 && d.sprite) {
        // the find itself, shrinking out of the middle into its place
        const sz = S * (0.42 - 0.34 * p.ease), k = sz / Math.max(d.sprite.width, d.sprite.height);
        g.globalAlpha = 1 - p.ease * 0.4;
        g.imageSmoothingEnabled = d.sprite.width > 60;
        g.drawImage(d.sprite, p.x - (d.sprite.width * k) / 2, p.y - (d.sprite.height * k) / 2, d.sprite.width * k, d.sprite.height * k);
      }
      const r = Math.max(1.6, S * [0.022, 0.03, 0.036, 0.03][d.band]) * (p.age < 1.4 ? 1 + Math.max(0, 1.4 - p.age) * 0.8 : 1);
      g.globalAlpha = p.age < 1 ? p.ease : 1;
      if (d.band === 3) { g.fillStyle = "#05030a"; g.strokeStyle = this.colors[3]; g.lineWidth = 1.5; g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill(); g.stroke(); }
      else { g.fillStyle = this.colors[d.band]; g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill(); }
      if (p.age < 1.2) { g.globalAlpha = Math.max(0, 1.2 - p.age) * 0.8; g.strokeStyle = "#fee761"; g.lineWidth = 1; g.beginPath(); g.arc(p.x, p.y, r + 2 + p.age * 8, 0, Math.PI * 2); g.stroke(); }
    }
    g.globalAlpha = 1;
  }
}
