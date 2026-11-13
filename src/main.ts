import "@fontsource/press-start-2p";
import "@fontsource/vt323";
import { CONFIG, tierFor } from "./config";
import { OBJECTS, BY_ID, shownNames, themeName, type SkyObject } from "./library";
import { makeMatcher, normalize, forms as formsOf } from "./match";
import { dailySky, practiceSky, localDateKey, puzzleNumber, mulberry32, dayTheme, dayCondition } from "./daily";
import { theme } from "./themes";
import { setMuted, unlockAudio } from "./themes/chip";
import { Viewer } from "./viewer";
import { store, type ItemResult, type RunResult } from "./storage";
import { crowdScores, beatShare, CROWD_IS_SIMULATED } from "./crowd";
import { share, shareText } from "./share";

const matcher = makeMatcher(OBJECTS.map((o) => o.names));
/** /?night=N plays night N's sky and condition as an unsaved preview (for trying themes and conditions). */
let PREVIEW_NIGHT = Math.max(0, Math.floor(Number(new URLSearchParams(location.search).get("night")) || 0));
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
  /** Until this time, keys that don't start a name for the new object are dropped. */
  graceUntil: number;
  graceObj: SkyObject | null;
  graceText: string;
  graceDropped: string;
  clearedBonus: number;
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
      <div class="theme-label" id="label"></div>
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
    if (run.phase === "countdown") return; // keep it; it's checked when the first object appears
    if (run.phase !== "playing") { input.value = ""; return; }
    if (performance.now() < run.graceUntil && isTail(input.value)) {
      // the rest of the last answer ("book|s", "cake| slice"), not a new guess
      run.graceText += input.value;
      run.graceDropped += input.value;
      input.value = "";
      run.graceUntil = performance.now() + CONFIG.graceMs;
      return;
    }
    if (input.value) run.graceUntil = 0; // something was kept: never clear text the player can see
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
    // keep the extra letters only if they're the start of the next object's name
    const nextObj = run.sky[run.i];
    input.value = rest && nextObj && startsAName(nextObj, rest) ? rest : "";
    if (input.value) onTyped(input);
  }
}

/** Right after a match: is this text still the previous answer being finished? */
function isTail(value: string): boolean {
  const prev = run.graceObj;
  if (!prev || !value) return false;
  // "cake| slice": a new guess never starts with a space, and the keys right after it belong to it
  if ((/^\s/.test(value) || /\s/.test(run.graceDropped)) && !startsAName(run.sky[run.i], value)) return true;
  if (startsAName(run.sky[run.i], value)) return false;
  const joined = run.graceText + value;
  const n = normalize(joined);
  // still spelling the last answer, or the last answer with its final letter ("brocoll|i")
  return forms(prev).some((f) => f.startsWith(n)) || !!matcher.test(joined, prev.names);
}

function startsAName(obj: SkyObject | undefined, typed: string): boolean {
  if (!obj) return false;
  const n = normalize(typed);
  if (!n) return true;
  return forms(obj).some((f) => f.startsWith(n));
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
  const sky = mode === "daily" ? dailySky(puzzle, tier) : PREVIEW_NIGHT ? dailySky(PREVIEW_NIGHT, tier) : practiceSky(tier);
  return { mode, puzzle: mode === "daily" ? puzzle : PREVIEW_NIGHT || puzzle, date, tier, streak, sky, i: 0, phase: "ready", countdownAt: 0, startAt: 0, penalty: 0, score: 0, items: [], attempt: "", lastTick: 99, combo: 0, bestCombo: 0, graceUntil: 0, graceObj: null, graceText: "", graceDropped: "", clearedBonus: 0, pending: null };
}

