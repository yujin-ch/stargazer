"""
Slice a ChatGPT grid sheet (transparent PNG, objects in rows x cols cells) into one PNG per object.

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
        if not keep[i]:
            print(sid, "EMPTY CELL")
            continue
        m = np.isin(lab, keep[i])
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
