import "@fontsource/press-start-2p";
import "@fontsource/vt323";
import { CONFIG } from "./config";
import { OBJECTS, BY_ID, type SkyObject } from "./library";
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
window.visualViewport?.addEventListener("scroll", () => window.scrollTo(0, 0));
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
  /** A match waiting briefly in case a longer name is being typed. */
  pending: string | null;
}
let run: Run;

function playScreen() {
  app.innerHTML = `
  <main class="play">
    <header class="hud">
      <div class="hud-score"><span id="score">0</span><small>PTS</small></div>
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
        <button class="clear" id="clear" aria-label="Clear" tabindex="-1">×</button>
      </div>
      <button class="skip" id="skip" tabindex="-1">SKIP <small>-${CONFIG.skipCost}s</small></button>
    </div>
    <div class="hint" id="hint">${isTouch ? "" : "Tab = skip · Esc = clear · no Enter needed"}</div>
    <div class="start" id="start"></div>
  </main>`;
  for (const id of ["score", "time", "count", "scope", "overlay", "pops", "label", "band", "bonus", "bonusbar", "controls", "guess", "clear", "skip", "hint", "start", "mute"])
    el[id] = document.getElementById(id)!;
  viewer = new Viewer(document.getElementById("eyepiece") as HTMLCanvasElement, theme);
  renderMute();
  el.mute.onclick = () => { store.muted = !store.muted; setMuted(store.muted); renderMute(); };
  wireInput();
  fitViewport();
}

function renderMute() { el.mute.textContent = store.muted ? "SOUND OFF" : "SOUND ON"; }

function sizeViewer() {
  const scope = el.scope;
  if (!scope || !viewer) return;
  const avail = Math.min(scope.clientWidth, scope.clientHeight);
  let k = avail / viewer.V;
  k = k >= 2 ? Math.floor(k * 2) / 2 : Math.max(1, k);
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
    else if (e.key === "Escape") { input.value = ""; }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (run.phase === "playing" && input.value.trim()) { shake(); input.value = ""; }
    }
  });
  // buttons must not steal focus (that would close the phone keyboard)
  const noFocus = (b: HTMLElement, fn: () => void) => {
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); fn(); });
    b.addEventListener("click", (e) => { if (e.detail === 0) fn(); }); // keyboard activation
  };
  noFocus(el.skip, () => { if (run.phase === "playing") skip(); });
  noFocus(el.clear, () => { input.value = ""; input.focus(); });
  el.scope.addEventListener("pointerdown", (e) => { if (run.phase === "playing" || run.phase === "countdown") { e.preventDefault(); input.focus(); } });
}

/**
 * Auto-advance, with one wrinkle: if what you typed matches but is also the start of a longer
 * listed name ("book" vs "books", "ice cream" vs "ice cream cone"), wait a moment so the extra
 * letters don't spill into the next guess. Typing something that isn't a longer name accepts at once
 * and carries the extra letters over to the next object.
 */
