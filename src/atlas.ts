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

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const MAP = 2000;

/** Set by the intro just before it hands over, so the atlas keeps the forward motion going. */
export const arrival = { forward: false };

// ---------------------------------------------------------------- atlas

export function atlasScreen(app: HTMLElement, stars: AtlasStar[], opts: { title: string; footer: string; focus?: string; onBack?: () => void }) {
  app.innerHTML = `
  <main class="atlas" id="atlas">
    <div class="atlas-map" id="atlas-map">
      <canvas class="atlas-sky" id="atlas-sky" width="500" height="500" aria-hidden="true"></canvas>
      <canvas class="atlas-lines" id="atlas-lines" width="500" height="500" aria-hidden="true"></canvas>
    </div>
    <canvas class="atlas-meteors" id="atlas-meteors" aria-hidden="true"></canvas>
    ${opts.onBack ? `<button class="btn back-btn atlas-back" id="atlas-back" type="button" aria-label="Step back from the telescope to the front page">&lt; STEP BACK</button>` : ""}
    <header class="atlas-head"><span>${opts.title}</span><small>drag to look around · pinch or scroll to zoom</small></header>
    <div class="atlas-tools">
      <button class="btn" id="atlas-out" aria-label="Zoom out">−</button>
      <button class="btn" id="atlas-in" aria-label="Zoom in">+</button>
      <button class="btn" id="atlas-home" aria-label="Back to tonight's star">◎</button>
    </div>
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
  drawSky(document.getElementById("atlas-sky") as HTMLCanvasElement);
  drawLines(document.getElementById("atlas-lines") as HTMLCanvasElement, stars);
  if (!REDUCED) shootingStars(document.getElementById("atlas-meteors") as HTMLCanvasElement);

  for (const s of stars) {
    const b = document.createElement("button");
    b.className = `astar ${s.size}${s.dim ? " dim" : ""}`;
    b.style.left = `${s.x}px`;
    b.style.top = `${s.y}px`;
    b.style.setProperty("--c", s.color);
    b.dataset.id = s.id;
    b.innerHTML = `<i></i><span>${s.label}${s.sub ? `<small>${s.sub}</small>` : ""}</span>`;
    b.setAttribute("aria-label", `${s.label}${s.sub ? `, ${s.sub}` : ""}`);
    map.appendChild(b);
  }

  // view state: a map point (mx, my) shows at screen (x + mx * s, y + my * s)
  const view = { x: 0, y: 0, s: 1 };
  const W = () => root.clientWidth, H = () => root.clientHeight;
  const minS = () => Math.min(W(), H()) / 1500, maxS = () => 3.2;
  const apply = () => {
    const s = view.s;
    view.x = Math.min(W() * 0.5, Math.max(W() * 0.5 - MAP * s, view.x));
    view.y = Math.min(H() * 0.5, Math.max(H() * 0.5 - MAP * s, view.y));
    map.style.transform = `translate(${view.x}px, ${view.y}px) scale(${s})`;
    root.style.setProperty("--inv", String(1 / s));
  };
  const centerOn = (mx: number, my: number, s: number) => { view.s = s; view.x = W() / 2 - mx * s; view.y = H() / 2 - my * s; apply(); };
  const home = () => Math.max(minS(), Math.min(1, W() / 1100, H() / 1150));
  const startAt = stars.find((s) => s.id === opts.focus) ?? stars[0];
  centerOn(startAt?.x ?? 1000, startAt?.y ?? 1000, home());

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
    if ((e.target as HTMLElement).closest(".atlas-card, .atlas-tools")) return;
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
  document.getElementById("atlas-home")!.onclick = () => animateTo(1000, 1000, home(), 600);
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
  const fx = startAt?.x ?? 1000, fy = startAt?.y ?? 1000;
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

function drawSky(c: HTMLCanvasElement) {
  const g = c.getContext("2d")!, N = c.width;
  g.fillStyle = "#0d0a1a"; g.fillRect(0, 0, N, N);
  const rand = mulberry32(2024);
  // nebula clouds: dithered blobs
  const clouds = [["#2c1f4a", 250, 250, 140], ["#1b2e4a", 120, 140, 90], ["#3a1f3a", 390, 360, 100], ["#1f3a3a", 380, 110, 80], ["#2a2140", 110, 390, 90]] as const;
  for (const [col, cx, cy, r] of clouds) {
    g.fillStyle = col;
    for (let y = cy - r; y < cy + r; y++) for (let x = cx - r; x < cx + r; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d < 1 && rand() < (1 - d) * 0.55 && (x + y) % 2 === 0) g.fillRect(x, y, 1, 1);
    }
  }
  // the galaxy band
  for (let i = 0; i < 2600; i++) {
    const t = rand() * N, off = (rand() - 0.5) * (rand() * 90);
    const x = t, y = N * 0.62 - t * 0.35 + off;
    g.fillStyle = rand() < 0.5 ? "#26294a" : "#3a4466";
    g.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
  // stars
  const cols = ["#5a6988", "#8b9bb4", "#c0cbdc", "#2ce8f5", "#e07ab8", "#fee761"];
  for (let i = 0; i < 1500; i++) {
    g.fillStyle = cols[Math.floor(rand() * (rand() < 0.85 ? 3 : 6))];
    g.fillRect(Math.floor(rand() * N), Math.floor(rand() * N), 1, 1);
  }
  // grid ticks like an old chart
  g.fillStyle = "#231d3a";
  for (let k = 50; k < N; k += 50) for (let j = 0; j < N; j += 4) { g.fillRect(k, j, 1, 1); g.fillRect(j, k, 1, 1); }
}

function drawLines(c: HTMLCanvasElement, stars: AtlasStar[]) {
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
}

function dotted(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, every: number) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 6; i <= n - 6; i += every) g.fillRect(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 1, 1);
}
