"""
Turn generated photos (object on a plain dark background) into Stargazer photo plates.

For each <id>.jpg/png in the source folder:
  - cut the object out (rembg u2netp), crop to a square around it
  - make the reveal stages: 6, 8, 12, 16, 24, 32, 48 px, each snapped to the drawing-board
    palette, plus the final 80 px "developed photo" in true colour
  - add a 1 px dark outline so dark objects still read against the night sky
  - write one strip per object: src/art/photos/<id>.png, 8 tiles of 80x80 (final first, then
    48, 32, 24, 16, 12, 8, 6), each stage scaled up with nearest-neighbour

Usage: python3 scripts/photos/build_photos.py <source folder> [ids...]
"""
import re, sys, os, glob
import numpy as np
from PIL import Image, ImageFilter
from rembg import remove, new_session

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "src/art/photos")
T = 80
STAGES = [48, 32, 24, 16, 12, 8, 6]
OUTLINE = (0x18, 0x14, 0x25)

board = open(os.path.join(ROOT, "src/art/board.ts")).read()
pal = sorted(set(re.findall(r'"#([0-9a-f]{6})"', board.split("export const OUTLINE")[0])))
COLS = np.array([[int(h[i:i + 2], 16) for i in (0, 2, 4)] for h in pal], float)


def lab(rgb):
    c = rgb / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ M.T / np.array([0.9505, 1.0, 1.089])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])], 1)


COLS_LAB = lab(COLS)


def snap(rgb, k):
    """k-means the stage to k colours, then snap each to the nearest palette colour."""
    flat = rgb.reshape(-1, 3)
    L = lab(flat)
    k = min(k, len(L))
    rng = np.random.default_rng(0)
    cent = L[rng.choice(len(L), k, replace=False)]
    for _ in range(12):
        lb = ((L[:, None] - cent[None]) ** 2).sum(-1).argmin(1)
        for j in range(k):
            if (lb == j).any():
                cent[j] = L[lb == j].mean(0)
    s = ((cent[:, None] - COLS_LAB[None]) ** 2).sum(-1).argmin(1)
    return COLS[s[lb]].reshape(rgb.shape)


def outline(rgba):
    a = rgba[..., 3] > 0
    grow = a.copy()
    grow[1:] |= a[:-1]; grow[:-1] |= a[1:]; grow[:, 1:] |= a[:, :-1]; grow[:, :-1] |= a[:, 1:]
    edge = grow & ~a
    rgba[edge] = (*OUTLINE, 255)
    return rgba


def stage(cut, n, final=False):
    inner = n - 2  # leave room for the outline
    im = cut.resize((inner, inner), Image.LANCZOS if final else Image.BOX)
    arr = np.asarray(im).astype(float)
    rgb, a = arr[..., :3], arr[..., 3]
    if not final:
        g = rgb.mean(-1, keepdims=True)
        rgb = np.clip(g + (rgb - g) * 1.2, 0, 255)
        k = 5 if n <= 8 else 8 if n <= 12 else 12 if n <= 24 else 16
        mask = a > 127
        if mask.any():
            rgb[mask] = snap(rgb[mask][None], k)[0]
    out = np.zeros((n, n, 4), np.uint8)
    out[1:-1, 1:-1, :3] = rgb.astype(np.uint8)
    out[1:-1, 1:-1, 3] = np.where(a > 127, 255, 0)
    return Image.fromarray(outline(out), "RGBA").resize((T, T), Image.NEAREST)


def main():
    src = sys.argv[1]
    want = set(sys.argv[2:])
    sess = new_session("u2netp")
    os.makedirs(OUT, exist_ok=True)
    for f in sorted(glob.glob(os.path.join(src, "*.jpg")) + glob.glob(os.path.join(src, "*.png"))):
        sid = os.path.splitext(os.path.basename(f))[0]
        if want and sid not in want:
            continue
        img = Image.open(f).convert("RGB")
        cut = remove(img, session=sess)
        a = np.asarray(cut)[..., 3] > 128
        ys, xs = np.where(a)
        x0, x1, y0, y1 = np.percentile(xs, 0.3), np.percentile(xs, 99.7), np.percentile(ys, 0.3), np.percentile(ys, 99.7)
        side = max(x1 - x0, y1 - y0) * 1.06
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        box = (int(cx - side / 2), int(cy - side / 2), int(cx + side / 2), int(cy + side / 2))
        sq = Image.new("RGBA", (box[2] - box[0], box[3] - box[1]))
        sq.paste(cut, (-box[0], -box[1]))
        # soften the generated rim light a touch so it doesn't read as a cyan halo
        sq = sq.filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=2))
        tiles = [stage(sq, T, final=True)] + [stage(sq, n) for n in STAGES]
        strip = Image.new("RGBA", (T * len(tiles), T))
        for i, t in enumerate(tiles):
            strip.paste(t, (i * T, 0))
        strip.save(os.path.join(OUT, f"{sid}.png"), optimize=True)
        print(sid, os.path.getsize(os.path.join(OUT, f"{sid}.png")), "bytes")


if __name__ == "__main__":
    main()