async function openPlay(mode: Run["mode"]) {
  run = newRun(mode);
  playScreen();
  const cond = dayCondition(run.puzzle);
  await viewer.load();
  viewer.condition = cond.id;
  viewer.preload(run.sky.slice(0, 3));
  el.count.textContent = `0/${run.sky.length}`;
  el.controls.classList.add("hidden");
  el.hint.classList.add("hidden");
  app.querySelector(".play")!.classList.add("ready");
  el.overlay.className = "overlay wordmark";
  el.overlay.innerHTML = `<div><b>${theme.title.toUpperCase()}</b><span>${mode === "daily" ? `NIGHT #${run.puzzle} · ${fmtDate(run.date).toUpperCase()}` : (PREVIEW_NIGHT ? `PREVIEW OF NIGHT #${PREVIEW_NIGHT} · NOT SAVED` : "PRACTICE SKY · NOT SCORED")}</span><span>TONIGHT: ${themeName(run.sky[0]?.theme ?? dayTheme(run.puzzle)).toUpperCase()}</span></div>`;
  const c3 = CONFIG.combo[0];
  el.start.innerHTML = `
    ${tierLine(run.tier, run.streak)}
    <p class="tonight"><b>${themeName(run.sky[0]?.theme ?? dayTheme(run.puzzle)).toUpperCase()}</b> under <b class="cond">${cond.name.toUpperCase()}</b><br><small>${cond.blurb}</small></p>
    <ul class="rules">
      <li><b>Type</b> what you see. It moves on by itself.</li>
      <li><b>Zoomed in?</b> Name it early for bonus points.</li>
      <li><b>${c3.at} in a row</b> earns extra. ${isTouch ? "Skip" : "Tab skips"}${isTouch ? "" : ","} costs ${CONFIG.skipCost}s and breaks it.</li>
    </ul>
    <button class="btn primary" id="go">OPEN THE SHUTTER</button>
    <p class="small">${CONFIG.runSeconds} seconds · ${mode === "daily" ? "same sky as everyone on your tier" : `random ${themeName(run.sky[0]?.theme ?? "").toLowerCase()}`}</p>`;
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
  lastFresh = 0;
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
  if ((el.guess as HTMLInputElement).value) onTyped(el.guess as HTMLInputElement);
}

function showObject(now: number) {
  const obj = run.sky[run.i];
  if (!obj) {
    // the whole sky named early: every second left is a point
    run.clearedBonus = Math.max(0, Math.floor(timeLeft(now)));
    run.score += run.clearedBonus;
    el.score.textContent = String(run.score);
    return finish(now, true);
  }
  viewer.show(obj, now);
  viewer.preload(run.sky.slice(run.i + 1, run.i + 3));
  run.attempt = "";
  el.label.textContent = themeName(obj.theme).toUpperCase();
  const band = CONFIG.bands[obj.band];
  el.band.textContent = `${theme.bandNames[obj.band].toUpperCase()} · ${band.points} PT${band.points > 1 ? "S" : ""}`;
  el.band.dataset.band = String(obj.band);
  blackHole(obj.band === 3);
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
  run.graceUntil = now + CONFIG.graceMs;
  run.graceObj = obj;
  run.graceText = typed;
  run.graceDropped = "";
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
    clearedBonus: run.clearedBonus || undefined,
  };
}

/** The daily run counts from the moment the shutter opens, so a reload can't buy a second try. */
function saveProgress() {
  if (run.mode !== "daily") return;
  store.save({ ...buildResult(), partial: true });
  const last = run.items[run.items.length - 1];
  if (last && last.outcome !== "skipped") lastFresh += store.addToCatalogue([last.id]);
}

/** Black Hole objects darken the whole screen, ring the scope in orange and flash a warning. */
function blackHole(on: boolean) {
  const play = app.querySelector(".play");
  if (!play) return;
  const was = play.classList.contains("blackhole");
  play.classList.toggle("blackhole", on);
  if (!on || was) return;
  theme.sounds.blackHole?.();
  announce("Black hole");
  const w = document.createElement("div");
  w.className = "bh-warn";
  w.innerHTML = `<span>! BLACK HOLE !</span><small>${CONFIG.bands[3].points} PTS · ${CONFIG.bands[3].zoomedPoints} IF YOU CATCH IT EARLY</small>`;
  el.scope.appendChild(w);
  setTimeout(() => w.remove(), 1400);
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
    e.innerHTML = `STEADY ×${c} <span class="cpips">${CONFIG.combo.map((k) => (c >= k.at ? "■" : "□")).join("")}</span>`;
    e.classList.add("on");
    if (c >= CONFIG.combo[1].at) e.classList.add("gold");
  } else e.textContent = "";
}

