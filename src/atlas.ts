import { ui } from "./themes/chip";
/**
 * The front door: a telescope on a hill under the stars, then the Star Atlas, a map you can drag
 * and zoom. The brightest star in the middle is tonight's sky; a patch of small stars below it holds the
 * past skies, by date; the bright stars at the edges are the menu (community skies come later).
 */
import { mulberry32 } from "./daily";
import { meteorShower } from "./themes/pixel-space/sky";

export interface AtlasStar {
  id: string;
  label: string;
  sub?: string;
  /** Map position (map is 2000 x 2000 units, centre 1000,1000). */
  x: number;
  y: number;
  size: "huge" | "big" | "mid" | "small";
  color: string;
  /** What happens on click: either zoom in and run, or show a card. */
  open?: () => void;
  card?: () => string;
  /** Called after a card is shown, to wire its buttons. */
  wire?: (card: HTMLElement) => void;
  dim?: boolean;
}

/** A named part of the sky (community skies, special skies, your galaxy): a soft cloud, a label, and an arrow at the
 * screen edge pointing to it while it's out of view. Positions use the same frame as stars (tonight at 1000,1000). */
export interface AtlasRegion {
  id: string;
  label: string;
  sub?: string;
  x: number;
  y: number;
  rx: number;
  ry: number;
  color: string;
  /** Empty dotted rings: room for skies that don't exist yet. */
  slots?: number;
  /** Draw a little spiral galaxy in it. */
  galaxy?: boolean;
}

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** The map is MAP x MAP units. Callers place things around tonight at (1000,1000); OFF shifts that to the centre. */
const MAP = 5000;
const OFF = (MAP - 2000) / 2;
const SKY_PX = MAP / 4;

/** Set by the intro just before it hands over, so the atlas keeps the forward motion going. */
export const arrival = { forward: false };

// ---------------------------------------------------------------- atlas

