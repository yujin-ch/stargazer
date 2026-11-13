import "@fontsource/press-start-2p";
import "@fontsource/vt323";
import { CONFIG, tierFor } from "./config";
import { OBJECTS, BY_ID, shownNames, type SkyObject } from "./library";
import { makeMatcher, normalize, forms as formsOf } from "./match";
import { dailySky, practiceSky, localDateKey, puzzleNumber } from "./daily";
import { theme } from "./themes";
import { setMuted, unlockAudio } from "./themes/chip";
import { Viewer } from "./viewer";
import { store, type ItemResult, type RunResult } from "./storage";
import { share, shareText } from "./share";

const matcher = makeMatcher(OBJECTS.map((o) => o.names));
const app = document.getElementById("app")!;
const forms = (o: SkyObject) => o.names.flatMap(formsOf);
const longerCache = new Map<string, string[]>();
/** The listed names of an object, normalized (no generated plurals). */
const longerNames = (o: SkyObject) => {
  let v = longerCache.get(o.id);
  if (!v) { v = o.names.map(normalize); longerCache.set(o.id, v); }
  return v;
};
const isTouch = window.matchMedia("(pointer: coarse)").matches;
const SITE_URL = location.origin + location.pathname;
setMuted(store.muted);
theme.startPageBackground(document.getElementById("sky") as HTMLCanvasElement);
document.title = theme.title;

// Keep the layout above the on-screen keyboard.
function fitViewport() {
  const h = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty("--app-h", `${h}px`);
  if (window.visualViewport && window.scrollY) window.scrollTo(0, 0);
  sizeViewer();
}
window.visualViewport?.addEventListener("resize", fitViewport);
window.addEventListener("resize", fitViewport);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmtDate = (key: string) => new Date(key + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

// ---------------------------------------------------------------- play screen

let viewer: Viewer;
let el: Record<string, HTMLElement> = {};

interface Run {
  mode: "daily" | "practice";
  puzzle: number;
  date: string;
  tier: number;
  streak: number;
  sky: SkyObject[];
  i: number;
  phase: "ready" | "countdown" | "playing" | "over";
  countdownAt: number;
  startAt: number;
  penalty: number;
  score: number;
  items: ItemResult[];
  attempt: string;
  lastTick: number;
  combo: number;
  bestCombo: number;
  /** A match waiting briefly in case a longer name is being typed. */
  pending: string | null;
}
let run: Run;

function playScreen() {
  app.innerHTML = `
  <main class="play">
    <header class="hud">
      <div class="hud-left">
        <div class="hud-score"><span id="score">0</span><small>PTS</small></div>
        <div class="combo" id="combo"></div>
      </div>
      <div class="hud-time" id="time">${CONFIG.runSeconds}</div>
      <div class="hud-right">
        <button class="mute" id="mute" aria-label="Toggle sound"></button>
        <div class="hud-count" id="count"></div>
      </div>
    </header>
    <section class="scope" id="scope">
      <canvas id="eyepiece" aria-label="Telescope view"></canvas>
      <div class="overlay" id="overlay"></div>
      <div class="pops" id="pops"></div>
    </section>
    <div class="label-row">
      <div class="theme-label" id="label">&nbsp;</div>
      <div class="bonus" id="bonus"><span>ZOOM BONUS</span><i id="bonusbar"></i></div>
      <div class="band" id="band">&nbsp;</div>
    </div>
    <div class="controls" id="controls">
      <div class="entry">
        <input id="guess" type="text" inputmode="text" enterkeyhint="go" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" placeholder="type what you see" aria-label="Your guess" maxlength="40" />
        <button class="clear" id="clear" aria-label="Clear" tabindex="-1"><i></i></button>
      </div>
      <button class="skip" id="skip" tabindex="-1">SKIP <small>-${CONFIG.skipCost}s</small></button>
    </div>
    <div class="hint" id="hint">${isTouch ? "" : "Tab = skip · Esc = clear · no Enter needed"}</div>
    <div class="start" id="start"></div>
    <div class="sr-only" id="live" aria-live="polite"></div>
  </main>`;
  for (const id of ["score", "time", "count", "scope", "overlay", "pops", "label", "band", "bonus", "bonusbar", "controls", "guess", "clear", "skip", "hint", "start", "mute", "combo"])
    el[id] = document.getElementById(id)!;
  viewer = new Viewer(document.getElementById("eyepiece") as HTMLCanvasElement, theme);
  renderMute();
  wireInput();
  fitViewport();
}

function renderMute() {
  el.mute.textContent = store.muted ? "♪ OFF" : "♪ ON";
  el.mute.setAttribute("aria-pressed", String(!store.muted));
}

function sizeViewer() {
  const scope = el.scope;
  if (!scope || !viewer) return;
  const avail = Math.min(scope.clientWidth, scope.clientHeight);
  let k = avail / viewer.V;
  k = k >= 2 ? Math.floor(k * 2) / 2 : Math.max(0.75, k);
  const canvas = scope.querySelector("canvas")!;
  canvas.style.width = canvas.style.height = `${Math.floor(viewer.V * k)}px`;
}

function wireInput() {
  const input = el.guess as HTMLInputElement;
  input.addEventListener("input", () => {
    if (run.phase !== "playing") { input.value = ""; return; }
    if (input.value.trim()) run.attempt = input.value;
    onTyped(input);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Tab") { e.preventDefault(); if (run.phase === "playing") skip(); }
    else if (e.key === "Escape") { input.value = ""; dropPending(); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (run.phase !== "playing") return;
      if (run.pending !== null) acceptPending();
      else if (input.value.trim()) { shake(); input.value = ""; }
    }
  });
  // buttons must not steal focus (that would close the phone keyboard)
  const noFocus = (b: HTMLElement, fn: () => void) => {
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); fn(); });
    b.addEventListener("click", (e) => { if (e.detail === 0) fn(); }); // keyboard activation
  };
  noFocus(el.skip, () => { if (run.phase === "playing") skip(); });
  noFocus(el.clear, () => { input.value = ""; dropPending(); input.focus(); });
  noFocus(el.mute, () => { store.muted = !store.muted; setMuted(store.muted); renderMute(); });
  el.scope.addEventListener("pointerdown", (e) => { if (run.phase === "playing" || run.phase === "countdown") { e.preventDefault(); input.focus(); } });
}

