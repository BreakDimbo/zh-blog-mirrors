#!/usr/bin/env python3
"""Render the PREVIEW hub /hub-preview/index.html — a 'tape shelf' (VHS cassettes as navigation)
from entries.json. v2: DOM/CSS 3D cassettes driven by a small damped-spring engine (vanilla JS, rAF,
transform/opacity only, no libraries, no WebGL) + generated material textures in hub-preview/assets/
(generated below on first run if missing).

Usage: python3 tools/build_hub_shelf.py
New entries: add them to entries.json (same as tools/build_hub.py) and rerun; covers are discovered
automatically from each sub-page's og:image (or images/cover.*, cover.*). The live hub
(index.html / tools/build_hub.py) is NOT touched by this script."""
import json, os, sys, html, hashlib, colorsys, re
from urllib.parse import urlsplit
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'hub-preview')
URL = 'https://breakdimbo.github.io/zh-blog-mirrors/'
REMOVAL = 'https://github.com/BreakDimbo/zh-blog-mirrors/issues/new?title=Removal%20request'
esc = html.escape
E = sorted(json.load(open(os.path.join(ROOT, 'entries.json'), encoding='utf-8')),
           key=lambda x: (x['date'], x['slug']), reverse=True)

# muted, warm, desaturated spine colours per type (unknown types fall back to the hashed palette)
# each type owns a small family of related tones (one pale 'bone' spine for rhythm), like a real collection
TYPE_COL = {'导读': ['#4d5340', '#5f6450', '#3d4840', '#d5cbb4'],
            '全文镜像': ['#6a3a2f', '#7a4a3a', '#552f29', '#d9cdb5'],
            '翻译': ['#34424d', '#45535c', '#2c3740', '#d2cbbb'],
            '画廊': ['#93703f', '#a2824f', '#7c5d35', '#ddd0b2'],
            '评述': ['#cdc2ab', '#5b4a3c', '#bfb197']}
SPARE = [['#5b4a3c', '#6d5a46', '#d3c8b2'], ['#3f4a43', '#4a3f4c', '#d0c6b1']]

def h(s):
    return int(hashlib.md5(s.encode()).hexdigest(), 16)

def shade(hexcol, seed):
    r, g, b = (int(hexcol[i:i+2], 16) / 255 for i in (1, 3, 5))
    hh, l, s = colorsys.rgb_to_hls(r, g, b)
    l = min(.86, max(.14, l + ((seed % 13) - 6) * 0.011))
    s = max(0, s * (0.82 + (seed % 7) * 0.04))
    r, g, b = colorsys.hls_to_rgb(hh, l, s)
    return '#%02x%02x%02x' % tuple(round(c * 255) for c in (r, g, b))

def cover_for(slug):
    """Find a cover image for a sub-page; returns a path relative to /hub-preview/ or ''."""
    page = os.path.join(ROOT, slug, 'index.html')
    cands = []
    if os.path.exists(page):
        m = re.search(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)', open(page, encoding='utf-8').read())
        if m:
            u = m.group(1).split('?')[0]
            if u.startswith(URL):
                cands.append(u[len(URL):])
            elif not urlsplit(u).scheme and not u.startswith('/'):
                cands.append(os.path.normpath(os.path.join(slug, u)))
    for f in ('images/cover.webp', 'images/cover.jpg', 'cover.webp', 'cover.jpg', 'img/cover.webp', 'og.jpg'):
        cands.append(os.path.join(slug, f))
    for c in cands:
        if os.path.basename(c).startswith('icon'):
            continue
        if os.path.isfile(os.path.join(ROOT, c)):
            return '../' + c.replace(os.sep, '/')
    return ''

def vlen(t):
    """visual length in CJK em: Latin letters/digits are about half an em in vertical-rl (rotated)."""
    return sum(1 if ord(c) > 0x2e80 else 0.3 if c == ' ' else 0.56 for c in t)