function timeLeft(now: number) {
  return CONFIG.runSeconds - (now - run.startAt) / 1000 - run.penalty;
}

function finish(now: number, cleared = false) {
  if (run.phase === "over") return;
  if (run.pending !== null) acceptPending(); // credit a match that was waiting on a longer name
  if ((run.phase as Run["phase"]) === "over") return; // that match cleared the sky and finished the run
  dropPending();
  run.phase = "over";
  blackHole(false);
  announce("Time. Results coming up.");
  viewer.dismiss("skipped", now);
  theme.sounds.end();
  if (!cleared) el.time.textContent = "0";
  el.overlay.textContent = cleared ? "SKY CLEARED!" : "TIME!";
  el.pops.textContent = "";
  el.overlay.className = "overlay big";
  (el.guess as HTMLInputElement).value = "";
  el.controls.classList.add("dim");
  const result = buildResult();
  lastFresh += store.addToCatalogue(run.items.filter((i) => i.outcome !== "skipped").map((i) => i.id));
  const prevBest = store.bestBefore(run.date);
  const prev = store.today(run.date);
  if (run.mode === "daily" && (!prev || prev.partial)) store.save(result);
  const newBest = run.mode === "daily" && result.score > prevBest && prevBest > 0;
  (el.guess as HTMLInputElement).blur();
  // the shutter closes, then the night's score counts up in the lens
  setTimeout(() => {
    if (!document.getElementById("eyepiece")) return;
    viewer.closeShutter(performance.now());
    app.querySelector(".play")?.classList.add("tally");
    el.overlay.className = "overlay tally";
    el.overlay.innerHTML = `<div><b id="tally">0</b><span>POINTS</span>${newBest ? `<em id="best" class="hidden">NEW BEST</em>` : ""}</div>`;
    countUp(document.getElementById("tally")!, result.score, 900, true, () => {
      if (newBest) { document.getElementById("best")?.classList.remove("hidden"); theme.sounds.best(); }
      setTimeout(() => resultsScreen(result, run.mode), newBest ? 1300 : 900);
    });
  }, 800);
}

