/**
 * Your Universe: a pinwheel galaxy that grows as you play. Each of the eight houses is a spiral arm and each night
 * you play adds a ring, from your first night at the core out to tonight at the edge; the arm's twist comes from
 * time. The ones that got away are faint dots beside your finds. So the galaxy's shape is your chart: the house you're best at has the fullest arm.
 * Beside the map sits the Star Chart (0-99 per house), which doubles as a filter: tap a house and its arm lights up.
 * Drag to pan, wheel or pinch to zoom, tap a find to read its card, tap a ring for that night.
 */
import { mulberry32 } from "./daily";
import { ui } from "./themes/chip";
import { HOUSES, drawChart, drawGlyph, glyphCanvas, rankOf, type HouseScore } from "./houses";

export interface UBody {
  id: string;
  band: number;
  house: number;
  name: string;
  others: string[];
  note: string;
  zoomed: boolean;
  /** Seconds into the night it was named, and the points it earned. */
  t?: number;
  points?: number;
  /** How many of your nights it rose in. */
  seen?: number;
  /** The picture to wear (small sprite canvas) and, if there is one, the sharp photo. */
  sprite: HTMLCanvasElement;
  hi: HTMLImageElement | null;
  /** Still out there: from a night you played but never named. Shown as a faint dot. */
  unknown?: boolean;
  /** You saw it and skipped it (rather than running out of time before it rose). */
  skipped?: boolean;
}
export interface UNight {
  date: string;
  label: string;
  /** e.g. "412 points · 17 named" */
  sub: string;
  /** The night's best find, e.g. "the zither". */
  title?: string;
  bodies: UBody[];
}
export interface UniverseOpts {
  nights: UNight[];
  bandNames: readonly string[];
  bandColors: readonly string[];
  plural: string[];
  scores: HouseScore[];
  onBack: () => void;
  /** Fly in to this night's system on opening, to show where its finds landed. */
  focus?: string;
}

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** the core (practice finds), first night's ring, gap between nights, and how far each ring twists the arms */
const CORE_R = 62, R0 = 120, STEP = 34, TWIST = 0.075;
const WEDGE = (Math.PI * 2) / 8;
const BODY_R = 11;
const armAngle = (h: number, ring: number) => h * WEDGE - Math.PI / 2 + ring * TWIST;

