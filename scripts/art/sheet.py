"""Preview sheet: python3 scripts/art/sheet.py in.json out.png [scale] [--nolabel]"""
import json, sys
from PIL import Image, ImageDraw
data = json.load(open(sys.argv[1])); out = sys.argv[2]
S = int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3].isdigit() else 4
label = "--nolabel" not in sys.argv
cols = 8; cell = 32 * S + 8; lh = 14 if label else 0
rows = (len(data) + cols - 1) // cols
im = Image.new("RGB", (cols * cell, rows * (cell + lh)), (32, 34, 67))
d = ImageDraw.Draw(im)
for i, s in enumerate(data):
    x0, y0 = (i % cols) * cell + 4, (i // cols) * (cell + lh) + 4
    if "error" in s:
        d.text((x0, y0), s["error"][:40], fill=(255, 80, 80)); continue
    for j, h in enumerate(s["px"]):
        if not h: continue
        x, y = j % 32, j // 32
        d.rectangle([x0 + x * S, y0 + y * S, x0 + x * S + S - 1, y0 + y * S + S - 1], fill=h)
    if label: d.text((x0, y0 + 32 * S + 1), s["id"], fill=(220, 220, 240))
im.save(out)