/** Count a number up for a little ceremony. */
function countUp(node: HTMLElement, to: number, ms: number, ticks: boolean, done?: () => void) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || to <= 0 || document.hidden) { node.textContent = String(to); done?.(); return; }
  let finished = false;
  const end = () => { if (finished) return; finished = true; node.textContent = String(to); done?.(); };
  setTimeout(end, ms + 600); // rAF stops in background tabs; don't leave the tally frozen
  const t0 = performance.now();
  let last = -1;
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / ms);
    const v = Math.round(to * (1 - (1 - p) * (1 - p)));
    if (v !== last) {
      node.textContent = String(v);
      if (ticks && Math.floor(v / 3) !== Math.floor(last / 3)) theme.sounds.tick();
      last = v;
    }
    if (finished) return;
    if (p < 1) requestAnimationFrame(step);
    else end();
  };
  requestAnimationFrame(step);
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
  return `<span class="pips" aria-hidden="true">${"<i class=on></i>".repeat(Math.max(0, have))}${"<i></i>".repeat(Math.max(0, need - have))}</span>`;
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
  const bandsSeen = [...new Set(r.items.map((it) => BY_ID.get(it.id)?.band).filter((b) => b !== undefined))].sort() as number[];
  const crowdSky = daily ? dailySky(r.puzzle, tier) : run?.sky ?? [];
  const crowd = crowdScores(crowdSky, daily ? r.puzzle * 10 + tier : 777, dayCondition(r.puzzle).id);
  app.innerHTML = `
  <main class="results">
    <section class="log">
      <header class="log-head">
        <span>OBSERVING LOG</span>
        <span>${daily ? `NIGHT #${r.puzzle}` : "PRACTICE"}</span>
      </header>
      <p class="date">${daily ? `${fmtDate(r.date)} · ${themeName(dayTheme(r.puzzle))} · ${dayCondition(r.puzzle).name} · ${CONFIG.tiers[tier].name} sky` : "Random objects, not scored"}</p>
      <div class="final"><span>${r.score}</span><small>POINTS${r.clearedBonus ? ` · SKY CLEARED +${r.clearedBonus}` : ""}</small></div>
      ${r.partial ? `<p class="small">This run was cut short, so it counts as it stood.</p>` : ""}
      <canvas class="chart" id="chart" aria-label="Star chart of your run, with tonight's crowd on the hill"></canvas>
      <div class="hill-axis"><span>◂ fewer points</span><span>more points ▸</span></div>
      <p class="hill-line" id="hill-line"></p>
      <p class="legend">${bandsSeen.map((b) => `<span><i class="lg" style="background:${theme.bandColors[b]}"></i>${theme.bandNames[b]}</span>`).join("")}<span><b class="lg-big">+</b>big star = zoom bonus</span><span><i class="lg skipped"></i>skipped</span></p>
      <p class="caption">One star per object, coloured by difficulty. Lines join answers in a row.${CROWD_IS_SIMULATED ? " The crowd on the hill is simulated on tonight's sky until live scores arrive." : ""}</p>
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
    <section class="missed" id="missed"></section>
    ${import.meta.env.VITE_PREVIEW_TOOLS ? `<section class="preview-tools"><h2>PREVIEW ONLY <small>try other nights, not saved</small></h2><div class="actions">${[1, 2, 3, 4, 5, 6].map((n) => `<button class="btn" data-night="${n}">#${n} ${themeName(dayTheme(n))}<br><small>${dayCondition(n).name}</small></button>`).join("")}</div></section>` : ""}
    <footer class="credits">${theme.credits}</footer>
  </main>`;
  lastFresh = 0;
  const others = 12, beat = beatShare(crowd, r.score), rank = Math.round(beat * others);
  drawChart(document.getElementById("chart") as HTMLCanvasElement, r, rank, others);
  const median = crowd[Math.floor(crowd.length / 2)];
  document.getElementById("hill-line")!.innerHTML =
    rank >= others ? `You out-spotted <b>every stargazer</b> on the hill tonight.`
    : rank === 0 ? `The whole hill saw more tonight. The sky comes back tomorrow.`
    : `You out-spotted <b>${rank} of ${others}</b> stargazers on the hill.`
    + `<br><small>A typical score tonight: ${median}</small>`;
  const list = document.getElementById("seen")!;
  for (const it of r.items) {
    const o = BY_ID.get(it.id);
    if (!o) continue;
    const li = document.createElement("li");
    li.className = it.outcome;
    li.style.setProperty("--band", theme.bandColors[o.band]);
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
  // tonight's sky that the clock ran out on, one fold-out per difficulty
  const reached = new Set(r.items.map((it) => it.id));
  const unseen = crowdSky.filter((o) => !reached.has(o.id));
  const missed = document.getElementById("missed")!;
  if (unseen.length) {
    missed.innerHTML = `<h2>STILL OUT THERE <small>${unseen.length} you didn't reach</small></h2>`;
    for (const b of [0, 1, 2, 3]) {
      const objs = unseen.filter((o) => o.band === b);
      if (!objs.length) continue;
      const d = document.createElement("details");
      d.style.setProperty("--band", theme.bandColors[b]);
      d.innerHTML = `<summary><i class="lg" style="background:${theme.bandColors[b]}"></i>${theme.bandNames[b]} <small>${objs.length} · ${CONFIG.bands[b].points} pt${CONFIG.bands[b].points > 1 ? "s" : ""} each</small></summary>`;
      const ul = document.createElement("ul");
      ul.className = "seen unseen";
      for (const o of objs) {
        const li = document.createElement("li");
        li.style.setProperty("--band", theme.bandColors[b]);
        li.appendChild(viewer.spriteCanvas(o.sprite, 2));
        const others = shownNames(o).slice(0, 3).join(", ");
        const div = document.createElement("div");
        div.innerHTML = `<b>${esc(o.names[0])}</b>${others ? `<small class="aka">${esc(others)}</small>` : ""}`;
        li.appendChild(div);
        ul.appendChild(li);
      }
      d.appendChild(ul);
      missed.appendChild(d);
    }
  }
  if (!r.items.length) list.innerHTML = `<li class="empty">Nothing this time. The sky will be back tomorrow.</li>`;
  const toast = (t: string) => { const e = document.getElementById("toast")!; e.textContent = t; };
  document.getElementById("share")?.addEventListener("click", async () => {
    const res = await share(shareText(r, theme, SITE_URL));
    toast(res === "copied" ? "Log copied. Paste it anywhere." : res === "shared" ? "" : "Couldn't share. Try again.");
  });
  document.getElementById("back")?.addEventListener("click", () => resultsScreen(store.today(localDateKey())!, "daily"));
  document.getElementById("daily")?.addEventListener("click", () => { PREVIEW_NIGHT = 0; void openPlay("daily"); });
  app.querySelectorAll<HTMLButtonElement>("[data-night]").forEach((b) => (b.onclick = () => { PREVIEW_NIGHT = Number(b.dataset.night); void openPlay("practice"); }));
}

