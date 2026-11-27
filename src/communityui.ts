/**
 * Community skies on screen: the zones and sky stars on the atlas, the browser, the maker (photos, answers, bands,
 * run length, a spot on the map), the admin review queue, and the bits added to a community run's results.
 * The data side is src/community.ts; pictures are made in the browser by src/photoprep.ts.
 */
import { CONFIG } from "./config";
import { community, communityOn, communityOpen, canMake, spotProblem, mockCommunity, type CommunitySky, type NewObject } from "./community";
import { loadPhoto, preparePhoto, type Crop } from "./photoprep";
import { registerCommunity, type SkyObject } from "./library";
import { atlasScreen, fmtCoord, type AtlasStar, type AtlasRegion } from "./atlas";
import { signedInEmail } from "./cloud";
import { theme } from "./themes";
import { ui } from "./themes/chip";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const C = CONFIG.community;
const PINK = "#e07ab8";

/** What main.ts lends this module. */
export interface CommunityHooks {
  app: HTMLElement;
  showAtlas: (focus?: string) => void;
  play: (sky: CommunitySky, objs: SkyObject[]) => void;
  openAccount: () => void;
}
let H: CommunityHooks;
export function initCommunity(h: CommunityHooks) { H = h; }

// ---------------------------------------------------------------- the list of live skies (cached)

let live: CommunitySky[] | null = null;
let loading: Promise<CommunitySky[]> | null = null;
/** Live skies, fetched once (and again after something changes). Resolves to [] when switched off or on error. */
export function liveSkies(fresh = false): Promise<CommunitySky[]> {
  if (!communityOpen) return Promise.resolve([]);
  if (live && !fresh) return Promise.resolve(live);
  if (!loading || fresh) loading = community.live().then((l) => (live = l)).catch((e) => { console.warn("[stargazer] community", e); return (live = []); }).finally(() => { loading = null; });
  return loading;
}
/** The cached list right now (empty until the first fetch lands). */
export function liveNow(): CommunitySky[] { return live ?? []; }

// ---------------------------------------------------------------- atlas: zones and sky stars

/** The four community zones, one in each direction just outside the home zone. Tapping one opens the browser. */
const ZONES: { id: string; dir: string; x: number; y: number }[] = [
  { id: "community-e", dir: "EAST", x: 1250, y: -500 },
  { id: "community-n", dir: "NORTH", x: 450, y: 1250 },
  { id: "community-w", dir: "WEST", x: -1250, y: 500 },
  { id: "community-s", dir: "SOUTH", x: -450, y: -1350 },
];

export function communityRegions(): AtlasRegion[] {
  return ZONES.map((z) => ({ id: z.id, label: "COMMUNITY SKIES", sub: communityOpen ? `${z.dir.toLowerCase()} · tap to browse` : "coming soon", x: z.x, y: z.y, rx: 260, ry: 170, color: PINK }));
}

function statusWord(s: CommunitySky) {
  return s.status === "live" ? "live" : s.status === "pending" ? "waiting for review" : s.status === "hidden" ? "hidden after reports, waiting for review" : "not approved";
}

function skyCardHtml(s: CommunitySky) {
  return `<h2>${esc(s.title)}</h2><p class="small">by ${esc(s.maker)}${s.mine ? " (you)" : ""}</p>
    ${s.blurb ? `<p>${esc(s.blurb)}</p>` : ""}
    <p class="small">${s.n} objects · ${s.seconds} seconds · played ${s.plays} time${s.plays === 1 ? "" : "s"}</p>
    <div class="card-actions"><button class="btn primary" data-play="${s.id}">PLAY</button></div>`;
}

