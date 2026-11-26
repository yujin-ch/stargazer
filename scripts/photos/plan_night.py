"""Plan a night's objects and write the ChatGPT prompt sheet for it.

    python3 scripts/photos/plan_night.py 2026-11-27 [more dates...]

Picks unused objects from bank/objects.txt (3 Moon, 8 Planet, 12 Nebula, 6 Black Hole, the same mix the game plays),
records them in bank/used.json so no object repeats, and writes scripts/photos/nights/<date>/:
  items.json  - the batch list make_day.py reads
  prompts.md  - copy-paste instructions for making the images by hand in ChatGPT
Re-running a planned date keeps its objects.
"""
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BANK = os.path.join(HERE, "bank", "objects.txt")
USED = os.path.join(HERE, "bank", "used.json")
PER_BAND = {1: 3, 2: 8, 3: 12, 4: 6}

SETUP = (
    "I'm making pictures for a daily guessing game. I'll give you a numbered list of objects. "
    "Make ONE image per reply, in list order, starting with number 1. After each image, wait until I type \"next\". "
    "Every image: a single square studio product photo of that one object, centered, the whole object visible with some space "
    "around it, on a fully transparent background (PNG). No floor, no shadow, no text, no labels, no border, no frame. "
    "Soft, even, neutral lighting, true colors, matte finish. Accuracy matters most: someone must be able to name the object "
    "from the picture alone, so get its real shape and parts right."
)


def bank():
    out = []
    for line in open(BANK):
        if not line.strip() or line.startswith("#"):
            continue
        i, band, desc, names, note = [x.strip() for x in line.split("|")]
        out.append({"id": i, "band": int(band), "desc": desc, "names": names, "note": note})
    return out


def plan(date, objs, used):
    if date in used["nights"]:
        ids = used["nights"][date]
        return [o for o in objs if o["id"] in ids]
    taken = {i for ids in used["nights"].values() for i in ids} | set(used.get("retired", []))
    rnd = random.Random(date)
    pick = []
    for band, n in PER_BAND.items():
        free = [o for o in objs if o["band"] == band and o["id"] not in taken]
        if len(free) < n:
            sys.exit(f"{date}: only {len(free)} unused band-{band} objects left; add more to bank/objects.txt")
        pick += rnd.sample(free, n)
    # easy ones first, then the night gets harder, the way the game ramps
    pick.sort(key=lambda o: (o["band"], rnd.random()))
    used["nights"][date] = [o["id"] for o in pick]
    return pick


def write(date, items):
    d = os.path.join(HERE, "nights", date)
    os.makedirs(d, exist_ok=True)
    json.dump({"date": date, "items": items}, open(os.path.join(d, "items.json"), "w"), indent=1)
    lines = [f"{k + 1}. {o['desc']}" for k, o in enumerate(items)]
    md = [
        f"# Stargazer images for {date}",
        "",
        f"{len(items)} objects. Takes about 20 minutes.",
        "",
        "1. Open a **new chat** in ChatGPT and paste everything in the box below as one message.",
        "2. When an image appears, download it (PNG). Then type `next`.",
        "3. Keep the downloads in order: don't download any image twice, and if ChatGPT gets one wrong, ask it to redo",
        "   that one *before* typing next, then download only the good one.",
        "4. Put the images in a folder named after the date and send them to me in the Stargazer thread.",
        "",
        "```",
        SETUP,
        "",
        *lines,
        "```",
        "",
        "For checking, in order:",
        "",
        *[f"{k + 1}. **{o['id']}** (band {o['band']})" for k, o in enumerate(items)],
        "",
    ]
    open(os.path.join(d, "prompts.md"), "w").write("\n".join(md))
    return d


def main():
    objs = bank()
    used = json.load(open(USED)) if os.path.exists(USED) else {"nights": {}, "retired": []}
    for date in sys.argv[1:]:
        items = plan(date, objs, used)
        d = write(date, items)
        print(f"{date}: {len(items)} objects -> {os.path.relpath(d)}")
    json.dump(used, open(USED, "w"), indent=1)


if __name__ == "__main__":
    main()
