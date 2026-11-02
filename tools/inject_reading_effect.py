#!/usr/bin/env python3
"""Idempotently add the broadsheet reading mode (assets/reading-effect/) to every standard article page.
Usage: python3 tools/inject_reading_effect.py [--check] [--remove] [slug ...]
  (no slugs = all pages; --check = report only; --remove = strip the block again)
Run after tools/inject_nav.py and before tools/build_hub.py.
Marker: <!-- re:head -->…<!-- /re:head --> just before </head>; an existing block is replaced, so edits
here propagate. Only pages built from templates/article.html (marker <!-- za:article v1 -->) qualify.
Never touched: the hub, galleries (entries.json type 画廊), EXCLUDE below, anything under _preview/ or
motion-gallery/, and pages whose <body> carries data-re-off (per-page opt-out; readers can also use ?re=off).
The block only links shared assets; article text is never modified."""
import json, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# app-like / interactive pages with their own generators or layouts
EXCLUDE = {'personal-sites-gallery', 'classic', 'hub-preview', 'design-resources', 'motion-gallery',
           'lemo-opuscar-98-styles', 'lemo-opuscar-evidence-films', '_preview'}
MARK = '<!-- za:article v1 -->'
BLOCK_RE = re.compile(r'\n?<!-- re:head -->.*?<!-- /re:head -->', re.S)
def block(depth):
    up = '../' * depth; a = f'{up}assets/reading-effect/'
    return ('<!-- re:head -->'
            f'<link rel="preload" href="{a}fonts/GeistSerif-Regular.woff2" as="font" type="font/woff2" crossorigin>'
            f'<link rel="preload" href="{a}fonts/GeistMono-Variable.woff2" as="font" type="font/woff2" crossorigin>'
            f'<link rel="stylesheet" href="{a}reading-effect.css">'
            '<script>(function(d){if(/[?&]re=off\\b/.test(location.search)||!("noModule" in d.createElement("script")))return;'
            'var r=d.documentElement;r.classList.add("re-js");setTimeout(function(){if(!r.classList.contains("re-ready"))r.classList.remove("re-js")},8000)})(document)</script>'
            f'<script type="module" src="{a}reading-effect.js"></script>'
            '<!-- /re:head -->')
def galleries():
    try: return {e['slug'] for e in json.load(open(os.path.join(ROOT, 'entries.json'), encoding='utf-8')) if e.get('type') == '画廊'}
    except Exception: return set()
def eligible(rel, s, gal):
    top = rel.split(os.sep)[0]
    if rel == 'index.html' or top in EXCLUDE or top in gal: return False
    if MARK not in s: return False
    if re.search(r'<body[^>]*\sdata-re-off', s, re.I): return False
    return True
def process(path, gal, check=False, remove=False):
    rel = os.path.relpath(path, ROOT); s = open(path, encoding='utf-8').read(); o = s
    ok = eligible(rel, s, gal)
    if not ok: return False, False  # ineligible pages are left exactly as they are
    if remove:
        s = BLOCK_RE.sub('', s)
    else:
        b = block(rel.count(os.sep))
        if '<!-- re:head -->' in s: s = BLOCK_RE.sub(lambda m: '\n' + b, s, count=1)
        else: s = re.sub(r'</head>', lambda m: b + '\n</head>', s, count=1, flags=re.I)
    if s != o and not check: open(path, 'w', encoding='utf-8').write(s)
    return s != o, ok
def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    check, remove = '--check' in sys.argv, '--remove' in sys.argv
    gal = galleries(); paths = []
    if args: paths = [os.path.join(ROOT, a.strip('/'), 'index.html') for a in args]
    else:
        for dp, dns, fns in os.walk(ROOT):
            dns[:] = sorted(d for d in dns if not d.startswith('.') and d not in ('assets', 'tools', 'templates', 'node_modules'))
            paths += [os.path.join(dp, f) for f in sorted(fns) if f.endswith('.html')]
    n = on = 0
    for p in paths:
        if not os.path.isfile(p): print('missing', os.path.relpath(p, ROOT)); continue
        ch, ok = process(p, gal, check, remove); on += ok and not remove
        if ch: n += 1; print(('would update ' if check else 'updated ') + os.path.relpath(p, ROOT))
    print(f'{n} file(s) changed; {on} page(s) with the reading effect')
if __name__ == '__main__': main()
