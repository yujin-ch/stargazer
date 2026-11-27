import { ui } from "./themes/chip";
/**
 * The front door: a telescope on a hill under the stars, then the Star Atlas, a map you can drag and zoom.
 *
 * The atlas has real coordinates: x from −5000 to +5000 (east is +), y from −5000 to +5000 (north/up is +), with
 * tonight's sky at (0, 0). Everything we show today sits within about ±500; the rest is room for community skies,
 * which will one day be placed at coordinates of their own. Zooming out is limited so the sky always feels big.
 *
 * The sky is drawn in tiles (made once, cached) onto one screen-sized canvas, so the map can be huge without a huge
 * bitmap. Stars and labels are buttons on a transformed layer above it.
 */
import { mulberry32 } from "./daily";
import { meteorShower } from "./themes/pixel-space/sky";

export interface AtlasStar {
  id: string;
  label: string;
  sub?: string;
  /** Atlas coordinates: tonight is (0, 0); x grows east, y grows north. */
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
 * screen edge pointing to it while it's out of view. Centre and radii in atlas coordinates. */
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
/** The edge of the charted sky, in coordinates. */
export const WORLD = 5000;
/** Map pixels per coordinate unit (at zoom 1). */
const K = 2.5;
/** How many coordinates the widest screen side may show when zoomed all the way out. */
const MAX_SPAN = 2400;
/** Sky tiles: TILE map pixels square, rendered at 1/4 resolution. */
const TILE = 1000, TRES = 4;

/** Set by the intro just before it hands over, so the atlas keeps the forward motion going. */
export const arrival = { forward: false };

/** "+0128.40"-style coordinate text. */
export function fmtCoord(v: number) {
  const s = Math.abs(v).toFixed(2).padStart(7, "0");
  return `${v < 0 ? "−" : "+"}${s}`;
}

// ---------------------------------------------------------------- atlas

export function atlasScreen(app: HTMLElement, starsIn: AtlasStar[], opts: { title: string; footer: string; focus?: string; onBack?: () => void; regions?: AtlasRegion[] }) {
  // coordinates -> map pixels (y flips: north is up on screen)
  const stars = starsIn.map((s) => ({ ...s, cx: s.x, cy: s.y, x: s.x * K, y: -s.y * K }));
  const regions = (opts.regions ?? []).map((r) => ({ ...r, cx: r.x, cy: r.y, x: r.x * K, y: -r.y * K, rx: r.rx * K, ry: r.ry * K }));
  app.innerHTML = `
  <main class="atlas" id="atlas">
    <canvas class="atlas-sky" id="atlas-sky" aria-hidden="true"></canvas>
    <canvas class="atlas-rulers" id="atlas-rulers" aria-hidden="true"></canvas>
    <div class="atlas-map" id="atlas-map"></div>
    <canvas class="atlas-meteors" id="atlas-meteors" aria-hidden="true"></canvas>
    ${opts.onBack ? `<button class="btn back-btn atlas-back" id="atlas-back" type="button" aria-label="Step back from the telescope to the front page">&lt; STEP BACK</button>` : ""}
    <header class="atlas-head"><span><img class="mark" src="/logo.svg" alt="" width="24" height="24" />${opts.title}</span><small>drag to look around · pinch or scroll to zoom</small></header>
    <div class="atlas-edges" id="atlas-edges"></div>
    <div class="atlas-tools">
      <button class="btn" id="atlas-out" aria-label="Zoom out">−</button>
      <button class="btn" id="atlas-in" aria-label="Zoom in">+</button>
      <button class="btn atlas-home" id="atlas-home" aria-label="Back to tonight's star">◎ HOME</button>
    </div>
    <canvas class="atlas-mini" id="atlas-mini" width="110" height="110" aria-label="Map of the charted sky near home; tap to fly there"></canvas>
    <p class="atlas-coord" id="atlas-coord" aria-live="off"></p>
    <section class="atlas-card hidden" id="atlas-card" role="dialog" aria-live="polite"></section>
    <p class="atlas-foot">${opts.footer}</p>
  </main>`;
  const root = document.getElementById("atlas")!;
  const map = document.getElementById("atlas-map")!;
  const sky = document.getElementById("atlas-sky") as HTMLCanvasElement;
  const sg = sky.getContext("2d")!;
  const rulers = document.getElementById("atlas-rulers") as HTMLCanvasElement;
  const rg = rulers.getContext("2d")!;
  const coordEl = document.getElementById("atlas-coord")!;
  const back = document.getElementById("atlas-back");
  if (back && opts.onBack) back.onclick = () => {
    // pull away from the map first, then the hill takes over
    if (REDUCED) { opts.onBack!(); return; }
    root.classList.add("leaving");
    setTimeout(opts.onBack!, 320);
  };
  const tiles = tileMaker(regions);
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
  // dotted lines between stars, drawn per frame in screen space
  type MapStar = (typeof stars)[number];
  const centre = stars[0];
  const links: [MapStar, MapStar, string, number][] = [];
  for (const s of stars.slice(1)) if (s.size === "big" && !s.dim) links.push([centre, s, "#2b4a6f", 6]);
  const past = stars.find((s) => s.id === "past-label");
  if (past) links.push([centre, past, "#24304f", 8]);
  let prev = past;
  for (const s of stars.filter((x) => x.id.startsWith("night-"))) { if (prev) links.push([prev, s, "#2a2f52", 6]); prev = s; }

  // view state: a map point (mx, my) shows at screen (x + mx * s, y + my * s)
  const view = { x: 0, y: 0, s: 1 };
  const W = () => root.clientWidth, H = () => root.clientHeight;
  const minS = () => Math.max(W(), H()) / (MAX_SPAN * K), maxS = () => 3.2;
  const home = () => Math.max(minS(), Math.min(1, W() / 1100, H() / 1150));
  let far = false, painted = 0;

  const paint = () => {
    painted = 0;
    if (!sky.isConnected) return;
    const w = W(), h = H(), s = view.s;
    // the sky canvas runs at half resolution for chunky pixels
    const cw = Math.ceil(w / 2), ch = Math.ceil(h / 2);
    if (sky.width !== cw || sky.height !== ch) { sky.width = cw; sky.height = ch; }
    sg.imageSmoothingEnabled = false;
    sg.fillStyle = "#07060f"; sg.fillRect(0, 0, cw, ch);
    const x0 = -view.x / s, y0 = -view.y / s, x1 = x0 + w / s, y1 = y0 + h / s;
    for (let ty = Math.floor(y0 / TILE); ty * TILE < y1; ty++) for (let tx = Math.floor(x0 / TILE); tx * TILE < x1; tx++) {
      const t = tiles(tx, ty);
      const sx = (view.x + tx * TILE * s) / 2, sy = (view.y + ty * TILE * s) / 2, sz = (TILE * s) / 2;
      sg.drawImage(t, Math.floor(sx), Math.floor(sy), Math.ceil(sz) + 1, Math.ceil(sz) + 1);
    }
    // links between stars
    for (const [a, b, col, every] of links) {
      sg.fillStyle = col;
      const ax = (view.x + a.x * s) / 2, ay = (view.y + a.y * s) / 2, bx = (view.x + b.x * s) / 2, by = (view.y + b.y * s) / 2;
      const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay)), step = Math.max(2, (every * s) / 2);
      for (let i = 8; i <= n - 8; i += step) sg.fillRect(Math.round(ax + ((bx - ax) * i) / n), Math.round(ay + ((by - ay) * i) / n), 1, 1);
    }
    // rulers: the coordinate grid's numbers along the top and left edges
    if (rulers.width !== w || rulers.height !== h) { rulers.width = w; rulers.height = h; }
    rg.clearRect(0, 0, w, h);
    const pxPerCoord = s * K;
    const stepC = [50, 100, 250, 500, 1000].find((c) => c * pxPerCoord >= 110) ?? 1000;
    rg.font = "15px VT323, ui-monospace, monospace";
    rg.fillStyle = "rgba(170, 160, 210, 0.55)";
    const cx0 = -view.x / pxPerCoord, cy0 = view.y / pxPerCoord;
    rg.textBaseline = "top";
    rg.textAlign = "center";
    for (let c = Math.ceil(cx0 / stepC) * stepC; c <= cx0 + w / pxPerCoord; c += stepC) {
      if (Math.abs(c) > WORLD) continue;
      const x = view.x + c * pxPerCoord;
      if (x < 60 || x > w - 60) continue;
      rg.fillRect(Math.round(x), 0, 1, 6);
      rg.fillText(c === 0 ? "0" : `${c > 0 ? "+" : "−"}${Math.abs(c)}`, x, 8);
    }
    rg.textAlign = "left";
    rg.textBaseline = "middle";
    for (let c = Math.floor(cy0 / stepC) * stepC; c >= cy0 - h / pxPerCoord; c -= stepC) {
      if (Math.abs(c) > WORLD) continue;
      const y = view.y - c * pxPerCoord;
      if (y < 110 || y > h - 170) continue;
      rg.fillRect(0, Math.round(y), 6, 1);
      rg.fillText(c === 0 ? "0" : `${c > 0 ? "+" : "−"}${Math.abs(c)}`, 9, y);
    }
    // where the middle of the screen is
    const mx = (w / 2 - view.x) / pxPerCoord, my = -(h / 2 - view.y) / pxPerCoord;
    coordEl.textContent = `${fmtCoord(mx)}, ${fmtCoord(my)}`;
  };
  const schedule = () => { if (!painted) painted = requestAnimationFrame(paint); };

  const overlay = () => {
    const s = view.s, w = W(), h = H();
    // zoomed far out, the little stars' labels would pile up: keep only the big names
    const nowFar = s < home() * 0.6;
    if (nowFar !== far) { far = nowFar; root.classList.toggle("far", far); }
    root.classList.toggle("mid", s < 0.7);
    // edge arrows: where the line from the screen centre to the region leaves the screen
    regions.forEach((r, i) => {
      const a = arrows[i], sx = view.x + r.x * s, sy = view.y + r.y * s;
      const inView = sx > -r.rx * s * 0.3 && sx < w + r.rx * s * 0.3 && sy > -r.ry * s * 0.3 && sy < h + r.ry * s * 0.3;
      const onScreen = sx > 40 && sx < w - 40 && sy > 90 && sy < h - 70;
      if (inView || onScreen) { a.hidden = true; return; }
      a.hidden = false;
      const cx = w / 2, cy = h / 2, dx = sx - cx, dy = sy - cy;
      const left = 26, right = w - 26, top = w < 600 ? 124 : 96, bottom = h - (w < 600 ? 190 : 170);
      const t = Math.min(dx > 0 ? (right - cx) / dx : dx < 0 ? (left - cx) / dx : Infinity, dy > 0 ? (bottom - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity);
      const ax = cx + dx * t;
      let ay = cy + dy * t;
      // a side arrow must not sit on a star's label: slide it along the edge until it is clear
      if (Math.abs(dx * t) > w * 0.25) {
        const rb = root.getBoundingClientRect();
        const boxes = Array.from(map.querySelectorAll<HTMLElement>(".astar:not(.bare) span, .aregion b, .aregion small")).map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0);
        const aw = 130, x0 = dx > 0 ? ax - aw : ax - 14, x1 = dx > 0 ? ax + 14 : ax + aw;
        for (let n = 0; n < 6; n++) {
          const hit = boxes.find((b) => b.right - rb.left > x0 && b.left - rb.left < x1 && b.bottom - rb.top > ay - 16 && b.top - rb.top < ay + 26);
          if (!hit) break;
          const up = hit.top - rb.top - 30, down = hit.bottom - rb.top + 18;
          ay = (Math.abs(up - ay) <= Math.abs(down - ay) && up > top) || down > bottom ? up : down;
        }
        ay = Math.max(top, Math.min(bottom, ay));
      }
      a.style.left = `${ax}px`;
      a.style.top = `${ay}px`;
      a.style.setProperty("--a", `${Math.atan2(dy, dx)}rad`);
      a.classList.toggle("at-right", dx * t > w * 0.25);
      a.classList.toggle("at-left", dx * t < -w * 0.25);
    });
    // the little map: home's neighbourhood (±1500), regions, tonight, and the box you're looking through
    const R = 1500 * K, k = mini.width / (2 * R), o = mini.width / 2;
    mg.clearRect(0, 0, mini.width, mini.height);
    mg.fillStyle = "rgba(13,10,26,0.85)"; mg.fillRect(0, 0, mini.width, mini.height);
    mg.fillStyle = "rgba(120,110,170,0.25)"; mg.fillRect(o, 0, 1, mini.height); mg.fillRect(0, o, mini.width, 1);
    for (const r of regions) { mg.globalAlpha = 0.55; mg.fillStyle = r.color; mg.beginPath(); mg.ellipse(o + r.x * k, o + r.y * k, Math.max(2, r.rx * k * 0.7), Math.max(2, r.ry * k * 0.7), 0, 0, 7); mg.fill(); }
    mg.globalAlpha = 1;
    for (const st of stars) if (st.size !== "small") { mg.fillStyle = st.color; mg.fillRect(Math.round(o + st.x * k) - 1, Math.round(o + st.y * k) - 1, st.size === "huge" ? 3 : 2, st.size === "huge" ? 3 : 2); }
    mg.strokeStyle = "#ffffff"; mg.lineWidth = 1;
    mg.strokeRect(Math.round(o - view.x / s * k) + 0.5, Math.round(o - view.y / s * k) + 0.5, Math.max(3, Math.round(w / s * k)), Math.max(3, Math.round(h / s * k)));
    schedule();
  };
  const place = () => {
    map.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
    root.style.setProperty("--inv", String(1 / view.s));
    overlay();
  };
  const apply = () => {
    const s = view.s, edge = WORLD * K;
    // the middle of the screen stays inside the charted sky
    view.x = Math.min(W() / 2 + edge * s, Math.max(W() / 2 - edge * s, view.x));
    view.y = Math.min(H() / 2 + edge * s, Math.max(H() / 2 - edge * s, view.y));
    place();
  };
  const centerOn = (mx: number, my: number, s: number) => { view.s = s; view.x = W() / 2 - mx * s; view.y = H() / 2 - my * s; apply(); };
  const startAt = stars.find((s) => s.id === opts.focus) ?? stars[0];
  centerOn(startAt?.x ?? 0, startAt?.y ?? 0, home());

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
      place();
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
  document.getElementById("atlas-home")!.onclick = () => animateTo(0, 0, home(), 700);
  mini.onclick = (e) => {
    const b = mini.getBoundingClientRect(), R = 1500 * K;
    animateTo((((e.clientX - b.left) / b.width) * 2 - 1) * R, (((e.clientY - b.top) / b.height) * 2 - 1) * R, view.s, 600);
  };
  window.addEventListener("resize", apply);

  // stars: tap to open
  const card = document.getElementById("atlas-card")!;
  const closeCard = () => { card.classList.add("hidden"); root.classList.remove("card-open"); map.querySelectorAll(".astar.on").forEach((n) => n.classList.remove("on")); };
  root.addEventListener("click", (e) => {
    if (moved > 6) return; // that was a drag
    const t = e.target as HTMLElement;
    if (t.closest(".atlas-card, .atlas-tools, .aedge, .atlas-mini, .atlas-back")) return;
    const b = t.closest(".astar") as HTMLElement | null;
    if (!b) { if (!card.classList.contains("hidden")) ui("back"); closeCard(); return; }
    const s = stars.find((x) => x.id === b.dataset.id)!;
    ui(s.open ? "dive" : "star");
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
      card.innerHTML = `<button class="card-x" aria-label="Close">✕</button>${s.card()}<p class="card-coord">at ${fmtCoord(s.cx)}, ${fmtCoord(s.cy)}</p>`;
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
  const fx = startAt?.x ?? 0, fy = startAt?.y ?? 0;
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

/** A stable pseudo-random number in [0, 1) for an integer point. */
function hash(x: number, y: number, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

type MapRegion = AtlasRegion & { x: number; y: number; rx: number; ry: number };

/** Returns tile(tx, ty): a cached canvas of the sky for map pixels [tx*TILE, (tx+1)*TILE), at 1/TRES resolution. */
function tileMaker(regions: MapRegion[]) {
  const cache = new Map<string, HTMLCanvasElement>();
  const N = TILE / TRES, edge = (WORLD * K) / TRES;
  // things drawn at fixed spots: galaxy spirals and empty rings, in tile pixels
  const dots: { x: number; y: number; c: string; a: number }[] = [];
  const rand = mulberry32(77);
  for (const r of regions) {
    if (r.galaxy) for (let i = 0; i < 700; i++) {
      const arm = i % 2 ? Math.PI : 0, a = i * 0.045 + arm, d = 4 + i * 0.2 * (r.rx / TRES / 110);
      dots.push({ x: Math.round(r.x / TRES + Math.cos(a) * d * 0.5), y: Math.round(r.y / TRES + Math.sin(a) * d * 0.35), c: i % 11 ? r.color : "#2ce8f5", a: 0.35 + 0.5 * (1 - i / 700) });
    }
    for (let i = 0; i < (r.slots ?? 0); i++) {
      const a = rand() * Math.PI * 2, d = 0.25 + Math.sqrt(rand()) * 0.7;
      const x = Math.round((r.x + Math.cos(a) * d * r.rx) / TRES), y = Math.round((r.y + Math.sin(a) * d * r.ry) / TRES);
      for (let t = 0; t < 12; t += 2) { const q = (t / 12) * Math.PI * 2; dots.push({ x: Math.round(x + Math.cos(q) * 4), y: Math.round(y + Math.sin(q) * 4), c: shade(r.color, 0.6), a: 1 }); }
    }
  }
  const regionCols = regions.map((r) => shade(r.color, 0.32));
  const faint = ["#1d1736", "#17213a", "#24172c", "#162a2a"];
  const cols = ["#5a6988", "#8b9bb4", "#c0cbdc", "#2ce8f5", "#e07ab8", "#fee761"];
  // faint clouds, a couple per 2x2 tiles, chosen by hash so neighbouring tiles agree
  const cloudsNear = (tx: number, ty: number) => {
    const out: { x: number; y: number; r: number; c: string }[] = [];
    for (let gy = Math.floor(ty / 2) - 1; gy <= Math.floor(ty / 2) + 1; gy++) for (let gx = Math.floor(tx / 2) - 1; gx <= Math.floor(tx / 2) + 1; gx++) {
      for (let k = 0; k < 2; k++) {
        if (hash(gx, gy, 11 + k) < 0.45) continue;
        out.push({ x: (gx * 2 + hash(gx, gy, 3 + k) * 2) * N, y: (gy * 2 + hash(gx, gy, 5 + k) * 2) * N, r: 40 + hash(gx, gy, 7 + k) * 90, c: faint[Math.floor(hash(gx, gy, 9 + k) * 4)] });
      }
    }
    return out;
  };
  const make = (tx: number, ty: number) => {
    const c = document.createElement("canvas");
    c.width = c.height = N;
    const g = c.getContext("2d")!;
    const ox = tx * N, oy = ty * N; // tile origin in tile pixels
    g.fillStyle = "#0d0a1a"; g.fillRect(0, 0, N, N);
    // dithered blobs: faint clouds, then region clouds
    const blob = (col: string, cx: number, cy: number, rx: number, ry: number, density: number, seed: number) => {
      if (cx + rx < ox || cx - rx > ox + N || cy + ry < oy || cy - ry > oy + N) return;
      g.fillStyle = col;
      for (let y = Math.max(oy, Math.floor(cy - ry)); y < Math.min(oy + N, cy + ry); y++) for (let x = Math.max(ox, Math.floor(cx - rx)); x < Math.min(ox + N, cx + rx); x++) {
        if ((x + y) & 1) continue;
        const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
        if (d < 1 && hash(x, y, seed) < (1 - d) * density) g.fillRect(x - ox, y - oy, 1, 1);
      }
    };
    cloudsNear(tx, ty).forEach((cl, i) => blob(cl.c, cl.x, cl.y, cl.r, cl.r * 0.8, 0.4, 100 + i));
    regions.forEach((r, i) => blob(regionCols[i], r.x / TRES, r.y / TRES, r.rx / TRES, r.ry / TRES, 0.6, 200 + i));
    // the galaxy band, a soft diagonal river through the whole sky
    for (let i = 0; i < 420; i++) {
      const x = ox + hash(tx, ty, 300 + i) * N, off = (hash(tx, ty, 900 + i) - 0.5) * hash(tx, ty, 1500 + i) * 240;
      const y = -0.35 * x + off;
      if (y < oy || y >= oy + N) continue;
      g.fillStyle = hash(tx, ty, 2100 + i) < 0.5 ? "#26294a" : "#3a4466";
      g.fillRect(Math.round(x - ox), Math.round(y - oy), 1, 1);
    }
    // stars
    for (let i = 0; i < 380; i++) {
      const x = Math.floor(hash(tx, ty, 3000 + i) * N), y = Math.floor(hash(tx, ty, 4000 + i) * N);
      const r = hash(tx, ty, 5000 + i);
      g.fillStyle = cols[Math.floor(hash(tx, ty, 6000 + i) * (r < 0.85 ? 3 : 6))];
      g.fillRect(x, y, 1, 1);
    }
    for (const d of dots) if (d.x >= ox && d.x < ox + N && d.y >= oy && d.y < oy + N) { g.globalAlpha = d.a; g.fillStyle = d.c; g.fillRect(d.x - ox, d.y - oy, 1, 1); }
    g.globalAlpha = 1;
    // grid: faint dots every 100 coordinates, brighter every 500, like an old chart
    const minor = (100 * K) / TRES, major = (500 * K) / TRES;
    for (let gx = Math.ceil(ox / minor) * minor; gx < ox + N; gx += minor) {
      const isMajor = Math.abs(gx / major - Math.round(gx / major)) < 1e-6;
      g.fillStyle = isMajor ? "#342a55" : "#231d3a";
      for (let y = 0; y < N; y += isMajor ? 2 : 4) g.fillRect(Math.round(gx - ox), y, 1, 1);
    }
    for (let gy = Math.ceil(oy / minor) * minor; gy < oy + N; gy += minor) {
      const isMajor = Math.abs(gy / major - Math.round(gy / major)) < 1e-6;
      g.fillStyle = isMajor ? "#342a55" : "#231d3a";
      for (let x = 0; x < N; x += isMajor ? 2 : 4) g.fillRect(x, Math.round(gy - oy), 1, 1);
    }
    // beyond ±5000: uncharted, darker, behind a dashed brass border
    const inX0 = Math.max(0, -edge - ox), inX1 = Math.min(N, edge - ox), inY0 = Math.max(0, -edge - oy), inY1 = Math.min(N, edge - oy);
    if (inX0 > 0 || inX1 < N || inY0 > 0 || inY1 < N) {
      g.fillStyle = "rgba(4,3,10,0.8)";
      if (inX1 <= inX0 || inY1 <= inY0) g.fillRect(0, 0, N, N);
      else {
        g.fillRect(0, 0, N, inY0); g.fillRect(0, inY1, N, N - inY1);
        g.fillRect(0, inY0, inX0, inY1 - inY0); g.fillRect(inX1, inY0, N - inX1, inY1 - inY0);
        g.fillStyle = "#6b5530";
        for (let i = inX0; i < inX1; i += 4) { if (inY0 > 0) g.fillRect(i, inY0, 2, 1); if (inY1 < N) g.fillRect(i, inY1 - 1, 2, 1); }
        for (let i = inY0; i < inY1; i += 4) { if (inX0 > 0) g.fillRect(inX0, i, 1, 2); if (inX1 < N) g.fillRect(inX1 - 1, i, 1, 2); }
      }
    }
    return c;
  };
  return (tx: number, ty: number) => {
    const key = `${tx},${ty}`;
    let t = cache.get(key);
    if (!t) {
      t = make(tx, ty);
      cache.set(key, t);
      if (cache.size > 90) cache.delete(cache.keys().next().value!);
    }
    return t;
  };
}

/** Mix a #rrggbb colour toward the night background. */
function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16), bg = [13, 10, 26];
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) => Math.round(bg[i] + (v - bg[i]) * f));
  return `rgb(${c.join(",")})`;
}
