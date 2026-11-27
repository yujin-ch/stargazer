/**
 * Your Universe: the catalogue as a map you can explore. Every night you played is a small star system; each
 * object you named that night is a body in it, by difficulty: Moons circle close, Planets orbit as little
 * spinning worlds wearing the object's photo, Nebulae drift as glowing clouds, Black Holes sit at the edge.
 * Nights spiral outward from the first one, so the map grows into a galaxy. Nothing you haven't found is shown.
 * Drag to pan, wheel or pinch to zoom, tap a body to fly to it.
 */
import { mulberry32 } from "./daily";
import { ui } from "./themes/chip";

export interface UBody {
  id: string;
  band: number;
  name: string;
  others: string[];
  note: string;
  zoomed: boolean;
  /** The picture to wear (small sprite canvas) and, if there is one, the sharp photo. */
  sprite: HTMLCanvasElement;
  hi: HTMLImageElement | null;
  /** Still out there: from a night you played but never named. Shown as a shadow. */
  unknown?: boolean;
}
export interface UNight {
  date: string;
  label: string;
  /** e.g. "412 points" */
  sub: string;
  /** The constellation's name, after the night's best find ("The Zither"). */
  title?: string;
  bodies: UBody[];
}
export interface UniverseOpts {
  nights: UNight[];
  bandNames: readonly string[];
  bandColors: readonly string[];
  plural: string[];
  onBack: () => void;
  /** Fly in to this night's system on opening, to show where its finds landed. */
  focus?: string;
}

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const SPACING = 430;
const SIZE = [9, 15, 22, 13];
/** Your universe expands across real cosmic scales as you play: the first week is the Solar Neighbourhood, and so on out. */
const REGIONS: [number, string, string][] = [
  [7, "Solar Neighbourhood", "#7fb7ff"], [30, "Orion Arm", "#9f8cff"], [90, "Milky Way", "#e08ad0"],
  [180, "Local Group", "#ffb36b"], [365, "Virgo Supercluster", "#7fe0c4"], [Infinity, "Laniakea", "#ffd86b"],
];
const regionOf = (i: number) => REGIONS.findIndex(([n]) => i < n);
const regionEdge = (k: number) => SPACING * Math.sqrt(REGIONS[k][0] - 0.5) + 320;