/**
 * Star chart: each object becomes a star at a spot seeded by the night and its position,
 * so everyone's chart for the same night has the same sky. Answers in a row join up into constellations,
 * and each star takes its difficulty colour. Below, a hill of stargazers lined up by score
 * (fewest points on the left), with you standing among them in gold.
 */
function drawChart(c: HTMLCanvasElement, r: RunResult, rank: number, others: number) {
  const W = 160, H = 112, SKY = 72;
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0b0a18";
  g.fillRect(0, 0, W, H);
  for (let k = 4; k >= 1; k--) {
    g.fillStyle = "rgba(32, 34, 67, 0.35)";
    g.beginPath();
    g.ellipse(W / 2, SKY / 2, (W / 2) * (k / 4), (SKY / 2) * (k / 4), 0, 0, Math.PI * 2);
    g.fill();
  }
  const rand = mulberry32(r.puzzle * 7919 + 13);
  g.fillStyle = "#26294a";
  for (let i = 0; i < 80; i++) g.fillRect(Math.floor(rand() * W), Math.floor(rand() * H), 1, 1);
  // a seeded random walk: each answer in a row steps a short way from the last, a skip jumps elsewhere
  const mx = Math.round(W * 0.08), my = 7;
  const clampX = (v: number) => Math.max(mx, Math.min(W - mx, v));
  const clampY = (v: number) => Math.max(my, Math.min(SKY - 10, v));
  let px = clampX(rand() * W), py = clampY(rand() * SKY);
  const pos = r.items.map((it, i) => {
    if (i > 0) {
      if (it.outcome === "skipped" || r.items[i - 1].outcome === "skipped") { px = clampX(rand() * W); py = clampY(rand() * SKY); }
      else {
        const ang = rand() * Math.PI * 2, d = W * (0.1 + rand() * 0.08);
        px = clampX(px + Math.cos(ang) * d); py = clampY(py + Math.sin(ang) * d * 0.6);
      }
    }
    return { x: Math.round(px), y: Math.round(py) };
  });
  g.fillStyle = "#2b4a6f";
  for (let i = 1; i < r.items.length; i++) {
    if (r.items[i].outcome === "skipped" || r.items[i - 1].outcome === "skipped") continue;
    line(g, pos[i - 1].x, pos[i - 1].y, pos[i].x, pos[i].y, 2);
  }
  let brightest = -1;
  r.items.forEach((it, i) => {
    const { x, y } = pos[i];
    const o = BY_ID.get(it.id);
    const col = theme.bandColors[o?.band ?? 0];
    if (it.outcome === "skipped") { g.fillStyle = "#3a4466"; g.fillRect(x, y, 1, 1); return; }
    if (brightest < 0 || (o?.band ?? 0) > (BY_ID.get(r.items[brightest].id)?.band ?? 0)) brightest = i;
    g.fillStyle = col;
    if (it.outcome === "zoomed") {
      // a bigger four-point sparkle with a gold heart
      g.fillRect(x - 2, y, 5, 1); g.fillRect(x, y - 2, 1, 5);
      g.fillStyle = "#fee761"; g.fillRect(x, y, 1, 1);
    } else {
      g.fillRect(x, y, 1, 1);
      g.globalAlpha = 0.45; g.fillRect(x - 1, y, 3, 1); g.fillRect(x, y - 1, 1, 3); g.globalAlpha = 1;
    }
  });

  // the hill
  const ground = (x: number) => Math.round(H - 10 - Math.sin((x / W) * Math.PI) * 9);
  for (let x = 0; x < W; x++) {
    const y0 = ground(x);
    g.fillStyle = "#1b1d3a"; g.fillRect(x, y0, 1, H - y0);
    g.fillStyle = "#2c3058"; g.fillRect(x, y0, 1, 1);
  }
  // grass tufts
  g.fillStyle = "#24284a";
  for (let i = 0; i < 26; i++) { const x = Math.floor(rand() * W); g.fillRect(x, ground(x) + 2 + Math.floor(rand() * 8), 1, 1); }

  // stargazers: `others` people by score, you slotted in after `rank` of them
  const n = others + 1, gap = (W - 20) / (n - 1);
  let you = { x: 0, y: 0 };
  for (let k = 0; k < n; k++) {
    const x = Math.round(10 + k * gap), base = ground(x) + 1;
    const isYou = k === rank;
    const facing = x < W / 2 ? 1 : -1; // everyone leans in toward the middle of the sky
    stargazer(g, x, base, facing, isYou ? "#fee761" : "#5a6988", isYou ? "#feae34" : "#3a4466", (k * 7) % 3);
    if (isYou) you = { x, y: base };
  }
  // your beam up to your hardest catch, and a marker star over your head
  if (brightest >= 0) {
    const tx = you.x + 6 * (you.x < W / 2 ? 1 : -1), ty = you.y - 11;
    g.fillStyle = "rgba(254, 231, 97, 0.35)";
    line(g, tx, ty, pos[brightest].x, pos[brightest].y + 2, 3);
  }
  g.fillStyle = "#fee761";
  g.fillRect(you.x, you.y - 17, 1, 3); g.fillRect(you.x - 1, you.y - 16, 3, 1);

  // compass mark
  g.fillStyle = "#5a6988";
  g.fillRect(W - 6, 3, 1, 5);
  g.fillRect(W - 7, 4, 3, 1);
}

