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
OUT = os.environ.get("PHOTO_OUT") or os.path.join(ROOT, "src/art/photos")
T = 80
STAGES = [48, 32, 24, 16, 12, 8, 6]
OUTLINE = (0x18, 0x14, 0x25)
HI = 448  # side of the high-resolution final photo

board = open(os.path.join(ROOT, "src/art/board.ts")).read()
_ramps = re.findall(r'(\w+): \["#([0-9a-f]{6})", "#([0-9a-f]{6})", "#([0-9a-f]{6})"\]', board.split("export const OUTLINE")[0])
def _cols(skip=()):
    hexes = sorted({h for name, *hs in _ramps if name not in skip for h in hs})
    return np.array([[int(h[i:i + 2], 16) for i in (0, 2, 4)] for h in hexes], float)
COLS = _cols()
# on a greenscreen nothing in the object is green (prompt rule), so leftover olive shadows must not snap to green
COLS_NO_GREEN = _cols(("green", "lime", "teal"))


def lab(rgb):
    c = rgb / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ M.T / np.array([0.9505, 1.0, 1.089])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])], 1)


COLS_LAB = lab(COLS)
NO_GREEN_LAB = lab(COLS_NO_GREEN)


def snap(rgb, k, no_green=False):
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
    cols, cl = (COLS_NO_GREEN, NO_GREEN_LAB) if no_green else (COLS, COLS_LAB)
    s = ((cent[:, None] - cl[None]) ** 2).sum(-1).argmin(1)
    return cols[s[lb]].reshape(rgb.shape)


def outline(rgba):
    a = rgba[..., 3] > 0
    grow = a.copy()
    grow[1:] |= a[:-1]; grow[:-1] |= a[1:]; grow[:, 1:] |= a[:, :-1]; grow[:, :-1] |= a[:, 1:]
    edge = grow & ~a
    rgba[edge] = (*OUTLINE, 255)
    return rgba


def is_greenscreen(img):
    """Mostly green image (the border can be a stray white frame the model drew)."""
    a = np.asarray(img.resize((64, 64))).astype(int)
    m = np.maximum(a[..., 0], a[..., 2])
    return ((a[..., 1] > m * 1.3 + 10) & (a[..., 1] - m > 30)).mean() > 0.3


def chroma_key(img, ai_mask=None):
    """Greenscreen cut-out: drop pixels where green clearly dominates, keep only the parts
    connected to the main object, then remove green spill from the edges that remain."""
    from scipy import ndimage
    rgb = np.asarray(img).astype(float)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    greenness = g - np.maximum(r, b)
    # backdrop = green clearly ahead of red and blue, relative to brightness, so the darker green of
    # floor shadows goes too (objects are never green by prompt rule)
    fg = ~((g > np.maximum(r, b) * 1.3 + 8) & (greenness > 12))
    key = fg.copy()
    if ai_mask is not None:
        # the cut-out model knows where the object is (so floor and shadow stay out, and green-tinted
        # white parts stay in); the key only clears clearly green pixels inside it (gaps, edges)
        fg &= ndimage.binary_dilation(ai_mask, iterations=3)
    keep = ndimage.binary_opening(fg, iterations=1)
    lab_, n = ndimage.label(keep)
    if n:
        sizes = ndimage.sum(keep, lab_, range(1, n + 1))
        # drop stray frames the model sometimes draws: parts touching three or four image edges
        sides = [set(np.unique(e)) - {0} for e in (lab_[0], lab_[-1], lab_[:, 0], lab_[:, -1])]
        frame = {i for i in range(1, n + 1) if sum(i in sd for sd in sides) >= 3}
        inner = [i for i in range(1, n + 1) if i not in frame]
        if inner:
            m = max(sizes[i - 1] for i in inner)
            big = [i for i in inner if sizes[i - 1] >= max(200, m * 0.002)]
        else:
            big = 1 + np.flatnonzero(sizes >= max(200, sizes.max() * 0.002))
        keep = np.isin(lab_, big)
    # the cut-out model drops thin parts (an erhu's neck, a bow, a rod): grow back through everything the
    # green key calls object, as long as it is joined to what was kept
    keep = ndimage.binary_propagation(keep, mask=key | keep)
    keep = ndimage.binary_fill_holes(keep) & key
    # despill: green may not exceed the larger of red and blue
    out = rgb.copy()
    out[..., 1] = np.minimum(g, (r + b) / 2 + 4)
    rgba = np.zeros(rgb.shape[:2] + (4,), np.uint8)
    rgba[..., :3] = out.clip(0, 255).astype(np.uint8)
    rgba[..., 3] = np.where(keep, 255, 0)
    return Image.fromarray(rgba, "RGBA")