interface Placed extends UBody {
  sys: number;
  /** orbit radius, start angle, angular speed (rad/s); nebulae drift on a slow wobble instead */
  r: number; a0: number; w: number; size: number;
  tint: string;
  x: number; y: number;
}
interface Sys { x: number; y: number; night: UNight; bodies: Placed[]; seed: number }

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The average colour of a sprite's opaque pixels, for a planet's base and a nebula's glow. */
function avgColor(c: HTMLCanvasElement): string {
  try {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    if (!n) return "#6a5a8a";
    return `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
  } catch { return "#6a5a8a"; }
}

export function openUniverse(app: HTMLElement, o: UniverseOpts): () => void {
  const total = o.nights.reduce((n, s) => n + s.bodies.filter((x) => !x.unknown).length, 0);
  const unknownN = o.nights.reduce((n, s) => n + s.bodies.filter((x) => x.unknown).length, 0);
  const counts = [0, 1, 2, 3].map((b) => o.nights.reduce((n, s) => n + s.bodies.filter((x) => x.band === b && !x.unknown).length, 0));
  app.innerHTML = `
  <main class="universe">
    <canvas class="uni-canvas" aria-label="Your universe: a map of everything you've named"></canvas>
    <header class="uni-head">
      <button class="btn back-btn" id="uni-back" type="button">&lt; BACK</button>
      <div class="uni-title"><h1>YOUR UNIVERSE</h1><p><b>${total}</b> found${unknownN ? ` · ${unknownN} still out there` : ""}</p></div>
    </header>
    <nav class="uni-filter" aria-label="Show only">
      <button class="chip on" data-band="-1">ALL</button>
      ${[0, 1, 2, 3].map((b) => `<button class="chip" data-band="${b}" style="--c:${o.bandColors[b]}" ${counts[b] ? "" : "disabled"}><i></i>${o.plural[b].toUpperCase()} <small>${counts[b]}</small></button>`).join("")}
    </nav>
    <p class="uni-hint">${total ? "Drag to look around · pinch or scroll to zoom · tap anything" : ""}</p>
    ${total ? "" : `<div class="uni-empty"><p>Nothing out here yet.</p><p class="small">Everything you name in tonight's sky becomes a moon, a planet, a nebula or a black hole in your own universe.</p></div>`}
    <aside class="uni-card" id="uni-card" hidden></aside>
  </main>`;
  const canvas = app.querySelector<HTMLCanvasElement>(".uni-canvas")!;
  const g = canvas.getContext("2d")!;
  const card = app.querySelector<HTMLElement>("#uni-card")!;

  // ------------------------------------------------------------ layout: nights on a golden spiral
  const systems: Sys[] = o.nights.map((night, i) => {
    const rr = SPACING * Math.sqrt(i) * (i ? 1 : 0), th = i * GOLDEN;
    const seed = hashStr(night.date || "wanderers");
    const rand = mulberry32(seed);
    const sys: Sys = { x: Math.cos(th) * rr, y: Math.sin(th) * rr, night, bodies: [], seed };
    const perBand = [0, 0, 0, 0];
    for (const b of night.bodies) {
      const k = perBand[b.band]++;
      const r = b.band === 0 ? 34 + k * 11 : b.band === 1 ? 74 + k * 15 : b.band === 2 ? 150 + (k % 4) * 18 + rand() * 10 : 222 + k * 12;
      const dir = b.band === 3 ? -1 : 1;
      sys.bodies.push({
        ...b, sys: i, r, a0: rand() * Math.PI * 2,
        w: b.band === 2 ? 0.012 : dir * (0.9 / Math.pow(r, 1.1)) * (0.8 + rand() * 0.4),
        size: SIZE[b.band], tint: avgColor(b.sprite), x: 0, y: 0,
      });
    }
    return sys;
  });
  const bodies = systems.flatMap((s) => s.bodies);

  // ------------------------------------------------------------ camera
  let W = 0, H = 0, dpr = 1;
  const cam = { x: 0, y: 0, z: 1 };
  let fly: { x: number; y: number; z: number; t0: number; from: { x: number; y: number; z: number }; follow?: Placed } | null = null;
  let following: Placed | null = null;
  let filter = -1;
  const resize = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  };
  resize();
  const fit = () => {
    if (!systems.length) return;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const s of systems) { x0 = Math.min(x0, s.x - 260); x1 = Math.max(x1, s.x + 260); y0 = Math.min(y0, s.y - 260); y1 = Math.max(y1, s.y + 260); }
    cam.x = (x0 + x1) / 2; cam.y = (y0 + y1) / 2;
    cam.z = Math.max(0.12, Math.min(1.25, Math.min(W / (x1 - x0), (H - 120) / (y1 - y0))));
  };
  fit();
  const clampZ = (z: number) => Math.max(0.08, Math.min(5, z));
  const toScreen = (x: number, y: number) => [(x - cam.x) * cam.z + W / 2, (y - cam.y) * cam.z + H / 2 + 20] as const;
  const toWorld = (sx: number, sy: number) => [(sx - W / 2) / cam.z + cam.x, (sy - H / 2 - 20) / cam.z + cam.y] as const;
  const narrow = () => W < 700;
  /** where a followed body sits on screen: left of centre on wide screens (card on its right), high on phones */
  const followOffset = (z: number) => (narrow() ? [0, (H * 0.2) / z] : [-(Math.min(220, W * 0.16)) / z, 0]);
  const flyTo = (x: number, y: number, z: number, follow?: Placed) => {
    fly = { x, y, z: clampZ(z), t0: performance.now(), from: { ...cam }, follow };
    following = null;
  };

  // ------------------------------------------------------------ background stars (parallax)
  const bg = Array.from({ length: 260 }, (_, i) => {
    const r = mulberry32(i * 7919 + 13);
    return { x: r(), y: r(), d: 0.03 + r() * 0.12, s: r() < 0.08 ? 2 : 1, c: ["#ffffff", "#9fd8ff", "#ffd7a0", "#e6b8ff"][Math.floor(r() * 4)], tw: r() * 6 };
  });

  // ------------------------------------------------------------ drawing
  const t0 = performance.now();
  let raf = 0;

  function drawPlanet(b: Placed, sx: number, sy: number, rad: number, sun: readonly [number, number], t: number) {
    const a = g.globalAlpha;
    // atmosphere glow in the band colour
    const halo = g.createRadialGradient(sx, sy, rad * 0.8, sx, sy, rad * 1.7);
    halo.addColorStop(0, o.bandColors[b.band] + "55"); halo.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = halo; g.fillRect(sx - rad * 1.7, sy - rad * 1.7, rad * 3.4, rad * 3.4);
    g.save();
    g.beginPath(); g.arc(sx, sy, rad, 0, Math.PI * 2); g.clip();
    // a dusky sphere tinted by the object, lit from its star
    const dx = sx - sun[0], dy = sy - sun[1], L = Math.hypot(dx, dy) || 1;
    const lx = sx - (dx / L) * rad * 0.55, ly = sy - (dy / L) * rad * 0.55;
    const ball = g.createRadialGradient(lx, ly, rad * 0.1, sx, sy, rad * 1.1);
    ball.addColorStop(0, "#4a3c72"); ball.addColorStop(0.7, "#211a3c"); ball.addColorStop(1, "#0c0818");
    g.fillStyle = ball; g.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
    g.globalAlpha = a * 0.35; g.fillStyle = b.tint; g.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
    g.globalAlpha = a;
    // the object itself, whole, gently bobbing as the little world turns
    const box = rad * 1.55, k = Math.min(box / b.sprite.width, box / b.sprite.height);
    const sw = b.sprite.width * k, sh = b.sprite.height * k, bob = REDUCED ? 0 : Math.sin(t * 0.9 + b.a0) * rad * 0.04;
    g.imageSmoothingEnabled = b.sprite.width > 60;
    g.drawImage(b.sprite, sx - sw / 2, sy - sh / 2 + bob, sw, sh);
    // a soft night side, so it still reads as a sphere
    const night = g.createLinearGradient(lx, ly, sx + (dx / L) * rad, sy + (dy / L) * rad);
    night.addColorStop(0, "rgba(255,240,210,0.10)"); night.addColorStop(0.6, "rgba(8,4,20,0)"); night.addColorStop(1, "rgba(8,4,20,0.55)");
    g.fillStyle = night; g.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
    g.restore();
    g.strokeStyle = o.bandColors[b.band]; g.globalAlpha = a * 0.7; g.lineWidth = Math.max(1, rad * 0.07);
    g.beginPath(); g.arc(sx, sy, rad + g.lineWidth / 2, 0, Math.PI * 2); g.stroke();
    if (b.band === 1 && rad > 10) {
      // planets get a thin ring
      g.globalAlpha = a * 0.45; g.lineWidth = Math.max(1, rad * 0.05);
      g.beginPath(); g.ellipse(sx, sy, rad * 1.6, rad * 0.42, -0.35, 0, Math.PI * 2); g.stroke();
    }
    g.globalAlpha = a;
  }

  function drawUnknown(b: Placed, sx: number, sy: number, rad: number) {
    const a = g.globalAlpha;
    g.globalAlpha = a * 0.55; g.fillStyle = "#120d24"; g.beginPath(); g.arc(sx, sy, rad, 0, Math.PI * 2); g.fill();
    const box = rad * 1.5, k = Math.min(box / b.sprite.width, box / b.sprite.height);
    g.imageSmoothingEnabled = b.sprite.width > 60;
    g.globalAlpha = a * 0.7; g.drawImage(b.sprite, sx - (b.sprite.width * k) / 2, sy - (b.sprite.height * k) / 2, b.sprite.width * k, b.sprite.height * k);
    g.globalAlpha = a * 0.5; g.strokeStyle = o.bandColors[b.band]; g.lineWidth = 1; g.setLineDash([2, 3]);
    g.beginPath(); g.arc(sx, sy, rad, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    g.globalAlpha = a;
  }

  function drawNebula(b: Placed, sx: number, sy: number, rad: number, t: number) {
    const rand = mulberry32(hashStr(b.id));
    const breathe = REDUCED ? 1 : 1 + Math.sin(t * 0.5 + b.a0) * 0.06;
    const a = g.globalAlpha;
    for (let i = 0; i < 4; i++) {
      const ox = (rand() - 0.5) * rad * 1.4, oy = (rand() - 0.5) * rad * 1.1, rr = rad * (0.9 + rand() * 0.8) * breathe;
      const gr = g.createRadialGradient(sx + ox, sy + oy, 0, sx + ox, sy + oy, rr);
      gr.addColorStop(0, i % 2 ? b.tint : o.bandColors[2]); gr.addColorStop(1, "rgba(0,0,0,0)");
      g.globalAlpha = a * 0.28; g.fillStyle = gr; g.fillRect(sx + ox - rr, sy + oy - rr, rr * 2, rr * 2);
    }
    g.globalAlpha = a * 0.92;
    const sw = rad * 1.25, sh = sw * (b.sprite.height / b.sprite.width);
    g.imageSmoothingEnabled = false;
    g.drawImage(b.sprite, sx - sw / 2, sy - sh / 2, sw, sh);
    g.globalAlpha = a;
  }

  function drawHole(b: Placed, sx: number, sy: number, rad: number, t: number) {
    const spin = REDUCED ? 0 : t * 0.8;
    g.save();
    g.translate(sx, sy);
    // accretion disc, tilted
    g.save(); g.scale(1, 0.38); g.rotate(spin * 0.1);
    const disc = g.createRadialGradient(0, 0, rad * 0.9, 0, 0, rad * 2.3);
    disc.addColorStop(0, "rgba(255,214,140,0.95)"); disc.addColorStop(0.35, "rgba(254,174,52,0.7)"); disc.addColorStop(1, "rgba(120,30,60,0)");
    g.fillStyle = disc; g.beginPath(); g.arc(0, 0, rad * 2.3, 0, Math.PI * 2); g.fill();
    g.restore();
    // the hole and the thing it swallowed, seen through the photon ring
    g.fillStyle = "#05030a"; g.beginPath(); g.arc(0, 0, rad, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(0, 0, rad * 0.92, 0, Math.PI * 2); g.clip();
    g.globalAlpha *= 0.85;
    const sw = rad * 1.5, sh = sw * (b.sprite.height / b.sprite.width);
    g.imageSmoothingEnabled = false;
    g.drawImage(b.sprite, -sw / 2, -sh / 2, sw, sh);
    g.restore();
    g.strokeStyle = "rgba(255,226,170,0.9)"; g.lineWidth = Math.max(1, rad * 0.12);
    g.beginPath(); g.arc(sx, sy, rad * 1.04, 0, Math.PI * 2); g.stroke();
  }

  function frame(now: number) {
    const t = (now - t0) / 1000;
    if (fly) {
      const k = Math.min(1, (now - fly.t0) / 900), e = 1 - Math.pow(1 - k, 3);
      const fo = fly.follow ? followOffset(fly.z) : [0, 0];
      const tx = (fly.follow ? fly.follow.x : fly.x) - fo[0], ty = (fly.follow ? fly.follow.y : fly.y) + fo[1] * (fly.follow ? 1 : 0);
      cam.x = fly.from.x + (tx - fly.from.x) * e; cam.y = fly.from.y + (ty - fly.from.y) * e;
      cam.z = Math.exp(Math.log(fly.from.z) + (Math.log(fly.z) - Math.log(fly.from.z)) * e);
      if (k >= 1) { following = fly.follow ?? null; fly = null; }
    } else if (following) { const fo = followOffset(cam.z); cam.x = following.x - fo[0]; cam.y = following.y + fo[1]; }

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#0b0818"; g.fillRect(0, 0, W, H);
    const neb = g.createRadialGradient(W * 0.3, H * 0.35, 0, W * 0.3, H * 0.35, Math.max(W, H) * 0.8);
    neb.addColorStop(0, "rgba(70,40,110,0.35)"); neb.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = neb; g.fillRect(0, 0, W, H);
    for (const s of bg) {
      const x = (((s.x * 3000 - cam.x * s.d) % W) + W) % W, y = (((s.y * 3000 - cam.y * s.d) % H) + H) % H;
      g.globalAlpha = REDUCED ? 0.7 : 0.45 + 0.4 * Math.sin(t * 1.3 + s.tw);
      g.fillStyle = s.c; g.fillRect(Math.round(x), Math.round(y), s.s, s.s);
    }
    g.globalAlpha = 1;

    const tt = REDUCED ? 0 : t;
    for (const s of systems) {
      for (const b of s.bodies) {
        const a = b.a0 + b.w * tt;
        b.x = s.x + Math.cos(a) * b.r; b.y = s.y + Math.sin(a) * b.r * (b.band === 2 ? 0.8 : 1);
      }
    }
    const far = cam.z < 0.32;
    // the regions of the real universe your nights have reached, and the next frontier
    const reached = systems.length ? regionOf(systems.length - 1) : 0;
    const o0 = toScreen(0, 0);
    for (let k = Math.min(REGIONS.length - 2, reached); k >= 0; k--) {
      const R = regionEdge(k) * cam.z;
      g.globalAlpha = k === reached ? 0.35 : 0.22; g.strokeStyle = REGIONS[k][2]; g.lineWidth = 1; g.setLineDash([6, 8]);
      g.beginPath(); g.arc(o0[0], o0[1], R, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      const fill = g.createRadialGradient(o0[0], o0[1], R * 0.7, o0[0], o0[1], R);
      fill.addColorStop(0, "rgba(0,0,0,0)"); fill.addColorStop(1, REGIONS[k][2] + "14");
      g.globalAlpha = 1; g.fillStyle = fill; g.beginPath(); g.arc(o0[0], o0[1], R, 0, Math.PI * 2); g.fill();
      // its name, curving along the top of the ring
      const label = REGIONS[k][1].toUpperCase(), next = REGIONS[k + 1]?.[1].toUpperCase();
      g.font = `${Math.max(8, Math.min(14, R * 0.03))}px "Press Start 2P", monospace`; g.textAlign = "center"; g.fillStyle = REGIONS[k][2];
      g.globalAlpha = 0.75; g.fillText(label, o0[0], o0[1] - R + Math.max(14, R * 0.035));
      if (k === reached && next) { g.globalAlpha = 0.45; g.fillStyle = REGIONS[k + 1][2]; g.fillText(`${next} · UNCHARTED`, o0[0], o0[1] - R - 10); }
    }
    g.globalAlpha = 1;
    // your path through the nights, star to star
    if (systems.length > 1) {
      g.globalAlpha = 0.18; g.strokeStyle = "#f2d38a"; g.lineWidth = 1; g.setLineDash([1, 6]);
      g.beginPath(); systems.filter((s) => s.night.date).forEach((s, i) => { const p = toScreen(s.x, s.y); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.stroke(); g.setLineDash([]);
      g.globalAlpha = 1;
    }
    for (const s of systems) {
      const sun = toScreen(s.x, s.y);
      if (sun[0] < -400 * cam.z - 60 || sun[0] > W + 400 * cam.z + 60 || sun[1] < -400 * cam.z - 60 || sun[1] > H + 400 * cam.z + 60) continue;
      const dim = (b: Placed) => (filter >= 0 && b.band !== filter ? 0.12 : 1);
      // orbits
      if (!far) {
        g.lineWidth = 1;
        for (const b of s.bodies) {
          if (b.band === 2) continue;
          g.globalAlpha = 0.1 * dim(b); g.strokeStyle = o.bandColors[b.band];
          g.beginPath(); g.arc(sun[0], sun[1], b.r * cam.z, 0, Math.PI * 2); g.stroke();
        }
        // that night's constellation: your finds joined in the order you named them
        g.globalAlpha = 0.4; g.strokeStyle = "#f2d38a"; g.lineWidth = 1.2;
        g.beginPath();
        s.bodies.filter((b) => !b.unknown).forEach((b, i) => { const p = toScreen(b.x, b.y); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); });
        g.stroke();
      }
      // the night's star
      if (s.night.date) {
        const sr = Math.max(3, (10 + Math.sqrt(s.bodies.length) * 3) * cam.z);
        const glow = g.createRadialGradient(sun[0], sun[1], 0, sun[0], sun[1], sr * 4);
        glow.addColorStop(0, "rgba(255,236,170,0.9)"); glow.addColorStop(0.25, "rgba(255,200,110,0.35)"); glow.addColorStop(1, "rgba(255,160,80,0)");
        g.globalAlpha = 1; g.fillStyle = glow; g.fillRect(sun[0] - sr * 4, sun[1] - sr * 4, sr * 8, sr * 8);
        g.fillStyle = "#fff6d8"; g.beginPath(); g.arc(sun[0], sun[1], sr, 0, Math.PI * 2); g.fill();
      }
      // bodies, nebulae first so they sit behind
      const order = s.bodies.slice().sort((a, b) => (a.band === 2 ? -1 : 0) - (b.band === 2 ? -1 : 0));
      for (const b of order) {
        const p = toScreen(b.x, b.y);
        const rad = Math.max(far ? 1.5 : 2.5, b.size * cam.z);
        g.globalAlpha = dim(b);
        if (far || rad < 4) {
          if (b.unknown) g.globalAlpha *= 0.25;
          g.fillStyle = o.bandColors[b.band];
          g.fillRect(Math.round(p[0] - rad / 2), Math.round(p[1] - rad / 2), Math.ceil(rad), Math.ceil(rad));
          continue;
        }
        if (b.unknown) drawUnknown(b, p[0], p[1], rad);
        else if (b.band === 2) drawNebula(b, p[0], p[1], rad * 1.6, t);
        else if (b.band === 3) drawHole(b, p[0], p[1], rad, t);
        else drawPlanet(b, p[0], p[1], rad, sun, t);
        if (fresh === s && now < freshUntil && !b.unknown) {
          const k = (freshUntil - now) / 6000;
          g.globalAlpha = Math.min(1, k * 2) * (0.5 + 0.5 * Math.sin(t * 5 + b.a0 * 3));
          g.strokeStyle = "#fee761"; g.lineWidth = 1.5;
          g.beginPath(); g.arc(p[0], p[1], rad * (b.band === 2 ? 1.2 : 1.35) + 6, 0, Math.PI * 2); g.stroke();
          g.globalAlpha = dim(b);
        }
        if (selected === b && !narrow() && !card.hidden) {
          const cw = card.offsetWidth, ch = card.offsetHeight, gap = rad * (b.band === 2 ? 1.6 : 1.5) + 34;
          let left = p[0] + gap, top = p[1] - ch / 2;
          if (left + cw > W - 16) left = p[0] - gap - cw;
          top = Math.max(80, Math.min(H - ch - 70, top));
          card.style.left = `${Math.round(left)}px`; card.style.top = `${Math.round(top)}px`;
          g.globalAlpha = 0.6; g.strokeStyle = o.bandColors[b.band]; g.lineWidth = 1; g.setLineDash([2, 4]);
          const ex = left > p[0] ? left : left + cw;
          g.beginPath(); g.moveTo(p[0] + Math.sign(ex - p[0]) * (rad + 6), p[1]); g.lineTo(ex, Math.max(top + 12, Math.min(top + ch - 12, p[1]))); g.stroke(); g.setLineDash([]);
        }
        if (selected === b) {
          g.globalAlpha = 1; g.strokeStyle = "#fee761"; g.lineWidth = 2;
          g.beginPath(); g.arc(p[0], p[1], rad * (b.band === 2 ? 1.3 : 1.5) + 4 + Math.sin(t * 4) * 1.5, 0, Math.PI * 2); g.stroke();
        }
        if (cam.z > 1.6) {
          g.globalAlpha = dim(b) * Math.min(1, (cam.z - 1.6) * 2);
          g.font = "16px VT323, monospace"; g.textAlign = "center"; g.fillStyle = "#e9e0ff";
          g.fillText(b.unknown ? "???" : b.name, p[0], p[1] + rad * (b.band === 2 ? 1.5 : b.band === 3 ? 1.6 : 1) + 16);
        }
      }
      g.globalAlpha = 1;
      if (cam.z > 0.18) {
        g.font = `${cam.z > 0.5 ? 9 : 8}px "Press Start 2P", monospace`; g.textAlign = "center";
        g.fillStyle = s.night.date ? "#f2d38a" : "#b9a8e0";
        g.globalAlpha = Math.min(1, (cam.z - 0.18) * 5);
        g.fillText(s.night.label.toUpperCase(), sun[0], sun[1] + Math.max(22, 34 * cam.z));
        if (s.night.title && cam.z > 0.4) { g.fillStyle = "#e9e0ff"; g.font = "16px VT323, monospace"; g.fillText(s.night.title, sun[0], sun[1] + Math.max(22, 34 * cam.z) + 16); }
        g.globalAlpha = 1;
      }
    }
    raf = requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ picking and the card
  let selected: Placed | null = null;
  let fresh: Sys | null = null, freshUntil = 0;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  function pick(sx: number, sy: number): Placed | Sys | null {
    let best: Placed | null = null, bd = Infinity;
    for (const b of bodies) {
      if (filter >= 0 && b.band !== filter) continue;
      const p = toScreen(b.x, b.y), rad = Math.max(14, b.size * cam.z * (b.band === 2 ? 1.6 : 1.3));
      const d = Math.hypot(p[0] - sx, p[1] - sy);
      if (d < rad && d < bd) { best = b; bd = d; }
    }
    if (best) return best;
    for (const s of systems) {
      const p = toScreen(s.x, s.y);
      if (Math.hypot(p[0] - sx, p[1] - sy) < Math.max(18, 30 * cam.z)) return s;
    }
    return null;
  }
  function showBody(b: Placed) {
    selected = b;
    const night = systems[b.sys].night;
    if (b.unknown) {
      card.hidden = false;
      card.style.setProperty("--band", o.bandColors[b.band]);
      card.innerHTML = `<button class="card-x" aria-label="Close">✕</button>
        <div class="uni-pic"></div>
        <p class="uni-kind"><i></i>${o.bandNames[b.band].toUpperCase()} · UNDISCOVERED</p>
        <h2>???</h2>
        <p class="uni-note">Something drifted past your telescope ${esc(night.label)} and got away.</p>
        <p class="small">Play that night again from Past Skies in the Star Atlas to find it.</p>`;
      const c = document.createElement("canvas"); c.width = b.sprite.width; c.height = b.sprite.height; c.getContext("2d")!.drawImage(b.sprite, 0, 0);
      card.querySelector(".uni-pic")!.appendChild(c);
      (card.querySelector(".card-x") as HTMLElement).onclick = () => { ui("back"); closeCard(); };
      flyTo(b.x, b.y, Math.max(cam.z, 2.6), b);
      return;
    }
    card.hidden = false;
    card.style.setProperty("--band", o.bandColors[b.band]);
    card.innerHTML = `<button class="card-x" aria-label="Close">✕</button>
      <div class="uni-pic"></div>
      <p class="uni-kind"><i></i>${o.bandNames[b.band].toUpperCase()}</p>
      <h2>${esc(b.name)}</h2>
      ${b.others.length ? `<p class="small">also: ${b.others.map(esc).join(", ")}</p>` : ""}
      ${b.note ? `<p class="uni-note">${esc(b.note)}</p>` : ""}
      <p class="small">${night.date ? `Caught ${esc(night.label)}${b.zoomed ? " · while zoomed in ★" : ""}` : "Caught on a practice sky"}</p>`;
    const pic = card.querySelector<HTMLElement>(".uni-pic")!;
    const img = b.hi && b.hi.complete && b.hi.naturalWidth ? (b.hi.cloneNode() as HTMLImageElement) : null;
    if (img) pic.appendChild(img);
    else { const c = document.createElement("canvas"); c.width = b.sprite.width; c.height = b.sprite.height; c.getContext("2d")!.drawImage(b.sprite, 0, 0); pic.appendChild(c); }
    (card.querySelector(".card-x") as HTMLElement).onclick = () => { ui("back"); closeCard(); };
    flyTo(b.x, b.y, Math.max(cam.z, b.band === 2 ? 2.2 : 3), b);
  }
  function showSystem(s: Sys, lead = "") {
    selected = null;
    card.hidden = false;
    card.style.setProperty("--band", "#f2d38a");
    const by = [0, 1, 2, 3].map((k) => s.bodies.filter((b) => b.band === k && !b.unknown).length);
    const lost = s.bodies.filter((b) => b.unknown).length;
    card.innerHTML = `<button class="card-x" aria-label="Close">✕</button>
      <p class="uni-kind"><i></i>${s.night.date ? `A NIGHT IN THE ${REGIONS[regionOf(systems.indexOf(s))][1].toUpperCase()}` : "PRACTICE SKIES"}</p>
      <h2>${esc(s.night.label)}</h2>
      ${s.night.title ? `<p class="uni-note">Tonight you drew ${esc(s.night.title)}.</p>` : ""}
      ${s.night.sub ? `<p class="small">${esc(s.night.sub)}</p>` : ""}
      ${lead ? `<p class="uni-note">${esc(lead)}</p>` : ""}
      <ul class="uni-tally">${by.map((n, k) => (n ? `<li style="--c:${o.bandColors[k]}"><i></i>${n} ${n === 1 ? o.bandNames[k] : o.plural[k]}</li>` : "")).join("")}${lost ? `<li style="--c:#5a5078"><i></i>${lost} still out there</li>` : ""}</ul>`;
    (card.querySelector(".card-x") as HTMLElement).onclick = () => { ui("back"); closeCard(); };
    flyTo(s.x, s.y, 1.1);
  }
  function closeCard() { card.hidden = true; selected = null; following = null; }

  // ------------------------------------------------------------ input
  const pts = new Map<number, { x: number; y: number }>();
  let moved = 0, pinch0 = 0, z0 = 1;
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0; fly = null;
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); z0 = cam.z; }
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (pts.size === 1) {
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 6) { following = null; cam.x -= dx / cam.z; cam.y -= dy / cam.z; }
    }
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size === 2) {
      moved = 99; following = null;
      const [a, b] = [...pts.values()];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const before = toWorld(mx, my);
      cam.z = clampZ(z0 * Math.hypot(a.x - b.x, a.y - b.y) / (pinch0 || 1));
      const after = toWorld(mx, my);
      cam.x += before[0] - after[0]; cam.y += before[1] - after[1];
    }
  });
  const up = (e: PointerEvent) => {
    const had = pts.delete(e.pointerId);
    if (!had || pts.size || moved > 6) return;
    const r = canvas.getBoundingClientRect();
    const hit = pick(e.clientX - r.left, e.clientY - r.top);
    if (!hit) { if (!card.hidden) closeCard(); return; }
    ui("tap");
    if ("sys" in hit) showBody(hit); else showSystem(hit);
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", (e) => pts.delete(e.pointerId));
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault(); fly = null;
    const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const before = toWorld(mx, my);
    cam.z = clampZ(cam.z * Math.exp(-e.deltaY * 0.0015));
    if (following) return;
    const after = toWorld(mx, my);
    cam.x += before[0] - after[0]; cam.y += before[1] - after[1];
  }, { passive: false });
  app.querySelectorAll<HTMLButtonElement>(".uni-filter .chip").forEach((c) => (c.onclick = () => {
    ui("toggle");
    filter = Number(c.dataset.band);
    app.querySelectorAll(".uni-filter .chip").forEach((x) => x.classList.toggle("on", x === c));
    if (selected && filter >= 0 && selected.band !== filter) closeCard();
  }));
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { if (!card.hidden) closeCard(); else stop(), o.onBack(); } };
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", resize);
  const stop = () => { cancelAnimationFrame(raf); document.removeEventListener("keydown", onKey); window.removeEventListener("resize", resize); };
  app.querySelector<HTMLButtonElement>("#uni-back")!.onclick = () => { ui("back"); stop(); o.onBack(); };
  raf = requestAnimationFrame(frame);
  const focusSys = o.focus ? systems.find((s) => s.night.date === o.focus) : undefined;
  if (focusSys) {
    freshUntil = performance.now() + 6000;
    fresh = focusSys;
    if (systems.length > 1) cam.z = Math.min(cam.z, 0.3);
    setTimeout(() => { ui("dive"); showSystem(focusSys, `Tonight's ${focusSys.bodies.filter((b) => !b.unknown).length} ${focusSys.bodies.filter((b) => !b.unknown).length === 1 ? "find" : "finds"} joined your universe.`); }, REDUCED ? 0 : 500);
  }
  return stop;
}
