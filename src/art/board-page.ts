// The drawing board page: edit a theme file on the left, see every sprite redraw live on the right.
// Served at /board.html; the game itself never loads this file.
import { parseSheet, renderSprite, toRGBA, SIZE, PALETTE } from "./board";
import animals from "./themes/animals.txt?raw";

const SHEETS: Record<string, string> = { animals };
const KEY = "stargazer-board-draft";

const css = `
:root{--bg:#0e0d1f;--panel:#181a35;--edge:#3a4466;--ink:#e8e6f5;--dim:#8b9bb4;--acc:#fee761;--cyan:#2ce8f5;--red:#f6757a}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.4 ui-monospace,Menlo,monospace}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:12px 16px;border-bottom:2px solid var(--edge)}
h1{font-size:16px;margin:0;color:var(--acc);letter-spacing:1px}
header .sp{flex:1}
button,select,input{font:inherit;color:var(--ink);background:var(--panel);border:2px solid var(--edge);padding:4px 10px}
button:hover{border-color:var(--cyan)}
main{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);height:calc(100vh - 58px)}
textarea{width:100%;height:100%;resize:none;background:#0b0a18;color:var(--ink);border:0;border-right:2px solid var(--edge);padding:12px;font:13px/1.45 ui-monospace,Menlo,monospace;outline:none}
.right{overflow:auto;padding:12px 16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:10px}
.cell{background:var(--panel);border:2px solid var(--edge);padding:6px;text-align:center;cursor:pointer}
.cell:hover,.cell.on{border-color:var(--cyan)}
.cell canvas{width:96px;height:96px;image-rendering:pixelated;display:block;margin:0 auto}
.cell b{display:block;font-weight:normal;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cell small{color:var(--dim);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cell.err{border-color:var(--red)}.cell.err small{color:var(--red)}
.band{margin:18px 0 8px;color:var(--dim)}
.pal{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 4px}
.pal span{display:flex;align-items:center;gap:4px;color:var(--dim);font-size:12px}
.pal i{display:inline-flex}.pal i em{width:10px;height:14px;display:block}
.help{color:var(--dim);font-size:12px;margin:0 0 6px;white-space:pre-wrap}
@media (max-width:760px){main{grid-template-columns:1fr;height:auto}textarea{height:45vh;border-right:0;border-bottom:2px solid var(--edge)}}
`;
document.head.insertAdjacentHTML("beforeend", `<style>${css}</style>`);
const app = document.getElementById("app")!;
app.innerHTML = `
<header><h1>STARGAZER DRAWING BOARD</h1>
<select id="theme">${Object.keys(SHEETS).map((k) => `<option>${k}</option>`).join("")}</select>
<label><input type="range" id="zoom" min="2" max="6" value="3"> size</label>
<span class="sp"></span>
<button id="reset">Reset to saved file</button><button id="copy">Copy text</button></header>
<main><textarea id="src" spellcheck="false"></textarea>
<div class="right">
<p class="help">e cx cy rx ry COLOR · c cx cy r COLOR · r x y w h COLOR · p COLOR x,y x,y… · l COLOR x,y x,y… [w] · d COLOR x,y…
COLOR = name (auto shaded) · name.l / name.d / name! (flat). Grid 32×32, keep inside 1..30. Click a sprite to jump to its code.</p>
<div class="pal">${Object.entries(PALETTE).map(([n, c]) => `<span><i>${c.map((h) => `<em style="background:${h}"></em>`).join("")}</i>${n}</span>`).join("")}</div>
<div id="out"></div></div></main>`;

const ta = document.getElementById("src") as HTMLTextAreaElement;
const out = document.getElementById("out")!;
const sel = document.getElementById("theme") as HTMLSelectElement;
const zoom = document.getElementById("zoom") as HTMLInputElement;
const load = () => { try { return localStorage.getItem(`${KEY}:${sel.value}`); } catch { return null; } };
const save = () => { try { localStorage.setItem(`${KEY}:${sel.value}`, ta.value); } catch { /* fine */ } };
ta.value = load() ?? SHEETS[sel.value];

function draw() {
  const defs = parseSheet(ta.value, sel.value);
  const bands = new Map<number, typeof defs>();
  for (const d of defs) bands.set(d.band, [...(bands.get(d.band) ?? []), d]);
  out.innerHTML = "";
  const names = ["", "Band 1 · easy", "Band 2 · medium", "Band 3 · hard", "Band 4 · uncharted"];
  for (const b of [...bands.keys()].sort()) {
    const h = document.createElement("div");
    h.className = "band"; h.textContent = `${names[b] ?? `Band ${b}`} (${bands.get(b)!.length})`;
    const grid = document.createElement("div"); grid.className = "grid";
    out.append(h, grid);
    for (const d of bands.get(b)!) {
      const cell = document.createElement("div"); cell.className = "cell";
      const cv = document.createElement("canvas"); cv.width = cv.height = SIZE;
      const s = Number(zoom.value) * SIZE; cv.style.width = cv.style.height = `${s}px`;
      let note = d.names.slice(1).join(", ");
      try { cv.getContext("2d")!.putImageData(new ImageData(toRGBA(renderSprite(d.src)) as Uint8ClampedArray<ArrayBuffer>, SIZE, SIZE), 0, 0); }
      catch (e) { cell.classList.add("err"); note = (e as Error).message; }
      cell.append(cv);
      cell.insertAdjacentHTML("beforeend", `<b>${d.names[0] ?? d.id}</b><small>${note.replace(/</g, "&lt;")}</small>`);
      cell.onclick = () => {
        const at = ta.value.indexOf(`@${d.id} `);
        if (at < 0) return;
        ta.focus(); ta.setSelectionRange(at, ta.value.indexOf("\n", at));
        ta.scrollTop = (ta.value.slice(0, at).split("\n").length - 3) * 18.85;
      };
      grid.append(cell);
    }
  }
}
let t = 0;
ta.oninput = () => { clearTimeout(t); t = window.setTimeout(() => { save(); draw(); }, 150); };
zoom.oninput = draw;
sel.onchange = () => { ta.value = load() ?? SHEETS[sel.value]; draw(); };
document.getElementById("reset")!.onclick = () => { ta.value = SHEETS[sel.value]; save(); draw(); };
document.getElementById("copy")!.onclick = async () => { try { await navigator.clipboard.writeText(ta.value); } catch { ta.select(); document.execCommand("copy"); } };
draw();
