/**
 * The Star Chart: eight houses that every object belongs to, broad enough that any future object fits one, and a
 * 0–99 score per house for how well you name things from it. Scores come only from your own saved nights.
 */
import type { RunResult } from "./storage";
import { drawGlow, st } from "./pixelfx";

export interface House {
  key: string;
  name: string;
  kind: string;
  color: string;
  /** Pixel-constellation glyph: polylines in a 0..1 box. */
  glyph: [number, number][][];
}

export const HOUSES: House[] = [
  { key: "hound", name: "The Hound", kind: "Creatures", color: "#7fe0c4",
    glyph: [[[0.1, 0.55], [0.3, 0.45], [0.55, 0.45], [0.75, 0.35], [0.85, 0.15], [0.95, 0.25], [0.85, 0.4]], [[0.3, 0.45], [0.25, 0.85]], [[0.6, 0.45], [0.65, 0.85]], [[0.1, 0.55], [0, 0.35]]] },
  { key: "sheaf", name: "The Sheaf", kind: "Food & plants", color: "#a8e06b",
    glyph: [[[0.5, 1], [0.5, 0.2]], [[0.5, 0.6], [0.2, 0.25]], [[0.5, 0.6], [0.8, 0.25]], [[0.5, 0.4], [0.3, 0.05]], [[0.5, 0.4], [0.7, 0.05]], [[0.3, 0.75], [0.7, 0.75]]] },
  { key: "hearth", name: "The Hearth", kind: "Home & wear", color: "#ffb36b",
    glyph: [[[0.1, 1], [0.1, 0.45], [0.5, 0.05], [0.9, 0.45], [0.9, 1], [0.1, 1]], [[0.4, 1], [0.4, 0.7], [0.6, 0.7], [0.6, 1]]] },
  { key: "anvil", name: "The Anvil", kind: "Tools & craft", color: "#9fb5d8",
    glyph: [[[0, 0.25], [1, 0.25], [0.8, 0.5], [0.62, 0.5], [0.62, 0.8], [0.8, 1], [0.2, 1], [0.38, 0.8], [0.38, 0.5], [0.1, 0.45], [0, 0.25]]] },
  { key: "ship", name: "The Ship", kind: "Travel & machines", color: "#7fb7ff",
    glyph: [[[0, 0.7], [1, 0.7], [0.8, 1], [0.2, 1], [0, 0.7]], [[0.5, 0.7], [0.5, 0], [0.85, 0.55], [0.5, 0.55]]] },
  { key: "lyre", name: "The Lyre", kind: "Music & art", color: "#e6b8ff",
    glyph: [[[0.25, 1], [0.75, 1], [0.85, 0.5], [0.95, 0.15], [0.75, 0]], [[0.25, 1], [0.15, 0.5], [0.05, 0.15], [0.25, 0]], [[0.4, 0.95], [0.4, 0.3]], [[0.6, 0.95], [0.6, 0.3]], [[0.15, 0.3], [0.85, 0.3]]] },
  { key: "clock", name: "The Clock", kind: "Science & time", color: "#ffd86b",
    glyph: [[[0.5, 0], [0.85, 0.15], [1, 0.5], [0.85, 0.85], [0.5, 1], [0.15, 0.85], [0, 0.5], [0.15, 0.15], [0.5, 0]], [[0.5, 0.5], [0.5, 0.15]], [[0.5, 0.5], [0.75, 0.6]]] },
  { key: "kite", name: "The Kite", kind: "Play & sport", color: "#ff8f8f",
    glyph: [[[0.5, 0], [0.85, 0.35], [0.5, 0.7], [0.15, 0.35], [0.5, 0], [0.5, 0.7]], [[0.15, 0.35], [0.85, 0.35]], [[0.5, 0.7], [0.4, 0.85], [0.6, 0.92], [0.45, 1]]] },
];

