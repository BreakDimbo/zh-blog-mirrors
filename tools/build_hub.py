#!/usr/bin/env python3
"""Standard hub build step (run after adding entries to entries.json).
1. Renders the classic text list to classic/index.html (static HTML, JS only adds filter/search).
2. Runs tools/build_hub_shelf.py, which writes the live homepage index.html (the VHS 'tape shelf')
   and keeps hub-preview/index.html as a redirect to the homepage.
So the usual order  entries.json -> restyle_articles -> inject_nav -> build_hub.py  yields the shelf
homepage with every entry plus the classic list."""
import json, os, html, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
E = sorted(json.load(open(os.path.join(ROOT, 'entries.json'), encoding='utf-8')), key=lambda x: (x['date'], x['slug']), reverse=True)
esc = html.escape
URL = 'https://breakdimbo.github.io/zh-blog-mirrors/'
REMOVAL = 'https://github.com/BreakDimbo/zh-blog-mirrors/issues/new?title=Removal%20request'
types = []
for e in E:
    if e['type'] not in types: types.append(e['type'])
def item(e, i):
    d = e['date'].replace('-', '.')
    return f'''<li class="entry" data-type="{esc(e['type'])}" data-text="{esc((e['title']+' '+e['desc']+' '+e['source']+' '+e['type']).lower())}">
  <a href="../{esc(e['slug'])}/">
    <span class="meta"><time datetime="{e['date']}">{d}</time><span class="tag">{esc(e['type'])}</span></span>
    <span class="body"><span class="t">{esc(e['title'])}</span><span class="d">{esc(e['desc'])}</span><span class="s">{esc(e['source'])}</span></span>
    <span class="go" aria-hidden="true">→</span>
  </a></li>'''
feat = next((e for e in E if e.get('featured')), None)
feat_html = ''
if feat:
    feat_html = f'''<section class="feature" aria-label="精选">
  <a href="../{feat['slug']}/">
    <span class="k">精选 · {esc(feat['type'])}</span>
    <span class="ft">{esc(feat['title'].split('：')[0])}</span>
    <span class="fd">{esc(feat['desc'])}</span>
    <span class="fm">{esc(feat['source'])} &nbsp;·&nbsp; {feat['date'].replace('-','.')} &nbsp;<span class="go">进入画廊 →</span></span>
  </a></section>'''