def spine_title(t):
    """A spine-friendly title: drop trailing parentheticals, then cut at the first clause break if still long."""
    st = re.split(r'[：:｜|]', t)[0].strip() or t
    st = re.sub(r'\s*[（(][^）)]*[）)]\s*$', '', st).strip() or st
    if vlen(st) > 22:
        m = re.match(r'(.{4,}?[？?!！]|.{4,}?(?=——|，|,|、))', st)
        if m and 7 <= vlen(m.group(1)) <= 22:
            st = m.group(1).strip()
    if vlen(st) > 23:
        out = ''
        for c in st:
            if vlen(out + c) > 21.5:
                break
            out += c
        st = out.rstrip(' ·-—，,') + '…'
    return st

def paper_tone(seed):
    # aged label paper: small spread in lightness and yellowing
    l = 0.885 + ((seed >> 3) % 9 - 4) * 0.006
    y = ((seed >> 7) % 7) * 0.006
    r, g, b = colorsys.hls_to_rgb(0.115 - y * 0.4, l, 0.30 + y * 2.2)
    return '#%02x%02x%02x' % tuple(round(c * 255) for c in (r, g, b))

# ---------- material textures (paper, wood, wall, grain) -> hub-preview/assets/*.webp ----------
# Deterministic (seeded) tileable noise; generated only when missing. Needs numpy + Pillow;
# without them the committed textures are kept.
try:
    import numpy as np
    from PIL import Image
    _HAVE_TEX = True
except ImportError:
    _HAVE_TEX = False

TEX_DIR = os.path.join(OUT_DIR, 'assets')

def pnoise(h, w, fy, fx, rng, power=1.0):
    """Periodic band-limited noise via FFT (tileable by construction). fy/fx = gaussian cutoff in cycles/image."""
    n = rng.standard_normal((h, w))
    F = np.fft.fft2(n)
    ky = np.fft.fftfreq(h)[:, None] * h
    kx = np.fft.fftfreq(w)[None, :] * w
    filt = np.exp(-((ky / fy) ** 2 + (kx / fx) ** 2) * power)
    r = np.real(np.fft.ifft2(F * filt))
    return (r - r.mean()) / (r.std() + 1e-9)

def save_tex(a, name, q=82):
    a = np.clip(a, 0, 1)
    Image.fromarray((a * 255).astype(np.uint8), 'L').save(os.path.join(TEX_DIR, name), 'WEBP', quality=q, method=6)

def build_textures(force=False):
    os.makedirs(TEX_DIR, exist_ok=True)
    rng = np.random.default_rng(20261029)
    if force or not os.path.exists(os.path.join(TEX_DIR, 'paper.webp')):
        # paper: fine tooth + soft cloudy formation + sparse stretched fibres
        tooth = pnoise(256, 256, 90, 90, rng)
        cloud = pnoise(256, 256, 7, 7, rng)
        fib = np.maximum(pnoise(256, 256, 60, 6, rng), 0) ** 2 * 0.5 + np.maximum(pnoise(256, 256, 6, 60, rng), 0) ** 2 * 0.5
        a = 0.93 + tooth * 0.022 + cloud * 0.02 - fib * 0.018
        save_tex(a, 'paper.webp', 80)
    if force or not os.path.exists(os.path.join(TEX_DIR, 'wood.webp')):
        # wood: long horizontal grain, warped, with pores; tileable horizontally and vertically
        h, w = 160, 1024
        y = np.arange(h)[:, None] / h
        warp = pnoise(h, w, 2.2, 3, rng) * 0.10 + pnoise(h, w, 6, 14, rng) * 0.018
        rings = np.sin((y + warp) * 2 * np.pi * 9)
        rings = np.sign(rings) * np.abs(rings) ** 0.6
        fine = pnoise(h, w, 70, 4, rng)
        pores = np.minimum(pnoise(h, w, 80, 30, rng), -1.6) + 1.6
        a = 0.86 + rings * 0.045 + fine * 0.035 + pores * 0.10 + pnoise(h, w, 3, 2, rng) * 0.03
        save_tex(a, 'wood.webp', 84)
    if force or not os.path.exists(os.path.join(TEX_DIR, 'wall.webp')):
        # wall: limewash / plaster mottling, very low contrast
        a = 0.975 + pnoise(256, 256, 5, 5, rng) * 0.006 + pnoise(256, 256, 22, 22, rng) * 0.005 + pnoise(256, 256, 110, 110, rng) * 0.007
        save_tex(a, 'wall.webp', 78)
    if force or not os.path.exists(os.path.join(TEX_DIR, 'grain.webp')):
        # film grain: neutral mid-grey, slight clumping (overlay / soft-light in CSS)
        g = pnoise(200, 200, 70, 70, rng) * 0.6 + rng.standard_normal((200, 200)) * 0.4
        save_tex(0.5 + g * 0.11, 'grain.webp', 70)

