// Render a theme sheet to JSON grids for preview. Usage: node --experimental-strip-types scripts/art/render.mts src/art/themes/animals.txt > out.json
import { readFileSync } from "node:fs";
import { parseSheet, renderSprite } from "../../src/art/board.ts";
const file = process.argv[2];
const defs = parseSheet(readFileSync(file, "utf8"), "x");
const only = process.argv[3] ? new Set(process.argv[3].split(",")) : null;
const out = defs.filter((d) => !only || only.has(d.id)).map((d) => {
  try { return { id: d.id, band: d.band, px: renderSprite(d.src) }; }
  catch (e) { return { id: d.id, band: d.band, error: String(e) }; }
});
process.stdout.write(JSON.stringify(out));
