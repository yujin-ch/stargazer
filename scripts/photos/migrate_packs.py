"""One-off: move each public/days/<date>/pack.json to packs/<date>.json and give its pictures random names."""
import json, os, secrets
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
days = os.path.join(ROOT, "public", "days")
os.makedirs(os.path.join(ROOT, "packs"), exist_ok=True)
for date in sorted(os.listdir(days)):
    d = os.path.join(days, date)
    pj = os.path.join(d, "pack.json")
    if not os.path.isfile(pj):
        continue
    pack = json.load(open(pj))
    for it in pack["items"]:
        tok = secrets.token_hex(8)
        for ext in ("png", "hi.webp"):
            src = os.path.join(d, f"{it['id']}.{ext}")
            if os.path.exists(src):
                os.replace(src, os.path.join(d, f"{tok}.{ext}"))
        it["img"] = tok
    json.dump(pack, open(os.path.join(ROOT, "packs", f"{date}.json"), "w"), indent=1)
    os.remove(pj)
    print(date, len(pack["items"]))
