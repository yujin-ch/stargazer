"""Turn one generated batch into a night's day pack.

The pictures go to public/days/<date>/ under random file names (so nobody can guess tomorrow's answers from URLs),
and the pack (names, bands, notes, which file is which) goes to packs/<date>.json, which is never public: the game
gets it from /api/night, which only hands a night out once it has started somewhere on Earth (or early to an admin).

    python3 scripts/photos/make_day.py <images dir> <items.json> <YYYY-MM-DD> [--skip id,id]

<images dir> holds the raw generated images, named <id>.png (or .jpg), and <items.json> is the batch list
(items with id, band 1-4, names "a, b, c" or a list, note). Every item with an image becomes a plate strip
(public/days/<date>/<id>.png, via build_photos.py) and an entry in pack.json. Items without an image, or in
--skip, are left out and listed. The game loads the pack on that date and plays it instead of the rotating theme.
"""
import json
import os
import secrets
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--skip")]
    skip = set()
    for a in sys.argv[1:]:
        if a.startswith("--skip"):
            skip |= set(a.split("=", 1)[1].split(",")) if "=" in a else set()
    src, items_path, date = args
    items = json.load(open(items_path))["items"]
    out = os.path.join(ROOT, "public", "days", date)
    if os.path.isdir(out):
        for f in os.listdir(out):
            os.remove(os.path.join(out, f))
    os.makedirs(out, exist_ok=True)

    def has_img(i):
        return any(os.path.exists(os.path.join(src, f"{i}.{e}")) for e in ("png", "jpg"))

    keep = [it for it in items if it["id"] not in skip and has_img(it["id"])]
    left = [it["id"] for it in items if it not in keep]
    subprocess.run([sys.executable, os.path.join(ROOT, "scripts/photos/build_photos.py"), src, *[it["id"] for it in keep]],
                   check=True, env={**os.environ, "PHOTO_OUT": out})
    # random names for the pictures; old pictures for this date are cleared first
    imgs = {}
    for it in keep:
        tok = secrets.token_hex(8)
        for ext in ("png", "hi.webp"):
            os.replace(os.path.join(out, f"{it['id']}.{ext}"), os.path.join(out, f"{tok}.{ext}"))
        imgs[it["id"]] = tok
    pack = {
        "date": date,
        "theme": "photos",
        "items": [{
            "id": it["id"],
            "img": imgs[it["id"]],
            "band": int(it["band"]),
            "names": it["names"] if isinstance(it["names"], list) else [n.strip() for n in it["names"].split(",") if n.strip()],
            "note": it.get("note", ""),
        } for it in keep],
    }
    os.makedirs(os.path.join(ROOT, "packs"), exist_ok=True)
    json.dump(pack, open(os.path.join(ROOT, "packs", f"{date}.json"), "w"), indent=1)
    idx_path = os.path.join(ROOT, "public", "days", "index.json")
    idx = json.load(open(idx_path)) if os.path.exists(idx_path) else {}
    idx[date] = {"theme": pack["theme"], "items": len(keep)}
    json.dump(dict(sorted(idx.items())), open(idx_path, "w"), indent=1)
    bands = [sum(1 for it in keep if int(it["band"]) == b) for b in (1, 2, 3, 4)]
    print(f"{date}: {len(keep)} items, bands {bands}" + (f"; left out: {', '.join(left)}" if left else ""))


if __name__ == "__main__":
    main()
