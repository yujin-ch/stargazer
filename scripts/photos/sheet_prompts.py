"""Write ChatGPT grid-sheet prompts for planned nights (9 objects per image, cut apart by slice_sheet.py).

    python3 scripts/photos/sheet_prompts.py 2026-11-28 [more dates...] [--out=<folder>]

Reads nights/<date>/items.json (from plan_night.py) and writes nights/<date>/sheets.md (and a copy in --out):
3x3 sheets in prompt order, with a final smaller sheet for the remainder. Upload the PNGs in sheet order; then
    python3 scripts/photos/slice_sheet.py sheetN.png <raw folder> 3x3 <ids from the sheet's list>
and ingest_night.py on the raw folder.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

RULES = ("Each object sits centered in its own cell, whole and fully visible, with clear empty space around it. "
         "Objects must never touch, overlap or cross into another cell. No grid lines, no borders, no frames, no numbers, "
         "no text, no labels, no floor, no shadows. Soft, even, neutral lighting, true colors, matte finish, all objects at a "
         "similar size. Accuracy matters most: someone must be able to name each object from its picture alone, so get its "
         "real shape and parts right.")


def grid(n):
    return {9: (3, 3), 8: (3, 3), 7: (3, 3), 6: (2, 3), 5: (2, 3), 4: (2, 2), 3: (1, 3), 2: (1, 2), 1: (1, 1)}[n]


def sheet_prompt(objs):
    rows, cols = grid(len(objs))
    shape = "square" if rows == cols else "wide"
    what = f"a {rows} by {cols} grid of {len(objs)}" if rows > 1 else f"a single row of {len(objs)}"
    extra = " Leave the unused cells empty." if rows * cols > len(objs) else ""
    lines = [f"Make ONE {shape} image on a fully transparent background (PNG): {what} separate studio product photos, read left "
             f"to right, top to bottom, in exactly this order. {RULES}{extra}", ""]
    lines += [f"{i + 1}. {o['desc']}" for i, o in enumerate(objs)]
    return "\n".join(lines), f"{rows}x{cols}"


def main():
    out = next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--out=")), None)
    for date in [a for a in sys.argv[1:] if not a.startswith("--")]:
        items = json.load(open(os.path.join(HERE, "nights", date, "items.json")))["items"]
        chunks = [items[i:i + 9] for i in range(0, len(items), 9)]
        md = [f"# Stargazer sheets for {date}", "",
              f"{len(items)} objects in {len(chunks)} images. Use a **new chat for each sheet**, download each PNG, "
              "and upload them in order (sheet 1, 2, ...). If one object comes out wrong, tell me which and I'll give you a single prompt for it.", ""]
        for k, ch in enumerate(chunks):
            text, g = sheet_prompt(ch)
            md += [f"## Sheet {k + 1} of {len(chunks)}  ({g}: {', '.join(o['id'] for o in ch)})", "", "```", text, "```", ""]
        body = "\n".join(md)
        open(os.path.join(HERE, "nights", date, "sheets.md"), "w").write(body)
        if out:
            os.makedirs(out, exist_ok=True)
            open(os.path.join(out, f"{date}-sheets.md"), "w").write(body)
        print(date, len(items), "objects,", len(chunks), "sheets")


if __name__ == "__main__":
    main()