/**
 * Auto-advance, with one wrinkle: if what you typed matches but is also the start of a longer
 * listed name ("book" vs "books", "ice cream" vs "ice cream cone"), wait a moment so the extra
 * letters don't spill into the next guess. Typing something that isn't a longer name accepts at once
 * and carries the extra letters over to the next object.
 */
let pendingTimer = 0;
function dropPending() { clearTimeout(pendingTimer); run.pending = null; }
function acceptPending() {
  const p = run.pending, obj = run.sky[run.i];
  if (p !== null && obj && run.phase === "playing") named(obj, p);
}
function onTyped(input: HTMLInputElement) {
  const obj = run.sky[run.i];
  if (!obj) return;
  const value = input.value;
  const p = run.pending;
  clearTimeout(pendingTimer);
  const m = matcher.test(value, obj.names);
  if (m) {
    const n = normalize(value);
    const longer = m.early || longerNames(obj).some((f) => f.length > n.length && f.startsWith(n));
    // a generated plural ("cake" -> "cakes") gets a shorter wait, so a trailing "s" doesn't spill over
    const plural = !longer && forms(obj).some((f) => f.length > n.length && f.startsWith(n));
    if (longer || plural) {
      run.pending = value;
      pendingTimer = window.setTimeout(acceptPending, longer ? CONFIG.longerNameWaitMs : CONFIG.pluralWaitMs);
      return;
    }
    return named(obj, value);
  }
  if (p !== null) {
    const n = normalize(value);
    if (value.startsWith(p) && [...longerNames(obj), ...forms(obj)].some((f) => f.startsWith(n))) {
      // still heading towards a longer name: keep waiting, but accept the shorter one if they stop
      pendingTimer = window.setTimeout(acceptPending, CONFIG.longerNameWaitMs);
      return;
    }
    const rest = value.startsWith(p) ? value.slice(p.length).replace(/^\s+/, "") : "";
    named(obj, p);
    input.value = rest;
    if (rest) onTyped(input);
  }
}