export function atlasScreen(app: HTMLElement, stars: AtlasStar[], opts: { title: string; footer: string; focus?: string; onBack?: () => void; regions?: AtlasRegion[] }) {
  stars = stars.map((s) => ({ ...s, x: s.x + OFF, y: s.y + OFF }));
  const regions = (opts.regions ?? []).map((r) => ({ ...r, x: r.x + OFF, y: r.y + OFF }));
  app.innerHTML = `
  <main class="atlas" id="atlas">
    <div class="atlas-map" id="atlas-map">
      <canvas class="atlas-sky" id="atlas-sky" width="${SKY_PX}" height="${SKY_PX}" aria-hidden="true"></canvas>
      <canvas class="atlas-lines" id="atlas-lines" width="${SKY_PX}" height="${SKY_PX}" aria-hidden="true"></canvas>
    </div>
    <canvas class="atlas-meteors" id="atlas-meteors" aria-hidden="true"></canvas>
    ${opts.onBack ? `<button class="btn back-btn atlas-back" id="atlas-back" type="button" aria-label="Step back from the telescope to the front page">&lt; STEP BACK</button>` : ""}
    <header class="atlas-head"><span><img class="mark" src="/logo.svg" alt="" width="24" height="24" />${opts.title}</span><small>drag to look around · pinch or scroll to zoom</small></header>
    <div class="atlas-edges" id="atlas-edges"></div>
    <div class="atlas-tools">
      <button class="btn" id="atlas-out" aria-label="Zoom out">−</button>
      <button class="btn" id="atlas-in" aria-label="Zoom in">+</button>
      <button class="btn atlas-home" id="atlas-home" aria-label="Back to tonight's star">◎ HOME</button>
    </div>
    <canvas class="atlas-mini" id="atlas-mini" width="110" height="110" aria-label="Map of the whole atlas; tap to fly there"></canvas>
    <section class="atlas-card hidden" id="atlas-card" role="dialog" aria-live="polite"></section>
    <p class="atlas-foot">${opts.footer}</p>
  </main>`;
  const root = document.getElementById("atlas")!;
  const map = document.getElementById("atlas-map")!;
  const back = document.getElementById("atlas-back");
  if (back && opts.onBack) back.onclick = () => {
    // pull away from the map first, then the hill takes over
    if (REDUCED) { opts.onBack!(); return; }
    root.classList.add("leaving");
    setTimeout(opts.onBack!, 320);
  };
  drawSky(document.getElementById("atlas-sky") as HTMLCanvasElement, regions);
  drawLines(document.getElementById("atlas-lines") as HTMLCanvasElement, stars, regions);
  for (const r of regions) {
    const l = document.createElement("div");
    l.className = "aregion";
    l.style.left = `${r.x}px`;
    l.style.top = `${r.y - r.ry * 0.62}px`;
    l.style.setProperty("--c", r.color);
    l.innerHTML = `<b>${r.label}</b>${r.sub ? `<small>${r.sub}</small>` : ""}`;
    map.appendChild(l);
  }
  // arrows at the screen edge for regions out of view
  const edges = document.getElementById("atlas-edges")!;
  const arrows = regions.map((r) => {
    const a = document.createElement("button");
    a.className = "aedge";
    a.type = "button";
    a.style.setProperty("--c", r.color);
    a.innerHTML = `<i aria-hidden="true"></i><span>${r.label}</span>`;
    a.setAttribute("aria-label", `Fly to ${r.label.toLowerCase()}`);
    a.onclick = () => { ui("star"); animateTo(r.x, r.y, Math.max(minS(), Math.min(1, W() / (r.rx * 2.3), H() / (r.ry * 2.6))), 800); };
    edges.appendChild(a);
    return a;
  });
  const mini = document.getElementById("atlas-mini") as HTMLCanvasElement;
  const mg = mini.getContext("2d")!;
  if (!REDUCED) shootingStars(document.getElementById("atlas-meteors") as HTMLCanvasElement);

  for (const s of stars) {
    const b = document.createElement("button");
    b.className = `astar ${s.size}${s.dim ? " dim" : ""}`;
    b.style.left = `${s.x}px`;
    b.style.top = `${s.y}px`;
    b.style.setProperty("--c", s.color);
    b.dataset.id = s.id;
    // a star at the heart of a region lets the region's big label speak for it
    const bare = regions.some((r) => r.id === s.id);
    if (bare) b.classList.add("bare");
    b.innerHTML = `<i></i><span>${bare ? "" : s.label}${s.sub ? `<small>${s.sub}</small>` : ""}</span>`;
    b.setAttribute("aria-label", `${s.label}${s.sub ? `, ${s.sub}` : ""}`);
    map.appendChild(b);
  }

  // view state: a map point (mx, my) shows at screen (x + mx * s, y + my * s)
  const view = { x: 0, y: 0, s: 1 };
  const W = () => root.clientWidth, H = () => root.clientHeight;
  const minS = () => (W() < 600 ? W() / (MAP * 0.55) : Math.min(W(), H()) / (MAP * 0.8)), maxS = () => 3.2;
  let far = false;
  const overlay = () => {
    const s = view.s, w = W(), h = H();
    // zoomed far out, the little stars' labels would pile up: keep only the big names
    const nowFar = s < home() * 0.6;
    if (nowFar !== far) { far = nowFar; root.classList.toggle("far", far); }
    root.classList.toggle("mid", s < 0.7);
    // edge arrows: where the line from the screen centre to the region leaves the screen
    regions.forEach((r, i) => {
      const a = arrows[i], sx = view.x + r.x * s, sy = view.y + r.y * s;
      const inView = far || (sx > -r.rx * s * 0.3 && sx < w + r.rx * s * 0.3 && sy > -r.ry * s * 0.3 && sy < h + r.ry * s * 0.3);
      const onScreen = sx > 40 && sx < w - 40 && sy > 90 && sy < h - 70;
      if (inView || onScreen) { a.hidden = true; return; }
      a.hidden = false;
      const cx = w / 2, cy = h / 2, dx = sx - cx, dy = sy - cy;
      const left = 26, right = w - 26, top = w < 600 ? 124 : 96, bottom = h - (w < 600 ? 190 : 170);
      const t = Math.min(dx > 0 ? (right - cx) / dx : dx < 0 ? (left - cx) / dx : Infinity, dy > 0 ? (bottom - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity);
      a.style.left = `${cx + dx * t}px`;
      a.style.top = `${cy + dy * t}px`;
      a.style.setProperty("--a", `${Math.atan2(dy, dx)}rad`);
      a.classList.toggle("at-right", dx * t > w * 0.25);
      a.classList.toggle("at-left", dx * t < -w * 0.25);
    });
    // the little map: regions, tonight, and the box you're looking through
    const k = mini.width / MAP;
    mg.clearRect(0, 0, mini.width, mini.height);
    mg.fillStyle = "rgba(13,10,26,0.85)"; mg.fillRect(0, 0, mini.width, mini.height);
    for (const r of regions) { mg.globalAlpha = 0.55; mg.fillStyle = r.color; mg.beginPath(); mg.ellipse(r.x * k, r.y * k, r.rx * k * 0.7, r.ry * k * 0.7, 0, 0, 7); mg.fill(); }
    mg.globalAlpha = 1;
    for (const st of stars) if (st.size !== "small") { mg.fillStyle = st.color; mg.fillRect(Math.round(st.x * k) - 1, Math.round(st.y * k) - 1, st.size === "huge" ? 3 : 2, st.size === "huge" ? 3 : 2); }
    mg.strokeStyle = "#ffffff"; mg.lineWidth = 1;
    mg.strokeRect(Math.round(-view.x / s * k) + 0.5, Math.round(-view.y / s * k) + 0.5, Math.max(3, Math.round(w / s * k)), Math.max(3, Math.round(h / s * k)));
  };
  const apply = () => {
    const s = view.s;
    view.x = Math.min(W() * 0.5, Math.max(W() * 0.5 - MAP * s, view.x));
    view.y = Math.min(H() * 0.5, Math.max(H() * 0.5 - MAP * s, view.y));
    map.style.transform = `translate(${view.x}px, ${view.y}px) scale(${s})`;
    root.style.setProperty("--inv", String(1 / s));
    overlay();
  };
  const centerOn = (mx: number, my: number, s: number) => { view.s = s; view.x = W() / 2 - mx * s; view.y = H() / 2 - my * s; apply(); };
  const home = () => Math.max(minS(), Math.min(1, W() / 1100, H() / 1150));
  const startAt = stars.find((s) => s.id === opts.focus) ?? stars[0];
  centerOn(startAt?.x ?? MAP / 2, startAt?.y ?? MAP / 2, home());

  let anim = 0;
  const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
  const animateTo = (mx: number, my: number, s: number, ms: number, done?: () => void, ease = easeInOut) => {
    cancelAnimationFrame(anim);
    const from = { cx: (W() / 2 - view.x) / view.s, cy: (H() / 2 - view.y) / view.s, s: view.s };
    if (REDUCED) { centerOn(mx, my, s); done?.(); return; }
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms), e = ease(p);
      const ls = Math.exp(Math.log(from.s) + (Math.log(s) - Math.log(from.s)) * e);
      view.s = ls; view.x = W() / 2 - (from.cx + (mx - from.cx) * e) * ls; view.y = H() / 2 - (from.cy + (my - from.cy) * e) * ls;
      map.style.transform = `translate(${view.x}px, ${view.y}px) scale(${ls})`;
      root.style.setProperty("--inv", String(1 / ls));
      overlay();
      if (p < 1) anim = requestAnimationFrame(step);
      else { apply(); done?.(); }
    };
    anim = requestAnimationFrame(step);
  };
  const zoomBy = (k: number, sx = W() / 2, sy = H() / 2) => {
    const s = Math.min(maxS(), Math.max(minS(), view.s * k));
    const mx = (sx - view.x) / view.s, my = (sy - view.y) / view.s;
    view.s = s; view.x = sx - mx * s; view.y = sy - my * s; apply();
  };

  // drag and pinch
  const pts = new Map<number, { x: number; y: number }>();
  let moved = 0, pinch = 0;
  root.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest(".atlas-card, .atlas-tools, .aedge, .atlas-mini")) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0;
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  root.addEventListener("pointermove", (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    if (pts.size === 1) {
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 6) { view.x += dx; view.y += dy; apply(); root.classList.add("dragging"); }
    } else if (pts.size === 2) {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) zoomBy(d / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch = d; moved = 99;
      return;
    }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  const up = (e: PointerEvent) => { pts.delete(e.pointerId); if (!pts.size) setTimeout(() => root.classList.remove("dragging"), 0); pinch = 0; };
  root.addEventListener("pointerup", up);
  root.addEventListener("pointercancel", up);
  root.addEventListener("wheel", (e) => { e.preventDefault(); zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
  document.getElementById("atlas-in")!.onclick = () => zoomBy(1.4);
  document.getElementById("atlas-out")!.onclick = () => zoomBy(1 / 1.4);
  document.getElementById("atlas-home")!.onclick = () => animateTo(MAP / 2, MAP / 2, home(), 700);
  mini.onclick = (e) => {
    const b = mini.getBoundingClientRect();
    animateTo(((e.clientX - b.left) / b.width) * MAP, ((e.clientY - b.top) / b.height) * MAP, view.s, 600);
  };
  window.addEventListener("resize", apply);

  // stars: tap to open
  const card = document.getElementById("atlas-card")!;
  const closeCard = () => { card.classList.add("hidden"); root.classList.remove("card-open"); map.querySelectorAll(".astar.on").forEach((n) => n.classList.remove("on")); };
  map.addEventListener("click", (e) => {
    if (moved > 6) return; // that was a drag
    const b = (e.target as HTMLElement).closest(".astar") as HTMLElement | null;
    if (!b) { if (!card.classList.contains("hidden")) ui("back"); closeCard(); return; }
    ui(stars.find((x) => x.id === b.dataset.id)?.open ? "dive" : "star");
    const s = stars.find((x) => x.id === b.dataset.id)!;
    closeCard();
    b.classList.add("on");
    if (s.open) {
      // fly into the star, then hand over
      root.classList.add("diving");
      animateTo(s.x, s.y, maxS() * 2.2, 900, s.open);
      return;
    }
    if (s.card) {
      animateTo(s.x, s.y + 60 / Math.max(view.s, 0.5), Math.max(view.s, home() * 1.3), 450);
      card.innerHTML = `<button class="card-x" aria-label="Close">✕</button>${s.card()}`;
      card.classList.remove("hidden");
      root.classList.add("card-open");
      (card.querySelector(".card-x") as HTMLElement).onclick = closeCard;
      s.wire?.(card);
    }
  });
  document.addEventListener("keydown", function esc(e) {
    if (!document.getElementById("atlas")) { document.removeEventListener("keydown", esc); return; }
    if (e.key === "Escape") closeCard();
  });
  const fx = startAt?.x ?? MAP / 2, fy = startAt?.y ?? MAP / 2;
  if (REDUCED) return;
  if (arrival.forward) {
    // straight out of the eyepiece: keep flying forward, slowing to a stop (ease-out)
    arrival.forward = false;
    root.classList.add("arriving");
    const s0 = view.s;
    centerOn(fx, fy, s0 * 0.5);
    animateTo(fx, fy, s0, 1500, undefined, (p) => 1 - (1 - p) ** 4); // keep "arriving": removing it would replay the plain fade-in
  } else {
    // coming back from a game: a gentle pull-back from close in
    const s0 = view.s;
    centerOn(fx, fy, s0 * 3);
    animateTo(fx, fy, s0, 1100);
  }
}

// ---------------------------------------------------------------- map art

/** Now and then a shooting star crosses the atlas (screen-fixed, over the map, under the cards). */
function shootingStars(c: HTMLCanvasElement) {
  const g = c.getContext("2d")!, m = meteorShower(2500, 7000);
  const step = (t: number) => {
    if (!c.isConnected) return;
    const w = Math.ceil(c.clientWidth / 3), h = Math.ceil(c.clientHeight / 3);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    g.clearRect(0, 0, w, h);
    m.step(g, t, w, h);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function drawSky(c: HTMLCanvasElement, regions: AtlasRegion[]) {
  const g = c.getContext("2d")!, N = c.width, k = N / MAP;
  g.fillStyle = "#0d0a1a"; g.fillRect(0, 0, N, N);
  const rand = mulberry32(2024);
  const blob = (col: string, cx: number, cy: number, rx: number, ry: number, density = 0.55) => {
    g.fillStyle = col;
    for (let y = Math.floor(cy - ry); y < cy + ry; y++) for (let x = Math.floor(cx - rx); x < cx + rx; x++) {
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      if (d < 1 && rand() < (1 - d) * density && (x + y) % 2 === 0) g.fillRect(x, y, 1, 1);
    }
  };
  // the old home sky's clouds around tonight, then a scatter of faint ones across the wider map
  const o = OFF * k;
  for (const [col, cx, cy, r] of [["#2c1f4a", 250, 250, 140], ["#1b2e4a", 120, 140, 90], ["#3a1f3a", 390, 360, 100], ["#1f3a3a", 380, 110, 80], ["#2a2140", 110, 390, 90]] as const) blob(col, cx + o, cy + o, r, r);
  const faint = ["#1d1736", "#17213a", "#24172c", "#162a2a"];
  for (let i = 0; i < 22; i++) { const r = 50 + rand() * 110; blob(faint[i % 4], rand() * N, rand() * N, r, r * (0.6 + rand() * 0.6), 0.4); }
  // regions: a cloud in their colour, darkened
  for (const r of regions) blob(shade(r.color, 0.32), r.x * k, r.y * k, r.rx * k, r.ry * k, 0.6);
  // the galaxy band, corner to corner
  for (let i = 0; i < 9000; i++) {
    const t = rand() * N, off = (rand() - 0.5) * (rand() * 220);
    g.fillStyle = rand() < 0.5 ? "#26294a" : "#3a4466";
    g.fillRect(Math.round(t), Math.round(N * 0.62 - t * 0.35 + off), 1, 1);
  }
  // stars
  const cols = ["#5a6988", "#8b9bb4", "#c0cbdc", "#2ce8f5", "#e07ab8", "#fee761"];
  for (let i = 0; i < 9400; i++) {
    g.fillStyle = cols[Math.floor(rand() * (rand() < 0.85 ? 3 : 6))];
    g.fillRect(Math.floor(rand() * N), Math.floor(rand() * N), 1, 1);
  }
  // a spiral galaxy where asked
  for (const r of regions) if (r.galaxy) {
    for (let i = 0; i < 520; i++) {
      const arm = i % 2 ? Math.PI : 0, a = i * 0.045 + arm, d = 4 + i * 0.2 * (r.rx * k / 110);
      g.fillStyle = i % 11 ? r.color : "#2ce8f5";
      g.globalAlpha = 0.35 + 0.5 * (1 - i / 520);
      g.fillRect(Math.round(r.x * k + Math.cos(a) * d * 0.5), Math.round(r.y * k + Math.sin(a) * d * 0.35), 1, 1);
    }
    g.globalAlpha = 1;
  }
  // grid ticks like an old chart
  g.fillStyle = "#231d3a";
  for (let t = 50; t < N; t += 50) for (let j = 0; j < N; j += 4) { g.fillRect(t, j, 1, 1); g.fillRect(j, t, 1, 1); }
}

/** Mix a #rrggbb colour toward the night background. */
function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16), bg = [13, 10, 26];
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) => Math.round(bg[i] + (v - bg[i]) * f));
  return `rgb(${c.join(",")})`;
}

