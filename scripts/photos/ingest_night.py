"""Turn a folder of hand-made images into a night's day pack, plus a review sheet.

    python3 scripts/photos/ingest_night.py 2026-11-27 <folder of images>

Matching: a file named after an object id (pineapple.png) goes to that object. All other images are taken in the
order they were saved (oldest first) and given to the remaining objects in prompt-sheet order, which is how
ChatGPT downloads come out when you follow prompts.md. Files can be PNG, JPG or WebP (extension optional).
Writes scripts/photos/nights/<date>/raw/<id>.png, public/days/<date>/ (via make_day.py) and
scripts/photos/nights/<date>/review.png. Leave an object out with --skip=id,id after checking the sheet.
"""
import json
import os
import shutil
import subprocess
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))


def images(folder):
    out = []
    for name in os.listdir(folder):
        p = os.path.join(folder, name)
        if not os.path.isfile(p) or name.startswith("."):
            continue
        try:
            with Image.open(p) as im:
                im.verify()
            out.append(p)
        except Exception:
            pass
    return out


def main():
    skip = [a for a in sys.argv[1:] if a.startswith("--skip")]
    date, folder = [a for a in sys.argv[1:] if not a.startswith("--")]
    night = os.path.join(HERE, "nights", date)
    items = json.load(open(os.path.join(night, "items.json")))["items"]
    ids = [o["id"] for o in items]
    files = images(folder)
    by_name = {os.path.splitext(os.path.basename(p))[0].lower(): p for p in files}
    assign = {i: by_name.pop(i) for i in ids if i in by_name}
    rest = sorted(by_name.values(), key=lambda p: (os.path.getmtime(p), os.path.basename(p)))
    todo = [i for i in ids if i not in assign]
    for i, p in zip(todo, rest):
        assign[i] = p
    raw = os.path.join(night, "raw")
    shutil.rmtree(raw, ignore_errors=True)
    os.makedirs(raw)
    for i, p in assign.items():
        Image.open(p).save(os.path.join(raw, f"{i}.png"))
    missing = [i for i in ids if i not in assign]
    extra = len(rest) - len(todo)
    print(f"{len(assign)} images matched" + (f"; missing: {', '.join(missing)}" if missing else "") + (f"; {extra} extra images ignored" if extra > 0 else ""))
    subprocess.run([sys.executable, os.path.join(HERE, "make_day.py"), raw, os.path.join(night, "items.json"), date, *skip], check=True, cwd=ROOT)
    subprocess.run([sys.executable, os.path.join(HERE, "day_sheet.py"), date, raw, os.path.join(night, "review.png")], check=True, cwd=ROOT)
    print("review sheet:", os.path.relpath(os.path.join(night, "review.png"), ROOT))


if __name__ == "__main__":
    main()
