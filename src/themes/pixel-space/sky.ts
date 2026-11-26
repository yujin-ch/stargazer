/**
 * The living sky behind the game: a time-of-day glow on the horizon, drifting nebula, two layers of stars
 * that shift with the pointer (parallax), and the odd shooting star. Drawn at low resolution, upscaled crisp.
 */

const SCALE = 3;

interface Tint { top: string; bottom: string; glow: string; glowA: number }

/** Sky colours by the player's local hour: dusk is rosy, deep night is ink, dawn is amber, daytime is a dreamy blue. */
export function skyTint(hour: number): Tint {
  if (hour >= 17 && hour < 20) return { top: "#110b22", bottom: "#3a1d3a", glow: "#a4503e", glowA: 0.4 };
  if (hour >= 20 || hour < 1) return { top: "#0e0b1e", bottom: "#1e1736", glow: "#5a3a6a", glowA: 0.28 };
  if (hour < 5) return { top: "#090716", bottom: "#141029", glow: "#2c2a5a", glowA: 0.22 };
  if (hour < 8) return { top: "#0f1226", bottom: "#2e2848", glow: "#c0784a", glowA: 0.35 };
  return { top: "#11152e", bottom: "#262a52", glow: "#4a5a9a", glowA: 0.3 };
}

const hex = (h: string) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const mix = (a: number[], b: number[], t: number) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** A dithered nebula cloud, drawn once into its own canvas. */
function nebula(w: number, h: number, seed: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  let s = seed;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const blobs = [
    { col: "#3a1f4a", x: 0.22, y: 0.3, r: 0.32 },
    { col: "#1d2f4a", x: 0.78, y: 0.22, r: 0.26 },
    { col: "#4a2440", x: 0.7, y: 0.72, r: 0.3 },
    { col: "#24304a", x: 0.15, y: 0.8, r: 0.22 },
  ];
  for (const b of blobs) {
    const cx = b.x * w, cy = b.y * h, r = b.r * Math.max(w, h);
    g.fillStyle = b.col;
    for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(h, cy + r); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(w, cx + r); x++) {
        // lumpy edge: distance warped by a cheap wobble
        const d = Math.hypot(x - cx, (y - cy) * 1.3) / r + Math.sin(x * 0.21 + y * 0.13) * 0.08 + (rand() - 0.5) * 0.05;
        // ordered (Bayer) dither: a soft, regular pixel-art falloff instead of static
        if (d < 1 && BAYER[(y & 3) * 4 + (x & 3)] / 16 < (1 - d) ** 1.5 * 0.45) g.fillRect(x, y, 1, 1);
      }
  }
  return c;
}

interface Meteor { x: number; y: number; vx: number; vy: number; born: number; life: number; len: number }

/** Shooting stars: call step() each frame with the low-res context. */
export function meteorShower(minGap = 3500, maxGap = 9000) {
  const list: Meteor[] = [];
  let next = performance.now() + 1200 + Math.random() * 2500;
  return {
    step(g: CanvasRenderingContext2D, now: number, w: number, h: number) {
      if (now > next) {
        next = now + minGap + Math.random() * (maxGap - minGap);
        const ang = Math.PI * (0.12 + Math.random() * 0.18) * (Math.random() < 0.5 ? 1 : -1);
        const sp = 0.09 + Math.random() * 0.07;
        list.push({ x: w * (0.15 + Math.random() * 0.7), y: h * Math.random() * 0.45, vx: Math.cos(ang) * sp * (ang < 0 ? -1 : 1), vy: Math.abs(Math.sin(ang)) * sp, born: now, life: 650 + Math.random() * 400, len: 10 + Math.random() * 10 });
      }
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i], age = now - m.born;
        if (age > m.life) { list.splice(i, 1); continue; }
        const fade = Math.sin((age / m.life) * Math.PI);
        const hx = m.x + m.vx * age, hy = m.y + m.vy * age, sp = Math.hypot(m.vx, m.vy);
        for (let k = 0; k < m.len; k++) {
          g.globalAlpha = fade * (1 - k / m.len) * 0.9;
          g.fillStyle = k < 2 ? "#fff6dc" : "#c9b8f0";
          g.fillRect(Math.round(hx - (m.vx / sp) * k), Math.round(hy - (m.vy / sp) * k), 1, 1);
        }
      }
      g.globalAlpha = 1;
    },
  };
}