function shake() {
  el.guess.parentElement!.classList.remove("shake");
  void el.guess.parentElement!.offsetWidth;
  el.guess.parentElement!.classList.add("shake");
}

function newRun(mode: Run["mode"]): Run {
  const date = localDateKey();
  const puzzle = puzzleNumber(date);
  const streak = store.streakThrough(puzzle - 1);
  const tier = tierFor(streak);
  const sky = mode === "daily" ? dailySky(puzzle, tier) : practiceSky(tier);
  return { mode, puzzle, date, tier, streak, sky, i: 0, phase: "ready", countdownAt: 0, startAt: 0, penalty: 0, score: 0, items: [], attempt: "", lastTick: 99, combo: 0, bestCombo: 0, pending: null };
}

async function openPlay(mode: Run["mode"]) {
  run = newRun(mode);
  playScreen();
  await viewer.load();
  viewer.preload(run.sky.slice(0, 3));
  el.count.textContent = `0/${run.sky.length}`;
  el.controls.classList.add("hidden");
  el.hint.classList.add("hidden");
  app.querySelector(".play")!.classList.add("ready");
  el.overlay.className = "overlay wordmark";
  el.overlay.innerHTML = `<div><b>${theme.title.toUpperCase()}</b><span>${mode === "daily" ? `NIGHT #${run.puzzle} · ${fmtDate(run.date).toUpperCase()}` : "PRACTICE SKY · NOT SCORED"}</span></div>`;
  const c3 = CONFIG.combo[0];
  el.start.innerHTML = `
    ${tierLine(run.tier, run.streak)}
    <ul class="rules">
      <li><b>Type</b> what you see. It moves on by itself.</li>
      <li><b>Zoomed in?</b> Name it early for bonus points.</li>
      <li><b>${c3.at} in a row</b> earns extra. ${isTouch ? "Skip" : "Tab skips"}${isTouch ? "" : ","} costs ${CONFIG.skipCost}s and breaks it.</li>
    </ul>
    <button class="btn primary" id="go">OPEN THE SHUTTER</button>
    <p class="small">${CONFIG.runSeconds} seconds · ${mode === "daily" ? "same sky as everyone on your tier" : "random objects"}</p>`;
  document.getElementById("go")!.onclick = begin;
  sizeViewer();
  loop();
}

function begin() {
  unlockAudio();
  el.start.classList.add("hidden");
  app.querySelector(".play")!.classList.remove("ready");
  el.controls.classList.remove("hidden");
  el.hint.classList.remove("hidden");
  const input = el.guess as HTMLInputElement;
  input.value = "";
  input.focus(); // inside the click, so phones open the keyboard
  sizeViewer();
  run.phase = "countdown";
  run.countdownAt = performance.now();
  saveProgress();
  el.overlay.innerHTML = "";
  theme.sounds.tick();
  setTimeout(fitViewport, 350);
}

function startClock(now: number) {
  run.phase = "playing";
  run.startAt = now;
  el.overlay.textContent = "";
  theme.sounds.start();
  showObject(now);
}

function showObject(now: number) {
  const obj = run.sky[run.i];
  if (!obj) return finish(now);
  viewer.show(obj, now);
  viewer.preload(run.sky.slice(run.i + 1, run.i + 3));
  run.attempt = "";
  el.label.textContent = obj.theme.toUpperCase();
  const band = CONFIG.bands[obj.band];
  el.band.textContent = `${theme.bandNames[obj.band].toUpperCase()} · ${band.points} PT${band.points > 1 ? "S" : ""}`;
  el.band.dataset.band = String(obj.band);
  el.count.textContent = `${run.i + 1}/${run.sky.length}`;
}