function drawLines(c: HTMLCanvasElement, stars: AtlasStar[], regions: AtlasRegion[]) {
  const g = c.getContext("2d")!, k = c.width / MAP;
  const centre = stars[0];
  g.fillStyle = "#2b4a6f";
  for (const s of stars.slice(1)) {
    if (s.size === "big" && !s.dim) dotted(g, centre.x * k, centre.y * k, s.x * k, s.y * k, 3);
  }
  // tonight leads down to the past-skies patch
  g.fillStyle = "#24304f";
  const past = stars.find((s) => s.id === "past-label");
  if (past) dotted(g, centre.x * k, centre.y * k, past.x * k, past.y * k, 4);
  // the trail of past nights, one dated star after another
  const trail = stars.filter((s) => s.id.startsWith("night-"));
  g.fillStyle = "#2a2f52";
  let prev = past;
  for (const s of trail) { if (prev) dotted(g, prev.x * k, prev.y * k, s.x * k, s.y * k, 3); prev = s; }
  // empty rings: room for skies that don't exist yet
  const rand = mulberry32(77);
  for (const r of regions) for (let i = 0; i < (r.slots ?? 0); i++) {
    const a = rand() * Math.PI * 2, d = 0.25 + Math.sqrt(rand()) * 0.7;
    const x = Math.round((r.x + Math.cos(a) * d * r.rx) * k), y = Math.round((r.y + Math.sin(a) * d * r.ry) * k);
    g.fillStyle = shade(r.color, 0.6);
    for (let t = 0; t < 12; t += 2) { const q = (t / 12) * Math.PI * 2; g.fillRect(Math.round(x + Math.cos(q) * 4), Math.round(y + Math.sin(q) * 4), 1, 1); }
  }
}

function dotted(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, every: number) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 6; i <= n - 6; i += every) g.fillRect(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 1, 1);
}