/** What the game asks of the sky: where the telescope is, a black hole behind it, and pulses of light after hits. */
const fx = { cx: -1, cy: -1, bh: 0, bhOn: false, pulses: [] as { color: string; born: number; strength: number }[] };
/** Centre of the telescope on screen, in CSS pixels. */
export function skyCenter(x: number, y: number) { fx.cx = x; fx.cy = y; }
/** A black hole looms behind the telescope while one is in view. */
export function skyBlackHole(on: boolean) { fx.bhOn = on; }
/** A wave of coloured light rolls out from the telescope across the whole sky; stronger for harder finds. */
export function skyPulse(color: string, strength: number) { fx.pulses.push({ color, born: performance.now(), strength }); }

function drawFx(g: CanvasRenderingContext2D, t: number, w: number, h: number) {
  const cx = fx.cx < 0 ? w / 2 : fx.cx / SCALE, cy = fx.cy < 0 ? h * 0.45 : fx.cy / SCALE;
  fx.bh += ((fx.bhOn ? 1 : 0) - fx.bh) * 0.04;
  if (fx.bh > 0.01) {
    const k = fx.bh, R = Math.min(w, h) * 0.6, spin = t / 1400;
    // the dark well: everything near it dims
    for (let i = 6; i >= 1; i--) {
      g.globalAlpha = k * 0.12;
      g.fillStyle = "#05030a";
      g.beginPath(); g.ellipse(cx, cy, R * (0.55 + i * 0.16), R * (0.55 + i * 0.16), 0, 0, Math.PI * 2); g.fill();
    }
    // a tilted accretion disc of pixels, turning slowly behind the telescope
    const cols = ["#fee761", "#feae34", "#f77622", "#be4a2f"];
    for (let ring = 0; ring < 5; ring++) {
      const r = R * (0.8 + ring * 0.12), n = 90 + ring * 24, sp = spin * (1.3 - ring * 0.18);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + sp;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.32 - Math.cos(a) * r * 0.05;
        const front = Math.sin(a) > 0; // the near side of the disc is brighter
        g.globalAlpha = k * (front ? 1 : 0.5) * (0.55 + 0.45 * Math.sin(i * 1.7 + ring));
        g.fillStyle = cols[(i + ring) % cols.length];
        g.fillRect(Math.round(x), Math.round(y), 2, ring < 3 ? 2 : 1);
      }
    }
    // the photon ring, a thin bright halo
    g.globalAlpha = k * 0.5;
    g.strokeStyle = "#feae34"; g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, R * 0.62, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1;
  }
  for (let i = fx.pulses.length - 1; i >= 0; i--) {
    const p = fx.pulses[i], age = t - p.born, life = 700 + p.strength * 500;
    if (age > life || age < 0) { if (age > life) fx.pulses.splice(i, 1); continue; }
    const q = age / life, fade = (1 - q) * (1 - q);
    // a tint over the whole sky, then rings rolling outward
    g.globalAlpha = fade * 0.1 * p.strength;
    g.fillStyle = p.color; g.fillRect(0, 0, w, h);
    g.strokeStyle = p.color;
    const rings = 1 + Math.round(p.strength * 2);
    for (let k = 0; k < rings; k++) {
      const r = (age * (0.12 + p.strength * 0.05)) - k * 10;
      if (r <= 0) continue;
      g.globalAlpha = fade * (0.55 - k * 0.12) * Math.min(1, 0.4 + p.strength);
      g.lineWidth = k === 0 ? 2 : 1;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    }
  }
  g.globalAlpha = 1;
}