export function communityStars(): AtlasStar[] {
  const zoneStars: AtlasStar[] = ZONES.map((z) => ({
    id: z.id, x: z.x, y: z.y, size: "mid", color: PINK, dim: !communityOpen, label: "COMMUNITY SKIES", sub: z.dir.toLowerCase(),
    card: () => communityOpen
      ? `<h2>Community skies</h2><p>Skies made by other stargazers, from their own photos. Anyone can play them; they don't count toward your log.</p>
         <p class="small">${liveNow().length} sk${liveNow().length === 1 ? "y" : "ies"} so far, anywhere outside the home zone.</p>
         <div class="card-actions"><button class="btn primary" data-browse>BROWSE</button><button class="btn" data-make>MAKE A SKY</button></div>`
      : `<h2>Community skies</h2><p>Coming soon: skies made by other stargazers from their own photos, placed anywhere out here beyond the home zone.</p>`,
    wire: (c) => {
      c.querySelector<HTMLButtonElement>("[data-browse]")?.addEventListener("click", () => void browseScreen());
      c.querySelector<HTMLButtonElement>("[data-make]")?.addEventListener("click", () => void startMaking());
    },
  }));
  const skies: AtlasStar[] = liveNow().map((s) => ({
    id: `sky-${s.id}`, x: s.x, y: s.y, size: "small", color: s.mine ? "#ffc2cc" : PINK, label: s.title.toUpperCase(), sub: `by ${s.maker}`,
    card: () => skyCardHtml(s),
    wire: (c) => c.querySelector<HTMLButtonElement>("[data-play]")?.addEventListener("click", () => void playSky(s)),
  }));
  return [...zoneStars, ...skies];
}

// ---------------------------------------------------------------- play

export async function playSky(s: CommunitySky) {
  try {
    const items = await community.objects(s.id);
    if (items.length < 1) throw new Error("This sky has no pictures.");
    const objs = registerCommunity(s.id, items);
    void community.played(s.id).then((n) => { if (n) s.plays = n; }).catch(() => undefined);
    H.play(s, objs);
  } catch (e) {
    toast(`Couldn't open that sky: ${(e as Error).message}`);
  }
}

/** Added to the results of a community run: who made it, how often it's been played, and a way to report it. */
export function communityResults(root: HTMLElement, s: CommunitySky) {
  root.querySelector(".hill-block")?.remove();
  const head = root.querySelectorAll(".log-head span")[1];
  if (head) head.textContent = "COMMUNITY SKY";
  const date = root.querySelector(".log-score .date");
  if (date) date.textContent = "A community sky · not saved to your log";
  const box = document.createElement("section");
  box.className = "sb-block csky-box";
  box.innerHTML = `<h3 class="sb-title">${esc(s.title.toUpperCase())}</h3>
    <p class="small">by ${esc(s.maker)} · played ${s.plays} time${s.plays === 1 ? "" : "s"}</p>
    <div class="card-actions"><button class="btn" data-again>PLAY AGAIN</button><button class="btn" data-more>MORE SKIES</button></div>
    <p class="small"><button class="link-btn" data-report>Report this sky</button></p>`;
  root.querySelector(".score-block")?.after(box);
  box.querySelector<HTMLButtonElement>("[data-again]")!.onclick = () => void playSky(s);
  box.querySelector<HTMLButtonElement>("[data-more]")!.onclick = () => void browseScreen();
  box.querySelector<HTMLButtonElement>("[data-report]")!.onclick = () => reportDialog(s);
}

function reportDialog(s: CommunitySky) {
  const d = modal(`<h2>Report this sky</h2><p class="small">Tell us what's wrong. After a few reports a sky is hidden until we check it.</p>
    <form class="csky-form" id="rep"><label class="c-radio"><input type="radio" name="why" value="Inappropriate or offensive" required> Inappropriate or offensive</label>
    <label class="c-radio"><input type="radio" name="why" value="Shows a private person"> Shows a private person</label>
    <label class="c-radio"><input type="radio" name="why" value="Someone else's photos"> Someone else's photos</label>
    <label class="c-radio"><input type="radio" name="why" value="Wrong answers or broken"> Wrong answers or broken</label>
    <label>More (optional)<input name="more" maxlength="200"></label>
    <div class="card-actions"><button class="btn primary">SEND REPORT</button></div><p class="small c-msg" id="rep-msg"></p></form>`);
  const f = d.querySelector<HTMLFormElement>("#rep")!;
  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(f), reason = `${fd.get("why")}${fd.get("more") ? `: ${fd.get("more")}` : ""}`.slice(0, 300);
    try { await community.report(s.id, reason); d.querySelector(".sheet")!.innerHTML = `<h2>Thanks</h2><p>We'll take a look.</p>`; setTimeout(() => d.remove(), 1400); }
    catch (err) { f.querySelector("#rep-msg")!.textContent = (err as Error).message; }
  };
}

