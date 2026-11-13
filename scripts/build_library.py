"""Build src/data/objects.json and public/sprites.png from data/objects.txt.
Usage: python3 scripts/build_library.py <twemoji svg dir>
Sprites: Twemoji graphics (c) Twitter/X and contributors, CC-BY 4.0, pixelated."""
import json, os, sys
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from pixelate import pixelate

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SVG = sys.argv[1]
SIZE = 32
COLS = 16

def svg_for(emoji):
    cps = [f"{ord(c):x}" for c in emoji]
    for cand in ("-".join(cps), "-".join(c for c in cps if c != "fe0f")):
        p = os.path.join(SVG, cand + ".svg")
        if os.path.exists(p): return p
    raise SystemExit(f"no svg for {emoji} {cps}")

objs = []
for line in open(os.path.join(ROOT, "data/objects.txt"), encoding="utf8"):
    line = line.strip()
    if not line or line.startswith("#"): continue
    e, theme, band, names = [s.strip() for s in line.split("|")]
    names = [n.strip() for n in names.split(",") if n.strip()]
    objs.append({"emoji": e, "theme": theme, "band": int(band), "names": names})

seen = set()
for o in objs:
    if o["emoji"] in seen: raise SystemExit("duplicate " + o["emoji"])
    seen.add(o["emoji"])
    o["id"] = o["names"][0].replace(" ", "-")

rows = (len(objs) + COLS - 1) // COLS
sheet = Image.new("RGBA", (COLS * SIZE, rows * SIZE), (0, 0, 0, 0))
out = []
for i, o in enumerate(objs):
    sp = pixelate(svg_for(o["emoji"]), SIZE)
    sheet.paste(sp, ((i % COLS) * SIZE, (i // COLS) * SIZE))
    # names starting with "~" are accepted but never shown to players
    hidden = [n[1:].strip() for n in o["names"] if n.startswith("~")]
    names = [n.lstrip("~").strip() for n in o["names"]]
    out.append({"id": o["id"], "sprite": i, "theme": o["theme"], "band": o["band"], "names": names, "hidden": hidden})

os.makedirs(os.path.join(ROOT, "src/data"), exist_ok=True)
os.makedirs(os.path.join(ROOT, "src/themes/pixel-space"), exist_ok=True)
sheet.save(os.path.join(ROOT, "src/themes/pixel-space/sprites.png"), optimize=True)
json.dump({"spriteSize": SIZE, "cols": COLS, "objects": out},
          open(os.path.join(ROOT, "src/data/objects.json"), "w"), ensure_ascii=False, indent=0)
from collections import Counter
print(len(out), Counter(o["band"] for o in out))
