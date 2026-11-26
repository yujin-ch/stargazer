import "@fontsource/press-start-2p";
import "@fontsource/vt323";
import { CONFIG, tierFor, answerPoints, SITE_URL, TIP_URL } from "./config";
import { drawShareCard, cardBlob } from "./sharecard";
import { OBJECTS, BY_ID, loadDayPack, loadPackIndex, shownNames, themeName, themeLabel, themeInfo, type SkyObject } from "./library";
import { makeMatcher, normalize, forms as formsOf, linkMatches } from "./match";
import { dailySky, setDayPack, notePackNight, practiceSky, localDateKey, puzzleNumber, mulberry32, dayTheme, dayCondition } from "./daily";
import { theme } from "./themes";
import { setMuted, unlockAudio, setAmbience, ui } from "./themes/chip";
import { Viewer } from "./viewer";
import { store, type ItemResult, type RunResult } from "./storage";
import { crowdScores, beatShare, liveCrowd, MIN_LIVE } from "./crowd";
import { share, shareText, nightTitle, type Standing } from "./share";
import { atlasScreen, type AtlasStar } from "./atlas";
import { introScreen } from "./intro";
import { skyCenter, skyBlackHole, skyPulse, skyTravel, skyBoost } from "./themes/pixel-space/sky";
import { THEMES } from "./library";

let matcher = makeMatcher(OBJECTS.map((o) => o.names));
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
/** Links people share carry ?s=1, so visits from shares can be told apart. */
const SHARE_URL = `${SITE_URL}/?s=1`;
setMuted(store.muted);
setAmbience(store.ambience);
// browsers only allow sound after a tap or key: the first one wakes the night sounds
for (const ev of ["pointerdown", "keydown"]) window.addEventListener(ev, () => unlockAudio(), { once: true, capture: true });
// a sound for every touch of the interface (the in-play skip has its own)
function uiSoundFor(t: HTMLElement) {
  const b = t.closest("button, .btn, summary, .astar, .seen li, a[href]") as HTMLElement | null;
  if (!b || b.id === "skip" || (b as HTMLButtonElement).disabled) return;
  if (b.matches(".astar")) return; // the atlas plays its own
  if (b.matches(".back-btn, #back, .card-x")) ui("back");
  else if (b.matches(".primary")) ui("confirm");
  else if (b.matches("summary, .seen li")) ui("open");
  else if (/: (ON|OFF)/.test(b.textContent ?? "")) ui("toggle");
  else ui("tap");
}
document.addEventListener("pointerdown", (e) => { unlockAudio(); uiSoundFor(e.target as HTMLElement); }, { capture: true });
document.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target instanceof HTMLElement && e.target !== el.guess) uiSoundFor(e.target); }, { capture: true });
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
    <button class="btn back-btn" id="backbtn" type="button" aria-label="Back to the star atlas">&lt; ATLAS</button>
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
  for (const id of ["score", "time", "count", "scope", "overlay", "pops", "label", "band", "bonus", "bonusbar", "controls", "guess", "clear", "skip", "hint", "start", "mute", "combo", "backbtn"])
    el[id] = document.getElementById(id)!;
  viewer = new Viewer(document.getElementById("eyepiece") as HTMLCanvasElement, theme);
  // the lens follows the space it has (the label row and keyboard change it mid-run)
  if (window.ResizeObserver) new ResizeObserver(() => sizeViewer()).observe(el.scope);
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
  const rc = scope.getBoundingClientRect();
  skyCenter(rc.left + rc.width / 2, rc.top + rc.height / 2);
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
    ui("key");
    warmth(input.value);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Tab") { e.preventDefault(); if (run.phase === "playing") skip(); }
    else if (e.key === "Escape") { input.value = ""; dropPending(); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (run.phase !== "playing") return;
      if (run.pending !== null) acceptPending();
      else if (input.value.trim()) { shake(); ui("nope"); input.value = ""; }
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
  await tonightPack;
  run = newRun(mode);
  playScreen();
  const cond = dayCondition(run.puzzle);
  await viewer.load(run.sky);
  viewer.condition = cond.id;
  viewer.preload(run.sky.slice(0, 3));
  el.count.textContent = `0/${run.sky.length}`;
  el.controls.classList.add("hidden");
  el.hint.classList.add("hidden");
  app.querySelector(".play")!.classList.add("ready");
  el.overlay.className = "overlay wordmark";
  const skyDate = mode === "daily" ? run.date : PREVIEW_NIGHT ? dateKeyOfNight(PREVIEW_NIGHT) : "";
  el.overlay.innerHTML = `<div><b>${theme.title.toUpperCase()}</b></div>`;
  const c3 = CONFIG.combo[0];
  const skyTheme = run.sky[0]?.theme ?? dayTheme(run.puzzle);
  const mystery = !!themeInfo(skyTheme)?.mystery;
  el.start.innerHTML = `
    <p class="start-kicker">${mode === "daily" ? "TONIGHT'S SKY" : skyDate && skyDate < localDateKey() ? `${fmtDate(skyDate).toUpperCase()} · NOT SAVED` : "PREVIEW · NOT SAVED"}</p>
    <h1 class="start-title">${mystery ? "A MYSTERY LINK" : themeName(skyTheme).toUpperCase()}</h1>
    <p class="start-line">${mystery ? `Name what you see, then guess what links it all for +${CONFIG.linkBonus}.` : "Name what you see before the clock runs out."}<br><small>${CONFIG.runSeconds} seconds · ${run.sky.length} objects · ${isTouch ? "Skip" : "Tab skips"} for ${CONFIG.skipCost}s</small></p>
    <button class="btn primary" id="go">OPEN THE SHUTTER</button>
    ${mode === "daily" ? `<p class="small tier-mini">${CONFIG.tiers[run.tier].name} sky${run.streak ? ` · ${run.streak}-night streak` : ""}</p>` : ""}`;
  document.getElementById("go")!.onclick = begin;
  el.backbtn.onclick = () => { cancelAnimationFrame(raf); skyTravel(false); showAtlas(); };
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
  skyTravel(true);
  el.overlay.textContent = "";
  theme.sounds.start();
  showObject(now);
  if ((el.guess as HTMLInputElement).value) onTyped(el.guess as HTMLInputElement);
}

