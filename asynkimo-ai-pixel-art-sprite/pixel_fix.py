#!/usr/bin/env python3
"""Minimal reference: turn 'fake' AI pixel art (mixels) into a real sprite.
Steps: 1) find grid  2) one color per cell  3) hard-cutoff background
       4) fill outline gaps  5) lock to palette.  (zh-blog-mirrors demo, MIT)"""
import numpy as np
from PIL import Image

def find_grid(img, smin=4, smax=64, w=2.0):
    """Return (cell, ox, oy). Edge energy should sit on evenly spaced lines; try every
    (non-integer) spacing and phase, keep the LARGEST spacing that still explains the edges."""
    a = np.asarray(img.convert('RGB'), float)
    profs = [np.abs(np.diff(a, axis=1)).sum(2).sum(0), np.abs(np.diff(a, axis=0)).sum(2).sum(1)]
    profs = [np.clip(g - np.median(g), 0, None) for g in profs]   # drop the noise floor
    def fit(g, s):
        idx = np.arange(len(g)) + 0.5                              # diff i = edge between px i and i+1
        best = (0, 0)
        for ph in np.arange(0, s, 0.25):
            d = np.abs((idx - ph + s / 2) % s - s / 2)              # distance to nearest grid line
            c = g[d <= w].sum() / g.sum()
            if c > best[0]: best = (c, ph)
        return best
    cands = []
    for s in np.arange(smin, smax, 0.1):
        (cx, px), (cy, py) = fit(profs[0], s), fit(profs[1], s)
        cands.append((min(cx, cy), s, px, py))
    top = max(c[0] for c in cands)
    c, s, px, py = max((c for c in cands if c[0] >= 0.92 * top), key=lambda c: c[1])
    return s, px, py

def rebuild(img, s, ox, oy):
    a = np.asarray(img.convert('RGBA'))
    H, W = a.shape[:2]
    def lines(o, n):                                                # grid lines, keep edge cells > half a cell
        L = np.clip(np.arange(o % s - s, n + s, s), 0, n)
        L = np.unique(L); keep = [L[0]]
        for v in L[1:]:
            if v - keep[-1] >= s / 2: keep.append(v)
        return np.array(keep)
    xs, ys = lines(ox, W), lines(oy, H)
    out = np.zeros((len(ys) - 1, len(xs) - 1, 4), np.uint8)
    for j in range(len(ys) - 1):
        for i in range(len(xs) - 1):
            y0, y1 = int(ys[j] + (ys[j+1]-ys[j]) * .25), int(ys[j + 1] - (ys[j+1]-ys[j]) * .25)   # sample the cell's core,
            x0, x1 = int(xs[i] + (xs[i+1]-xs[i]) * .25), int(xs[i + 1] - (xs[i+1]-xs[i]) * .25)   # skip blurry borders
            cell = a[y0:max(y0 + 1, y1), x0:max(x0 + 1, x1)].reshape(-1, 4)
            out[j, i] = np.median(cell, axis=0)                       # one color per cell
    return Image.fromarray(out, 'RGBA')

def cut_background(sp, tol=40):
    """Hard cutoff: flood-fill from the border over cells close to the corner color.
    Alpha is 0 or 255, never in between. Flood fill (not a global color key) keeps
    interior pixels that happen to match the background, e.g. white eye highlights."""
    a = np.asarray(sp).copy(); H, W = a.shape[:2]; bg = a[0, 0, :3].astype(int)
    near = np.abs(a[..., :3].astype(int) - bg).sum(2) < tol
    seen = np.zeros((H, W), bool)
    stack = [(y, x) for y in range(H) for x in (0, W - 1)] + [(y, x) for x in range(W) for y in (0, H - 1)]
    while stack:
        y, x = stack.pop()
        if 0 <= y < H and 0 <= x < W and near[y, x] and not seen[y, x]:
            seen[y, x] = True; stack += [(y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)]
    a[..., 3] = np.where(seen, 0, 255)
    return Image.fromarray(a, 'RGBA')

def fill_outline_gaps(sp, outline=(28, 22, 38), tol=60):
    """Plug 1-px holes in the rim: a transparent cell whose opposite neighbours
    (left+right or up+down) are both outline-colored becomes outline."""
    a = np.asarray(sp).copy(); H, W = a.shape[:2]
    isol = (a[..., 3] > 0) & (np.abs(a[..., :3].astype(int) - outline).sum(2) < tol)
    out = a.copy()
    for y in range(1, H - 1):
        for x in range(1, W - 1):
            if a[y, x, 3] == 0 and ((isol[y, x - 1] and isol[y, x + 1]) or (isol[y - 1, x] and isol[y + 1, x])):
                out[y, x] = (*outline, 255)
    return Image.fromarray(out, 'RGBA')

def lock_palette(sp, palette):
    a = np.asarray(sp).copy(); P = np.array(palette, int)
    rgb = a[..., :3].astype(int)
    d = ((rgb[..., None, :] - P[None, None]) ** 2).sum(-1)
    a[..., :3] = P[d.argmin(-1)]
    return Image.fromarray(a, 'RGBA')