chips = ''.join(f'<button type="button" data-f="{esc(t)}" aria-pressed="false">{esc(t)}</button>' for t in types)
counts = {t: sum(1 for e in E if e['type']==t) for t in types}
page = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>经典列表 · 中文镜像文库 · zh-blog-mirrors</title>
<meta name="description" content="精选海外技术与创作长文的中文镜像、翻译、导读与评述，长期托管于 GitHub Pages。">
<link rel="canonical" href="{URL}classic/">
<meta property="og:type" content="website"><meta property="og:site_name" content="zh-blog-mirrors">
<meta property="og:title" content="中文镜像文库"><meta property="og:description" content="精选海外技术与创作长文的中文镜像、翻译、导读与评述。">
<meta property="og:url" content="{URL}classic/"><meta property="og:locale" content="zh_CN"><meta name="twitter:card" content="summary">
<meta name="theme-color" content="#f6f3ee" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#151412" media="(prefers-color-scheme: dark)">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Crect x=%224%22 y=%229%22 width=%2224%22 height=%2214%22 rx=%221.5%22 fill=%22%233a2f26%22/%3E%3Crect x=%227%22 y=%2212%22 width=%2218%22 height=%225%22 fill=%22%23e6dcc6%22/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600&family=Cormorant+Garamond:ital,wght@0,500;1,400&display=swap" rel="stylesheet">
<style>
:root{{--bg:#f6f3ee;--ink:#1d1c1a;--mute:#76716a;--rule:#d9d3c9;--soft:#ece7df;--acc:#8a6d3b;
--serif:"Noto Serif SC","Source Han Serif SC","Songti SC","STSong",Georgia,serif;--sans:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;--latin:"Cormorant Garamond",Georgia,serif}}
@media (prefers-color-scheme:dark){{:root{{--bg:#151412;--ink:#ebe6de;--mute:#948e85;--rule:#33302b;--soft:#1e1d1a;--acc:#c9a96e}}}}
*{{box-sizing:border-box}}html{{-webkit-text-size-adjust:100%}}
body{{margin:0;background:var(--bg);color:var(--ink);font:15px/1.7 var(--sans);-webkit-font-smoothing:antialiased}}
a{{color:inherit;text-decoration:none}}
.wrap{{max-width:1080px;margin:0 auto;padding:0 clamp(20px,5vw,56px)}}
.top{{display:flex;justify-content:space-between;align-items:baseline;padding:28px 0 0;font:italic 400 15px/1 var(--latin);color:var(--mute);letter-spacing:.02em}}
.top a:hover{{color:var(--ink)}}
header.hero{{padding:clamp(72px,12vw,140px) 0 clamp(48px,7vw,80px);border-bottom:1px solid var(--rule)}}
.eyebrow{{font:500 12px/1 var(--sans);letter-spacing:.24em;color:var(--mute);margin:0 0 28px}}
h1{{font:600 clamp(40px,7.2vw,84px)/1.08 var(--serif);letter-spacing:.02em;margin:0}}
h1 em{{font:italic 400 .62em/1 var(--latin);color:var(--mute);letter-spacing:0;margin-left:.3em;white-space:nowrap}}
.intro{{max-width:34em;margin:32px 0 0;font:400 clamp(16px,1.6vw,18px)/1.9 var(--serif);color:var(--mute)}}
.feature a{{display:grid;grid-template-columns:1fr;gap:10px;padding:clamp(36px,5vw,56px) 0;border-bottom:1px solid var(--rule)}}
.feature .k{{font:500 12px/1 var(--sans);letter-spacing:.2em;color:var(--acc)}}
.feature .ft{{font:600 clamp(28px,4vw,44px)/1.25 var(--serif);transition:color .25s}}
.feature .fd{{font:400 17px/1.8 var(--serif);color:var(--mute);max-width:36em}}
.feature .fm{{font-size:13px;color:var(--mute)}} .feature .go{{color:var(--ink);transition:margin .25s}}
.feature a:hover .ft{{color:var(--acc)}} .feature a:hover .go{{margin-left:4px}}
.bar{{display:flex;flex-wrap:wrap;gap:16px 28px;align-items:center;justify-content:space-between;padding:28px 0 12px;position:sticky;top:0;background:var(--bg);z-index:5}}
.chips{{display:flex;flex-wrap:wrap;gap:6px 22px}}
.chips button{{appearance:none;background:none;border:0;padding:4px 0;font:inherit;font-size:14px;color:var(--mute);cursor:pointer;border-bottom:1px solid transparent;transition:color .2s,border-color .2s}}
.chips button sup{{font-size:10px;margin-left:2px;opacity:.7}}
.chips button:hover{{color:var(--ink)}} .chips button[aria-pressed=true]{{color:var(--ink);border-color:var(--ink)}}
.search{{flex:0 1 260px;display:flex;align-items:center;border-bottom:1px solid var(--rule);transition:border-color .2s}}
.search:focus-within{{border-color:var(--ink)}}
.search input{{width:100%;background:none;border:0;outline:0;padding:6px 0;font:inherit;font-size:14px;color:var(--ink)}}
.search input::placeholder{{color:var(--mute)}}
ol.list{{list-style:none;margin:0;padding:0}}
.entry a{{display:grid;grid-template-columns:150px 1fr 24px;gap:28px;padding:30px 0;border-bottom:1px solid var(--rule);align-items:start}}
.meta{{display:flex;flex-direction:column;gap:8px;padding-top:4px}}
.meta time{{font:500 17px/1 var(--latin);letter-spacing:.04em;color:var(--mute);font-variant-numeric:tabular-nums}}
.tag{{font-size:12px;letter-spacing:.12em;color:var(--acc)}}
.body{{display:flex;flex-direction:column;gap:6px}}
.t{{font:600 clamp(18px,1.9vw,21px)/1.5 var(--serif);transition:color .2s}}
.d{{color:var(--mute);font-size:14.5px}} .s{{font-size:12.5px;color:var(--mute);letter-spacing:.02em}} .s::before{{content:"— "}}
.go{{padding-top:4px;color:var(--mute);opacity:0;transform:translateX(-6px);transition:opacity .25s,transform .25s}}
.entry a:hover .t{{color:var(--acc)}} .entry a:hover .go{{opacity:1;transform:none}}
a:focus-visible,button:focus-visible{{outline:2px solid var(--acc);outline-offset:4px}}
.empty{{padding:48px 0;color:var(--mute);font-family:var(--serif)}}
footer{{margin-top:96px;padding:40px 0 56px;border-top:1px solid var(--rule);font-size:12.5px;line-height:1.9;color:var(--mute);display:grid;grid-template-columns:1fr auto;gap:24px}}
footer a{{border-bottom:1px solid var(--rule)}} footer a:hover{{color:var(--ink);border-color:var(--ink)}}
footer .mark{{font:italic 400 18px/1 var(--latin)}}
@media (max-width:720px){{.entry a{{grid-template-columns:1fr;gap:10px;padding:24px 0}}.meta{{flex-direction:row;gap:14px;align-items:baseline}}.go{{display:none}}
 .bar{{position:static}}.search{{flex:1 1 100%}}footer{{grid-template-columns:1fr}}h1 em{{display:block;margin:14px 0 0}}}}
@media (prefers-reduced-motion:reduce){{*{{transition:none!important}}}}
</style>
<!-- zbm-nav:head --><link rel="stylesheet" href="../assets/nav.css"><script defer src="../assets/nav.js"></script><!-- /zbm-nav:head -->
</head>
<body>
<!-- zbm-nav --><!-- /zbm-nav -->
<div class="wrap">
<div class="top"><a href="../">← 书架首页</a><a href="https://github.com/BreakDimbo/zh-blog-mirrors">GitHub</a></div>
<header class="hero">
<p class="eyebrow">VOL. 01 &nbsp;·&nbsp; {len(E)} 篇收录</p>
<h1>中文镜像文库<em>a reading room</em></h1>
<p class="intro">把值得细读的海外长文、项目与讨论，译成中文、整理成篇，安静地放在这里——全文镜像、翻译、导读与评述，按时间倒序陈列。</p>
</header>
{feat_html}
<div class="bar">
<div class="chips" role="group" aria-label="按类型筛选"><button type="button" data-f="" aria-pressed="true">全部<sup>{len(E)}</sup></button>{''.join(f'<button type="button" data-f="{esc(t)}" aria-pressed="false">{esc(t)}<sup>{counts[t]}</sup></button>' for t in types)}</div>
<label class="search"><span class="sr" style="position:absolute;left:-9999px">搜索</span><input id="q" type="search" placeholder="搜索标题、作者、关键词" autocomplete="off"></label>
</div>
<main><ol class="list" id="list">
{chr(10).join(item(e,i) for i,e in enumerate(E))}
</ol><p class="empty" id="empty" hidden>没有匹配的文章，换个关键词试试。</p></main>
<footer>
<div>本站内容为对公开文章的中文镜像、翻译或评述，版权归原作者及原发布方所有，各页均注明出处；仅供学习交流，非商业用途。<br>如你是原作者并希望更正或移除，请 <a href="{REMOVAL}">提交移除请求</a>，我们会尽快处理。</div>
<div class="mark">© 2026 zh-blog-mirrors</div>
</footer>
</div>
<script>
(function(){{var q=document.getElementById('q'),bs=[].slice.call(document.querySelectorAll('.chips button')),items=[].slice.call(document.querySelectorAll('.entry')),em=document.getElementById('empty'),f='';
function run(){{var s=q.value.trim().toLowerCase(),n=0;items.forEach(function(li){{var ok=(!f||li.dataset.type===f)&&(!s||li.dataset.text.indexOf(s)>-1);li.hidden=!ok;if(ok)n++;}});em.hidden=n>0;}}
bs.forEach(function(b){{b.addEventListener('click',function(){{f=b.dataset.f;bs.forEach(function(x){{x.setAttribute('aria-pressed',x===b)}});run();}});}});
q.addEventListener('input',run);}})();
</script>
</body>
</html>
'''
os.makedirs(os.path.join(ROOT, 'classic'), exist_ok=True)
open(os.path.join(ROOT, 'classic', 'index.html'), 'w', encoding='utf-8').write(page)
print(f'classic list built: {len(E)} entries -> classic/index.html')
# the live homepage is the tape shelf (also refreshes the hub-preview/ redirect)
subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'build_hub_shelf.py')] + [a for a in sys.argv[1:] if a == '--textures'], check=True)