// ---------------------------------------------------------------- small helpers

function modal(html: string): HTMLElement {
  document.querySelector(".sheet-wrap")?.remove();
  const wrap = document.createElement("div");
  wrap.className = "sheet-wrap";
  wrap.innerHTML = `<section class="atlas-card sheet" role="dialog" aria-modal="true"><button class="card-x" aria-label="Close">✕</button>${html}</section>`;
  const close = () => { wrap.remove(); document.removeEventListener("keydown", key); };
  const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  wrap.addEventListener("pointerdown", (e) => { if (e.target === wrap) close(); });
  (wrap.querySelector(".card-x") as HTMLElement).onclick = close;
  document.addEventListener("keydown", key);
  document.body.appendChild(wrap);
  return wrap;
}
function toast(t: string) {
  const n = document.createElement("p");
  n.className = "csky-toast";
  n.textContent = t;
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 4200);
}
function page(title: string, body: string, back: () => void, backLabel = "&lt; ATLAS"): HTMLElement {
  H.app.innerHTML = `<main class="csky-page"><header class="csky-head"><button class="btn back-btn" id="c-back" type="button">${backLabel}</button><h1>${title}</h1></header>${body}</main>`;
  document.getElementById("c-back")!.onclick = () => { ui("back"); back(); };
  window.scrollTo(0, 0);
  return H.app.querySelector(".csky-page")!;
}

// ---------------------------------------------------------------- browse

export async function browseScreen() {
  if (!communityOpen) return;
  const root = page("COMMUNITY SKIES", `<p class="csky-lead">Skies made by other stargazers. Play any of them; they don't count toward your log.</p>
    <div class="csky-tools"><input type="search" id="c-q" placeholder="Search titles and makers" aria-label="Search community skies">
      <select id="c-sort" aria-label="Sort"><option value="new">Newest</option><option value="plays">Most played</option><option value="az">A to Z</option></select></div>
    <div class="card-actions csky-make-row"><button class="btn primary" id="c-make">MAKE A SKY</button><button class="btn" id="c-mine">YOUR SKIES</button><button class="btn hidden" id="c-review">REVIEW</button></div>
    <ol class="csky-list" id="c-list"><li class="small">Looking…</li></ol>`, () => H.showAtlas("community-e"));
  root.querySelector<HTMLButtonElement>("#c-make")!.onclick = () => void startMaking();
  root.querySelector<HTMLButtonElement>("#c-mine")!.onclick = () => void mySkiesScreen();
  void community.isAdmin().then(async (yes) => {
    if (!yes) return;
    const b = root.querySelector<HTMLButtonElement>("#c-review")!;
    const q = await community.queue().catch(() => []);
    b.textContent = `REVIEW (${q.length})`;
    b.classList.remove("hidden");
    b.onclick = () => void reviewScreen();
  }).catch(() => undefined);
  const skies = await liveSkies(true);
  const list = root.querySelector<HTMLOListElement>("#c-list")!;
  const draw = () => {
    const q = (root.querySelector<HTMLInputElement>("#c-q")!.value || "").trim().toLowerCase();
    const sort = root.querySelector<HTMLSelectElement>("#c-sort")!.value;
    const rows = skies.filter((s) => !q || `${s.title} ${s.maker} ${s.blurb}`.toLowerCase().includes(q))
      .sort((a, b) => (sort === "plays" ? b.plays - a.plays : sort === "az" ? a.title.localeCompare(b.title) : b.created_at.localeCompare(a.created_at)));
    list.innerHTML = rows.length ? rows.map((s) => `<li class="csky-row"><div><b>${esc(s.title)}</b><small>by ${esc(s.maker)} · ${s.n} objects · ${s.seconds}s · played ${s.plays}×</small>${s.blurb ? `<p>${esc(s.blurb)}</p>` : ""}</div>
      <div class="csky-row-btns"><button class="btn" data-map="${s.id}">MAP</button><button class="btn primary" data-play="${s.id}">PLAY</button></div></li>`).join("")
      : `<li class="small">${skies.length ? "Nothing matches that." : "No community skies yet. Be the first to make one!"}</li>`;
    list.querySelectorAll<HTMLButtonElement>("[data-play]").forEach((b) => (b.onclick = () => void playSky(skies.find((s) => s.id === b.dataset.play)!)));
    list.querySelectorAll<HTMLButtonElement>("[data-map]").forEach((b) => (b.onclick = () => H.showAtlas(`sky-${b.dataset.map}`)));
  };
  root.querySelector<HTMLInputElement>("#c-q")!.oninput = draw;
  root.querySelector<HTMLSelectElement>("#c-sort")!.onchange = draw;
  draw();
}

