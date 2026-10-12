#!/usr/bin/env python3
"""Idempotently inject the shared 'back to library' pill into every sub-page.
Usage: python3 tools/inject_nav.py [--check]
Markers: <!-- zbm-nav:head -->…<!-- /zbm-nav:head --> and <!-- zbm-nav -->…<!-- /zbm-nav -->.
Existing marked blocks are replaced (so edits here propagate). Root index.html (hub) is skipped."""
import os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LABEL = '中文镜像文库'
def blocks(depth):
    up = '../' * depth
    head = (f'<!-- zbm-nav:head --><link rel="stylesheet" href="{up}assets/nav.css">'
            f'<script defer src="{up}assets/nav.js"></script><!-- /zbm-nav:head -->')
    body = (f'<!-- zbm-nav --><a class="zbm-nav" data-zbm-nav href="{up}" aria-label="返回{LABEL}首页">'
            f'<span class="zbm-arrow" aria-hidden="true">←</span><span>{LABEL}</span></a><!-- /zbm-nav -->')
    return head, body
def process(path, check=False):
    rel = os.path.relpath(path, ROOT); depth = rel.count(os.sep)
    s = open(path, encoding='utf-8').read(); o = s
    head, body = blocks(depth)
    if re.search(r'<!-- zbm-nav:head -->', s):
        s = re.sub(r'<!-- zbm-nav:head -->.*?<!-- /zbm-nav:head -->', lambda m: head, s, flags=re.S)
    else:
        s = re.sub(r'</head>', head + '\n</head>', s, count=1, flags=re.I)
    if '<!-- zbm-nav -->' in s:
        # template-provided (e.g. localized gallery) blocks are kept as-is
        pass
    else:
        s = re.sub(r'(<body[^>]*>)', lambda m: m.group(1) + '\n' + body, s, count=1, flags=re.I)
    if s != o and not check:
        open(path, 'w', encoding='utf-8').write(s)
    return s != o
def main():
    check = '--check' in sys.argv; n = 0
    for dp, dns, fns in os.walk(ROOT):
        dns[:] = [d for d in dns if not d.startswith('.') and d not in ('assets', 'tools', 'node_modules')]
        for f in fns:
            p = os.path.join(dp, f)
            if f.endswith('.html') and os.path.relpath(p, ROOT) != 'index.html':
                if process(p, check): n += 1; print(('would update ' if check else 'updated ') + os.path.relpath(p, ROOT))
    print(f'{n} file(s) changed')
if __name__ == '__main__': main()