function showObject(now: number) {
  const obj = run.sky[run.i];
  if (!obj) {
    // the whole sky named early: every second left is a point
    run.clearedBonus = Math.max(0, Math.floor(timeLeft(now))) * CONFIG.clearedPerSecond;
    run.score += run.clearedBonus;
    el.score.textContent = String(run.score);
    return finish(now, true);
  }
  viewer.show(obj, now);
  skyBoost(obj.band === 3 ? 0.4 : 1.2); // swing across space to the next object (a black hole pulls you up short)
  viewer.preload(run.sky.slice(run.i + 1, run.i + 3));
  warmth((el.guess as HTMLInputElement).value);
  run.attempt = "";
  el.label.textContent = themeLabel(obj.theme).toUpperCase();
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
  const points = answerPoints(obj.band, zoomed, run.combo);
  run.score += points;
  run.items.push({ id: obj.id, outcome: zoomed ? "zoomed" : "named", typed: typed.trim(), points, t: clockAt(now) });
  (el.guess as HTMLInputElement).value = "";
  run.graceUntil = now + CONFIG.graceMs;
  run.graceObj = obj;
  run.graceText = typed;
  run.graceDropped = "";
  el.score.textContent = String(run.score);
  pop(obj.names[0], `+${points}${zoomed ? " ZOOM" : ""}`, zoomed ? "gold" : "", obj.band);
  bandHit(obj.band, zoomed);
  flyStar(zoomed ? "#fee761" : theme.bandColors[obj.band], zoomed);
  buzz(zoomed ? [18, 40, 28] : [12]);
  theme.sounds.correct(zoomed, run.combo, obj.band);
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
  run.items.push({ id: obj.id, outcome: "skipped", typed: run.attempt.trim(), points: 0, t: clockAt(now) });
  (el.guess as HTMLInputElement).value = "";
  const broke = run.combo >= CONFIG.combo[0].at;
  run.combo = 0;
  renderCombo(broke);
  if (broke) theme.sounds.comboBreak();
  pop(obj.names[0], `-${CONFIG.skipCost}s`, "red");
  buzz([40]);
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
  skyBlackHole(on);
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
/** The harder the find, the bigger the moment: the sky pulses in the band's colour, the lens kicks, the room lights up. */
function bandHit(band: number, zoomed: boolean) {
  skyPulse(theme.bandColors[band], [0.25, 0.5, 0.85, 1.25][band] + (zoomed ? 0.2 : 0));
  const play = app.querySelector<HTMLElement>(".play");
  if (!play) return;
  play.style.setProperty("--hit", theme.bandColors[band]);
  for (let b = 0; b < 4; b++) play.classList.remove(`hit-b${b}`);
  void play.offsetWidth;
  play.classList.add(`hit-b${band}`);
  clearTimeout(bandHitTimer);
  bandHitTimer = window.setTimeout(() => play.classList.remove(`hit-b${band}`), 900);
}
let bandHitTimer = 0;

function pop(name: string, points: string, cls: string, band = -1) {
  el.pops.textContent = "";
  const p = document.createElement("div");
  p.className = `pop ${cls}`;
  const n = document.createElement("span");
  n.className = "pop-name";
  n.setAttribute("aria-hidden", "true");
  // each letter lights up in turn
  [...name.toUpperCase()].forEach((ch, i) => {
    const l = document.createElement("i");
    l.textContent = ch;
    l.style.animationDelay = `${i * 28}ms`;
    n.appendChild(l);
  });
  const pts = document.createElement("span");
  pts.className = "pop-pts";
  pts.textContent = points;
  p.append(n, pts);
  if (band >= 0) {
    const tag = document.createElement("span");
    tag.className = "pop-band";
    tag.style.setProperty("--band", theme.bandColors[band]);
    tag.innerHTML = `<i></i>${theme.bandNames[band].toUpperCase()}`;
    p.append(tag);
  }
  el.pops.appendChild(p);
  setTimeout(() => p.remove(), 900);
}

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A little star leaves the lens and flies up into the score, which bumps when it lands. */
function flyStar(color: string, big: boolean) {
  const bump = () => { el.score.parentElement!.classList.remove("bump"); void el.score.offsetWidth; el.score.parentElement!.classList.add("bump"); };
  const cv = el.scope.querySelector("canvas");
  if (REDUCED_MOTION || !cv || !("animate" in Element.prototype)) return bump();
  const from = cv.getBoundingClientRect(), to = el.score.getBoundingClientRect();
  const s = document.createElement("i");
  s.className = `fly-star${big ? " big" : ""}`;
  s.style.setProperty("--c", color);
  document.body.appendChild(s);
  const x0 = from.left + from.width / 2, y0 = from.top + from.height / 2, x1 = to.left + to.width / 2, y1 = to.top + to.height / 2;
  // an arc: out and up, then into the score
  const mx = (x0 + x1) / 2 + (x0 > x1 ? 40 : -40), my = Math.min(y0, y1) - 30;
  const a = s.animate([
    { transform: `translate(${x0}px, ${y0}px) scale(1.4)`, opacity: 1 },
    { transform: `translate(${mx}px, ${my}px) scale(1)`, opacity: 1, offset: 0.55 },
    { transform: `translate(${x1}px, ${y1}px) scale(0.5)`, opacity: 0.9 },
  ], { duration: 480, easing: "cubic-bezier(0.3, 0, 0.6, 1)" });
  a.onfinish = () => { s.remove(); bump(); };
}

/** A small tap on phones that can do it (Android); silent everywhere else. */
function buzz(pattern: number[]) {
  if (!isTouch || !store.haptics || REDUCED_MOTION) return;
  try { navigator.vibrate?.(pattern); } catch { /* not allowed */ }
}

/** "Warmer": the entry glows while what you've typed is the start of a name for this object. */
function warmth(value: string) {
  const obj = run?.sky[run.i];
  const n = normalize(value);
  const warm = !!obj && run.phase === "playing" && n.length >= 2 && forms(obj).some((f) => f.startsWith(n));
  const was = el.guess.parentElement!.classList.contains("warm");
  el.guess.parentElement!.classList.toggle("warm", warm);
  if (warm && !was) ui("warm");
}

function renderCombo(broke: boolean) {
  const c = run.combo;
  const e = el.combo;
  e.classList.remove("broke", "gold", "on");
  void e.offsetWidth;
  if (broke) { e.textContent = "STEADY ×0"; e.classList.add("broke", "on"); return; }
  if (c >= CONFIG.combo[0].at) {
    const mult = CONFIG.combo.reduce((x, k) => (c >= k.at ? k.mult : x), 1);
    e.innerHTML = `STEADY ×${mult} <span class="cpips">${CONFIG.combo.map((k) => (c >= k.at ? "■" : "□")).join("")}</span>`;
    e.classList.add("on");
    if (c >= CONFIG.combo[1].at) e.classList.add("gold");
  } else e.textContent = "";
}

/** Seconds gone on the clock (skips included), rounded to a tenth. */
function clockAt(now: number) { return Math.round(Math.min(CONFIG.runSeconds, CONFIG.runSeconds - timeLeft(now)) * 10) / 10; }

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
  skyTravel(false);
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
      const info = themeInfo(run.sky[0]?.theme ?? "");
      setTimeout(() => (info?.mystery ? finalQuestion(result, run.mode) : resultsScreen(result, run.mode)), newBest ? 1300 : 900);
    });
  }, 800);
}

/** Score a Mystery link guess onto a result (and save it for a daily run). */
function applyLink(r: RunResult, guess: string, mode: Run["mode"], themeId: string): RunResult {
  const info = themeInfo(themeId);
  const ok = !!info && !!guess.trim() && linkMatches(guess, [...info.keys, info.name ?? ""]);
  const bonus = ok ? CONFIG.linkBonus : 0;
  const next: RunResult = { ...r, score: r.score + bonus, link: { guess: guess.trim(), ok, bonus } };
  if (mode === "daily") store.save(next);
  if (ok) theme.sounds.best();
  return next;
}