// ---------------------------------------------------------------- your skies

async function mySkiesScreen() {
  const root = page("YOUR SKIES", `<ol class="csky-list" id="c-list"><li class="small">Looking…</li></ol>
    <p class="small">You can delete a sky at any time. Skies can't be edited once sent; delete it and make it again instead.</p>`, () => void browseScreen(), "&lt; BACK");
  const list = root.querySelector<HTMLOListElement>("#c-list")!;
  if (!canMake()) { list.innerHTML = `<li class="small">Sign in to see the skies you've made.</li>`; return; }
  const mine = await community.mine().catch(() => []);
  list.innerHTML = mine.length ? mine.map((s) => `<li class="csky-row"><div><b>${esc(s.title)}</b><small>${statusWord(s)} · ${s.n} objects · at ${fmtCoord(s.x)}, ${fmtCoord(s.y)}${s.status === "live" ? ` · played ${s.plays}×` : ""}</small>
    ${s.review_note ? `<p class="small">Note from review: ${esc(s.review_note)}</p>` : ""}</div>
    <div class="csky-row-btns">${s.status === "live" ? `<button class="btn" data-play="${s.id}">PLAY</button>` : ""}<button class="btn" data-del="${s.id}">DELETE</button></div></li>`).join("")
    : `<li class="small">You haven't made a sky yet.</li>`;
  list.querySelectorAll<HTMLButtonElement>("[data-play]").forEach((b) => (b.onclick = () => void playSky(mine.find((s) => s.id === b.dataset.play)!)));
  list.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((b) => (b.onclick = () => {
    const s = mine.find((k) => k.id === b.dataset.del)!;
    const d = modal(`<h2>Delete "${esc(s.title)}"?</h2><p>Its photos and answers are removed for good. This can't be undone.</p>
      <div class="card-actions"><button class="btn" data-no>KEEP IT</button><button class="btn primary" data-yes>DELETE</button></div>`);
    d.querySelector<HTMLButtonElement>("[data-no]")!.onclick = () => d.remove();
    d.querySelector<HTMLButtonElement>("[data-yes]")!.onclick = async () => {
      try { await community.remove(s.id); d.remove(); void liveSkies(true); void mySkiesScreen(); }
      catch (e) { toast((e as Error).message); }
    };
  }));
}

// ---------------------------------------------------------------- make a sky

interface DraftObject { key: number; img: ImageBitmap | null; crop: Crop; name: string; others: string; vague: string; band: number; note: string; preview: HTMLCanvasElement | null }
interface Draft { title: string; blurb: string; maker: string; seconds: number; feature: boolean; rights: boolean; objects: DraftObject[] }
let draft: Draft | null = null;
let keySeq = 1;
const newObject = (): DraftObject => ({ key: keySeq++, img: null, crop: { pan: 0, zoom: 1 }, name: "", others: "", vague: "", band: 1, note: "", preview: null });

async function startMaking() {
  if (!communityOpen) return;
  if (!canMake()) {
    const d = modal(`<h2>Sign in to make a sky</h2><p>Making a sky needs an account, so you can come back to it and delete it later. Playing skies never does.</p>
      <div class="card-actions"><button class="btn primary" data-acct>SIGN IN</button></div>`);
    d.querySelector<HTMLButtonElement>("[data-acct]")!.onclick = () => { d.remove(); H.openAccount(); };
    return;
  }
  let left = 0;
  try { left = await community.left(); } catch (e) { toast((e as Error).message); return; }
  if (left < 1) {
    modal(`<h2>No sky left to make</h2><p>Each stargazer can make ${C.freeSkies} sky while the atlas fills up its first ${C.freeUntil}. You've made yours (or the first ${C.freeUntil} are taken). Supporters will be able to make more later.</p>
      <p class="small">You can delete your sky under Community skies → Your skies and make a new one.</p>`);
    return;
  }
  draft ??= { title: "", blurb: "", maker: "", seconds: 60, feature: false, rights: false, objects: Array.from({ length: C.minObjects }, newObject) };
  makerScreen();
}