function named(obj: SkyObject, typed: string) {
  if (run.phase !== "playing") return;
  const now = performance.now();
  clearTimeout(pendingTimer);
  run.pending = null;
  const band = CONFIG.bands[obj.band];
  const zoomed = band.pullBack > 0 && viewer.pullProgress(now) < 1;
  run.combo++;
  run.bestCombo = Math.max(run.bestCombo, run.combo);
  const extra = CONFIG.combo.reduce((x, c) => (run.combo >= c.at ? c.extra : x), 0);
  const points = (zoomed ? band.zoomedPoints : band.points) + extra;
  run.score += points;
  run.items.push({ id: obj.id, outcome: zoomed ? "zoomed" : "named", typed: typed.trim(), points });
  (el.guess as HTMLInputElement).value = "";
  el.score.textContent = String(run.score);
  el.score.parentElement!.classList.remove("bump"); void el.score.offsetWidth; el.score.parentElement!.classList.add("bump");
  pop(obj.names[0], `+${points}${zoomed ? " ZOOM" : ""}`, zoomed ? "gold" : "");
  theme.sounds.correct(zoomed, run.combo);
  viewer.dismiss(zoomed ? "zoomed" : "named", now);
  announce(`${obj.names[0]}, ${points} points`);
  saveProgress();
  if (zoomed) { el.scope.classList.remove("jolt"); void el.scope.offsetWidth; el.scope.classList.add("jolt"); }
  renderCombo(false);
  run.i++;
  showObject(now);
}

function skip() {
  if (run.phase !== "playing") return;
  const now = performance.now();
  clearTimeout(pendingTimer);
  run.pending = null;
  const obj = run.sky[run.i];
  if (!obj) return;
  run.penalty += CONFIG.skipCost;
  run.items.push({ id: obj.id, outcome: "skipped", typed: run.attempt.trim(), points: 0 });
  (el.guess as HTMLInputElement).value = "";
  const broke = run.combo >= CONFIG.combo[0].at;
  run.combo = 0;
  renderCombo(broke);
  if (broke) theme.sounds.comboBreak();
  pop(obj.names[0], `-${CONFIG.skipCost}s`, "red");
  el.time.classList.remove("hit"); void el.time.offsetWidth; el.time.classList.add("hit");
  theme.sounds.skip();
  viewer.dismiss("skipped", now);
  announce(`Skipped ${obj.names[0]}`);
  saveProgress();
  run.i++;
  showObject(now);
}

function announce(t: string) { const a = document.getElementById("live"); if (a) a.textContent = t; }

function buildResult(): RunResult {
  return {
    puzzle: run.puzzle,
    date: run.date,
    score: run.score,
    named: run.items.filter((i) => i.outcome !== "skipped").length,
    zoomed: run.items.filter((i) => i.outcome === "zoomed").length,
    skipped: run.items.filter((i) => i.outcome === "skipped").length,
    items: run.items.slice(),
    device: isTouch ? "touch" : "keyboard",
    tier: run.tier,
    bestCombo: run.bestCombo,
  };
}

/** The daily run counts from the moment the shutter opens, so a reload can't buy a second try. */
function saveProgress() {
  if (run.mode === "daily") store.save({ ...buildResult(), partial: true });
}

/** One pop at a time: the object's name and what it earned. */
function pop(name: string, points: string, cls: string) {
  el.pops.textContent = "";
  const p = document.createElement("div");
  p.className = `pop ${cls}`;
  const n = document.createElement("span");
  n.className = "pop-name";
  n.textContent = name.toUpperCase();
  const pts = document.createElement("span");
  pts.className = "pop-pts";
  pts.textContent = points;
  p.append(n, pts);
  el.pops.appendChild(p);
  setTimeout(() => p.remove(), 900);
}