interface Placed extends UBody {
  sys: number;
  x: number; y: number;
  /** a phase for twinkling */
  a0: number;
}
/** One night: a ring of the galaxy (the core holds practice finds). */
interface Sys { night: UNight; bodies: Placed[]; belt: boolean; r: number; ring: number }

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const ordinal = (n: number) => `${n}${["TH", "ST", "ND", "RD"][n % 100 >= 11 && n % 100 <= 13 ? 0 : Math.min(n % 10, 4) % 4] ?? "TH"}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function openUniverse(app: HTMLElement, o: UniverseOpts): () => void {
  const found = o.nights.flatMap((n) => n.bodies.filter((b) => !b.unknown));
  const total = found.length;
  const played = o.nights.filter((n) => n.date).length;
  const scores = o.scores.map((s) => s.score);
  const anySeen = o.scores.some((s) => s.seen > 0);
  const sign = anySeen ? scores.indexOf(Math.max(...o.scores.map((s, i) => (s.seen ? scores[i] : -1)))) : 0;
  // the one that got away: the hardest thing you saw and skipped (latest night first) that you've never found since
  let gotAway: { b: UBody; night: UNight } | null = null;
  for (const n of o.nights) for (const b of n.bodies) if (b.unknown && b.skipped && (!gotAway || b.band >= gotAway.b.band)) gotAway = { b, night: n };

  app.innerHTML = `
  <main class="universe">
    <canvas class="uni-canvas" aria-label="Your universe: a map of everything you've named"></canvas>
    <header class="uni-head">
      <button class="btn back-btn" id="uni-back" type="button">&lt; BACK</button>
      <div class="uni-title"><h1>YOUR UNIVERSE</h1><p><b>${total}</b> found${played ? ` over ${played} ${played === 1 ? "night" : "nights"}` : ""}<span class="uni-tip"> · tap a house to light up its finds</span></p></div>
    </header>
    <aside class="uni-chart" id="uni-chart" aria-label="Your star chart">
      <button class="uni-chart-head" id="uni-chart-head" type="button" aria-expanded="false">
        <span>YOUR CHART</span><span class="uni-sign">${anySeen ? `SIGN <b style="color:${HOUSES[sign].color}">${HOUSES[sign].name.replace("The ", "").toUpperCase()}</b>` : ""}</span><i aria-hidden="true">▲</i>
      </button>
      <div class="uni-chart-body">
        <canvas class="uni-dial" width="240" height="240" aria-hidden="true"></canvas>
        <ul class="uni-houses">
          ${HOUSES.map((h, i) => `<li><button type="button" data-h="${i}" style="--c:${h.color}"><span class="g"></span><span class="n">${h.name.replace("The ", "").toUpperCase()}</span><b>${scores[i]}</b></button></li>`).join("")}
        </ul>
        <div class="uni-house-info" id="uni-house-info"></div>
        ${gotAway ? `<button class="uni-away" id="uni-away" type="button" style="--c:${o.bandColors[gotAway.b.band]}"><small>THE ONE THAT GOT AWAY</small><span>A ${esc(o.bandNames[gotAway.b.band].toLowerCase())} on ${esc(gotAway.night.label)}, still out there</span></button>` : ""}
        <button class="btn uni-all" id="uni-all" type="button">ALL</button>
      </div>
    </aside>
    <p class="uni-hint">${total ? "Drag to look around · pinch or scroll to zoom · tap anything" : ""}</p>
    ${total ? "" : `<div class="uni-empty"><p>Nothing out here yet.</p><p class="small">Everything you name in tonight's sky becomes a star in your galaxy, on the arm of its house.</p></div>`}
    <aside class="uni-card" id="uni-card" hidden></aside>
  </main>`;
  const root = app.querySelector<HTMLElement>(".universe")!;
  const canvas = app.querySelector<HTMLCanvasElement>(".uni-canvas")!;
  const g = canvas.getContext("2d")!;
  const card = app.querySelector<HTMLElement>("#uni-card")!;
  const rail = app.querySelector<HTMLElement>("#uni-chart")!;
  const info = app.querySelector<HTMLElement>("#uni-house-info")!;
  rail.querySelectorAll<HTMLElement>(".uni-houses .g").forEach((el, i) => el.appendChild(glyphCanvas(HOUSES[i], 20)));

  // ------------------------------------------------------------ layout: houses are arms, nights are rings
  const dated = o.nights.filter((n) => n.date).sort((x, y) => (x.date < y.date ? -1 : 1));
  const loose = o.nights.filter((n) => !n.date);
  const systems: Sys[] = [...loose, ...dated].map((night, i) => {
    const belt = !night.date, ring = belt ? -1 : dated.indexOf(night);
    const r = belt ? CORE_R : R0 + ring * STEP;
    const rand = mulberry32(hashStr(night.date || "practice"));
    const sys: Sys = { night, bodies: [], belt, r, ring };
    for (let h = 0; h < 8; h++) {
      const group = night.bodies.filter((b) => b.house === h);
      // found ones in the middle of the arm, the ones that got away at its edges
      group.sort((x, y) => Number(!!x.unknown) - Number(!!y.unknown));
      // a crowded arm on an early (small) ring stacks into a few rows across the ring's width
      const n = group.length, rows = Math.min(3, Math.max(1, Math.ceil((n * 28) / (r * WEDGE * 0.9))));
      const perRow = Math.ceil(n / rows);
      const order = group.map((_, k) => k).sort((x, y) => Math.abs(x - (n - 1) / 2) - Math.abs(y - (n - 1) / 2));
      const placed: Placed[] = [];
      group.forEach((b, k) => {
        const slot = order.indexOf(k), row = slot % rows, col = Math.floor(slot / rows);
        const inRow = Math.min(perRow, Math.ceil((n - row) / rows)), spread = Math.min(WEDGE * 0.92, (inRow * 28) / r);
        const a = armAngle(h, belt ? 0 : ring) + (inRow > 1 ? (col / (inRow - 1) - 0.5) * spread : 0) + (rand() - 0.5) * 0.04;
        const rr = r + (rows > 1 ? (row - (rows - 1) / 2) * STEP * 0.62 : (rand() - 0.5) * STEP * (belt ? 0.8 : 0.55));
        placed.push({ ...b, sys: i, x: Math.cos(a) * rr, y: Math.sin(a) * rr, a0: rand() * 6.28 });
      });
      sys.bodies.push(...placed);
    }
    return sys;
  });
  const bodies = systems.flatMap((s) => s.bodies);
  /** finds in the order you caught them, for PREV / NEXT */
  const order = systems.filter((s) => !s.belt).concat(systems.filter((s) => s.belt)).flatMap((s) => {
    const src = s.night.bodies.filter((b) => !b.unknown);
    return src.map((b) => s.bodies.find((x) => x.id === b.id)!).filter(Boolean);
  });
  const outerR = (dated.length ? R0 + (dated.length - 1) * STEP : CORE_R) + STEP;
  const lastRing = dated.length - 1;

  // pre-drawn glows, one per house colour, so hundreds of stars stay cheap
  const glow = HOUSES.map((h) => {
    const c = document.createElement("canvas"); c.width = c.height = 32;
    const x = c.getContext("2d")!, gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, h.color); gr.addColorStop(0.35, h.color + "88"); gr.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
    return c;
  });

  // ------------------------------------------------------------ camera
  let W = 0, H = 0, dpr = 1;
  const cam = { x: 0, y: 0, z: 1 };
  let fly: { x: number; y: number; z: number; t0: number; from: { x: number; y: number; z: number }; follow?: Placed } | null = null;
  let following: Placed | null = null;
  let filter = -1;
  let selected: Placed | null = null;
  let fresh: Sys | null = null, freshUntil = 0;
  const narrow = () => W < 760;
  /** width the chart rail takes on the right on wide screens */
  const railW = () => (narrow() ? 0 : rail.offsetWidth + 24);
  /** height the collapsed rail takes at the bottom on phones */
  const railH = () => (narrow() ? rail.offsetHeight + 8 : 0);
  const resize = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  };
  resize();
  /** the visible middle of the map, leaving out the header and the rail */
  const midX = () => (W - railW()) / 2, midY = () => (H - railH()) / 2 + 30;
  const fit = () => {
    // leave room for the arm names at the tips (a fixed size on screen, not in the galaxy)
    const half = Math.min((W - railW()) / 2, (H - railH() - 110) / 2) - (narrow() ? 34 : 62);
    cam.x = 0; cam.y = 0;
    cam.z = Math.max(0.03, Math.min(1.6, (half - (narrow() ? 22 : 36)) / (outerR + 14)));
  };
  fit();
  const fitZ = cam.z;
  const clampZ = (z: number) => Math.max(Math.min(0.08, fitZ * 0.7), Math.min(5, z));
  let ringSel: Sys | null = null;
  const toScreen = (x: number, y: number) => [(x - cam.x) * cam.z + midX(), (y - cam.y) * cam.z + midY()] as const;
  const toWorld = (sx: number, sy: number) => [(sx - midX()) / cam.z + cam.x, (sy - midY()) / cam.z + cam.y] as const;
  /** where a followed body sits on screen: left of centre on wide screens (card on its right), high on phones */
  const followOffset = (z: number) => (narrow() ? [0, (H * 0.27) / z] : [-(Math.min(200, W * 0.14)) / z, 0]);
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

  /** a find: its picture in a round window, ringed in its band's colour */
  function drawFind(b: Placed, sx: number, sy: number, rad: number, lit: boolean) {
    const a = g.globalAlpha, ring = o.bandColors[b.band];
    if (lit) {
      const halo = g.createRadialGradient(sx, sy, rad * 0.8, sx, sy, rad * 2.2);
      halo.addColorStop(0, HOUSES[b.house].color + "88"); halo.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = halo; g.fillRect(sx - rad * 2.2, sy - rad * 2.2, rad * 4.4, rad * 4.4);
    }
    g.fillStyle = "#171030"; g.beginPath(); g.arc(sx, sy, rad, 0, Math.PI * 2); g.fill();
    g.save(); g.beginPath(); g.arc(sx, sy, rad, 0, Math.PI * 2); g.clip();
    const box = rad * 1.7, k = Math.min(box / b.sprite.width, box / b.sprite.height);
    const sw = b.sprite.width * k, sh = b.sprite.height * k;
    g.imageSmoothingEnabled = b.sprite.width > 60;
    g.drawImage(b.sprite, sx - sw / 2, sy - sh / 2, sw, sh);
    g.restore();
    g.strokeStyle = lit ? HOUSES[b.house].color : ring; g.lineWidth = Math.max(1.5, rad * 0.11);
    g.beginPath(); g.arc(sx, sy, rad, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = a;
  }

  function frame(now: number) {
    const t = (now - t0) / 1000;
    if (fly) {
      const k = Math.min(1, (now - fly.t0) / 900), e = 1 - Math.pow(1 - k, 3);
      const fo = fly.follow ? followOffset(fly.z) : [0, 0];
      const tx = (fly.follow ? fly.follow.x : fly.x) - fo[0], ty = (fly.follow ? fly.follow.y : fly.y) + fo[1];
      cam.x = fly.from.x + (tx - fly.from.x) * e; cam.y = fly.from.y + (ty - fly.from.y) * e;
      cam.z = Math.exp(Math.log(fly.from.z) + (Math.log(fly.z) - Math.log(fly.from.z)) * e);
      if (k >= 1) { following = fly.follow ?? null; fly = null; }
    } else if (following) { const fo = followOffset(cam.z); cam.x = following.x - fo[0]; cam.y = following.y + fo[1]; }

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#0b0818"; g.fillRect(0, 0, W, H);
    const neb = g.createRadialGradient(W * 0.35, H * 0.4, 0, W * 0.35, H * 0.4, Math.max(W, H) * 0.8);
    neb.addColorStop(0, "rgba(70,40,110,0.35)"); neb.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = neb; g.fillRect(0, 0, W, H);
    for (const s of bg) {
      const x = (((s.x * 3000 - cam.x * s.d) % W) + W) % W, y = (((s.y * 3000 - cam.y * s.d) % H) + H) % H;
      g.globalAlpha = REDUCED ? 0.7 : 0.45 + 0.4 * Math.sin(t * 1.3 + s.tw);
      g.fillStyle = s.c; g.fillRect(Math.round(x), Math.round(y), s.s, s.s);
    }
    g.globalAlpha = 1;

    const z = cam.z, far = z < 0.55, c0 = toScreen(0, 0);
    const on = (b: Placed) => filter < 0 || b.house === filter;
    // the core
    const coreR = Math.max(30, Math.min(170, 150 * z));
    const core = g.createRadialGradient(c0[0], c0[1], 0, c0[0], c0[1], coreR);
    core.addColorStop(0, "rgba(255,240,205,0.75)"); core.addColorStop(0.3, "rgba(255,200,120,0.25)"); core.addColorStop(1, "rgba(255,150,80,0)");
    g.fillStyle = core; g.fillRect(c0[0] - coreR, c0[1] - coreR, coreR * 2, coreR * 2);
    // the rings: one per night, each week a little brighter, tonight's in gold
    g.lineWidth = 1;
    for (const s of systems) {
      if (s.belt) continue;
      const last = s.ring === lastRing, week = s.ring % 7 === 6, picked = ringSel === s;
      g.globalAlpha = picked ? 0.7 : last ? 0.5 : week ? 0.13 : 0.05;
      g.strokeStyle = picked || last ? "#fee761" : "#b9a8e0";
      if (last || picked) g.setLineDash([3, 5]);
      g.beginPath(); g.arc(c0[0], c0[1], s.r * z, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    }
    // a soft haze along each arm in its house colour, so the arms read as arms from far out
    if (z < 0.9) for (const b of bodies) {
      if (b.unknown || !on(b)) continue;
      const p = toScreen(b.x, b.y), hr = 24 * z + 6;
      if (p[0] < -hr || p[0] > W + hr || p[1] < -hr || p[1] > H + hr) continue;
      g.globalAlpha = filter >= 0 ? 0.22 : 0.13; g.drawImage(glow[b.house], p[0] - hr, p[1] - hr, hr * 2, hr * 2);
    }
    // the finds
    const twinkle = !REDUCED;
    for (const s of systems) {
      const dimRing = ringSel && ringSel !== s ? 0.35 : 1;
      for (const b of s.bodies) {
        const p = toScreen(b.x, b.y);
        if (p[0] < -30 || p[0] > W + 30 || p[1] < -30 || p[1] > H + 30) continue;
        const lit = on(b);
        if (b.unknown) {
          g.globalAlpha = (lit ? 0.35 : 0.08) * dimRing;
          g.fillStyle = HOUSES[b.house].color;
          const d = Math.max(1, Math.min(3, 2 * z));
          g.fillRect(Math.round(p[0] - d / 2), Math.round(p[1] - d / 2), Math.ceil(d), Math.ceil(d));
          if (selected === b) { g.globalAlpha = 1; g.strokeStyle = "#fee761"; g.lineWidth = 1.5; g.setLineDash([2, 3]); g.beginPath(); g.arc(p[0], p[1], 10 + Math.sin(t * 4) * 1.5, 0, 7); g.stroke(); g.setLineDash([]); }
          continue;
        }
        const rad = BODY_R * z * (b.band === 4 ? 1.15 : 1);
        if (far || rad < 6) {
          // a star: glow in the house colour, brighter for harder finds
          const s0 = (1.3 + b.band * 0.36) * Math.max(0.7, Math.min(2.2, z * 2.2));
          const tw = twinkle ? 0.8 + 0.2 * Math.sin(t * 1.6 + b.a0) : 1;
          g.globalAlpha = (lit ? 1 : 0.12) * dimRing * tw;
          const gs = s0 * 4.2;
          g.drawImage(glow[b.house], p[0] - gs, p[1] - gs, gs * 2, gs * 2);
          g.fillStyle = "#fff"; g.fillRect(Math.round(p[0] - s0 / 2), Math.round(p[1] - s0 / 2), Math.ceil(s0), Math.ceil(s0));
        } else {
          g.globalAlpha = (lit ? 1 : 0.13) * dimRing;
          drawFind(b, p[0], p[1], rad, filter >= 0 && lit);
          if (z > 2.1) {
            g.globalAlpha = (lit ? 1 : 0.2) * Math.min(1, (z - 2.1) * 2);
            g.font = "15px VT323, monospace"; g.textAlign = "center"; g.fillStyle = "#e9e0ff";
            g.fillText(b.name, p[0], p[1] + rad + 13);
          }
        }
        if (fresh === s && now < freshUntil) {
          const k = (freshUntil - now) / 6000;
          g.globalAlpha = Math.min(1, k * 2) * (0.5 + 0.5 * Math.sin(t * 5 + b.a0 * 3));
          g.strokeStyle = "#fee761"; g.lineWidth = 1.5;
          g.beginPath(); g.arc(p[0], p[1], Math.max(rad, 4) + 5, 0, Math.PI * 2); g.stroke();
        }
        if (selected === b) {
          g.globalAlpha = 1; g.strokeStyle = "#fee761"; g.lineWidth = 2;
          g.beginPath(); g.arc(p[0], p[1], Math.max(rad, 4) + 5 + Math.sin(t * 4) * 1.5, 0, Math.PI * 2); g.stroke();
        }
      }
    }
    g.globalAlpha = 1; g.textAlign = "center";
    // night labels in the gap between two arms: every ring up close, every week from further out, always tonight
    for (const s of systems) {
      if (s.belt) continue;
      const last = s.ring === lastRing;
      if (!last && ringSel !== s && !(z > 0.6 && z < 2.2 && s.ring % 7 === 6)) continue;
      const a = armAngle(0.5, s.ring), p = toScreen(Math.cos(a) * s.r, Math.sin(a) * s.r);
      g.font = `${last || ringSel === s ? 8 : 7}px "Press Start 2P", monospace`;
      g.fillStyle = last || ringSel === s ? "#fee761" : "#b9a8e0"; g.globalAlpha = last || ringSel === s ? 0.95 : 0.6;
      g.fillText(last ? "TONIGHT" : s.night.label.replace(/^\w+, /, "").toUpperCase(), p[0], p[1] + 3);
    }
    const core0 = systems.find((s) => s.belt);
    if (core0 && z > 0.5) { g.font = "15px VT323, monospace"; g.fillStyle = "#b9a8e0"; g.globalAlpha = 0.7; g.fillText("practice", c0[0], c0[1] + 4); }
    // the arms' names at their tips, with your score
    HOUSES.forEach((h, i) => {
      const a = armAngle(i, Math.max(0, lastRing)), R = outerR + 14 + (W < 760 ? 22 : 36) / z;
      const p = toScreen(Math.cos(a) * R, Math.sin(a) * R);
      const lit = filter < 0 || filter === i, small = W < 760;
      g.globalAlpha = lit ? 1 : 0.35;
      drawGlyph(g, h, p[0], p[1] - (small ? 18 : 22), small ? 15 : 20, 1, 1.1);
      g.font = `${small ? 7 : 8}px "Press Start 2P", monospace`; g.fillStyle = h.color; g.fillText(h.name.replace("The ", "").toUpperCase(), p[0], p[1] + 2);
      g.font = `${small ? 16 : 19}px VT323, monospace`; g.fillStyle = "#fff"; g.fillText(String(scores[i]), p[0], p[1] + (small ? 17 : 20));
    });
    g.globalAlpha = 1;
    // the card sits beside the selected find on wide screens, with a dotted leader to it
    if (selected && !narrow() && !card.hidden) {
      const p = toScreen(selected.x, selected.y), rad = Math.max(4, BODY_R * z);
      const cw = card.offsetWidth, ch = card.offsetHeight, gap = rad + 34;
      let left = p[0] + gap, top = p[1] - ch / 2;
      if (left + cw > W - railW() - 8) left = p[0] - gap - cw;
      top = Math.max(80, Math.min(H - ch - 20, top));
      card.style.left = `${Math.round(left)}px`; card.style.top = `${Math.round(top)}px`;
      g.globalAlpha = 0.6; g.strokeStyle = HOUSES[selected.house].color; g.lineWidth = 1; g.setLineDash([2, 4]);
      const ex = left > p[0] ? left : left + cw;
      g.beginPath(); g.moveTo(p[0] + Math.sign(ex - p[0]) * (rad + 6), p[1]); g.lineTo(ex, Math.max(top + 12, Math.min(top + ch - 12, p[1]))); g.stroke(); g.setLineDash([]);
      g.globalAlpha = 1;
    }
    raf = requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ the chart rail
  const dial = rail.querySelector<HTMLCanvasElement>(".uni-dial")!;
  function paintDial() {
    const d = Math.min(2, window.devicePixelRatio || 1), size = 220;
    dial.width = dial.height = size * d; dial.style.width = dial.style.height = `${size}px`;
    const dg = dial.getContext("2d")!; dg.setTransform(d, 0, 0, d, 0, 0); dg.clearRect(0, 0, size, size);
    drawChart(dg, size / 2, size / 2, size / 2 - 34, scores, filter, sign);
    // glyphs around the rim
    HOUSES.forEach((h, i) => {
      const a = (i / HOUSES.length) * Math.PI * 2 - Math.PI / 2, R = size / 2 - 12;
      drawGlyph(dg, h, size / 2 + Math.cos(a) * R, size / 2 + Math.sin(a) * R, 15, filter < 0 || filter === i ? 1 : 0.4, 1);
    });
  }
  function setFilter(h: number) {
    filter = h;
    rail.querySelectorAll<HTMLElement>(".uni-houses button").forEach((b) => b.classList.toggle("on", Number(b.dataset.h) === h));
    rail.classList.toggle("filtered", h >= 0);
    if (h < 0) {
      info.innerHTML = `<p>${anySeen ? `Your sign is <b style="color:${HOUSES[sign].color}">${HOUSES[sign].name}</b>: you name ${esc(HOUSES[sign].kind.toLowerCase())} best.` : "Play a night and your chart starts to take shape."} Tap a house to light up its finds.</p>`;
    } else {
      const hs = o.scores[h], house = HOUSES[h];
      const mine = found.filter((b) => b.house === h).length;
      info.innerHTML = `<h3 style="color:${house.color}">${house.name.toUpperCase()} <small>${esc(house.kind)}</small></h3>
        <p class="uni-score"><b>${hs.score}</b> ${rankOf(hs.score).toUpperCase()}</p>
        <p>${hs.seen ? `${mine} ${mine === 1 ? "find" : "finds"} lit up on the map. You named ${hs.named} of the ${hs.seen} you've seen.` : `Nothing from this house has risen for you yet, so it starts at ${hs.score}.`}</p>`;
    }
    if (selected && h >= 0 && selected.house !== h) closeCard();
    paintDial();
  }
  rail.querySelectorAll<HTMLButtonElement>(".uni-houses button").forEach((b) => (b.onclick = () => {
    ui("toggle");
    const h = Number(b.dataset.h);
    setFilter(filter === h ? -1 : h);
  }));
  rail.querySelector<HTMLButtonElement>("#uni-all")!.onclick = () => { ui("toggle"); setFilter(-1); };
  const head = rail.querySelector<HTMLButtonElement>("#uni-chart-head")!;
  head.onclick = () => {
    if (!narrow()) return;
    const open = !rail.classList.contains("open");
    ui(open ? "tap" : "back");
    rail.classList.toggle("open", open); head.setAttribute("aria-expanded", String(open));
    if (open) closeCard();
  };
  const awayBtn = rail.querySelector<HTMLButtonElement>("#uni-away");
  if (awayBtn && gotAway) awayBtn.onclick = () => {
    const b = bodies.find((x) => x.id === gotAway!.b.id && x.unknown);
    if (!b) return;
    ui("tap"); rail.classList.remove("open"); setFilter(-1); showBody(b);
  };
  setFilter(-1);

  // ------------------------------------------------------------ picking and the card
  function pick(sx: number, sy: number): Placed | Sys | null {
    let best: Placed | null = null, bd = Infinity;
    for (const b of bodies) {
      if (filter >= 0 && b.house !== filter) continue;
      const p = toScreen(b.x, b.y), rad = b.unknown ? 10 : Math.max(12, BODY_R * cam.z * 1.2);
      const d = Math.hypot(p[0] - sx, p[1] - sy);
      if (d < rad && d < bd && (!b.unknown || cam.z > 1.2)) { best = b; bd = d; }
    }
    if (best) return best;
    // no find under the finger: the ring (night) you tapped on, if you're close enough to tell them apart
    if (cam.z < 0.35) return null;
    const w = toWorld(sx, sy), d = Math.hypot(w[0], w[1]);
    let ring: Sys | null = null, rd = STEP * 0.5;
    for (const s of systems) if (!s.belt && Math.abs(d - s.r) < rd) { rd = Math.abs(d - s.r); ring = s; }
    if (!ring && d < CORE_R + STEP * 0.6) ring = systems.find((s) => s.belt) ?? null;
    return ring;
  }
  function picture(b: Placed): HTMLElement {
    const img = b.hi && b.hi.complete && b.hi.naturalWidth ? (b.hi.cloneNode() as HTMLImageElement) : null;
    if (img) return img;
    const c = document.createElement("canvas"); c.width = b.sprite.width; c.height = b.sprite.height; c.getContext("2d")!.drawImage(b.sprite, 0, 0);
    return c;
  }
  function wireCard(b?: Placed) {
    (card.querySelector(".card-x") as HTMLElement).onclick = () => { ui("back"); closeCard(); };
    if (!b) return;
    const list = filter >= 0 ? order.filter((x) => x.house === filter) : order;
    const i = list.indexOf(b);
    const prev = card.querySelector<HTMLButtonElement>(".uni-prev"), next = card.querySelector<HTMLButtonElement>(".uni-next");
    if (prev) { prev.disabled = i <= 0; prev.onclick = () => { ui("tap"); showBody(list[i - 1]); }; }
    if (next) { next.disabled = i < 0 || i >= list.length - 1; next.onclick = () => { ui("tap"); showBody(list[i + 1]); }; }
  }
  function showBody(b: Placed) {
    selected = b; ringSel = null;
    rail.classList.remove("open");
    const night = systems[b.sys].night, house = HOUSES[b.house];
    card.hidden = false;
    card.style.setProperty("--band", o.bandColors[b.band]);
    const houseLine = `<p class="uni-house" style="--c:${house.color}"><span class="g"></span>${house.name.toUpperCase()} · you're ${scores[b.house]}</p>`;
    if (b.unknown) {
      card.innerHTML = `<button class="card-x" aria-label="Close">✕</button>
        <div class="uni-top"><div class="uni-pic unknown"><span>?</span></div><div>
        <p class="uni-kind"><i></i>${o.bandNames[b.band].toUpperCase()} · UNDISCOVERED</p>
        <h2>Still out there</h2>${houseLine}</div></div>
        <p class="uni-note">${b.skipped ? `It rose in your telescope ${esc(night.label)} and you let it go.` : `It was in the sky ${esc(night.label)} but rose after your time ran out.`}</p>
        <p class="small">Play that night again from Past Skies in the Star Atlas to catch it.</p>`;
    } else {
      const how = b.zoomed ? "while zoomed in ★" : "named";
      card.innerHTML = `<button class="card-x" aria-label="Close">✕</button>
        <div class="uni-top"><div class="uni-pic"></div><div>
        <p class="uni-kind"><i></i>${o.bandNames[b.band].toUpperCase()}</p>
        <h2>${esc(b.name)}</h2>${houseLine}
        ${b.others.length ? `<p class="small">also: ${b.others.map(esc).join(", ")}</p>` : ""}</div></div>
        ${b.note ? `<p class="uni-note">${esc(b.note)}</p>` : ""}
        <dl class="uni-facts">
          <dt>CAUGHT</dt><dd>${night.date ? `${esc(night.label)}${b.t !== undefined ? ` · ${Math.round(b.t)} s into the night` : ""}` : "on a practice sky"}</dd>
          <dt>HOW</dt><dd>${how}${b.points ? ` · +${b.points}` : ""}</dd>
          ${b.seen ? `<dt>SEEN</dt><dd>${b.seen === 1 ? "the one night it rose for you" : `${b.seen} nights it rose for you`}</dd>` : ""}
        </dl>
        <div class="uni-step"><button class="btn uni-prev" type="button">&lt; PREV</button><button class="btn uni-next" type="button">NEXT &gt;</button></div>`;
      card.querySelector(".uni-pic")!.appendChild(picture(b));
    }
    card.querySelector<HTMLElement>(".uni-house .g")!.appendChild(glyphCanvas(house, 18));
    wireCard(b.unknown ? undefined : b);
    flyTo(b.x, b.y, Math.max(cam.z, narrow() ? 2.2 : 2.6), b);
  }
  function showSystem(s: Sys, lead = "") {
    selected = null;
    rail.classList.remove("open");
    card.hidden = false;
    card.style.setProperty("--band", "#f2d38a");
    const mine = s.bodies.filter((b) => !b.unknown);
    const byHouse = HOUSES.map((_, h) => mine.filter((b) => b.house === h).length);
    const lost = s.bodies.filter((b) => b.unknown).length;
    card.innerHTML = `<button class="card-x" aria-label="Close">✕</button>
      <p class="uni-kind"><i></i>${s.belt ? "THE CORE · PRACTICE FINDS" : `YOUR ${ordinal(s.ring + 1)} NIGHT`}</p>
      <h2>${esc(s.night.label)}</h2>
      ${s.night.sub ? `<p class="small">${esc(s.night.sub)}</p>` : ""}
      ${lead ? `<p class="uni-note">${esc(lead)}</p>` : s.night.title ? `<p class="uni-note">Best find: ${esc(s.night.title)}.</p>` : ""}
      <ul class="uni-tally">${byHouse.map((n, h) => (n ? `<li style="--c:${HOUSES[h].color}"><i></i>${n} · ${HOUSES[h].name}</li>` : "")).join("")}${lost ? `<li style="--c:#5a5078"><i></i>${lost} still out there</li>` : ""}</ul>`;
    wireCard();
    ringSel = s;
    // show the whole ring, nudged so the card doesn't cover it
    const zz = Math.min(1.6, Math.min((W - railW() - (narrow() ? 24 : 380)) / (2 * s.r + 120), (H - railH() - (narrow() ? H * 0.45 : 140)) / (2 * s.r + 120)));
    flyTo(narrow() ? 0 : 150 / zz, narrow() ? (H * 0.2) / zz : 0, zz);
  }
  function closeCard() { card.hidden = true; selected = null; following = null; ringSel = null; }

  // ------------------------------------------------------------ input
  const pts = new Map<number, { x: number; y: number }>();
  let moved = 0, pinch0 = 0, z0 = 1;
  root.addEventListener("dragstart", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    window.getSelection()?.removeAllRanges();
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
    if (rail.classList.contains("open")) { rail.classList.remove("open"); head.setAttribute("aria-expanded", "false"); return; }
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
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { if (!card.hidden) closeCard(); else { stop(); o.onBack(); } }
    else if (selected && !selected.unknown && (e.key === "ArrowLeft" || e.key === "ArrowRight")) card.querySelector<HTMLButtonElement>(e.key === "ArrowLeft" ? ".uni-prev" : ".uni-next")?.click();
  };
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", resize);
  const stop = () => { cancelAnimationFrame(raf); document.removeEventListener("keydown", onKey); window.removeEventListener("resize", resize); };
  app.querySelector<HTMLButtonElement>("#uni-back")!.onclick = () => { ui("back"); stop(); o.onBack(); };
  root.classList.toggle("empty", !total);
  raf = requestAnimationFrame(frame);
  const focusSys = o.focus ? systems.find((s) => s.night.date === o.focus) : undefined;
  if (focusSys) {
    freshUntil = performance.now() + 6000;
    fresh = focusSys;
    const n = focusSys.bodies.filter((b) => !b.unknown).length;
    setTimeout(() => { ui("dive"); showSystem(focusSys, `Tonight's ${n} ${n === 1 ? "find" : "finds"} joined your universe.`); }, REDUCED ? 0 : 500);
  }
  return stop;
}