def add_thin_parts(img, cut):
    """The cut-out model drops thin parts (antennas, wires, pendulum rods). Add back sharp detail
    that touches the object: pixels that differ strongly from their blurred neighbourhood, kept only
    if connected to the main cut-out. Soft shadows have no sharp edges, so they stay out."""
    from scipy import ndimage
    rgb = np.asarray(img).astype(float)
    base = np.asarray(cut)[..., 3] > 128
    blur = ndimage.gaussian_filter(rgb, (6, 6, 0))
    hf = np.abs(rgb - blur).max(-1) > 14
    hf = ndimage.binary_closing(hf, iterations=2)
    cand = hf | base
    lab_, _ = ndimage.label(cand)
    keep = np.isin(lab_, np.unique(lab_[base]))
    keep &= lab_ > 0
    # drop anything that is just the backdrop showing through (gaps, fringes): close to the
    # background colour estimated from the pixels around the object
    w = (~base).astype(float)
    bg = ndimage.gaussian_filter(rgb * w[..., None], (40, 40, 0)) / np.maximum(ndimage.gaussian_filter(w, 40), 1e-3)[..., None]
    like_bg = np.abs(rgb - bg).max(-1) < 16
    # ...but a thin dark line (wire, rod) on a light backdrop is real even when faint
    like_bg &= ~(hf & (rgb.mean(-1) < bg.mean(-1) - 8))
    m = (keep | base) & ~like_bg
    m = ndimage.binary_opening(m, iterations=1) | (m & hf)
    out = np.asarray(cut).copy()
    out[..., :3] = np.asarray(img)
    out[..., 3] = np.where(m, 255, 0)
    return Image.fromarray(out, "RGBA")


def stage(cut, n, final=False, no_green=False):
    inner = n - 2  # leave room for the outline
    # premultiply so the (keyed-out) backdrop colour never bleeds into edge pixels
    src = np.asarray(cut).astype(np.float32)
    al = src[..., 3] / 255
    flt = Image.LANCZOS if final else Image.BOX
    rs = lambda ch: np.asarray(Image.fromarray(ch.astype(np.float32), "F").resize((inner, inner), flt))
    a1 = np.clip(rs(al), 0, 1)
    rgb = np.stack([rs(src[..., c] * al) for c in range(3)], -1) / np.maximum(a1, 1e-3)[..., None]
    rgb = rgb.clip(0, 255)
    a = a1 * 255
    if not final:
        g = rgb.mean(-1, keepdims=True)
        rgb = np.clip(g + (rgb - g) * 1.2, 0, 255)
        k = 5 if n <= 8 else 8 if n <= 12 else 12 if n <= 24 else 16
        mask = a > (28 if n >= 24 else 90)
        if mask.any():
            rgb[mask] = snap(rgb[mask][None], k, no_green)[0]
    out = np.zeros((n, n, 4), np.uint8)
    out[1:-1, 1:-1, :3] = rgb.astype(np.uint8)
    # a low threshold keeps thin parts (antennas, rods) from vanishing when shrunk
    out[1:-1, 1:-1, 3] = np.where(a > (60 if final else 28 if n >= 24 else 90), 255, 0)
    return Image.fromarray(outline(out), "RGBA").resize((T, T), Image.NEAREST)


def main():
    src = sys.argv[1]
    want = set(sys.argv[2:])
    sess = new_session("u2netp")
    sess_green = new_session("isnet-general-use")
    os.makedirs(OUT, exist_ok=True)
    for f in sorted(glob.glob(os.path.join(src, "*.jpg")) + glob.glob(os.path.join(src, "*.png")) + glob.glob(os.path.join(src, "*.webp"))):
        sid = os.path.splitext(os.path.basename(f))[0]
        if want and sid not in want:
            continue
        src_img = Image.open(f)
        img = src_img.convert("RGB")
        alpha = np.asarray(src_img.convert("RGBA"))[..., 3]
        green = False
        if (alpha < 16).mean() > 0.05:
            # already cut out (a transparent PNG, e.g. from ChatGPT): keep its own edges
            cut = src_img.convert("RGBA")
        else:
            green = is_greenscreen(img)
            cut = chroma_key(img, np.asarray(remove(img, session=sess_green))[..., 3] > 100) if green else add_thin_parts(img, remove(img, session=sess))
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
        tiles = [stage(sq, T, final=True, no_green=green)] + [stage(sq, n, no_green=green) for n in STAGES]
        strip = Image.new("RGBA", (T * len(tiles), T))
        for i, t in enumerate(tiles):
            strip.paste(t, (i * T, 0))
        strip.save(os.path.join(OUT, f"{sid}.png"), optimize=True)
        # the developed photo at high resolution, shown once the plate has fully depixelated
        hi = sq.convert("RGBa").resize((HI, HI), Image.LANCZOS).convert("RGBA")
        hi.save(os.path.join(OUT, f"{sid}.hi.webp"), quality=82, method=6)
        print(sid, os.path.getsize(os.path.join(OUT, f"{sid}.png")), "bytes")


if __name__ == "__main__":
    main()
