"""Make a night's pictures with the Codex CLI's built-in image tool (runs on your ChatGPT plan, no API key).

    python codex_night.py <items.json> <out folder> [--only=id,id,...] [--limit=N]

items.json is the night list plan_night.py writes (scripts/photos/nights/<date>/items.json), or any JSON with
{"items": [{"id": ..., "desc": ...}, ...]}. For each object not already in the out folder, this runs
`codex exec` once with a green-screen product-photo prompt and saves <out>/<id>.png. Codex can't make transparent
backgrounds, so pictures come on flat chroma green; build_photos.py / ingest_night.py cut that away.

Needs: Python 3, and Codex CLI installed and signed in (npm i -g @openai/codex, then codex login).
Safe to re-run: finished objects are skipped, so a run that stops partway (plan limits) just picks up later.
Then hand the folder to ingest_night.py <date> <out folder>, as with ChatGPT downloads.
"""
import glob
import json
import os
import shutil
import subprocess
import sys
import time

STYLE = (
    "a single square studio product photo of that one object, centered, the whole object visible with generous space "
    "around it, on a perfectly flat, uniform chroma-key green background (#00B140) that fills the whole frame. "
    "No floor, no shadow, no reflections, no text, no labels, no border, no frame. Soft, even, neutral lighting, true "
    "colors, matte finish, no green tint or green light on the object. Accuracy matters most: someone must be able to "
    "name the object from the picture alone, so get its real shape and parts right."
)


def prompt(item, out_name):
    return (
        f"$imagegen Generate exactly one image of: {item['desc']}. Style: {STYLE} "
        f"Save the final image as a PNG named {out_name} in the current folder. "
        "Do not create, edit or delete any other files, and do not ask me anything: just make the image and save it."
    )


def newest_generated(since):
    """Fallback: the newest picture Codex left in its own generated_images folder after `since`."""
    home = os.environ.get("CODEX_HOME") or os.path.join(os.path.expanduser("~"), ".codex")
    files = [p for p in glob.glob(os.path.join(home, "generated_images", "**", "*"), recursive=True)
             if os.path.isfile(p) and p.lower().endswith((".png", ".jpg", ".jpeg", ".webp")) and os.path.getmtime(p) >= since]
    return max(files, key=os.path.getmtime) if files else None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    opts = dict(a[2:].split("=", 1) for a in sys.argv[1:] if a.startswith("--") and "=" in a)
    if len(args) != 2:
        sys.exit(__doc__)
    items_path, out = args
    items = json.load(open(items_path, encoding="utf-8"))["items"]
    if "only" in opts:
        want = opts["only"].split(",")
        items = [it for it in items if it["id"] in want]
    if "limit" in opts:
        items = items[: int(opts["limit"])]
    codex = shutil.which("codex") or shutil.which("codex.cmd")
    if not codex:
        sys.exit("Can't find the codex command. Install it with: npm i -g @openai/codex   then: codex login")
    os.makedirs(out, exist_ok=True)
    out = os.path.abspath(out)
    log = open(os.path.join(out, "codex-log.txt"), "a", encoding="utf-8")
    done = failed = 0
    for n, it in enumerate(items, 1):
        name = f"{it['id']}.png"
        dest = os.path.join(out, name)
        if os.path.exists(dest):
            print(f"[{n}/{len(items)}] {it['id']}: already there, skipping")
            continue
        print(f"[{n}/{len(items)}] {it['id']}: {it['desc']} ...", flush=True)
        t0 = time.time()
        cmd = [codex, "exec", "--sandbox", "workspace-write", "--skip-git-repo-check", prompt(it, name)]
        try:
            res = subprocess.run(cmd, cwd=out, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
            log.write(f"\n===== {it['id']} (exit {res.returncode}, {time.time() - t0:.0f}s)\n{res.stdout[-4000:]}\n{res.stderr[-2000:]}\n")
        except subprocess.TimeoutExpired:
            log.write(f"\n===== {it['id']}: timed out\n")
        if not os.path.exists(dest):
            # Codex sometimes leaves the picture in its own folder or under another name: take the newest one
            alt = [p for p in glob.glob(os.path.join(out, "*")) if os.path.getmtime(p) >= t0 and p.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))]
            src = max(alt, key=os.path.getmtime) if alt else newest_generated(t0)
            if src:
                shutil.copy(src, dest) if not src.startswith(out) else os.replace(src, dest)
        if os.path.exists(dest):
            done += 1
            print(f"    saved {name} ({time.time() - t0:.0f}s)")
        else:
            failed += 1
            print(f"    no image came back (see codex-log.txt). If it says you hit a usage limit, re-run later.")
        log.flush()
    print(f"\nDone: {done} new, {failed} missing. Pictures are in {out}")


if __name__ == "__main__":
    main()