function renderCombo(broke: boolean) {
  const c = run.combo;
  const e = el.combo;
  e.classList.remove("broke", "gold", "on");
  void e.offsetWidth;
  if (broke) { e.textContent = "STEADY ×0"; e.classList.add("broke", "on"); return; }
  if (c >= CONFIG.combo[0].at) {
    const extra = CONFIG.combo.reduce((x, k) => (c >= k.at ? k.extra : x), 0);
    e.textContent = `STEADY ×${c} +${extra}`;
    e.classList.add("on");
    if (c >= CONFIG.combo[1].at) e.classList.add("gold");
  } else e.textContent = "";
}

function timeLeft(now: number) {
  return CONFIG.runSeconds - (now - run.startAt) / 1000 - run.penalty;
}

function finish(now: number) {
  if (run.phase === "over") return;
  if (run.pending !== null) acceptPending(); // credit a match that was waiting on a longer name
  dropPending();
  run.phase = "over";
  announce("Time. Results coming up.");
  viewer.dismiss("skipped", now);
  theme.sounds.end();
  el.time.textContent = "0";
  el.overlay.textContent = "TIME!";
  el.overlay.className = "overlay big";
  (el.guess as HTMLInputElement).value = "";
  el.controls.classList.add("dim");
  const result = buildResult();
  const fresh = store.addToCatalogue(run.items.filter((i) => i.outcome !== "skipped").map((i) => i.id));
  lastFresh = fresh;
  const prev = store.today(run.date);
  if (run.mode === "daily" && (!prev || prev.partial)) store.save(result);
  setTimeout(() => { (el.guess as HTMLInputElement).blur(); resultsScreen(result, run.mode); }, 1400);
}