let pendingTimer = 0;
function onTyped(input: HTMLInputElement) {
  const obj = run.sky[run.i];
  if (!obj) return;
  const value = input.value;
  const p = run.pending;
  clearTimeout(pendingTimer);
  const m = matcher.test(value, obj.names);
  if (m) {
    const n = normalize(value);
    if (m.early || longerNames(obj).some((f) => f.length > n.length && f.startsWith(n))) {
      run.pending = value;
      pendingTimer = window.setTimeout(() => { if (run.pending === value && run.sky[run.i] === obj) named(obj, value); }, CONFIG.longerNameWaitMs);
      return;
    }
    return named(obj, value);
  }
  if (p !== null) {
    const n = normalize(value);
    if (value.startsWith(p) && [...longerNames(obj), ...forms(obj)].some((f) => f.startsWith(n))) {
      // still heading towards a longer name: keep waiting, but accept the shorter one if they stop
      pendingTimer = window.setTimeout(() => { if (run.sky[run.i] === obj && run.phase === "playing") named(obj, p); }, CONFIG.longerNameWaitMs);
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
  const sky = mode === "daily" ? dailySky(puzzle) : practiceSky();
  return { mode, puzzle, date, sky, i: 0, phase: "ready", countdownAt: 0, startAt: 0, penalty: 0, score: 0, items: [], attempt: "", lastTick: 99, pending: null };
}

async function openPlay(mode: Run["mode"]) {
  run = newRun(mode);
  playScreen();
  await viewer.load();
  viewer.preload(run.sky.slice(0, 3));
  el.count.textContent = `0/${run.sky.length}`;
  el.controls.classList.add("hidden");
  el.hint.classList.add("hidden");
  const title = mode === "daily" ? `${theme.title.toUpperCase()} #${run.puzzle}` : "PRACTICE SKY";
  const b = CONFIG.bands;
  el.start.innerHTML = `
    <h1>${title}</h1>
    <p class="date">${mode === "daily" ? fmtDate(run.date) : "Random objects, not scored"}</p>
    <ul class="rules">
      <li><b>Type</b> the name of what you see. No Enter needed.</li>
      <li><b>${isTouch ? "Skip" : "Tab"}</b> moves on, but costs ${CONFIG.skipCost} seconds.</li>
      <li>Far-off objects start <b>zoomed in</b>. Name them before the view pulls back for <b>${b[1].zoomedPoints}</b> or <b>${b[2].zoomedPoints}</b> points.</li>
    </ul>
    <button class="btn primary" id="go">START</button>
    <p class="small">${CONFIG.runSeconds} seconds · ${run.sky.length} objects · ${mode === "daily" ? "same sky for everyone today" : "practice"}</p>`;
  document.getElementById("go")!.onclick = begin;
  loop();
}

function begin() {
  unlockAudio();
  el.start.classList.add("hidden");
  el.controls.classList.remove("hidden");
  el.hint.classList.remove("hidden");
  const input = el.guess as HTMLInputElement;
  input.value = "";
  input.focus(); // inside the click, so phones open the keyboard
  run.phase = "countdown";
  run.countdownAt = performance.now();
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
  const now = performance.now();
  clearTimeout(pendingTimer);
  run.pending = null;
  const band = CONFIG.bands[obj.band];
  const zoomed = band.pullBack > 0 && viewer.pullProgress(now) < 1;
  const points = zoomed ? band.zoomedPoints : band.points;
  run.score += points;
  run.items.push({ id: obj.id, outcome: zoomed ? "zoomed" : "named", typed: typed.trim(), points });
  (el.guess as HTMLInputElement).value = "";
  el.score.textContent = String(run.score);
  el.score.parentElement!.classList.remove("bump"); void el.score.offsetWidth; el.score.parentElement!.classList.add("bump");
  pop(zoomed ? `+${points} ZOOM!` : `+${points}`, zoomed ? "gold" : "");
  theme.sounds.correct(zoomed);
  viewer.dismiss("named", now);
  run.i++;
  showObject(now);
}

function skip() {
  const now = performance.now();
  clearTimeout(pendingTimer);
  run.pending = null;
  const obj = run.sky[run.i];
  if (!obj) return;
  run.penalty += CONFIG.skipCost;
  run.items.push({ id: obj.id, outcome: "skipped", typed: run.attempt.trim(), points: 0 });
  (el.guess as HTMLInputElement).value = "";
  pop(`-${CONFIG.skipCost}s`, "red");
  el.time.classList.remove("hit"); void el.time.offsetWidth; el.time.classList.add("hit");
  theme.sounds.skip();
  viewer.dismiss("skipped", now);
  run.i++;
  showObject(now);
}

function pop(text: string, cls: string) {
  const p = document.createElement("div");
  p.className = `pop ${cls}`;
  p.textContent = text;
  el.pops.appendChild(p);
  setTimeout(() => p.remove(), 900);
}

function timeLeft(now: number) {
  return CONFIG.runSeconds - (now - run.startAt) / 1000 - run.penalty;
}

function finish(now: number) {
  if (run.phase === "over") return;
  run.phase = "over";
  viewer.dismiss("skipped", now);
  theme.sounds.end();
  el.time.textContent = "0";
  el.overlay.textContent = "TIME!";
  el.overlay.className = "overlay big";
  (el.guess as HTMLInputElement).value = "";
  el.controls.classList.add("dim");
  const named = run.items.filter((i) => i.outcome !== "skipped").length;
  const result: RunResult = {
    puzzle: run.puzzle,
    date: run.date,
    score: run.score,
    named,
    zoomed: run.items.filter((i) => i.outcome === "zoomed").length,
    skipped: run.items.filter((i) => i.outcome === "skipped").length,
    items: run.items,
    device: isTouch ? "touch" : "keyboard",
  };
  if (run.mode === "daily" && !store.today(run.date)) store.save(result);
  setTimeout(() => { (el.guess as HTMLInputElement).blur(); resultsScreen(result, run.mode); }, 1400);
}

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
      if (t <= 0) finish(now);
      else {
        const s = Math.ceil(t);
        el.time.textContent = String(s);
        el.time.classList.toggle("low", s <= 10);
        if (s <= 5 && s < run.lastTick) { run.lastTick = s; theme.sounds.tick(); }
        const obj = run.sky[run.i];
        const p = viewer.pullProgress(now);
        const zooming = !!obj && CONFIG.bands[obj.band].pullBack > 0 && p < 1;
        el.bonus.classList.toggle("on", zooming);
        if (zooming) {
          el.bonusbar.style.transform = `scaleX(${1 - p})`;
          (el.bonus.firstElementChild as HTMLElement).textContent = `ZOOM BONUS ${CONFIG.bands[obj.band].zoomedPoints}`;
        }
      }
    } else el.bonus.classList.remove("on");
    viewer.draw(now);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- results

function nextSkyIn(): string {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const ms = next.getTime() - now.getTime();
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

async function resultsScreen(r: RunResult, mode: Run["mode"]) {
  cancelAnimationFrame(raf);
  if (!viewer) { viewer = new Viewer(document.createElement("canvas"), theme); }
  await viewer.load();
  const stats = store.stats();
  const daily = mode === "daily";
  app.innerHTML = `
  <main class="results">
    <h1>${daily ? `${theme.title.toUpperCase()} #${r.puzzle}` : "PRACTICE SKY"}</h1>
    <p class="date">${daily ? fmtDate(r.date) : "Not scored"}</p>
    <div class="final"><span>${r.score}</span><small>POINTS</small></div>
    <p class="line">${r.named} named · ${r.zoomed} zoom bonus${r.zoomed === 1 ? "" : "es"} · ${r.skipped} skipped</p>
    <div class="actions">
      ${daily ? `<button class="btn primary" id="share">SHARE</button>` : ""}
      <button class="btn" id="practice">${daily ? "PRACTICE SKY" : "AGAIN"}</button>
      ${!daily && store.today(localDateKey()) ? `<button class="btn" id="back">TODAY'S RESULT</button>` : ""}
      ${!daily && !store.today(localDateKey()) ? `<button class="btn primary" id="daily">PLAY TODAY'S SKY</button>` : ""}
    </div>
    <p class="toast" id="toast"></p>
    ${daily ? `<p class="stats">Played ${stats.played} · Best ${stats.best} · Streak ${stats.streak}<br>Next sky in ${nextSkyIn()}</p>` : ""}
    <h2>WHAT YOU SAW</h2>
    <ol class="seen" id="seen"></ol>
    <footer class="credits">${theme.credits}</footer>
  </main>`;
  const list = document.getElementById("seen")!;
  for (const it of r.items) {
    const o = BY_ID.get(it.id);
    if (!o) continue;
    const li = document.createElement("li");
    li.className = it.outcome;
    li.appendChild(viewer.spriteCanvas(o.sprite, 2));
    const others = o.names.slice(1, 4).join(", ");
    const what =
      it.outcome === "skipped"
        ? `<span class="tag skip">skipped</span>${it.typed ? ` you tried “${esc(it.typed)}”` : ""}`
        : `<span class="tag ${it.outcome}">+${it.points}${it.outcome === "zoomed" ? " ★" : ""}</span> “${esc(it.typed)}”`;
    const div = document.createElement("div");
    div.innerHTML = `<b>${esc(o.names[0])}</b> <small>${esc(theme.bandNames[o.band])}</small><br>${what}${others ? `<br><small class="aka">also: ${esc(others)}</small>` : ""}`;
    li.appendChild(div);
    list.appendChild(li);
  }
  if (!r.items.length) list.innerHTML = `<li class="empty">Nothing this time. The sky will be back tomorrow.</li>`;
  const toast = (t: string) => { const e = document.getElementById("toast")!; e.textContent = t; };
  document.getElementById("share")?.addEventListener("click", async () => {
    const res = await share(shareText(r, theme, SITE_URL));
    toast(res === "copied" ? "Copied to clipboard" : res === "shared" ? "" : "Could not share");
  });
  document.getElementById("practice")!.onclick = () => openPlay("practice");
  document.getElementById("back")?.addEventListener("click", () => resultsScreen(store.today(localDateKey())!, "daily"));
  document.getElementById("daily")?.addEventListener("click", () => openPlay("daily"));
}

// ---------------------------------------------------------------- boot

// test hook for automated playtests: /?debug
if (new URLSearchParams(location.search).has("debug"))
  (window as unknown as { __sg: unknown }).__sg = { answer: () => run?.sky[run.i]?.names[0], phase: () => run?.phase };

const done = store.today(localDateKey());
if (done) void resultsScreen(done, "daily");
else void openPlay("daily");
