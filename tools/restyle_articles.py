#!/usr/bin/env python3
"""Re-wrap text/article sub-pages in templates/article.html + assets/article.css (idempotent).
Usage: python3 tools/restyle_articles.py [slug ...]   (no args = all pages listed below as articles)
Then run tools/inject_nav.py (adds the back pill) and tools/build_hub.py.
- Extracts: <head> extras (title/meta/og/scripts), header (h1 + source/meta lines/cover/CTA),
  body content (everything between header and footer), original footer notes.
- Page <style> blocks: generic rules AND components now provided by assets/article.css (cards, grids, CTA,
  callouts, badges, slack/xpost mocks, timeline…) are dropped; any other unknown component rules are kept in <style data-za-legacy> so custom components keep working.
- Kicker/meta come from entries.json (type, date, source, optional "subtitle" / "original_url").
Special/interactive pages (SKIP) are never touched."""
import html, json, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP = {'personal-sites-gallery', 'classic', 'hub-preview'}  # app-like gallery / hub pages with their own generators
GENERIC = re.compile(r'''^(:root|\*|html|body|\.wrap|h[1-6]|a|a:hover|p|ul|ol|li|img|video|article\b.*|header\.meta\b.*|\.source\b.*|
 \.meta-line|figure\b.*|figcaption\b.*|p\.caption|blockquote\b.*|pre\b.*|code|p\ code|li\ code|td\ code|table\b.*|th|td|tr\b.*|hr|
 footer\b.*|nav\.toc\b.*|img\.cover|\.cover|\.related-guide|\.hub\b.*|summary|details\b.*|\.table-wrap|\.lede|ol\.subs\ li|\.grid2\b.*|
 \.slack\b.*|\.recreated|\.xpost\b.*|\.math-block|\.film|\.tag|\.cta\b.*|\.grid|\.card\b.*|\.card-body|\.brand\b.*|\.warn|\.notice|\.tl\b.*|\.questions\b.*|\.dense-list\b.*|\.closer)$''', re.X)
def css_filter(css):
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S); out = []; i = 0
    while i < len(css):
        j = css.find('{', i)
        if j < 0: break
        sel = css[i:j].strip()
        if sel.startswith('@'):
            depth, k = 1, j + 1
            while depth and k < len(css):
                depth += {'{': 1, '}': -1}.get(css[k], 0); k += 1
            inner = css[j + 1:k - 1]
            if sel.startswith('@media') and 'print' not in sel:
                kept = css_filter(inner)
                if kept.strip(): out.append(f'{sel}{{{kept}}}')
            elif not sel.startswith('@media'): out.append(css[i:k])
            i = k; continue
        k = css.find('}', j); body = css[j + 1:k]; i = k + 1
        parts = [p.strip() for p in sel.split(',')]
        keep = [p for p in parts if not GENERIC.match(p)]
        if keep: out.append(', '.join(keep) + '{' + re.sub(r'\s+', ' ', body).strip() + '}')
    return '\n'.join(out)
def between(s, a, b):
    i = s.find(a); j = s.find(b, i)
    return s[i + len(a):j] if i >= 0 and j >= 0 else None
def extract(s):
    """Return dict(head, css, title, origin, content, footer) from original or already-restyled page."""
    head = re.search(r'<head[^>]*>(.*?)(?:</head>|<body)', s, re.S | re.I).group(1)  # tolerate missing </head>
    css = '\n'.join(re.findall(r'<style[^>]*>(.*?)</style>', s, re.S | re.I))
    head = re.sub(r'<style[^>]*>.*?</style>', '', head, flags=re.S | re.I)
    head = re.sub(r'<!-- zbm-nav:head -->.*?<!-- /zbm-nav:head -->', '', head, flags=re.S)
    head = re.sub(r'<link rel="preconnect"[^>]*>|<link href="https://fonts.googleapis.com[^>]*>|<link rel="stylesheet" href="[./]*assets/article.css">|<script defer src="[./]*assets/article.js"></script>', '', head)
    head = re.sub(r'<meta charset[^>]*>\s*', '', head, flags=re.I)
    head = '<meta charset="utf-8">\n' + re.sub(r'\n\s*\n+', '\n', head).strip()
    body = re.search(r'<body[^>]*>(.*?)(?:</body>\s*)?(?:</html>\s*)?$', s, re.S | re.I).group(1)
    body = re.sub(r'<!-- zbm-nav -->.*?<!-- /zbm-nav -->', '', body, flags=re.S)
    if '<!-- za:article' in s:
        t = re.search(r'<h1 class="za-title">(.*?)</h1>', body, re.S).group(1)
        return dict(head=head, css=css, title=t, origin=between(body, '<!-- za:origin --><div class="za-origin">', '</div><!-- /za:origin -->'),
                    content=between(body, '<!-- za:content --><main class="za-content">', '</main><!-- /za:content -->'),
                    footer=between(body, '<!-- za:foot --><div class="za-foot-orig">', '</div><!-- /za:foot -->'))
    body = re.sub(r'<style[^>]*>.*?</style>', '', body, flags=re.S | re.I)
    body = re.sub(r'(<div class="wrap">\s*)<body>\s*', r'\1', body)  # stray nested <body>
    nwrap = len(re.findall(r'<div class="wrap">', body[:body.find('<header')]))
    body = re.sub(r'<p class="hub"><a href="\.\./">[^<]*</a></p>', '', body)  # old duplicate back link
    hm = re.search(r'<header class="meta">(.*?)</header>', body, re.S)
    pre_header = body[:hm.start()]
    pre_header = re.sub(r'<div class="wrap">', '', pre_header).strip()
    hdr = hm.group(1); rest = body[hm.end():]
    for _ in range(nwrap):
        rest = re.sub(r'</div>\s*$', '', rest.rstrip())
    fm = list(re.finditer(r'<footer[^>]*>(.*?)</footer>', rest, re.S))
    footer = ''
    if fm:
        f = fm[-1]; footer = f.group(1).strip(); tail = rest[f.end():].strip()
        assert re.sub(r'</div>|\s', '', tail) == '', tail[:200]; rest = rest[:f.start()]
    h1 = re.search(r'<h1[^>]*>(.*?)</h1>', hdr, re.S)
    title = h1.group(1).strip(); origin = (hdr[:h1.start()] + hdr[h1.end():]).strip()
    origin = re.sub(r'<div>\s*</div>', '', origin)
    return dict(head=head, css=css, title=title, origin=(pre_header + origin).strip(), content=rest.strip(), footer=footer)