/** A little stargazer (5x10) peering through a telescope on a tripod, feet at (x, base). */
function stargazer(g: CanvasRenderingContext2D, x: number, base: number, dir: number, body: string, scope: string, hat: number) {
  const px = (dx: number, dy: number, w = 1, h = 1) => g.fillRect(dir > 0 ? x + dx : x - dx - w + 1, base + dy, w, h);
  g.fillStyle = body;
  px(-1, -9, 3, 3); // head
  if (hat === 1) px(-1, -10, 3, 1); // beanie
  if (hat === 2) { px(-2, -9, 1, 1); px(-1, -10, 3, 1); } // hood
  px(-1, -6, 3, 4); // coat
  px(2, -6, 1, 1); // arm up to the eyepiece
  px(-1, -2, 1, 2); px(1, -2, 1, 2); // legs
  g.fillStyle = scope;
  px(2, -8, 2, 1); px(4, -9, 2, 1); px(6, -10, 1, 1); // tube, angled up
  px(4, -8, 1, 1); px(4, -7, 1, 7); px(3, -1, 1, 1); px(5, -1, 1, 1); // tripod
}

function line(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, every = 1) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let k = 0; k <= n; k += every) g.fillRect(Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n), 1, 1);
}

// ---------------------------------------------------------------- boot

// test hook for automated playtests: /?debug
if (new URLSearchParams(location.search).has("debug"))
  (window as unknown as { __sg: unknown }).__sg = { answer: () => run?.sky[run.i]?.names[0], phase: () => run?.phase };

const done = store.today(localDateKey());
if (PREVIEW_NIGHT) void openPlay("practice");
else if (done) void resultsScreen(done, "daily");
else void openPlay("daily");
