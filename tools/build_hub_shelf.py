#!/usr/bin/env python3
"""Render the PREVIEW hub /hub-preview/index.html — a 'tape shelf' (VHS cassettes as navigation)
from entries.json. Built from scratch (plain HTML + CSS 3D transforms + ~6 KB vanilla JS, no libraries).

Usage: python3 tools/build_hub_shelf.py
New entries: add them to entries.json (same as tools/build_hub.py) and rerun; covers are discovered
automatically from each sub-page's og:image (or images/cover.*, cover.*). The live hub
(index.html / tools/build_hub.py) is NOT touched by this script."""
import json, os, html, hashlib, colorsys, re
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
    })

types = []
for e in E:
    if e['type'] not in types:
        types.append(e['type'])
counts = {t: sum(1 for e in E if e['type'] == t) for t in types}
types.sort(key=lambda t: -counts[t])

def list_item(e):
    return (f'<li data-s="{esc(e["slug"])}"><a href="../{esc(e["slug"])}/"><time datetime="{e["date"]}">{e["date"].replace("-", ".")}</time>'
            f'<span class="lt">{esc(e["title"])}</span><span class="lm">{esc(e["type"])} · {esc(e.get("source", ""))}</span></a></li>')

chips = '<button type="button" data-f="" aria-pressed="true">全部<sup>%d</sup></button>' % len(E) + ''.join(
    f'<button type="button" data-f="{esc(t)}" aria-pressed="false">{esc(t)}<sup>{counts[t]}</sup></button>' for t in types)
payload = json.dumps({'items': data, 'types': types}, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')

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