def render(slug, d, entry, tpl):
    e = entry or {}
    sub = e.get('subtitle')
    if not sub:
        m = re.search(r'<img class="cover"[^>]*alt="([^"]+?) 封面"', d['origin'])
        if m: sub = html.unescape(m.group(1))
    meta = []
    if e.get('source'): meta.append(f'<span>来源 · {html.escape(e["source"])}</span>')
    if e.get('date'): meta.append(f'<span>收录 · {e["date"]}</span>')
    url = e.get('original_url')
    if not url:
        m = re.search(r'href="(https?://[^"]+)"', d['origin']); url = m.group(1) if m else ''
    if url: meta.append(f'<span><a href="{url}" rel="noopener">查看原文 ↗</a></span>')
    rep = {'{{HEAD}}': d['head'], '{{UP}}': '../',
           '{{LEGACY_CSS}}': (f'<style data-za-legacy>\n/* page-specific components kept from the original page */\n{d["css"]}\n</style>' if d['css'].strip() else ''),
           '{{TYPE}}': html.escape(e.get('type', '文章')),
           '{{DATE}}': f'<time datetime="{e["date"]}">{e["date"].replace("-", ".")}</time>' if e.get('date') else '',
           '{{TITLE}}': d['title'], '{{SUBTITLE}}': f'<p class="za-sub" lang="en" data-za-gen>{html.escape(sub)}</p>' if sub else '',
           '{{META}}': f'<p class="za-meta" data-za-gen>{"".join(meta)}</p>' if meta else '',
           '{{ORIGIN}}': d['origin'], '{{CONTENT}}': d['content'], '{{FOOTER}}': d['footer'],
           '{{SOURCE_LINK}}': f'原文：<a href="{url}" rel="noopener">{html.escape(re.sub(r"^https?://", "", url)[:60])}</a>。' if url else ''}
    out = tpl
    for k, v in rep.items(): out = out.replace(k, v)
    return out
def main():
    tpl = open(os.path.join(ROOT, 'templates/article.html'), encoding='utf-8').read()
    entries = {e['slug']: e for e in json.load(open(os.path.join(ROOT, 'entries.json'), encoding='utf-8'))}
    slugs = sys.argv[1:] or sorted(d for d in os.listdir(ROOT) if os.path.isfile(os.path.join(ROOT, d, 'index.html')))
    n = 0
    for slug in slugs:
        if slug in SKIP: print('skip', slug); continue
        p = os.path.join(ROOT, slug, 'index.html'); s = open(p, encoding='utf-8').read()
        d = extract(s)
        d['css'] = css_filter(d['css'])
        out = render(slug, d, entries.get(slug), tpl)
        # keep the nav pill if present so inject_nav stays a no-op on re-runs
        nav = re.search(r'<!-- zbm-nav:head -->.*?<!-- /zbm-nav:head -->', s, re.S)
        if nav: out = out.replace('</head>', nav.group(0) + '\n</head>', 1)
        pill = re.search(r'<!-- zbm-nav -->.*?<!-- /zbm-nav -->', s, re.S)
        if pill: out = out.replace('<body class="za">', '<body class="za">\n' + pill.group(0), 1)
        if out != s: open(p, 'w', encoding='utf-8').write(out); n += 1; print('restyled', slug)
    print(f'{n} file(s) changed')
if __name__ == '__main__': main()