/** Which house each object belongs to, by its base id (the part after the theme and pack date). */
const LISTS: string[] = [
  // Hound: creatures
  `penguin snail octopus chameleon seahorse beehive toucan peacock walrus koala sloth porcupine platypus pelican lobster
   jellyfish narwhal axolotl capybara quokka fennecfox puffin mantaray hammerhead mantis stickinsect horseshoecrab
   cassowary kiwibird seaurchin fossil trilobite anglerfish pufferfish tarsier gharial starnosedmole saiga babirusa dugong
   coelacanth nudibranch frilledlizard secretarybird shoebill proboscismonkey markhor gerenuk armadillo flamingo giraffe
   hedgehog okapi pangolin tapir nautilus dinosaur piranha shark crocodile beaver hippo elephant catfish starfish firefly
   butterfly sunfish bookworm tooth foot`,
  // Sheaf: food & plants
  `apple pineapple mushroom strawberry cactus cupcake icecream dragonfruit starfruit artichoke pomegranate venusflytrap
   bonsai durian rambutan mangosteen jackfruit kohlrabi romanesco banana donut pumpkin sandwich nachos poinsettia flower
   cake butter egg plant water melon eggplant watermelon sunflower pancake pine caesar jelly`,
  // Hearth: home & wear
  `chair key sunglasses toothbrush envelope lightbulb headphones crown lantern birdcage rollingpin whisk corkscrew mailbox
   snowglobe candelabra windchime graduationcap wateringcan garlicpress nutcracker samovar mokapot frenchpress monocle
   tophat sombrero fez clogs snowshoe lavalamp chandelier mangle tricorn pithhelmet pincenez teapot umbrella padlock
   sneaker cardigan wellies mackintosh comb zipper fork grater cup pan shoe brush ear ring earring tub bathtub house
   doghouse bulb man`,
  // Anvil: tools & craft
  `pencil ladder wheelbarrow sewingmachine firehydrant trafficcone horseshoe loom butterchurn anvil sickle pitchfork vise
   spiritlevel weathervane scarecrow quern davylamp hammer scissors mortarpestle spinningwheel saw rake gear cashregister`,
  // Ship: travel & machines
  `anchor lighthouse compass shipswheel paddle trebuchet galleon gondola rickshaw pennyfarthing unicycle zeppelin
   submarine bicycle hotairballoon divinghelmet periscope`,
  // Lyre: music & art
  `trumpet violin harp banjo xylophone tambourine bagpipes cello gramophone musicbox sitar didgeridoo ocarina lute
   mandolin bassoon concertina kalimba steeldrum gong castanets jukebox glassharmonica serpent handpan sousaphone lyre
   zither shamisen erhu koto balalaika accordion guitar saxophone harmonica ukulele frenchhorn theremin metronome quill
   inkwell fountainpen waxseal filmreel cassette silhouette book`,
  // Clock: science & time
  `hourglass stethoscope globe stereoscope cameraobscura sliderule rotaryphone floppydisk cuckooclock grandfatherclock
   newtonscradle geode barometer orrery armillarysphere theodolite enigmamachine eartrumpet magnifyingglass alarmclock
   pocketwatch sundial binoculars microscope gyroscope typewriter sextant abacus laser radar bunsen sun star`,
  // Kite: play & sport
  `kite chessknight rubikscube dartboard bowlingpin spinningtop dreidel rockinghorse kettlebell rollerskate rubberduck
   teddybear teddy kaleidoscope football ball snowman rainbow ferriswheel cowboy rain snow bow fire`,
];
const MAP = new Map<string, number>();
LISTS.forEach((l, h) => l.split(/\s+/).filter(Boolean).forEach((id) => MAP.set(id, h)));
/** Whole themes that are all one house. */
const THEME_HOUSE: Record<string, number> = { animals: 0, birds: 0, bugs: 0 };

/** "photos:2026-11-26/okapi" → "okapi"; "bugs:stick-insect" → "stickinsect". */
export const baseId = (id: string) => id.slice(id.lastIndexOf("/") + 1).slice(id.includes("/") ? 0 : id.indexOf(":") + 1).replace(/[^a-z0-9]/g, "");

export function houseOf(id: string): number {
  const b = baseId(id);
  const m = MAP.get(b);
  if (m !== undefined) return m;
  const theme = id.slice(0, id.indexOf(":"));
  return THEME_HOUSE[theme] ?? 2;
}

export function rankOf(v: number): string {
  return v >= 90 ? "Supernova" : v >= 75 ? "Giant" : v >= 60 ? "Bright Star" : v >= 45 ? "Star" : v >= 30 ? "Spark" : "Glimmer";
}

export interface HouseScore { score: number; seen: number; named: number }

const BAND_W = [1, 1.5, 1.75, 2, 3, 4];
const PRIOR = 4;

/**
 * Score 0–99 per house. Each sighting is worth its band's weight; naming it scores 0.75–1 by how quickly you got it
 * (named while still zoomed in counts as full marks), a skip scores 0. With few sightings the score leans toward 50.
 */