let lastFresh = 0;
let raf = 0;
function loop() {
  cancelAnimationFrame(raf);
  const frame = (now: number) => {
    if (!document.getElementById("eyepiece")) return;
    if (run.phase === "countdown") {
      const left = CONFIG.countdownSeconds - (now - run.countdownAt) / 1000;
      const n = Math.ceil(left);
      if (left <= 0) startClock(now);
      else if (el.overlay.textContent !== String(n)) {
        el.overlay.className = "overlay big";
        el.overlay.textContent = String(n);
        if (n < CONFIG.countdownSeconds) theme.sounds.tick();
      }
    }
    if (run.phase === "playing") {
      const t = timeLeft(now);
      viewer.alert = t <= 10;
      if (t <= 0) finish(now);
      else {
        const s = Math.ceil(t);
        if (el.time.textContent !== String(s)) el.time.textContent = String(s);
        el.time.classList.toggle("low", s <= 10);
        if (s <= 5 && s < run.lastTick) { run.lastTick = s; theme.sounds.tick(); }
        const obj = run.sky[run.i];
        const p = viewer.pullProgress(now);
        const zooming = !!obj && CONFIG.bands[obj.band].pullBack > 0 && p < 1;
        el.bonus.classList.toggle("on", zooming);
        if (zooming) {
          el.bonusbar.style.transform = `scaleX(${1 - p})`;
          const label = `ZOOM BONUS ${CONFIG.bands[obj.band].zoomedPoints}`;
          const span = el.bonus.firstElementChild as HTMLElement;
          if (span.textContent !== label) span.textContent = label;
        }
      }
    } else el.bonus.classList.remove("on");
    viewer.draw(now);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}

function tierLine(tier: number, streak: number): string {
  const t = CONFIG.tiers[tier], next = CONFIG.tiers[tier + 1];
  const streakTxt = streak ? `${streak}-night streak` : "no streak yet";
  return `<p class="tier">${t.name.toUpperCase()} SKY <span>· ${streakTxt}</span></p>${next ? `<p class="small next">${pips(streak - t.minStreak, next.minStreak - t.minStreak)} ${next.name} sky in ${next.minStreak - streak} more night${next.minStreak - streak === 1 ? "" : "s"}</p>` : `<p class="small next">The hardest sky there is.</p>`}`;
}

function pips(have: number, need: number): string {
  return `<span class="pips" aria-hidden="true">${"●".repeat(Math.max(0, have))}${"○".repeat(Math.max(0, need - have))}</span>`;
}

// ---------------------------------------------------------------- results

function nextSkyIn(): string {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const ms = next.getTime() - now.getTime();
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : m ? `${m}m` : "a moment";
}

async function resultsScreen(r: RunResult, mode: Run["mode"]) {
  cancelAnimationFrame(raf);
  if (!viewer) { viewer = new Viewer(document.createElement("canvas"), theme); }
  await viewer.load();
  const today = puzzleNumber(localDateKey());
  const stats = store.stats(today);
  const daily = mode === "daily";
  const cat = store.catalogue().size;
  const tier = r.tier ?? 0;
  const streakNow = store.streakThrough(today);
  const next = CONFIG.tiers[tier + 1];
  const tomorrow = next
    ? `${pips(streakNow - CONFIG.tiers[tier].minStreak, next.minStreak - CONFIG.tiers[tier].minStreak)} ${next.name} sky in ${Math.max(1, next.minStreak - streakNow)} more night${next.minStreak - streakNow === 1 ? "" : "s"}`
    : "You're on the hardest sky.";
  app.innerHTML = `
  <main class="results">
    <section class="log">
      <header class="log-head">
        <span>OBSERVING LOG</span>
        <span>${daily ? `NIGHT #${r.puzzle}` : "PRACTICE"}</span>
      </header>
      <p class="date">${daily ? `${fmtDate(r.date)} · ${CONFIG.tiers[tier].name} sky` : "Random objects, not scored"}</p>
      <div class="final"><span>${r.score}</span><small>POINTS</small></div>
      <canvas class="chart" id="chart" aria-label="Star chart of your run"></canvas>
      <p class="legend"><i class="lg named"></i>named <i class="lg zoomed"></i>zoom bonus <i class="lg skipped"></i>skipped</p>
      <dl class="figures">
        <div><dt>NAMED</dt><dd>${r.named}</dd></div>
        <div><dt>ZOOM</dt><dd>${r.zoomed}</dd></div>
        <div><dt>STEADY</dt><dd>${r.bestCombo ?? 0}</dd></div>
        <div><dt>SKIPPED</dt><dd>${r.skipped}</dd></div>
      </dl>
    </section>
    <div class="actions">
      ${daily ? `<button class="btn primary" id="share">SHARE LOG</button>` : ""}
      ${!daily && !store.today(localDateKey()) ? `<button class="btn primary" id="daily">TONIGHT'S SKY</button>` : ""}
      <button class="btn" id="practice">${daily ? "PRACTICE" : "AGAIN"}</button>
      ${!daily && store.today(localDateKey()) ? `<button class="btn" id="back">TONIGHT'S LOG</button>` : ""}
    </div>
    <p class="toast" id="toast" role="status"></p>
    <section class="come-back">
      ${daily ? `<p>Next sky in <b>${nextSkyIn()}</b></p><p class="small">${tomorrow}</p>` : ""}
      <p class="small">Catalogue <b>${cat}</b> / ${OBJECTS.length} objects${lastFresh ? ` <span class="new">+${lastFresh} new</span>` : ""}</p>
      ${daily ? `<p class="small">Best ${stats.best} · Streak ${stats.streak}</p>` : ""}
    </section>
    <h2>WHAT YOU SAW <small>tap for other names</small></h2>
    <ol class="seen" id="seen"></ol>
    <footer class="credits">${theme.credits}</footer>
  </main>`;
  lastFresh = 0;
  drawChart(document.getElementById("chart") as HTMLCanvasElement, r);
  const list = document.getElementById("seen")!;
  for (const it of r.items) {
    const o = BY_ID.get(it.id);
    if (!o) continue;
    const li = document.createElement("li");
    li.className = it.outcome;
    li.tabIndex = 0;
    li.appendChild(viewer.spriteCanvas(o.sprite, 2));
    const others = shownNames(o).slice(0, 4).join(", ");
    const typed = it.typed && normalize(it.typed) !== normalize(o.names[0]) ? `“${esc(it.typed)}”` : "";
    const div = document.createElement("div");
    div.innerHTML = `<b>${esc(o.names[0])}</b><span class="pts">${it.outcome === "skipped" ? "skip" : `+${it.points}${it.outcome === "zoomed" ? "★" : ""}`}</span>` +
      `<small class="more">${it.outcome === "skipped" && it.typed ? `you tried ${typed || `“${esc(it.typed)}”`}<br>` : typed ? `you typed ${typed}<br>` : ""}${others ? `also: ${esc(others)}` : esc(theme.bandNames[o.band])}</small>`;
    li.appendChild(div);
    const toggle = () => li.classList.toggle("open");
    li.addEventListener("click", toggle);
    li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    list.appendChild(li);
  }
  if (!r.items.length) list.innerHTML = `<li class="empty">Nothing this time. The sky will be back tomorrow.</li>`;
  const toast = (t: string) => { const e = document.getElementById("toast")!; e.textContent = t; };
  document.getElementById("share")?.addEventListener("click", async () => {
    const res = await share(shareText(r, theme, SITE_URL));
    toast(res === "copied" ? "Log copied. Paste it anywhere." : res === "shared" ? "" : "Couldn't share. Try again.");
  });
  document.getElementById("practice")!.onclick = () => openPlay("practice");
  document.getElementById("back")?.addEventListener("click", () => resultsScreen(store.today(localDateKey())!, "daily"));
  document.getElementById("daily")?.addEventListener("click", () => openPlay("daily"));
}

/** Star chart: one star per object in order, 10 to a row; answers in a row join into constellations. */
function drawChart(c: HTMLCanvasElement, r: RunResult) {
  const cols = 10, cell = 12, pad = 6;
  const rows = Math.max(1, Math.ceil(r.items.length / cols));
  c.width = cols * cell + pad * 2;
  c.height = rows * cell + pad * 2;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0b0a18";
  g.fillRect(0, 0, c.width, c.height);
  // faint grid
  g.fillStyle = "#1b1a33";
  for (let x = 0; x <= cols; x++) g.fillRect(pad + x * cell - 6, 0, 1, c.height);
  // jitter each star a little so it reads as a sky, deterministic per index
  const pos = r.items.map((_, i) => {
    const j1 = ((i * 37) % 7) - 3, j2 = ((i * 53) % 5) - 2;
    return { x: pad + (i % cols) * cell + 6 + Math.round(j1 / 2), y: pad + Math.floor(i / cols) * cell + 6 + Math.round(j2 / 2) };
  });
  g.fillStyle = "#2b6f8a";
  for (let i = 1; i < r.items.length; i++) {
    if (r.items[i].outcome === "skipped" || r.items[i - 1].outcome === "skipped") continue;
    line(g, pos[i - 1].x, pos[i - 1].y, pos[i].x, pos[i].y);
  }
  r.items.forEach((it, i) => {
    const { x, y } = pos[i];
    if (it.outcome === "skipped") { g.fillStyle = "#3a4466"; g.fillRect(x, y, 1, 1); }
    else if (it.outcome === "zoomed") {
      g.fillStyle = "#fee761"; g.fillRect(x - 1, y, 3, 1); g.fillRect(x, y - 1, 1, 3);
      g.fillStyle = "#ffffff"; g.fillRect(x, y, 1, 1);
    } else { g.fillStyle = "#2ce8f5"; g.fillRect(x, y, 2, 2); }
  });
}

function line(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let k = 0; k <= n; k++) g.fillRect(Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n), 1, 1);
}

// ---------------------------------------------------------------- boot

// test hook for automated playtests: /?debug
if (new URLSearchParams(location.search).has("debug"))
  (window as unknown as { __sg: unknown }).__sg = { answer: () => run?.sky[run.i]?.names[0], phase: () => run?.phase };

const done = store.today(localDateKey());
if (done) void resultsScreen(done, "daily");
else void openPlay("daily");
