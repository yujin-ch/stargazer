"""Review sheet for a day pack: raw image | final plate | 16px stage, grouped by band.

    python3 scripts/photos/day_sheet.py <date> <raw images dir> <out.png>
"""
import json, sys
from PIL import Image, ImageDraw

date, RAW, OUT = sys.argv[1:4]
D = f"public/days/{date}"
pack = json.load(open(f"packs/{date}.json"))
items = sorted(pack["items"], key=lambda i: (i["band"], i["id"]))
T, S, cols = 80, 2, 3
cw, ch = T * S * 3 + 20, T * S + 28
rows = (len(items) + cols - 1) // cols
sheet = Image.new("RGB", (cw * cols, ch * rows), (24, 20, 37))
d = ImageDraw.Draw(sheet)
bandc = [(254, 231, 97), (44, 232, 245), (224, 122, 184), (255, 80, 80)]
for k, it in enumerate(items):
    x, y = (k % cols) * cw + 6, (k // cols) * ch + 4
    sheet.paste(Image.open(f"{RAW}/{it['id']}.png").convert("RGB").resize((T * S, T * S)), (x, y))
    strip = Image.open(f"{D}/{it.get('img', it['id'])}.png").convert("RGBA")
    for j, st in enumerate([0, 4]):
        b = Image.new("RGBA", (T, T), (40, 36, 60, 255))
        b.alpha_composite(strip.crop((st * T, 0, st * T + T, T)))
        sheet.paste(b.resize((T * S, T * S), Image.NEAREST), (x + (T * S + 4) * (j + 1), y))
    d.text((x, y + T * S + 4), f"B{it['band']} {it['id']}", fill=bandc[it["band"] - 1])
sheet.save(OUT)