const BAND_HELP = ["anyone names it at once", "most people know it", "takes a moment", "needs a second look or a specific word", "only a few will get it"];

function objectRow(o: DraftObject, i: number) {
  return `<li class="cobj" data-key="${o.key}">
    <div class="cobj-pic"><canvas width="160" height="80" aria-label="Preview of photo ${i + 1}"></canvas>
      <label class="btn cobj-file">${o.img ? "CHANGE" : "ADD PHOTO"}<input type="file" accept="image/*" hidden></label>
      <div class="cobj-crop${o.img ? "" : " hidden"}"><label>shift<input type="range" min="-1" max="1" step="0.05" value="${o.crop.pan}" data-f="pan"></label><label>zoom<input type="range" min="1" max="3" step="0.05" value="${o.crop.zoom}" data-f="zoom"></label></div>
    </div>
    <div class="cobj-fields">
      <label>Answer <input data-f="name" maxlength="40" value="${esc(o.name)}" placeholder="e.g. french press" required></label>
      <label>Other answers that count <input data-f="others" maxlength="200" value="${esc(o.others)}" placeholder="cafetiere, coffee press"></label>
      <label>Too general (we'll ask "what kind?") <input data-f="vague" maxlength="100" value="${esc(o.vague)}" placeholder="pot, jug"></label>
      <label>How hard <select data-f="band">${[0, 1, 2, 3, 4].map((b) => `<option value="${b}"${o.band === b ? " selected" : ""}>${theme.bandNames[b]}: ${BAND_HELP[b]}</option>`).join("")}</select></label>
      <label>A short note shown afterwards <input data-f="note" maxlength="200" value="${esc(o.note)}" placeholder="optional: a fact or a story"></label>
    </div>
    <div class="cobj-side"><b>${i + 1}</b><button class="btn" data-del aria-label="Remove object ${i + 1}">✕</button></div>
  </li>`;
}