/** On Mystery link nights the run ends with one last question in the lens: what linked tonight's sky? */
function finalQuestion(result: RunResult, mode: Run["mode"]) {
  if (!document.getElementById("eyepiece")) return;
  const themeId = run.sky[0]?.theme ?? "";
  el.overlay.className = "overlay final-q";
  el.overlay.innerHTML = `<div><b>?</b><span>ONE LAST QUESTION</span></div>`;
  el.start.className = "start final-card";
  el.start.innerHTML = `
    <h1>WHAT LINKED TONIGHT'S SKY?</h1>
    <p class="small">Everything you saw had something in common. One guess, +${CONFIG.linkBonus} if you get it.</p>
    <form id="final-form" class="link-form" autocomplete="off">
      <input id="final-guess" type="text" maxlength="60" placeholder="they all…" aria-label="Your guess at the link" autocapitalize="none" spellcheck="false" enterkeyhint="done" />
      <button class="btn primary" type="submit">GUESS</button>
    </form>
    <button class="link-skip" id="final-skip" type="button">I give up, show me</button>`;
  const input = document.getElementById("final-guess") as HTMLInputElement;
  setTimeout(() => input.focus(), 50);
  let done = false;
  const submit = (guess: string) => {
    if (done) return;
    done = true;
    const next = applyLink(result, guess, mode, themeId);
    el.start.classList.add("hidden");
    el.overlay.className = "overlay final-q " + (next.link!.ok ? "found" : "missed");
    el.overlay.innerHTML = next.link!.ok
      ? `<div><b>+${next.link!.bonus}</b><span>LINK FOUND</span></div>`
      : `<div><b>✕</b><span>${guess.trim() ? "NOT QUITE" : "THE LINK WAS…"}</span></div>`;
    setTimeout(() => resultsScreen(next, mode), 1100);
  };
  (document.getElementById("final-form") as HTMLFormElement).onsubmit = (e) => { e.preventDefault(); submit(input.value); };
  document.getElementById("final-skip")!.onclick = () => submit("");
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

/** The moon climbs over the hill as the next sky gets closer; the countdown ticks every second. */
function moonrise() {
  const c = document.getElementById("moonrise") as HTMLCanvasElement | null, label = document.getElementById("next-in");
  if (!c || !label) return;
  const g = c.getContext("2d")!, W = c.width, H = c.height;
  const paint = () => {
    if (!c.isConnected) { clearInterval(timer); return; }
    const now = new Date(), start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const frac = (now.getTime() - start.getTime()) / (next.getTime() - start.getTime());
    const ms = next.getTime() - now.getTime();
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
    label.textContent = `${h ? `${h}h ` : ""}${String(m).padStart(h ? 2 : 1, "0")}m ${String(s).padStart(2, "0")}s`;
    g.clearRect(0, 0, W, H);
    // a few stars
    g.fillStyle = "#5a5078";
    for (let i = 0; i < 18; i++) g.fillRect((i * 37) % W, (i * 23) % (H - 12), 1, 1);
    // the moon rises from behind the hill toward the top as midnight nears
    const mx = Math.round(18 + frac * (W - 36)), my = Math.round(H + 4 - frac * (H - 2));
    g.fillStyle = "rgba(242, 211, 138, 0.18)";
    g.beginPath(); g.arc(mx, my, 9, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#f2e6c0";
    g.beginPath(); g.arc(mx, my, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#d8c89a"; g.fillRect(mx - 2, my - 1, 2, 2); g.fillRect(mx + 1, my + 2, 1, 1);
    // the hill, with a tiny telescope waiting on top
    for (let x = 0; x < W; x++) {
      const y = Math.round(H - 6 - Math.sin((x / W) * Math.PI) * 6);
      g.fillStyle = "#1b1630"; g.fillRect(x, y, 1, H - y);
      g.fillStyle = "#3a2f52"; g.fillRect(x, y, 1, 1);
    }
    g.fillStyle = "#c99a4a";
    g.fillRect(W / 2 - 1, H - 15, 4, 1); g.fillRect(W / 2 + 2, H - 16, 2, 1); g.fillRect(W / 2, H - 14, 1, 3); g.fillRect(W / 2 - 1, H - 12, 1, 1); g.fillRect(W / 2 + 1, H - 12, 1, 1);
  };
  const timer = window.setInterval(paint, 1000);
  paint();
}

async function resultsScreen(r: RunResult, mode: Run["mode"]) {
  cancelAnimationFrame(raf);
  if (!viewer) { viewer = new Viewer(document.createElement("canvas"), theme); }
  await viewer.load(OBJECTS.filter((o) => o.kind === "photo"));
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
  const themeId = crowdSky[0]?.theme ?? dayTheme(r.puzzle);
  const info = themeInfo(themeId);
  const mystery = !!info?.mystery;
  const revealed = !mystery || !!r.link;
  const shownTheme = revealed ? themeName(themeId) : "Mystery link";
  app.innerHTML = `
  <main class="results">
   <div class="res-main">
    <section class="log">
      <header class="log-head">
        <span>OBSERVING LOG</span>
        <span>${daily ? fmtDate(r.date).toUpperCase() : "PRACTICE"}</span>
      </header>
      <p class="date">${daily ? `${fmtDate(r.date)} · ${shownTheme}${CONFIG.conditionsOn ? ` · ${dayCondition(r.puzzle).name}` : ""} · ${CONFIG.tiers[tier].name} sky` : `Preview · ${shownTheme}${CONFIG.conditionsOn ? ` · ${dayCondition(r.puzzle).name}` : ""}`}</p>
      <div class="final"><span>${r.score}</span><small>POINTS</small></div>
      ${r.partial ? `<p class="small">This run was cut short, so it counts as it stood.</p>` : ""}
      ${mystery ? `<section class="link-box${r.link ? (r.link.ok ? " found" : " missed") : ""}" id="link-box"></section>` : ""}
      ${breakdown(r)}
      <section class="sb-block">
        <p class="constellation" id="constellation"></p>
        <canvas class="chart sky-chart" id="chart" aria-label="Your run drawn as a constellation"></canvas>
        <p class="legend">${bandsSeen.map((b) => `<span><i class="lg" style="background:${theme.bandColors[b]}"></i>${theme.bandNames[b]}</span>`).join("")}<span><i class="lg zoomed"></i>zoom</span><span><i class="lg skipped"></i>skipped</span></p>
        <p class="caption">Around the dial: your minute, from the top. Further out: harder. Answers in a row join up; grey dashes on the rim are skips.</p>
      </section>
      <section class="sb-block">
        <h3 class="sb-title">ON THE HILL TONIGHT</h3>
        <canvas class="chart hill-chart" id="hill" aria-label="Tonight's scores as a bell-shaped hill, with you standing in gold at your score"></canvas>
        <div class="hill-axis" id="hill-axis"></div>
        <p class="hill-line" id="hill-line"></p>
        <p class="caption" id="crowd-note">The hill is simulated on tonight's sky until enough live scores arrive.</p>
      </section>
      <dl class="figures">
        <div><dt>NAMED</dt><dd>${r.named}</dd></div>
        <div><dt>ZOOM</dt><dd>${r.zoomed}</dd></div>
        <div><dt>STEADY</dt><dd>${r.bestCombo ?? 0}</dd></div>
        <div><dt>SKIPPED</dt><dd>${r.skipped}</dd></div>
      </dl>
      ${daily ? `<div class="share-row"><button class="btn primary" id="share">SHARE</button></div>${isTouch ? "" : `<p class="save-row"><button class="link-btn" id="save-card">save the picture</button></p>`}` : ""}
      ${TIP_URL ? `<p class="tip-row"><a href="${esc(TIP_URL)}" target="_blank" rel="noopener">Enjoying the sky? Leave a tip for the stargazers who make it ☕</a></p>` : ""}
    </section>
    <div class="actions">
      <button class="btn" id="to-atlas">STAR ATLAS</button>
      ${!daily && !store.today(localDateKey()) ? `<button class="btn primary" id="daily">TONIGHT'S SKY</button>` : ""}
      ${!daily && store.today(localDateKey()) ? `<button class="btn" id="back">TONIGHT'S LOG</button>` : ""}
    </div>
    <p class="toast" id="toast" role="status"></p>
    <section class="come-back">
      ${daily ? `<div class="moonrise"><canvas id="moonrise" width="120" height="34" aria-hidden="true"></canvas><p>Next sky in <b id="next-in">${nextSkyIn()}</b></p></div><p class="small">${tomorrow}</p>` : ""}
      <p class="small"><button class="link-btn" id="to-cat">Catalogue <b>${cat}</b> / ${OBJECTS.length} objects</button>${lastFresh ? ` <span class="new">+${lastFresh} new</span>` : ""}</p>
      ${daily ? `<p class="small">Best ${stats.best} · Streak ${stats.streak}</p>` : ""}
    </section>
   </div>
   <div class="res-side">
    <h2>WHAT YOU SAW <small>${r.items.length} objects · tap one for more</small></h2>
    <ol class="seen" id="seen"></ol>
    <section class="missed" id="missed"></section>
   </div>
    ${import.meta.env.VITE_PREVIEW_TOOLS ? `<section class="preview-tools"><h2>PREVIEW ONLY <small>try other nights, not saved</small></h2><div class="actions">${[1, 2, 3, 4, 5, 6].map((n) => `<button class="btn" data-night="${n}">#${n} ${themeName(dayTheme(n))}<br><small>${dayCondition(n).name}</small></button>`).join("")}</div></section>` : ""}
  </main>`;
  lastFresh = 0;
  moonrise();
  const chart = document.getElementById("chart") as HTMLCanvasElement;
  let standing: Standing | null = null;
  const sharePreview = () => { const pre = document.getElementById("share-preview"); if (pre) pre.textContent = shareText(r, theme, SHARE_URL, standing, streakNow); };
  const best = bestFind(r);
  const bestObj = best >= 0 ? BY_ID.get(r.items[best].id) : undefined;
  document.getElementById("constellation")!.innerHTML = bestObj
    ? `<small>TONIGHT YOU DREW</small><b>THE ${esc(bestObj.names[0].toUpperCase())}</b><small>a constellation named for your best find</small>`
    : `<small>TONIGHT YOU DREW</small><b>A CLOUDY SKY</b>`;
  const hill = document.getElementById("hill") as HTMLCanvasElement;
  if (REDUCED_MOTION || !r.items.length) drawConstellation(chart, r, best);
  else {
    // the constellation draws itself, star by star
    const t0 = performance.now(), per = Math.min(110, 1400 / r.items.length);
    const step = (now: number) => {
      const k = Math.min(r.items.length, Math.floor((now - t0) / per) + 1);
      drawConstellation(chart, r, best, k);
      if (k < r.items.length && chart.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  const paintHill = (scores: number[], live: boolean) => {
    const mine = r.score - (r.link?.bonus ?? 0), beat = beatShare(scores, mine);
    standing = { beat, live, players: scores.length };
    sharePreview();
    const ax = drawHill(hill, scores, mine);
    const pct = Math.round(beat * 100);
    document.getElementById("hill-axis")!.innerHTML = `<span>${ax.lo}</span><span>typical ${ax.mean}</span><span>${ax.hi}</span>`;
    document.getElementById("hill-line")!.innerHTML =
      (pct >= 99 ? `You out-spotted <b>everyone on the hill</b> tonight.`
      : pct <= 1 ? `The whole hill saw more tonight. The sky comes back tomorrow.`
      : `You out-spotted <b>${pct}%</b> of tonight's stargazers.`)
      + `<br><small>${live ? `${scores.length} players on your sky tonight` : `Your gold slope is everyone you out-spotted.`}</small>`;
    if (live) document.getElementById("crowd-note")!.textContent = `These are tonight's real players on the ${CONFIG.tiers[tier].name} sky.`;
  };
  paintHill(crowd, false);
  if (daily) void liveCrowd(r.puzzle, tier, r.partial ? null : r.score - (r.link?.bonus ?? 0)).then((live) => {
    if (live && live.length >= MIN_LIVE && chart.isConnected) paintHill(live, true);
  });
  const box = document.getElementById("link-box");
  if (box && info) {
    if (!r.link) {
      box.innerHTML = `<h3>THE MYSTERY LINK</h3><p>What did everything tonight have in common? One guess, +${CONFIG.linkBonus} if you get it.</p>
        <form id="link-form" class="link-form" autocomplete="off"><input id="link-guess" type="text" maxlength="60" placeholder="they all…" aria-label="Your guess at the link" autocapitalize="none" spellcheck="false" />
        <button class="btn primary" type="submit">GUESS</button></form><button class="link-skip" id="link-skip" type="button">I give up, show me</button>`;
      const submit = (guess: string) => void resultsScreen(applyLink(r, guess, mode, themeId), mode);
      (document.getElementById("link-form") as HTMLFormElement).onsubmit = (e) => { e.preventDefault(); submit((document.getElementById("link-guess") as HTMLInputElement).value); };
      document.getElementById("link-skip")!.onclick = () => submit("");
    } else {
      box.innerHTML = `<h3>${r.link.ok ? `LINK FOUND · +${r.link.bonus}` : r.link.guess ? "NOT QUITE" : "THE LINK WAS"}</h3>
        <p class="link-name">${esc((info.name ?? themeName(themeId)).toUpperCase())}</p>
        ${info.about ? `<p>${esc(info.about)}</p>` : ""}
        ${r.link.guess ? `<p class="small">You guessed “${esc(r.link.guess)}”</p>` : ""}
        <p class="small">Tap any object below to see why it fits.</p>`;
    }
  }
  const list = document.getElementById("seen")!;
  for (const it of r.items) {
    const o = BY_ID.get(it.id);
    if (!o) continue;
    const li = document.createElement("li");
    li.className = it.outcome;
    li.style.setProperty("--band", theme.bandColors[o.band]);
    li.tabIndex = 0;
    li.appendChild(lens(viewer.spriteCanvas(o, 2)));
    const others = shownNames(o).slice(0, 4).join(", ");
    const typed = it.typed && normalize(it.typed) !== normalize(o.names[0]) ? `“${esc(it.typed)}”` : "";
    const div = document.createElement("div");
    div.innerHTML = `<b>${esc(o.names[0])}</b><span class="pts">${it.outcome === "skipped" ? "skipped" : `+${it.points}`}</span>${it.outcome === "zoomed" ? `<span class="zoom-tag">ZOOM</span>` : ""}<span class="sp-band">${esc(theme.bandNames[o.band])}</span>` +
      (revealed && o.note ? `<small class="note">${esc(o.note)}</small>` : "") +
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
    missed.innerHTML = `<h2>STILL OUT THERE <small>${unseen.length} the clock ran out on</small></h2>`;
    for (const b of [0, 1, 2, 3]) {
      const objs = unseen.filter((o) => o.band === b);
      if (!objs.length) continue;
      const d = document.createElement("details");
      d.style.setProperty("--band", theme.bandColors[b]);
      d.innerHTML = `<summary><i class="lg" style="background:${theme.bandColors[b]}"></i><span>${theme.bandNames[b]}</span><small>${objs.length} left · ${objs.length * CONFIG.bands[b].points} pts were waiting</small></summary>`;
      const ul = document.createElement("ul");
      ul.className = "unseen-grid";
      for (const o of objs) {
        const li = document.createElement("li");
        li.style.setProperty("--band", theme.bandColors[b]);
        li.appendChild(lens(viewer.spriteCanvas(o, 2)));
        const others = shownNames(o).slice(0, 3).join(", ");
        const div = document.createElement("div");
        div.innerHTML = `<b>${esc(o.names[0])}</b>`;
        if (revealed && o.note) li.title = o.note; else if (others) li.title = `also: ${others}`;
        li.appendChild(div);
        ul.appendChild(li);
      }
      d.appendChild(ul);
      missed.appendChild(d);
    }
  }
  if (!r.items.length) list.innerHTML = `<li class="empty">Nothing this time. The sky will be back tomorrow.</li>`;
  const toast = (t: string) => { const e = document.getElementById("toast")!; e.textContent = t; };
  const card = async () => {
    const small = document.createElement("canvas");
    drawConstellation(small, r, best);
    const host = SITE_URL.replace(/^https?:\/\//, "");
    const title = standing ? nightTitle(standing.beat).replace(/^\S+\s/, "") : "";
    const c = await drawShareCard({ r, theme, sky: shownTheme, constellation: small, title, streak: streakNow, host });
    return cardBlob(c);
  };
  document.getElementById("save-card")?.addEventListener("click", async () => {
    const b = await card();
    if (!b) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b); a.download = `stargazer-${r.date}.png`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
  // phones: draw the picture ahead of time, so the tap goes straight to the share sheet
  let cardFile: File | null = null;
  if (isTouch && daily) setTimeout(() => void card().then((b) => { cardFile = b ? new File([b], `stargazer-${r.date}.png`, { type: "image/png" }) : null; }), 1800);
  document.getElementById("share")?.addEventListener("click", async () => {
    const res = await share(shareText(r, theme, SHARE_URL, standing, streakNow), cardFile);
    toast(res === "copied" ? "Copied! Paste it to a friend or group chat." : res === "shared" ? "" : "Couldn't share. Try again.");
  });
  document.getElementById("to-atlas")!.onclick = () => showAtlas();
  document.getElementById("to-cat")!.onclick = () => void catalogueScreen(() => void resultsScreen(r, mode));
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
/** A picture in a little round brass eyepiece, for the lists. */
function lens(c: HTMLCanvasElement): HTMLElement {
  const d = document.createElement("div");
  d.className = "lens";
  d.appendChild(c);
  return d;
}

/** Your best find of the night: the hardest object named, a zoom answer beating a plain one. -1 if none. */
function bestFind(r: RunResult): number {
  let best = -1, bestScore = -1;
  r.items.forEach((it, i) => {
    if (it.outcome === "skipped") return;
    const v = (BY_ID.get(it.id)?.band ?? 0) * 10000 + (it.outcome === "zoomed" ? 5000 : 0) + it.points;
    if (v > bestScore) { bestScore = v; best = i; }
  });
  return best;
}

/** Where each object's star sits: a seeded walk, so everyone's chart for the same night shares a sky. */
function starPositions(r: RunResult, W: number, H: number): { x: number; y: number }[] {
  const rand = mulberry32(r.puzzle * 7919 + 13);
  const mx = 14, my = 12;
  const clampX = (v: number) => Math.max(mx, Math.min(W - mx, v));
  const clampY = (v: number) => Math.max(my, Math.min(H - my, v));
  let px = clampX(rand() * W), py = clampY(rand() * H);
  return r.items.map((it, i) => {
    if (i > 0) {
      if (it.outcome === "skipped" || r.items[i - 1].outcome === "skipped") { px = clampX(rand() * W); py = clampY(rand() * H); }
      else {
        const ang = rand() * Math.PI * 2, d = W * (0.11 + rand() * 0.07);
        px = clampX(px + Math.cos(ang) * d); py = clampY(py + Math.sin(ang) * d * 0.7);
      }
    }
    return { x: Math.round(px), y: Math.round(py) };
  });
}

/**
 * Your run as a star dial: you in the middle, the minute running clockwise from the top, and each find
 * placed out from the centre by how hard it was (inner ring easiest, outer ring hardest).
 * Answers in a row join into a constellation; skips are grey dashes on the rim; the best find is ringed in gold.
 */
function drawConstellation(c: HTMLCanvasElement, r: RunResult, best: number, upto = r.items.length) {
  const W = 200, H = 200, cx = W / 2, cy = H / 2, R = [24, 42, 60, 78], RIM = 90;
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const px = (x: number, y: number, w = 1, h = 1) => g.fillRect(Math.round(x), Math.round(y), w, h);
  g.fillStyle = "#0d0a1a"; g.fillRect(0, 0, W, H);
  const rand = mulberry32(r.puzzle * 31 + 7);
  for (let i = 0; i < 120; i++) { g.fillStyle = rand() < 0.8 ? "#2c2648" : "#4a4068"; px(rand() * W, rand() * H); }
  // the four difficulty bands, faintly tinted, with dotted orbits
  for (let i = 3; i >= 0; i--) { g.globalAlpha = 0.1; g.fillStyle = theme.bandColors[i]; g.beginPath(); g.arc(cx, cy, R[i] + 9, 0, Math.PI * 2); g.fill(); }
  g.globalAlpha = 1;
  g.fillStyle = "#0d0a1a"; g.beginPath(); g.arc(cx, cy, 13, 0, Math.PI * 2); g.fill();
  R.forEach((rr, i) => {
    g.fillStyle = theme.bandColors[i]; g.globalAlpha = 0.45;
    const n = Math.round(rr * 6.28);
    for (let k = 0; k < n; k += 3) { const a = (k / n) * Math.PI * 2; px(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
  });
  g.globalAlpha = 1;
  // the minute: ticks every 5 s, longer every 15 s
  g.fillStyle = "#6a5f88";
  for (let sec = 0; sec < 60; sec += 5) {
    const a = (sec / 60) * Math.PI * 2 - Math.PI / 2, len = sec % 15 ? 2 : 5;
    for (let k = 0; k < len; k++) px(cx + Math.cos(a) * (RIM + 2 + k), cy + Math.sin(a) * (RIM + 2 + k));
  }
  // you, in the middle
  g.fillStyle = "#fee761"; px(cx - 1, cy - 4, 3, 3); px(cx - 1, cy, 3, 4);
  const n = r.items.length;
  const pos = r.items.map((it, i) => {
    const t = it.t ?? ((i + 0.5) / n) * CONFIG.runSeconds; // older logs have no times: spread them evenly
    const a = (Math.min(t, CONFIG.runSeconds) / CONFIG.runSeconds) * Math.PI * 2 - Math.PI / 2;
    const rad = it.outcome === "skipped" ? RIM : R[BY_ID.get(it.id)?.band ?? 0];
    return { x: Math.round(cx + Math.cos(a) * rad), y: Math.round(cy + Math.sin(a) * rad), a };
  });
  const k = Math.min(upto, n);
  g.fillStyle = "rgba(150, 180, 230, 0.6)";
  for (let i = 1; i < k; i++) {
    if (r.items[i].outcome === "skipped" || r.items[i - 1].outcome === "skipped") continue;
    line(g, pos[i - 1].x, pos[i - 1].y, pos[i].x, pos[i].y, 1);
  }
  for (let i = 0; i < k; i++) {
    const it = r.items[i], { x, y, a } = pos[i], band = BY_ID.get(it.id)?.band ?? 0;
    if (it.outcome === "skipped") {
      g.fillStyle = "#5a5078";
      for (let d = -1; d <= 1; d++) px(x - Math.sin(a) * d * 1.5, y + Math.cos(a) * d * 1.5);
      continue;
    }
    const col = theme.bandColors[band], arm = band + 1;
    g.globalAlpha = 0.25; g.fillStyle = col; g.fillRect(x - arm, y - arm, arm * 2 + 1, arm * 2 + 1); g.globalAlpha = 1;
    g.fillStyle = col;
    g.fillRect(x - arm - 1, y, arm * 2 + 3, 1); g.fillRect(x, y - arm - 1, 1, arm * 2 + 3);
    if (band >= 2) g.fillRect(x - 1, y - 1, 3, 3);
    g.fillStyle = it.outcome === "zoomed" ? "#fee761" : "#ffffff";
    g.fillRect(x, y, 1, 1);
  }
  if (best >= 0 && best < k) {
    const { x, y } = pos[best];
    g.fillStyle = "#fee761";
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 10) px(x + Math.cos(a) * 8, y + Math.sin(a) * 8);
  }
}

/** Standard normal CDF (Abramowitz-Stegun erf approximation). */
function ncdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}
/** z for a given share of the bell curve (binary search on the CDF). */
function nInv(p: number): number {
  let lo = -4, hi = 4;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (ncdf(m) < p) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/**
 * Tonight's crowd as a hill shaped like a bell curve (from the crowd's mean and spread): stargazers stand along it,
 * thickest in the middle where most scores fall. You stand in gold at your score, and the slope you out-spotted glows.
 */
function drawHill(c: HTMLCanvasElement, scores: number[], mine: number): { lo: number; hi: number; mean: number } {
  const W = 240, H = 96, base = H - 12, amp = 58;
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const n = scores.length || 1;
  const mean = scores.reduce((a, b) => a + b, 0) / n;
  const sd = Math.max(1, Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / n));
  const lo = Math.max(0, Math.min(mine, mean - 2.8 * sd)), hi = Math.max(mine, mean + 2.8 * sd);
  const X = (v: number) => 10 + ((v - lo) / (hi - lo || 1)) * (W - 20);
  const V = (x: number) => lo + ((x - 10) / (W - 20)) * (hi - lo);
  const top = (x: number) => Math.round(base - amp * Math.exp(-((V(x) - mean) ** 2) / (2 * sd * sd)));
  g.fillStyle = "#0d0a1a"; g.fillRect(0, 0, W, H);
  const rand = mulberry32(Math.round(mean) * 31 + n);
  g.fillStyle = "#2c2648";
  for (let i = 0; i < 40; i++) g.fillRect(Math.floor(rand() * W), Math.floor(rand() * (H - 30)), 1, 1);
  const youX = Math.round(X(mine));
  // the hill: a bell curve, softly lit from its ridge down; the part you out-spotted glows warm
  const hill = new Path2D();
  hill.moveTo(0, base);
  for (let x = 0; x <= W; x++) hill.lineTo(x, top(x));
  hill.lineTo(W, base); hill.closePath();
  const peak = base - amp;
  const shade = (a: string, b: string) => { const gr = g.createLinearGradient(0, peak, 0, base); gr.addColorStop(0, a); gr.addColorStop(1, b); return gr; };
  g.save(); g.clip(hill);
  g.fillStyle = shade("#3a2f56", "#17132a"); g.fillRect(youX, 0, W - youX, H);
  g.fillStyle = shade("#7a5238", "#2a1d2e"); g.fillRect(0, 0, youX, H);
  g.restore();
  for (let x = 0; x < W; x++) { g.fillStyle = x < youX ? "#e0b060" : "#6a5a88"; g.fillRect(x, top(x), 1, 1); }
  g.fillStyle = "#3a2f52"; g.fillRect(0, base, W, 1);
  // typical score: a dotted line down from the peak
  const mx = Math.round(X(mean));
  g.fillStyle = "#8a7f9e";
  for (let y = top(mx) + 2; y < base; y += 3) g.fillRect(mx, y, 1, 1);
  // stargazers at evenly spaced shares of the crowd, so they bunch up in the middle like real scores do
  const people = 15;
  for (let k = 0; k < people; k++) {
    const x = Math.round(X(mean + nInv((k + 0.5) / people) * sd));
    if (x < 4 || x > W - 4 || Math.abs(x - youX) < 4) continue;
    stargazer(g, x, top(x) + 1, x < mx ? 1 : -1, "#6a5f88", "#463d5e", (k * 7) % 3);
  }
  // you
  const yy = top(youX) + 1;
  const glow = g.createRadialGradient(youX, yy - 6, 0, youX, yy - 6, 16);
  glow.addColorStop(0, "rgba(254, 231, 97, 0.28)"); glow.addColorStop(1, "rgba(254, 231, 97, 0)");
  g.fillStyle = glow; g.fillRect(youX - 16, yy - 22, 32, 32);
  stargazer(g, youX, yy, youX < mx ? 1 : -1, "#fee761", "#feae34", 0);
  g.fillStyle = "#fee761";
  g.fillRect(youX, yy - 21, 1, 5); g.fillRect(youX - 2, yy - 19, 5, 1);
  for (let y = base + 2; y < H; y += 2) g.fillRect(youX, y, 1, 1);
  return { lo: Math.round(lo), hi: Math.round(hi), mean: Math.round(mean) };
}

/** Where the points came from: each difficulty, then zoom, steady-hand and end bonuses. */
function breakdown(r: RunResult): string {
  const rows: string[] = [];
  let zoom = 0, steady = 0;
  for (const b of [0, 1, 2, 3]) {
    const its = r.items.filter((it) => it.outcome !== "skipped" && BY_ID.get(it.id)?.band === b);
    if (!its.length) continue;
    const base = its.length * CONFIG.bands[b].points;
    rows.push(`<li style="--band:${theme.bandColors[b]}"><i class="sq"></i><span>${theme.bandNames[b]} <small>× ${its.length}</small></span><b>${base}</b></li>`);
  }
  for (const it of r.items) {
    if (it.outcome === "skipped") continue;
    const band = CONFIG.bands[BY_ID.get(it.id)?.band ?? 0];
    const z = it.outcome === "zoomed" ? band.zoomedPoints - band.points : 0;
    const st = it.points - band.points - z;
    if (st < 0) return ""; // a night scored on the old points scale: no breakdown
    zoom += z; steady += st;
  }
  if (zoom) rows.push(`<li class="bonus-row"><i>★</i><span>Zoom bonus</span><b>+${zoom}</b></li>`);
  if (steady) rows.push(`<li class="bonus-row"><i>■</i><span>Steady hand</span><b>+${steady}</b></li>`);
  if (r.clearedBonus) rows.push(`<li class="bonus-row"><i>☼</i><span>Sky cleared</span><b>+${r.clearedBonus}</b></li>`);
  if (r.link?.bonus) rows.push(`<li class="bonus-row"><i>⛓</i><span>Mystery link</span><b>+${r.link.bonus}</b></li>`);
  return rows.length ? `<ul class="breakdown">${rows.join("")}</ul>` : "";
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

// ---------------------------------------------------------------- catalogue: the collection book

/** Every object you've ever named, by theme; the rest wait as shadows. Future nights' photos are never loaded. */
async function catalogueScreen(back: () => void) {
  cancelAnimationFrame(raf);
  if (!viewer) viewer = new Viewer(document.createElement("canvas"), theme);
  app.innerHTML = `<main class="results catalogue"><p class="small">Opening the catalogue…</p></main>`;
  const today = localDateKey();
  const idx = await loadPackIndex();
  for (const k of Object.keys(idx).filter((k) => k <= today)) await usePack(k);
  const objs = OBJECTS.filter((o) => { const d = packDate(o); return !d || d <= today; });
  await viewer.load(objs, false);
  const seen = store.catalogue();
  const found = objs.filter((o) => seen.has(o.id)).length;
  const groups = new Map<string, { label: string; objs: SkyObject[] }>();
  for (const o of objs) {
    const d = packDate(o), key = d ? `pack:${d}` : o.theme;
    if (!groups.has(key)) groups.set(key, { label: d ? `Photographs · ${fmtDate(d)}` : themeName(o.theme), objs: [] });
    groups.get(key)!.objs.push(o);
  }
  // packs (newest first), then the themes with the most found
  const order = [...groups.entries()].sort(([ka, a], [kb, b]) => {
    const pa = ka.startsWith("pack:"), pb = kb.startsWith("pack:");
    if (pa !== pb) return pa ? -1 : 1;
    if (pa) return kb.localeCompare(ka);
    const fa = a.objs.filter((o) => seen.has(o.id)).length / a.objs.length, fb = b.objs.filter((o) => seen.has(o.id)).length / b.objs.length;
    return fb - fa || a.label.localeCompare(b.label);
  });
  app.innerHTML = `
  <main class="results catalogue">
    <button class="btn back-btn" id="cat-back" type="button">&lt; BACK</button>
    <header class="cat-head">
      <h1>CATALOGUE</h1>
      <p class="cat-count"><b>${found}</b> / ${objs.length} found</p>
      <div class="cat-bar" aria-hidden="true"><i style="width:${(found / Math.max(1, objs.length)) * 100}%"></i></div>
      <p class="small">Everything you name goes in the book. Shadows are still out there.</p>
    </header>
    <div id="cat-groups"></div>
  </main>`;
  const wrap = document.getElementById("cat-groups")!;
  for (const [, grp] of order) {
    const have = grp.objs.filter((o) => seen.has(o.id)).length;
    const d = document.createElement("details");
    d.className = "cat-group";
    if (have) d.open = true;
    d.innerHTML = `<summary><span>${esc(grp.label)}</span><small>${have} / ${grp.objs.length}</small><i class="cat-mini"><i style="width:${(have / grp.objs.length) * 100}%"></i></i></summary>`;
    const ul = document.createElement("ul");
    ul.className = "cat-grid";
    // found first, by difficulty; then shadows
    const sorted = grp.objs.slice().sort((a, b) => Number(seen.has(b.id)) - Number(seen.has(a.id)) || a.band - b.band);
    for (const o of sorted) {
      const got = seen.has(o.id);
      const li = document.createElement("li");
      li.className = got ? "got" : "shadow";
      li.style.setProperty("--band", theme.bandColors[o.band]);
      li.appendChild(got ? viewer.spriteCanvas(o, 2) : viewer.silhouette(o, 2));
      const name = document.createElement("span");
      name.textContent = got ? o.names[0] : "???";
      li.appendChild(name);
      if (got && o.note) { li.title = o.note; li.tabIndex = 0; }
      ul.appendChild(li);
    }
    d.appendChild(ul);
    wrap.appendChild(d);
  }
  document.getElementById("cat-back")!.onclick = back;
  window.scrollTo(0, 0);
}

/** The date of the pack an object came from, if any ("photos:2026-11-26/okapi" → "2026-11-26"). */
function packDate(o: SkyObject): string {
  return /:(\d{4}-\d{2}-\d{2})\//.exec(o.id)?.[1] ?? "";
}

// ---------------------------------------------------------------- boot

// test hook for automated playtests: /?debug
if (new URLSearchParams(location.search).has("debug"))
  (window as unknown as { __sg: unknown }).__sg = { answer: () => run?.sky[run.i]?.names[0], phase: () => run?.phase };

// ---------------------------------------------------------------- front door: intro, then the star atlas

const THEME_COLORS = ["#2ce8f5", "#e07ab8", "#9bd34a", "#feae34", "#a884d8", "#7cc6f5", "#f6757a", "#fee761"];

/** The local date key (YYYY-MM-DD) of a puzzle number. */
function dateKeyOfNight(n: number): string {
  const [y, m, d] = CONFIG.launchDate.split("-").map(Number);
  return localDateKey(new Date(y, m - 1, d + n - 1));
}

/** Load a date's photo pack (if it has one) so its sky can be played or shown. */
async function usePack(dateKey: string): Promise<void> {
  const objs = await loadDayPack(dateKey);
  if (!objs.length) return;
  setDayPack(puzzleNumber(dateKey), objs);
  matcher = makeMatcher(OBJECTS.map((o) => o.names));
}

/** Play an earlier night's sky as an unsaved run. */
async function playPastNight(dateKey: string) {
  await usePack(dateKey);
  PREVIEW_NIGHT = puzzleNumber(dateKey);
  void openPlay("practice");
}

function showAtlas(focus = "tonight") {
  cancelAnimationFrame(raf);
  const today = puzzleNumber(localDateKey());
  const done = store.today(localDateKey());
  const tonightTheme = dayTheme(today);
  const cond = dayCondition(today);
  const stats = store.stats(today);
  const cat = store.catalogue();
  const stars: AtlasStar[] = [];
  stars.push({
    id: "tonight", x: 1000, y: 1000, size: "huge", color: "#fee761",
    label: "TONIGHT'S SKY",
    sub: done && !done.partial ? `${done.score} pts · next sky in ${nextSkyIn()}` : `${themeLabel(tonightTheme)}${CONFIG.conditionsOn ? ` · ${cond.name}` : ""}`,
    open: () => (done ? resultsScreen(done, "daily") : openPlay("daily")),
  });
  // past skies: one star below tonight; its card is a logbook of earlier nights by date, newest first
  const shortDate = (key: string) => new Date(key + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const past = Array.from({ length: Math.min(30, today - 1) }, (_, i) => {
    const n = today - 1 - i, key = dateKeyOfNight(n), r = store.today(key), id = dayTheme(n), info = themeInfo(id);
    return { key, r, name: info?.mystery && !r?.link ? "Mystery link" : themeName(id) };
  });
  if (past.length) stars.push({
    id: "past-label", x: 1000, y: 1260, size: "big", color: "#b8aed0",
    label: "PAST SKIES", sub: `${past.filter((p) => p.r).length} of ${past.length} seen`,
    card: () => `<h2>Past skies</h2>
      <p class="small">Missed nights can still be looked at. They just don't count.</p>
      <ul class="past-list">${past.map((p) => `<li class="${p.r ? "seen-night" : "missed-night"}">
        <div><b>${esc(shortDate(p.key))}</b><small>${esc(p.name)} · ${p.r ? `${p.r.score} pts` : "missed"}</small></div>
        ${p.r ? `<button class="btn" data-log="${p.key}">LOG</button>` : ""}<button class="btn${p.r ? "" : " primary"}" data-replay="${p.key}">${p.r ? "AGAIN" : "LOOK"}</button></li>`).join("")}</ul>`,
    wire: (c) => {
      c.querySelectorAll<HTMLButtonElement>("[data-log]").forEach((b) => (b.onclick = async () => { const k = b.dataset.log!; await usePack(k); resultsScreen(store.today(k)!, "daily"); }));
      c.querySelectorAll<HTMLButtonElement>("[data-replay]").forEach((b) => (b.onclick = () => void playPastNight(b.dataset.replay!)));
    },
  });
  const menu: AtlasStar[] = [
    { id: "log", x: 1320, y: 720, size: "big", color: "#e07ab8", label: "OBSERVING LOG", card: () => `<h2>Observing log</h2>
      <dl class="figures"><div><dt>NIGHTS</dt><dd>${stats.played}</dd></div><div><dt>BEST</dt><dd>${stats.best}</dd></div><div><dt>STREAK</dt><dd>${stats.streak}</dd></div><div><dt>CATALOGUE</dt><dd>${cat.size}</dd></div></dl>
      ${done ? `<button class="btn" id="card-log">TONIGHT'S LOG</button>` : `<p class="small">Tonight's sky is still waiting.</p>`}`,
      wire: (c) => { const b = c.querySelector<HTMLButtonElement>("#card-log"); if (b) b.onclick = () => resultsScreen(done!, "daily"); } },
    { id: "catalogue", x: 680, y: 720, size: "big", color: "#f2d38a", label: "CATALOGUE", sub: `${cat.size} found`, card: () => `<h2>Catalogue</h2>
      <p>Your collection book: everything you've ever named, by theme. The rest wait as shadows.</p>
      <div class="card-actions"><button class="btn primary" id="card-cat">OPEN THE BOOK</button></div>`,
      wire: (c) => { c.querySelector<HTMLButtonElement>("#card-cat")!.onclick = () => void catalogueScreen(() => showAtlas("catalogue")); } },
    { id: "community", x: 1640, y: 1180, size: "small", color: "#5a6988", dim: true, label: "COMMUNITY SKIES", sub: "coming soon",
      card: () => `<h2>Community skies</h2><p>Soon: skies drawn and themed by other stargazers, out here on the edge of the map.</p>` },
  ];
  stars.push(...menu);
  atlasScreen(app, stars, { title: "STAR ATLAS", footer: fmtDate(localDateKey()), focus, onBack: () => frontPage() });
}

// tonight's own photo set, if one has been published (falls back to the rotating themes)
// /?date=YYYY-MM-DD previews that date's pack as an unsaved run (for checking a pack before its night)
const PACK_DATE = /^\d{4}-\d{2}-\d{2}$/.test(new URLSearchParams(location.search).get("date") ?? "") ? new URLSearchParams(location.search).get("date")! : "";
if (PACK_DATE) PREVIEW_NIGHT = puzzleNumber(PACK_DATE);
const tonightPack = Promise.all([
  loadPackIndex().then((idx) => { for (const [k, v] of Object.entries(idx)) notePackNight(puzzleNumber(k), v.theme); }),
  usePack(PACK_DATE || localDateKey()),
]);

// ---------------------------------------------------------------- the front page: the main menu

const MENU_CARDS: Record<string, { html: () => string; wire?: (c: HTMLElement) => void }> = {
  how: { html: () => `<h2>How to play</h2>
      <ul class="rules"><li><b>Type</b> what you see in the telescope. It moves on by itself.</li>
      <li><b>Zoomed in?</b> Name it before it pulls back for bonus points.</li>
      <li><b>Harder finds</b> are worth far more: ${CONFIG.bands.map((b) => b.points).join(" / ")} points by difficulty.</li>
      <li><b>${CONFIG.combo[0].at} in a row</b> multiplies your points, up to ×${CONFIG.combo[CONFIG.combo.length - 1].mult}. A skip costs ${CONFIG.skipCost}s.</li>
      <li><b>One sky a night</b>, the same for everyone. Some nights hide their theme: guess the <b>Mystery link</b> at the end.</li>
      <li>Difficulty goes outward: ${theme.bandNames.slice(0, 3).join(", ")}, then <b>${theme.bandNames[3]}</b>.</li></ul>` },
  settings: { html: () => `<h2>Settings</h2>
      <div class="settings">
        <button class="btn" id="card-sound">SOUND: ${store.muted ? "OFF" : "ON"}</button>
        <button class="btn" id="card-amb">NIGHT SOUNDS: ${store.ambience ? "ON" : "OFF"}</button>
        ${isTouch && "vibrate" in navigator ? `<button class="btn" id="card-buzz">VIBRATION: ${store.haptics ? "ON" : "OFF"}</button>` : ""}
      </div>
      <p class="small">Night sounds are wind, crickets and a low hum of space under the game. Motion follows your device's reduced-motion setting.</p>`,
    wire: (c) => {
      const b = c.querySelector<HTMLButtonElement>("#card-sound")!;
      b.onclick = () => { store.muted = !store.muted; setMuted(store.muted); b.textContent = `SOUND: ${store.muted ? "OFF" : "ON"}`; };
      const a = c.querySelector<HTMLButtonElement>("#card-amb")!;
      a.onclick = () => { store.ambience = !store.ambience; setAmbience(store.ambience); a.textContent = `NIGHT SOUNDS: ${store.ambience ? "ON" : "OFF"}`; };
      const v = c.querySelector<HTMLButtonElement>("#card-buzz");
      if (v) v.onclick = () => { store.haptics = !store.haptics; v.textContent = `VIBRATION: ${store.haptics ? "ON" : "OFF"}`; if (store.haptics) navigator.vibrate?.(15); };
    } },
  credits: { html: () => `<h2>Credits</h2><p>${theme.credits}</p><p class="small">Photographs generated with Qwen-Image, cut out and pixelated for the telescope.</p>` },
};

/** A card over the front page; closes on ✕, Escape, or a tap outside it. */
function menuSheet(id: string) {
  const m = MENU_CARDS[id];
  if (!m) return;
  document.querySelector(".sheet-wrap")?.remove();
  const wrap = document.createElement("div");
  wrap.className = "sheet-wrap";
  wrap.innerHTML = `<section class="atlas-card sheet" role="dialog" aria-modal="true"><button class="card-x" aria-label="Close">✕</button>${m.html()}</section>`;
  const close = () => { wrap.remove(); document.removeEventListener("keydown", esc); (document.querySelector(`[data-link="${id}"]`) as HTMLElement | null)?.focus(); };
  const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  wrap.addEventListener("pointerdown", (e) => { if (e.target === wrap) { ui("back"); close(); } });
  (wrap.querySelector(".card-x") as HTMLElement).onclick = close;
  document.addEventListener("keydown", esc);
  document.body.appendChild(wrap);
  m.wire?.(wrap);
  (wrap.querySelector(".card-x") as HTMLElement).focus();
}

function frontPage() {
  cancelAnimationFrame(raf);
  introScreen(app, {
    title: theme.title,
    sub: fmtDate(localDateKey()),
    onEnter: () => { document.querySelector(".sheet-wrap")?.remove(); void tonightPack.then(() => showAtlas()); },
    links: [{ id: "how", label: "HOW TO PLAY" }, { id: "settings", label: "SETTINGS" }, { id: "credits", label: "CREDITS" }],
    onLink: menuSheet,
  });
}

if (PREVIEW_NIGHT) void openPlay("practice");
else frontPage();