if _HAVE_TEX:
    build_textures(force='--textures' in sys.argv)

ORDER = {e['slug']: n + 1 for n, e in enumerate(sorted(E, key=lambda x: (x['date'], x['slug'])))}
data = []
for e in E:
    seed = h(e['slug'])
    fam = TYPE_COL.get(e['type']) or SPARE[h(e['type']) % len(SPARE)]
    k = (seed >> 8) % 9  # mostly the type's main tone, occasionally a sibling or a pale spine
    base = fam[0] if k < 4 else fam[1] if k < 6 else fam[2 % len(fam)] if k < 8 else fam[-1]
    col = shade(base, seed)
    r, g, b = (int(col[i:i+2], 16) for i in (1, 3, 5))
    light = (0.299 * r + 0.587 * g + 0.114 * b) > 150
    data.append({
        's': e['slug'], 't': e['title'], 'st': re.split(r'[：:｜|]', e['title'])[0].strip() or e['title'],
        'sub': e.get('subtitle', ''), 'd': e['date'], 'ty': e['type'], 'src': e.get('source', ''),
        'desc': e.get('desc', ''), 'u': e.get('original_url', ''), 'c': cover_for(e['slug']),
        'col': col, 'lt': light, 'v': seed % 3, 'f': bool(e.get('featured')),
        'sp': spine_title(e['title']), 'no': ORDER[e['slug']], 'pp': paper_tone(seed),
        'sk': round(((seed >> 11) % 11 - 5) * 0.09, 2), 'wo': (seed >> 15) % 128, 'pv': (seed >> 19) % 3,
    })
for d in data:
    d['l2'] = vlen(d['sp']) > 11.5

types = []
for e in E:
    if e['type'] not in types:
        types.append(e['type'])
counts = {t: sum(1 for e in E if e['type'] == t) for t in types}
types.sort(key=lambda t: -counts[t])
# shelves for the 'by type' grouping: small categories (< 5 tapes) share one shelf, separated by a bookend
shelves, small = [], []
for t in types:
    (small if counts[t] < 5 else shelves).append(t)
shelves = [[t] for t in shelves] + ([small] if small else [])

def list_item(e):
    return (f'<li data-s="{esc(e["slug"])}"><a href="../{esc(e["slug"])}/"><time datetime="{e["date"]}">{e["date"].replace("-", ".")}</time>'
            f'<span class="lt">{esc(e["title"])}</span><span class="lm">{esc(e["type"])} · {esc(e.get("source", ""))}</span></a></li>')

chips = '<button type="button" data-f="" aria-pressed="true">全部<sup>%d</sup></button>' % len(E) + ''.join(
    f'<button type="button" data-f="{esc(t)}" aria-pressed="false">{esc(t)}<sup>{counts[t]}</sup></button>' for t in types)
payload = json.dumps({'items': data, 'types': types, 'shelves': shelves}, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')

TPL = open(os.path.join(ROOT, 'tools', 'hub_shelf_template.html'), encoding='utf-8').read()
page = (TPL.replace('%%N%%', str(len(E)))
           .replace('%%CHIPS%%', chips)
           .replace('%%LIST%%', '\n'.join(list_item(e) for e in E))
           .replace('%%DATA%%', payload)
           .replace('%%URL%%', URL)
           .replace('%%REMOVAL%%', REMOVAL))
os.makedirs(OUT_DIR, exist_ok=True)
open(os.path.join(OUT_DIR, 'index.html'), 'w', encoding='utf-8').write(page)
print(f'hub-preview built: {len(E)} tapes, {sum(1 for d in data if d["c"])} with covers -> hub-preview/index.html')