function makerScreen() {
  const d = draft!;
  const root = page("MAKE A SKY", `
    <section class="csky-tips"><h2>Before you start</h2><ul>
      <li>${C.minObjects} to ${C.maxObjects} objects, each a photo and the answers that count.</li>
      <li><b>Plain, clear backgrounds work best</b>: one object, filling most of the square.</li>
      <li>Ask yourself: would a stranger name this? (Your own cat is "cat", not "Biscuit".)</li>
      <li>Your own photos, or AI images you made. No photos of people who haven't agreed, nothing you wouldn't show a 13-year-old.</li>
      <li>Every sky is checked by hand before anyone else sees it. Skies can't be edited after sending, only deleted.</li></ul></section>
    <form class="csky-form" id="c-form" novalidate>
      <label>Title <input name="title" maxlength="60" value="${esc(d.title)}" placeholder="e.g. Grandma's kitchen" required></label>
      <label>About it (optional) <textarea name="blurb" maxlength="280" rows="2" placeholder="One or two lines about your sky">${esc(d.blurb)}</textarea></label>
      <label>Your name as shown <input name="maker" maxlength="30" value="${esc(d.maker)}" placeholder="a nickname is fine" required></label>
      <label>Time on the clock <select name="seconds">${C.times.map((t) => `<option value="${t}"${d.seconds === t ? " selected" : ""}>${t} seconds</option>`).join("")}</select></label>
      <h2 class="cobj-title">Objects <small id="c-count"></small></h2>
      <ol class="cobj-list" id="c-objs">${d.objects.map(objectRow).join("")}</ol>
      <div class="card-actions"><button class="btn" type="button" id="c-add">+ ONE MORE</button></div>
      <label class="c-check"><input type="checkbox" name="rights"${d.rights ? " checked" : ""}> These are my own photos or AI images I made, I'm 13 or older, and I agree to the <a href="/terms" target="_blank" rel="noopener">community rules</a>.</label>
      <label class="c-check"><input type="checkbox" name="feature"${d.feature ? " checked" : ""}> Stargazer may also use my objects in its daily or special skies (with credit).</label>
      <p class="c-msg" id="c-msg" role="alert"></p>
      <div class="card-actions"><button class="btn primary" type="submit">NEXT: PICK A SPOT ON THE MAP</button></div>
    </form>`, () => H.showAtlas("community-e"));
  const form = root.querySelector<HTMLFormElement>("#c-form")!;
  const list = root.querySelector<HTMLOListElement>("#c-objs")!;
  const count = () => { root.querySelector("#c-count")!.textContent = `${d.objects.length} of ${C.minObjects}–${C.maxObjects}`; root.querySelector<HTMLButtonElement>("#c-add")!.disabled = d.objects.length >= C.maxObjects; };
  const drawPreview = (li: HTMLElement, o: DraftObject) => {
    const cv = li.querySelector("canvas")!, g = cv.getContext("2d")!;
    g.fillStyle = "#14102a"; g.fillRect(0, 0, 160, 80);
    if (!o.preview) { g.fillStyle = "#6e6890"; g.font = "16px VT323, monospace"; g.textAlign = "center"; g.fillText("no photo yet", 80, 45); return; }
    g.imageSmoothingEnabled = false;
    g.drawImage(o.preview, 0, 0, 80, 80, 0, 0, 80, 80);            // sharp
    g.drawImage(o.preview, 80 * 4, 0, 80, 80, 80, 0, 80, 80);       // a middle stage, as it first appears
  };
  const refresh = async (li: HTMLElement, o: DraftObject) => {
    if (!o.img) { drawPreview(li, o); return; }
    o.preview = (await preparePhoto(o.img, o.crop)).preview;
    drawPreview(li, o);
  };
  const wireRow = (li: HTMLElement) => {
    const o = d.objects.find((x) => x.key === Number(li.dataset.key))!;
    drawPreview(li, o);
    li.querySelector<HTMLInputElement>("input[type=file]")!.onchange = async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (!f) return;
      try {
        o.img = await loadPhoto(f); o.crop = { pan: 0, zoom: 1 };
        li.querySelector(".cobj-crop")!.classList.remove("hidden");
        li.querySelector(".cobj-file")!.firstChild!.textContent = "CHANGE";
        li.querySelectorAll<HTMLInputElement>("input[type=range]").forEach((r) => (r.value = String(o.crop[r.dataset.f as keyof Crop])));
        await refresh(li, o);
      } catch (err) { toast((err as Error).message); }
    };
    let t = 0;
    li.querySelectorAll<HTMLInputElement>("input[type=range]").forEach((r) => (r.oninput = () => { o.crop[r.dataset.f as keyof Crop] = Number(r.value); clearTimeout(t); t = window.setTimeout(() => void refresh(li, o), 60); }));
    li.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-f]:not([type=range])").forEach((inp) => (inp.oninput = () => {
      const f = inp.dataset.f as "name" | "others" | "vague" | "note" | "band";
      if (f === "band") o.band = Number(inp.value); else o[f] = inp.value;
    }));
    li.querySelector<HTMLButtonElement>("[data-del]")!.onclick = () => {
      if (d.objects.length <= 1) return;
      d.objects = d.objects.filter((x) => x !== o);
      li.remove();
      list.querySelectorAll(".cobj-side b").forEach((b, i) => (b.textContent = String(i + 1)));
      count();
    };
  };
  list.querySelectorAll<HTMLElement>(".cobj").forEach(wireRow);
  count();
  root.querySelector<HTMLButtonElement>("#c-add")!.onclick = () => {
    if (d.objects.length >= C.maxObjects) return;
    const o = newObject();
    d.objects.push(o);
    list.insertAdjacentHTML("beforeend", objectRow(o, d.objects.length - 1));
    wireRow(list.lastElementChild as HTMLElement);
    count();
    (list.lastElementChild as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const save = () => {
    const fd = new FormData(form);
    d.title = String(fd.get("title") ?? "").trim(); d.blurb = String(fd.get("blurb") ?? "").trim(); d.maker = String(fd.get("maker") ?? "").trim();
    d.seconds = Number(fd.get("seconds")) || 60; d.rights = fd.get("rights") === "on"; d.feature = fd.get("feature") === "on";
  };
  form.oninput = save;
  form.onsubmit = (e) => {
    e.preventDefault();
    save();
    const msg = root.querySelector<HTMLParagraphElement>("#c-msg")!;
    const problem = checkDraft(d);
    msg.textContent = problem;
    if (problem) { ui("nope"); return; }
    void pickSpot();
  };
}

/** names list for an object: the answer first, then the others, then "?vague" words. */
function namesOf(o: DraftObject): string[] {
  const split = (s: string) => s.split(",").map((x) => x.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean);
  const main = o.name.trim().toLowerCase().replace(/\s+/g, " ");
  const others = split(o.others).filter((n) => n !== main);
  const vague = split(o.vague).filter((n) => n !== main && !others.includes(n)).map((n) => `?${n}`);
  return [...new Set([main, ...others, ...vague])].filter((n) => n.replace("?", "").length <= 40).slice(0, 12);
}

function checkDraft(d: Draft): string {
  if (d.title.length < 3) return "Give your sky a title (at least 3 letters).";
  if (d.maker.length < 2) return "Add the name to show as the maker (at least 2 letters).";
  if (d.objects.length < C.minObjects) return `A sky needs at least ${C.minObjects} objects.`;
  if (d.objects.length > C.maxObjects) return `A sky can have at most ${C.maxObjects} objects.`;
  const noPic = d.objects.findIndex((o) => !o.img);
  if (noPic >= 0) return `Object ${noPic + 1} still needs a photo.`;
  const noName = d.objects.findIndex((o) => !o.name.trim());
  if (noName >= 0) return `Object ${noName + 1} still needs its answer.`;
  const seen = new Map<string, number>();
  for (const [i, o] of d.objects.entries()) {
    const n = o.name.trim().toLowerCase();
    if (seen.has(n)) return `Objects ${seen.get(n)! + 1} and ${i + 1} have the same answer.`;
    seen.set(n, i);
  }
  if (!d.rights) return "Please tick the box about your photos, your age and the community rules.";
  return "";
}

async function pickSpot() {
  const taken = await liveSkies(true);
  const mine = await community.mine().catch(() => []);
  const others = [...taken, ...mine.filter((m) => m.status !== "rejected")];
  const stars: AtlasStar[] = [
    { id: "tonight", x: 0, y: 0, size: "huge", color: "#fee761", label: "TONIGHT'S SKY", dim: true },
    ...others.map((s) => ({ id: `sky-${s.id}`, x: s.x, y: s.y, size: "small" as const, color: PINK, label: s.title.toUpperCase(), dim: true })),
  ];
  // start at a free spot in the east zone
  atlasScreen(H.app, stars, {
    title: "PICK A SPOT", sub: "tap anywhere outside the dashed home zone", footer: draft!.title, focus: "tonight", homeRadius: C.homeRadius,
    regions: communityRegions().map((r) => ({ ...r, sub: "" })),
    onBack: () => makerScreen(),
    pick: {
      check: (x, y) => spotProblem(x, y, others),
      hint: "Your sky will sit here once it's approved. Others can fly to it from the map or find it in the list.",
      onPick: (x, y) => void sendSky(x, y),
    },
  });
}

async function sendSky(x: number, y: number) {
  const d = draft!;
  const root = page("SENDING YOUR SKY", `<p class="csky-lead" id="c-step">Getting your photos ready…</p><div class="c-bar"><i id="c-bar"></i></div><p class="c-msg" id="c-msg" role="alert"></p>`, () => makerScreen(), "&lt; BACK");
  const bar = root.querySelector<HTMLElement>("#c-bar")!, step = root.querySelector<HTMLElement>("#c-step")!;
  try {
    const objects: NewObject[] = [];
    for (const [i, o] of d.objects.entries()) {
      const p = await preparePhoto(o.img!, o.crop);
      objects.push({ band: o.band, names: namesOf(o), note: o.note.trim().slice(0, 200), strip: p.strip, hi: p.hi });
      bar.style.width = `${((i + 1) / d.objects.length) * 30}%`;
    }
    step.textContent = "Sending…";
    await community.create({ title: d.title, blurb: d.blurb, maker: d.maker, seconds: d.seconds, x, y, feature_ok: d.feature, objects },
      (done, of) => { bar.style.width = `${30 + (done / of) * 70}%`; });
    draft = null;
    ui("confirm");
    page("SENT FOR REVIEW", `<section class="csky-tips"><h2>Thank you!</h2>
      <p>"${esc(d.title)}" is waiting for review. We check every sky by hand, usually within a day or two. Once it's approved it appears at ${fmtCoord(x)}, ${fmtCoord(y)} for everyone.</p>
      <p class="small">You can see how it's doing, or delete it, under Community skies → Your skies.</p>
      <div class="card-actions"><button class="btn primary" id="c-done">BACK TO THE ATLAS</button></div></section>`, () => H.showAtlas("community-e"));
    document.getElementById("c-done")!.onclick = () => H.showAtlas("community-e");
  } catch (e) {
    root.querySelector("#c-msg")!.textContent = `It didn't go through: ${(e as Error).message}`;
    step.innerHTML = `<button class="btn" id="c-again">PICK ANOTHER SPOT</button>`;
    document.getElementById("c-again")!.onclick = () => void pickSpot();
  }
}

// ---------------------------------------------------------------- review (admins)

async function reviewScreen() {
  const root = page("REVIEW QUEUE", `<p class="csky-lead">Waiting skies and skies hidden after reports. Approve to put a sky on the map; reject to send it back with a note (its photos are removed).</p><div id="c-q"><p class="small">Loading…</p></div>`, () => void browseScreen(), "&lt; BACK");
  const box = root.querySelector<HTMLElement>("#c-q")!;
  const queue = await community.queue().catch((e) => { box.textContent = (e as Error).message; return []; });
  if (!queue.length) { box.innerHTML = `<p class="small">Nothing to review.</p>`; return; }
  box.innerHTML = "";
  for (const s of queue) {
    const sec = document.createElement("section");
    sec.className = "c-review";
    const [objs, reps] = await Promise.all([community.objects(s.id).catch(() => []), s.status === "hidden" ? community.reports(s.id).catch(() => []) : Promise.resolve([])]);
    sec.innerHTML = `<h2>${esc(s.title)} <small>${s.status === "hidden" ? "HIDDEN AFTER REPORTS" : "NEW"}</small></h2>
      <p class="small">by ${esc(s.maker)} · ${s.n} objects · ${s.seconds}s · at ${fmtCoord(s.x)}, ${fmtCoord(s.y)} · sent ${new Date(s.created_at).toLocaleString()}</p>
      ${s.blurb ? `<p>${esc(s.blurb)}</p>` : ""}
      ${reps.length ? `<ul class="c-reports">${reps.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
      <ol class="c-objs">${objs.map((o) => `<li><img src="${esc(o.hi)}" alt="" loading="lazy" width="112" height="112"><div><b>${esc(o.names[0] ?? "")}</b>
        <small>${theme.bandNames[o.band]}</small><small>${esc(o.names.slice(1).join(", "))}</small>${o.note ? `<small><i>${esc(o.note)}</i></small>` : ""}</div></li>`).join("")}</ol>
      <label>Note to the maker (shown if rejected) <input data-note maxlength="200"></label>
      <div class="card-actions"><button class="btn" data-reject>REJECT</button><button class="btn primary" data-ok>APPROVE</button></div>`;
    const act = async (status: "live" | "rejected") => {
      try { await community.review(s.id, status, sec.querySelector<HTMLInputElement>("[data-note]")!.value.trim()); sec.remove(); void liveSkies(true); if (!box.children.length) box.innerHTML = `<p class="small">Nothing left to review.</p>`; }
      catch (e) { toast((e as Error).message); }
    };
    sec.querySelector<HTMLButtonElement>("[data-ok]")!.onclick = () => void act("live");
    sec.querySelector<HTMLButtonElement>("[data-reject]")!.onclick = () => void act("rejected");
    box.appendChild(sec);
  }
}

/** For the account panel: a line about community skies (only where they're open). */
export function accountCommunityHtml(): string {
  if (!communityOpen || !signedInEmail() && !mockCommunity) return "";
  return `<p class="small"><button class="link-btn" id="acct-skies">Your community skies</button></p>`;
}
export function wireAccountCommunity(box: HTMLElement) {
  box.querySelector<HTMLButtonElement>("#acct-skies")?.addEventListener("click", () => { document.querySelector(".sheet-wrap")?.remove(); void mySkiesScreen(); });
}
export { communityOn };