export function livingSky(canvas: HTMLCanvasElement) {
  const g = canvas.getContext("2d")!;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  type Star = { x: number; y: number; p: number; c: string; s: number; depth: number };
  let stars: Star[] = [];
  let neb: HTMLCanvasElement | null = null;
  let bg: HTMLCanvasElement | null = null;
  const resize = () => {
    canvas.width = Math.ceil(window.innerWidth / SCALE);
    canvas.height = Math.ceil(window.innerHeight / SCALE);
    const W = canvas.width + 24, H = canvas.height + 24; // a margin so parallax never shows an edge
    const n = Math.floor((W * H) / 80);
    stars = Array.from({ length: n }, (_, i) => ({
      x: Math.random() * W - 12,
      y: Math.random() * H - 12,
      p: Math.random() * 6.28,
      c: ["#6a6488", "#9a93b4", "#d8cfe6", "#2ce8f5", "#e07ab8", "#fee761", "#f3e2c0"][i % 7],
      s: Math.random() < 0.05 ? 2 : 1,
      depth: Math.random() < 0.7 ? 0.25 : 1,
    }));
    neb = nebula(W, H, 7);
    // the sky's colour, by the hour: a smooth gradient twice the screen tall, so scrolling moves through it
    bg = document.createElement("canvas");
    bg.width = canvas.width; bg.height = canvas.height * 2;
    const b = bg.getContext("2d")!;
    const tint = skyTint(new Date().getHours());
    const grad = b.createLinearGradient(0, 0, 0, bg.height);
    grad.addColorStop(0, tint.top);
    grad.addColorStop(0.45, mix(hex(tint.top), hex(tint.bottom), 0.6));
    grad.addColorStop(1, tint.bottom);
    b.fillStyle = grad; b.fillRect(0, 0, bg.width, bg.height);
    // a soft glow rising from below, like a far-off horizon: a wide radial wash, no hard edge
    const gx = bg.width / 2, gy = bg.height * 1.05, gr = Math.max(bg.width, bg.height) * 0.75;
    const rg = b.createRadialGradient(gx, gy, 0, gx, gy, gr);
    const gc = hex(tint.glow);
    rg.addColorStop(0, `rgba(${gc.join(",")},${tint.glowA * 1.4})`);
    rg.addColorStop(0.5, `rgba(${gc.join(",")},${tint.glowA * 0.5})`);
    rg.addColorStop(1, `rgba(${gc.join(",")},0)`);
    b.fillStyle = rg; b.fillRect(0, 0, bg.width, bg.height);
  };
  resize();
  window.addEventListener("resize", resize);
  // parallax: the sky leans a little away from the pointer; it eases so it feels heavy
  const aim = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
  window.addEventListener("pointermove", (e) => { aim.x = (e.clientX / window.innerWidth - 0.5) * 2; aim.y = (e.clientY / window.innerHeight - 0.5) * 2; }, { passive: true });
  const meteors = meteorShower();
  // scrolling a long page (results, catalogue) drifts through the sky: far things move least
  let scroll = 0;
  window.addEventListener("scroll", () => { scroll = window.scrollY / SCALE; if (reduce) requestAnimationFrame(frame); }, { passive: true });
  const frame = (t: number) => {
    if (!canvas.isConnected) return;
    // nothing to see while the atlas or intro covers it: keep ticking cheaply
    cur.x += (aim.x - cur.x) * 0.04; cur.y += (aim.y - cur.y) * 0.04;
    const driftX = reduce ? 0 : Math.sin(t / 23000) * 3, driftY = reduce ? 0 : Math.cos(t / 31000) * 2;
    const H0 = canvas.height, SH = H0 + 24;
    g.drawImage(bg!, 0, -Math.round(Math.min(H0, scroll * 0.35)));
    const nx = Math.round(-12 - cur.x * 2 + driftX * 0.5);
    const ny = -12 - (((Math.round(cur.y * 2 - driftY * 0.5 + scroll * 0.5) % SH) + SH) % SH);
    g.globalAlpha = 0.55;
    g.drawImage(neb!, nx, ny);
    g.drawImage(neb!, nx, ny + SH); // tiled, so a long scroll never runs out of nebula
    g.globalAlpha = 1;
    for (const s of stars) {
      const tw = reduce ? 1 : (Math.sin(t / 900 + s.p) + 1) / 2;
      g.globalAlpha = (s.depth < 1 ? 0.2 : 0.35) + 0.65 * tw * (s.depth < 1 ? 0.6 : 1);
      g.fillStyle = s.c;
      const k = s.depth * 6;
      const sy = ((((s.y + 12 - cur.y * k + driftY * s.depth - scroll * (0.3 + s.depth * 0.5)) % SH) + SH) % SH) - 12;
      g.fillRect(Math.floor(s.x - cur.x * k + driftX * s.depth), Math.floor(sy), s.s, s.s);
    }
    g.globalAlpha = 1;
    if (!reduce) meteors.step(g, t, canvas.width, canvas.height);
    if (!reduce) drawFx(g, t, canvas.width, canvas.height);
    if (!reduce) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
