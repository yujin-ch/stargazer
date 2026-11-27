"""
Slice a grid sheet (ChatGPT transparent PNG, or a Codex green-screen or plain grey sheet) into one PNG per object.

Each solid blob is given to the cell its centre falls in, so an object that leans a little past
its cell line still comes out whole, and stray specks are dropped. Nearly invisible pixels get
their colour cleared so they can't bleed into the edges when scaled.

Usage: python3 scripts/photos/slice_sheet.py <sheet.png> <out folder> <rows>x<cols> id1 id2 ...
"""
import os, sys
import numpy as np
from PIL import Image
from scipy import ndimage


def slice_sheet(path, out, rows, cols, ids):
    a = np.asarray(Image.open(path).convert("RGBA")).copy()
    H, W = a.shape[:2]
    rgb = a[..., :3].astype(int)
    greenish = (rgb[..., 1] > 1.3 * np.maximum(rgb[..., 0], rgb[..., 2])) & (rgb[..., 1] > 60)
    # a green-screen sheet (Codex): find objects by what isn't green, and cut each out ON its green, so
    # build_photos.py can do its proper green key + object mask later
    opaque = a[..., 3].min() > 200
    green_sheet = opaque and greenish[[0, -1], :].mean() > 0.8
    # an opaque sheet on a plain colour (Codex grey sheet for green objects): objects are what differs from the backdrop
    border = np.concatenate([rgb[[0, -1]].reshape(-1, 3), rgb[:, [0, -1]].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    if green_sheet:
        raw = ~greenish
        solid = ndimage.binary_opening(raw, iterations=2)
        fill = (0, 177, 64)
    elif opaque:
        raw = np.abs(rgb - bg).max(axis=2) > 16
        solid = ndimage.binary_opening(raw, iterations=2)
        fill = tuple(int(v) for v in bg)
        green_sheet = True  # same crop-on-backdrop path below; build_photos cuts these with its object model
    else:
        a[a[..., 3] < 16] = 0
        solid = a[..., 3] > 16
    lab, n = ndimage.label(solid, structure=np.ones((3, 3)))
    sizes = ndimage.sum(solid, lab, range(1, n + 1))
    cents = ndimage.center_of_mass(solid, lab, range(1, n + 1))
    keep = {i: [] for i in range(rows * cols)}
    for k, (s, (cy, cx)) in enumerate(zip(sizes, cents), start=1):
        if s < 0.0005 * H * W:  # specks
            continue
        cell = min(int(cy / H * rows), rows - 1) * cols + min(int(cx / W * cols), cols - 1)
        keep[cell].append(k)
    os.makedirs(out, exist_ok=True)
    for i, sid in enumerate(ids):
        if not keep[i] and green_sheet:
            # nothing found (an object close to the backdrop colour): hand over the whole cell
            r, c = divmod(i, cols)
            Image.fromarray(a[r * H // rows:(r + 1) * H // rows, c * W // cols:(c + 1) * W // cols, :3].astype(np.uint8), "RGB").save(os.path.join(out, f"{sid}.png"))
            print(sid, "whole cell (nothing found, check it)")
            continue
        if not keep[i]:
            print(sid, "EMPTY CELL")
            continue
        m = np.isin(lab, keep[i])
        if green_sheet:
            # the opening that drops specks also drops thin parts (an erhu's neck, a bow): grow the blob back
            # through the un-opened pixels, but no further than a little past its own cell
            r, c = divmod(i, cols)
            near = np.zeros_like(m)
            my, mx = H // rows // 6, W // cols // 6
            near[max(0, r * H // rows - my):(r + 1) * H // rows + my, max(0, c * W // cols - mx):(c + 1) * W // cols + mx] = True
            m = ndimage.binary_propagation(m, mask=(raw | m) & near)
            ys, xs = np.where(m)
            pad = max(8, int(0.03 * max(H, W)))
            y0, y1, x0, x1 = max(0, ys.min() - pad), min(H, ys.max() + pad + 1), max(0, xs.min() - pad), min(W, xs.max() + pad + 1)
            box = a[y0:y1, x0:x1, :3].copy()
            # anything in the box that belongs to a neighbour's blob is painted back to green
            other = (lab[y0:y1, x0:x1] > 0) & ~ndimage.binary_dilation(m, iterations=3)[y0:y1, x0:x1]
            box[other] = fill
            Image.fromarray(box.astype(np.uint8), "RGB").save(os.path.join(out, f"{sid}.png"))
            print(sid, box.shape[1], "x", box.shape[0], "(on its backdrop)")
            continue
        # keep the soft edge pixels next to the kept blobs too
        m = ndimage.binary_dilation(m, iterations=2) & (a[..., 3] > 0)
        ys, xs = np.where(m)
        part = np.zeros_like(a)
        part[m] = a[m]
        crop = part[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        Image.fromarray(crop, "RGBA").save(os.path.join(out, f"{sid}.png"))
        print(sid, crop.shape[1], "x", crop.shape[0])


if __name__ == "__main__":
    rows, cols = map(int, sys.argv[3].lower().split("x"))
    slice_sheet(sys.argv[1], sys.argv[2], rows, cols, sys.argv[4:])