export function houseScores(days: RunResult[], bandOf: (id: string) => number | undefined): HouseScore[] {
  const sum = HOUSES.map(() => 0), wt = HOUSES.map(() => 0), seen = HOUSES.map(() => 0), named = HOUSES.map(() => 0);
  for (const d of days) {
    let prevT = 0;
    for (const it of d.items) {
      const band = bandOf(it.id);
      const dt = it.t !== undefined ? Math.max(0, it.t - prevT) : 6;
      if (it.t !== undefined) prevT = it.t;
      if (band === undefined) continue;
      const h = houseOf(it.id), w = BAND_W[band] ?? 1;
      const speed = Math.max(0, Math.min(1, (14 - dt) / 11));
      const v = it.outcome === "zoomed" ? 1 : it.outcome === "named" ? 0.75 + 0.25 * speed : 0;
      sum[h] += v * w; wt[h] += w; seen[h]++;
      if (it.outcome !== "skipped") named[h]++;
    }
  }
  return HOUSES.map((_, h) => ({
    score: Math.round(Math.min(99, (99 * (sum[h] + 0.5 * PRIOR)) / (wt[h] + PRIOR))),
    seen: seen[h], named: named[h],
  }));
}

/** Draw a house's glyph on a canvas, centred at (cx, cy). */
export function drawGlyph(g: CanvasRenderingContext2D, h: House, cx: number, cy: number, size: number, alpha = 1, lw = 1.5) {
  const a = g.globalAlpha;
  g.globalAlpha = a * alpha; g.strokeStyle = h.color; g.lineWidth = lw; g.lineJoin = "round";
  const pts: [number, number][] = [];
  for (const line of h.glyph) {
    g.beginPath();
    line.forEach(([x, y], i) => { const X = cx + (x - 0.5) * size, Y = cy + (y - 0.5) * size; if (i) g.lineTo(X, Y); else g.moveTo(X, Y); pts.push([X, Y]); });
    g.stroke();
  }
  g.fillStyle = "#fff";
  for (const [x, y] of pts) { g.beginPath(); g.arc(x, y, lw * 1.1, 0, 7); g.fill(); }
  g.globalAlpha = a;
}

/** A house glyph as a small inline canvas (for cards and lists). */
export function glyphCanvas(h: House, px = 22): HTMLCanvasElement {
  const c = document.createElement("canvas"), dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = c.height = Math.round(px * dpr); c.style.width = c.style.height = `${px}px`; c.className = "glyph";
  const g = c.getContext("2d")!; g.scale(dpr, dpr);
  drawGlyph(g, h, px / 2, px / 2, px * 0.78, 1, Math.max(1, px / 18));
  return c;
}

/** The chart: an astrolabe dial with the eight houses and your scores as a glowing shape. */
export function drawChart(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, scores: number[], sel = -1, sign = 0) {
  const n = HOUSES.length;
  g.strokeStyle = "#b08a4a"; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R + 8, 0, 7); g.stroke();
  g.strokeStyle = "#6b5530"; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, R + 13, 0, 7); g.stroke();
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2, l = i % 9 === 0 ? 6 : 3;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * (R + 8), cy + Math.sin(a) * (R + 8)); g.lineTo(cx + Math.cos(a) * (R + 8 - l), cy + Math.sin(a) * (R + 8 - l)); g.strokeStyle = "#b08a4a"; g.stroke();
  }
  HOUSES.forEach((h, i) => {
    const a0 = ((i - 0.5) / n) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 0.5) / n) * Math.PI * 2 - Math.PI / 2;
    g.fillStyle = sel === i ? h.color + "38" : i % 2 ? "rgba(255,255,255,.025)" : "rgba(255,255,255,.05)";
    g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0, a1); g.closePath(); g.fill();
    g.strokeStyle = "rgba(176,138,74,.3)"; g.lineWidth = 1; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R); g.stroke();
  });
  const pt = (i: number, v: number) => { const a = (i / n) * Math.PI * 2 - Math.PI / 2, r = R * 0.24 + R * 0.7 * (v / 100); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const; };
  g.setLineDash([2, 4]); g.strokeStyle = "rgba(255,255,255,.08)";
  for (const v of [25, 50, 75]) { g.beginPath(); g.arc(cx, cy, R * 0.24 + R * 0.7 * (v / 100), 0, 7); g.stroke(); }
  g.setLineDash([]);
  g.fillStyle = "rgba(255,224,102,.2)"; g.beginPath(); scores.forEach((v, i) => { const [x, y] = pt(i, v); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.closePath(); g.fill();
  g.strokeStyle = "#ffe066"; g.lineWidth = 1.5; g.stroke();
  scores.forEach((v, i) => {
    const [x, y] = pt(i, v);
    drawGlow(g, x, y, 9, [st(0, "#ffffff", 1), st(0.3, HOUSES[i].color, 1), st(1, HOUSES[i].color, 0)], 1);
  });
  g.fillStyle = "#140e2a"; g.beginPath(); g.arc(cx, cy, R * 0.2, 0, 7); g.fill();
  g.strokeStyle = "#b08a4a"; g.lineWidth = 1.5; g.stroke();
  drawGlyph(g, HOUSES[sign], cx, cy, R * 0.2, 1, 1);
}
