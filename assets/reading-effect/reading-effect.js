/*! zh-blog-mirrors · reading-effect v2 ("broadsheet")
 * A newspaper reading mode for article pages, after keshav (@kshvbgde)'s "The Blue Hour" experiment
 * (https://x.com/kshvbgde/status/2116270360417243293, https://kshv.me/experiments/blue-hour).
 * That demo's source is not published under a licence, so nothing here is copied from it: this is an
 * independent re-implementation of the behaviour seen in its video (folded sheet that opens, justified
 * columns set line by line, text that re-flows live around figures you drag, a page you turn by its
 * corner). Figures are shown as the original images (no re-inking).
 * Line layout: @chenglou/pretext (MIT, ./pretext.js, bundled unmodified). Obstacle carving is our own
 * code, in the spirit of pretext's MIT-licensed dynamic-layout demo.
 * Progressive enhancement: without JS / module support the page keeps the normal article layout.
 * Opt out per page with <body data-re-off> or ?re=off. */
import { prepareRichInline, layoutNextRichInlineLineRange, materializeRichInlineLineRange } from './pretext.js';

const D = document, root = D.documentElement;
const RM = matchMedia('(prefers-reduced-motion: reduce)');
const qs = (s, el = D) => el.querySelector(s), qsa = (s, el = D) => [...el.querySelectorAll(s)];
const h = (tag, cls, attrs) => { const e = D.createElement(tag); if (cls) e.className = cls; if (attrs) for (const k in attrs) { if (k === 'text') e.textContent = attrs[k]; else if (k === 'html') e.innerHTML = attrs[k]; else e.setAttribute(k, attrs[k]); } return e; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const raf = () => new Promise(r => requestAnimationFrame(() => r()));

/* ---------- type scale (must match reading-effect.css) ---------- */
const SERIF = '"Geist Serif", "Noto Serif SC", "Source Han Serif SC", "Songti SC", serif';
const MONO = '"Geist Mono", ui-monospace, Menlo, Consolas, monospace';
const BODY = { size: 16, lh: 28 };
const TYPES = {
  p: { size: 16, lh: 28, gap: 5, indent: 2 },
  caption: { size: 13, lh: 22, gap: 4, indent: 0, mute: 1 },
  h3: { size: 20, lh: 28, gap: 22, indent: 0, head: 1 },
  h4: { size: 17, lh: 26, gap: 16, indent: 0, head: 1 },
  li: { size: 16, lh: 28, gap: 3, indent: 0, pad: 1.6 },
  q: { size: 15.5, lh: 27, gap: 5, indent: 0, pad: 1.3, quote: 1 },
};
const INLINE_OK = new Set(['A', 'STRONG', 'B', 'EM', 'I', 'CODE', 'SUP', 'SUB', 'BR', 'SPAN', 'SMALL', 'MARK', 'ABBR', 'TIME', 'KBD', 'U', 'S', 'DEL', 'INS', 'Q', 'CITE', 'DFN', 'VAR', 'SAMP', 'WBR']);
const NARROW = () => innerWidth < 640;
const EASE = { paper: 'cubic-bezier(.6,.02,.28,1)', out: 'cubic-bezier(.2,.7,.2,1)', settle: 'cubic-bezier(.3,0,.4,1)' };

/* ---------- boot ---------- */
const page = qs('.za-page'), content = qs('.za-content'), headEl = qs('.za-head'), footEl = qs('.za-foot');
const off = !page || !content || D.body.hasAttribute('data-re-off') || /[?&]re=off\b/.test(location.search);
if (off) root.classList.remove('re-js'); else boot().catch(err => { console.error('[reading-effect]', err); root.classList.remove('re-js', 're-on'); });

const S = { pages: [], cur: 0, cols: 0, sheetW: 0, linesSet: 0, t0: performance.now(), figN: 0 };

async function boot() {
  await fontsReady();
  build();
  root.classList.add('re-on');
  const hashPage = location.hash ? pageOf(safeTarget(location.hash)) : -1;
  S.cur = hashPage >= 0 ? hashPage : 0;
  showPage(S.cur);
  layoutPage(S.cur);
  root.classList.add('re-ready');
  bindGlobal();
  tickStats();
  if (hashPage >= 0) { const t = safeTarget(location.hash); t && t.scrollIntoView(); }
  else if (!RM.matches && !NARROW() && !sessionStorage.getItem('re-opened:' + location.pathname)) await foldIntro();
}

function fontsReady() {
  const txt = (content.textContent + (headEl ? headEl.textContent : '')).replace(/\s+/g, '');
  const uniq = [...new Set(txt)].join('');
  const loads = [
    D.fonts.load(`16px "Geist Serif"`, 'Ag'), D.fonts.load(`500 11px "Geist Mono"`, 'Ag0'),
    D.fonts.load(`16px "Noto Serif SC"`, uniq), D.fonts.load(`600 16px "Noto Serif SC"`, uniq.slice(0, 4000)),
  ];
  return Promise.race([Promise.allSettled(loads), new Promise(r => setTimeout(r, 4000))]);
}

/* ---------- structure: pages → stories → blocks ---------- */
function isSimpleInline(el) {
  for (const n of el.querySelectorAll('*')) if (!INLINE_OK.has(n.tagName) || (n.tagName === 'SPAN' && n.className && !/^(en|zh|nowrap)$/.test(n.className))) return false;
  return el.textContent.trim().length > 0;
}
function classify(el) {
  if (el.nodeType !== 1) return null;
  const t = el.tagName;
  if (t === 'P') return isSimpleInline(el) ? { kind: 'prose', units: [unitOf(el, el.classList.contains('caption') || el.classList.contains('source') ? 'caption' : 'p')] } : { kind: 'solid' };
  if (t === 'H3' || t === 'H4' || t === 'H5') return isSimpleInline(el) ? { kind: 'prose', units: [unitOf(el, t === 'H3' ? 'h3' : 'h4')] } : { kind: 'solid' };
  if ((t === 'UL' || t === 'OL') && !el.className) {
    const lis = [...el.children];
    if (lis.length && lis.every(li => li.tagName === 'LI' && isSimpleInline(li))) {
      el.setAttribute('role', 'list');
      const start = +(el.getAttribute('start') || 1);
      return { kind: 'prose', units: lis.map((li, i) => unitOf(li, 'li', t === 'OL' ? `${start + i}.` : '•')) };
    }
    return { kind: 'solid' };
  }
  if (t === 'BLOCKQUOTE' && !el.className) {
    const ps = [...el.children];
    if (ps.length && ps.every(p => p.tagName === 'P' && isSimpleInline(p))) return { kind: 'prose', units: ps.map(p => unitOf(p, 'q')) };
    return { kind: 'solid' };
  }
  if (t === 'FIGURE' && el.querySelectorAll('img').length === 1 && !el.querySelector('video,iframe,a img')) return { kind: 'figure' };
  return { kind: 'solid' };
}
function unitOf(el, type, marker) { return { el, type, T: TYPES[type], marker, orig: el.cloneNode(true), prep: null, items: null }; }

function build() {
  S.chars = content.textContent.replace(/\s/g, '').length;
  const kids = [...content.childNodes].filter(n => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim()));
  // group into stories at top-level h2
  const stories = [{ h2: null, blocks: [] }];
  for (const n of kids) {
    if (n.nodeType === 1 && n.tagName === 'H2') stories.push({ h2: n, blocks: [] });
    else stories[stories.length - 1].blocks.push(n);
  }
  if (!stories[0].blocks.length) stories.shift();
  // visible length (collapsed <details> count as their summary only)
  const vlen = n => n.nodeType !== 1 ? (n.textContent || '').length : n.tagName === 'DETAILS' ? 80 + (qs('summary', n)?.textContent.length || 0)
    : (n.textContent || '').length - qsa('details', n).reduce((a, d) => a + d.textContent.length, 0);
  // long stories continue on the next page at an h3 boundary ("续前版"), like a jump in a paper
  const PAGE = 7600, CHUNK = 4600; const chunks = [];
  for (const st of stories) {
    let cur = { h2: st.h2, blocks: [], len: 0, title: st.h2 ? st.h2.textContent.trim() : '' };
    chunks.push(cur);
    for (const b of st.blocks) {
      if (cur.len > CHUNK && b.nodeType === 1 && /^H3$/.test(b.tagName)) { cur = { h2: null, cont: st.h2, blocks: [], len: 0, title: cur.title }; chunks.push(cur); }
      cur.blocks.push(b); cur.len += vlen(b);
    }
  }
  const pages = []; let curP = null, chars = 0;
  for (const st of chunks) {
    if (!curP || chars + st.len > PAGE || (st.cont && chars > 0)) { curP = { stories: [] }; pages.push(curP); chars = 0; }
    curP.stories.push(st); chars += st.len;
  }
  const stage = h('div', 're-stage');
  const sheet = h('div', 're-sheet', { id: 're-sheet' });
  sheet.append(h('div', 're-grain', { 'aria-hidden': 'true' }));
  stage.append(sheet);
  const meta = readMeta();
  S.meta = meta;
  pages.forEach((p, i) => {
    const folio = 'A' + (i + 1);
    const sec = h('section', 're-page', { 'data-folio': folio, 'aria-label': `第 ${folio} 版` });
    const body = h('div', 'za-content re-body');
    if (i === 0) sec.append(masthead(meta)); else sec.append(runningHead(meta, folio, p.stories[0]));
    if (i === 0) body.append(leadBlock(meta));
    p.stories.forEach((st, si) => body.append(storyEl(st, i === 0 && si === 0, i, si)));
    if (i === pages.length - 1) {
      const col = h('div', 're-colophon'); if (footEl) col.append(footEl);
      const base = new URL('./', import.meta.url).href;
      col.append(h('p', 're-credit', { html: `版式说明：报纸阅读模式，灵感来自 keshav 的 <a href="https://kshv.me/experiments/blue-hour" rel="noopener">The Blue Hour</a>（独立重写，未使用其代码）· 逐行排字 <a href="https://github.com/chenglou/pretext" rel="noopener">pretext</a>（MIT）· 字体 Geist Serif / Geist Mono（SIL OFL 1.1）· <a href="${base}LICENSES.md">许可与致谢</a> · <a href="?re=off">切换回普通版式</a>` }));
      body.append(col);
    }
    sec.append(body, folioEl(i, pages.length));
    p.el = sec; p.body = body; p.folio = folio; p.laid = false;
    p.title = (p.stories.find(s => s.h2) || p.stories[0]).title || meta.title.replace(/<[^>]+>/g, '');
    if (!p.stories.some(s => s.h2) && p.stories[0].cont) p.title = '续 · ' + p.title;
    if (i === 0) p.title = '头版 · ' + ((p.stories.find(s => s.h2) || {}).title || '导读');
    sheet.append(sec);
  });
  S.pages = pages; S.sheet = sheet; S.stage = stage;
  const corner = h('button', 're-corner', { type: 'button' });
  corner.innerHTML = '<span class="re-corner-fold" aria-hidden="true"></span>';
  sheet.append(corner); S.corner = corner;
  page.replaceChildren(stage);
  page.classList.add('re-host');
  controls();
}

function readMeta() {
  const g = s => headEl && qs(s, headEl);
  const title = g('.za-title') ? g('.za-title').innerHTML : D.title;
  const kicker = g('.za-kicker');
  return {
    title, type: kicker ? (qs('span', kicker)?.textContent || '') : '',
    date: kicker && qs('time', kicker) ? qs('time', kicker).getAttribute('datetime') : '',
    sub: g('.za-sub'), metaLine: g('.za-meta'), origin: g('.za-origin'),
  };
}
function cnDate(iso) {
  const d = iso ? new Date(iso + 'T12:00:00+08:00') : new Date();
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · 星期${'日一二三四五六'[d.getDay()]}`;
}
function masthead(meta) {
  const m = h('header', 're-mast');
  const top = h('div', 're-toprow');
  top.append(h('span', '', { text: `${meta.type || '文章'} · 中文镜像文库 · READING EDITION` }),
    h('span', 're-quote', { text: meta.sub ? `“${meta.sub.textContent.trim()}”` : '' }),
    h('span', '', { text: cnDate(meta.date) }));
  const plate = h('div', 're-plate', { role: 'presentation' });
  plate.innerHTML = '<span>中文镜像</span>';
  const moon = h('canvas', 're-moon', { 'aria-hidden': 'true', width: 10, height: 10 });
  plate.append(moon, h('span', '', { text: '文库' }));
  S.plateMoon = moon;
  const stats = h('dl', 're-stats', { 'aria-label': '版面数据' });
  const cell = (k, id, up = '▲') => { const d = h('div'); d.append(h('dt', '', { html: `<i aria-hidden="true">${up}</i>${k}` }), h('dd', '', { id: 're-st-' + id, text: '—' })); return d; };
  stats.append(cell('月相 · 亮面', 'moon'), cell('排字行数', 'lines'), cell('版面', 'pages'), cell('插图 · 原图', 'figs'),
    cell('全文字数', 'chars'), cell('已读', 'read', '▼'), cell('付印以来', 'since'));
  m.append(top, plate, stats);
  return m;
}
function runningHead(meta, folio, st) {
  const r = h('header', 're-running');
  r.append(h('span', '', { text: `${folio} · 中文镜像文库` }),
    h('span', 're-quote', { text: st.title ? `“${st.title}”` : '' }),
    h('span', '', { text: cnDate(meta.date) }));
  return r;
}
function leadBlock(meta) {
  const l = h('div', 're-lead');
  const k = h('p', 're-kicker'); k.textContent = `${meta.type || '文章'} · ${meta.date ? meta.date.replace(/-/g, '.') : ''}`;
  const t = h('h1', 're-headline'); t.innerHTML = meta.title;
  l.append(k, t);
  if (meta.sub) { const s = h('p', 're-deck', { lang: 'en' }); s.textContent = meta.sub.textContent; l.append(s); }
  if (meta.metaLine) { meta.metaLine.className = 're-metaline'; l.append(meta.metaLine); }
  if (meta.origin) { meta.origin.className = 're-origin'; l.append(meta.origin); }
  return l;
}
function storyEl(st, isLead, pi, si) {
  const a = h('article', 're-story' + (isLead ? ' re-leadstory' : ''));
  if (st.h2) { st.h2.classList.add('re-hl'); a.append(st.h2); a.append(h('p', 're-byline', { 'aria-hidden': 'true', text: `第 ${pi + 1} 版 · 第 ${si + 1} 篇 · 中文镜像文库编辑部` })); }
  else if (st.cont) { a.classList.add('re-cont'); a.append(h('p', 're-contline', { text: `续前版 · CONTINUED — ${st.title}` })); }
  // blocks → runs (prose/figure) and solids
  let run = null; const flushRun = () => { if (run) { a.append(run.el); run = null; } };
  st.blocks.forEach(n => {
    if (n.nodeType === 3) { const p = h('p'); p.textContent = n.textContent.trim(); n.replaceWith(p); n = p; }
    const c = classify(n);
    if (!c || c.kind === 'solid') { flushRun(); const w = h('div', 're-solid'); w.append(n); a.append(w); prepSolid(n); return; }
    if (!run) { run = { el: h('div', 're-run'), blocks: [] }; run.el._run = run; }
    if (c.kind === 'figure') { prepFigure(n); run.blocks.push({ kind: 'figure', el: n }); }
    else run.blocks.push({ kind: 'prose', el: n, units: c.units });
    run.el.append(n);
  });
  flushRun();
  a._lead = isLead;
  return a;
}
function prepSolid(n) { qsa('figure', n).forEach(f => f.querySelector('img') && prepFigure(f, true)); if (n.tagName === 'FIGURE' && n.querySelector('img')) prepFigure(n, true); }
function prepFigure(f, solid) {
  if (f._re) return; f._re = 1;
  const img = qs('img', f); if (!img) return;
  const n = ++S.figN;
  f.classList.add('re-fig');
  const wrap = h('div', 're-plate-img'); img.replaceWith(wrap); wrap.append(img);
  let cap = qs('figcaption', f); if (!cap) { cap = h('figcaption'); f.append(cap); }
  cap.prepend(h('span', 're-fign', { 'aria-hidden': 'true', text: `图 ${n}` }));
  f.tabIndex = 0;
  f.setAttribute('aria-label', `图 ${n}：${img.alt || ''}。按回车查看大图${solid ? '' : '；方向键可移动插图，正文随之重排'}`);
  f._img = img;
  // a gentle fade-in once the picture has actually arrived; already-cached images just appear
  if (img.complete && img.naturalWidth) wrap.classList.add('re-in', 're-now');
  else {
    img.addEventListener('load', () => { wrap.classList.add('re-in'); if (f.closest('.re-band') && !f._ar) relayoutBandOf(f); }, { once: true });
    img.addEventListener('error', () => wrap.classList.add('re-in', 're-err'), { once: true });
  }
}
function folioEl(i, n) {
  const f = h('footer', 're-folio');
  f.append(h('span', '', { text: 'A' + (i + 1) }), h('span', 're-reg', { 'aria-hidden': 'true', html: '<i>⌖</i><b></b>' }),
    h('span', '', { text: i < n - 1 ? `下接 A${i + 2} 版 —— 掀起右下角 · CONTINUED OVERLEAF — TAKE THE CORNER` : '全文完 · END OF EDITION' }));
  return f;
}

/* ---------- inline items for pretext ---------- */
function fontFor(chain, T) {
  let w = 400, st = 'normal', size = T.size, fam = SERIF, extra = 0, cls = '';
  for (const e of chain) {
    const t = e.tagName;
    if (t === 'STRONG' || t === 'B') w = 600;
    else if (t === 'EM' || t === 'I' || t === 'CITE' || t === 'DFN' || t === 'VAR') st = 'italic';
    else if (t === 'CODE' || t === 'KBD' || t === 'SAMP') { fam = MONO; size = Math.round(T.size * 0.84 * 4) / 4; extra = 6; cls = 'c'; }
    else if (t === 'SUP' || t === 'SUB' || t === 'SMALL') size = Math.round(T.size * 0.72);
  }
  if (T.head) w = Math.max(w, 400);
  return { font: `${st === 'italic' ? 'italic ' : ''}${w} ${size}px ${fam}`, extra, cls };
}
function itemsOf(u) {
  const segs = [[]]; // split at <br>
  const walk = (node, chain) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { const t = c.textContent.replace(/[\t\n\r ]+/g, ' '); if (t) segs[segs.length - 1].push({ text: t, chain }); }
      else if (c.nodeType === 1) { if (c.tagName === 'BR') segs.push([]); else walk(c, chain.concat(c)); }
    }
  };
  walk(u.orig, []);
  return segs.map(list => {
    // trim edges
    while (list.length && !list[0].text.trim()) list.shift();
    while (list.length && !list[list.length - 1].text.trim()) list.pop();
    if (list.length) { list[0].text = list[0].text.replace(/^\s+/, ''); list[list.length - 1].text = list[list.length - 1].text.replace(/\s+$/, ''); }
    return list.map(it => ({ ...it, ...fontFor(it.chain, u.T) }));
  }).filter(l => l.length);
}
function prepUnit(u) {
  if (u.prep) return;
  u.lines = itemsOf(u); // array of hard-broken sub-paragraphs
  if (u.dropcap && u.lines.length) {
    const first = u.lines[0][0]; const m = first.text.match(/^[\p{L}\p{N}]/u);
    if (m && !first.chain.some(e => e.tagName === 'A' || e.tagName === 'CODE')) { u.dcChar = m[0]; first.text = first.text.slice(m[0].length); }
  }
  u.prep = u.lines.map(list => prepareRichInline(list.map(it => ({ text: it.text, font: it.font, extraWidth: it.extra || undefined }))));
}

/* ---------- geometry ---------- */
function blocked(ob, y0, y1) {
  if (ob.cap) { // ornament = circle + a caption strip under it
    const c = blocked({ ...ob, cap: null }, y0, y1);
    const ct = ob.y + ob.h, cb = ct + ob.cap.h;
    if (y1 <= ct - 2 || y0 >= cb + ob.pad) return c;
    const cx = ob.x + ob.w / 2, r = [cx - ob.cap.w / 2 - ob.pad, cx + ob.cap.w / 2 + ob.pad];
    return c ? [Math.min(c[0], r[0]), Math.max(c[1], r[1])] : r;
  }
  if (y1 <= ob.y - ob.pad || y0 >= ob.y + ob.h + ob.pad) return null;
  if (ob.shape === 'circle') {
    const cy = ob.y + ob.h / 2, r = ob.h / 2 + ob.pad;
    const dy = cy < y0 ? y0 - cy : cy > y1 ? cy - y1 : 0;
    if (dy >= r) return null;
    const half = Math.sqrt(r * r - dy * dy), cx = ob.x + ob.w / 2;
    return [cx - half, cx + half];
  }
  return [ob.x - ob.pad, ob.x + ob.w + ob.pad];
}
function freeSegs(x0, x1, y0, y1, obs, min) {
  let segs = [[x0, x1]];
  for (const ob of obs) {
    const b = blocked(ob, y0, y1); if (!b) continue;
    const nx = [];
    for (const [a, z] of segs) {
      if (b[1] <= a || b[0] >= z) { nx.push([a, z]); continue; }
      if (b[0] > a) nx.push([a, b[0]]);
      if (b[1] < z) nx.push([b[1], z]);
    }
    segs = nx;
  }
  return segs.filter(([a, z]) => z - a >= min);
}

/* ---------- band layout ---------- */
function layBand(band, H, render) {
  const { cols, colW, gutter } = band;
  const obs = band.obstacles.slice();
  let c = 0, y = 0, maxY = 0; const out = [];
  for (const blk of band.blocks) {
    if (blk.kind !== 'prose') continue;
    blk.units.forEach((u, ui) => {
      if (out.fail) return;
      const T = u.T, lh = T.lh, em = T.size;
      const gapB = ui === 0 ? Math.max(T.gap, blk.gapTop || 0) : T.gap;
      if (y > 0) y += gapB;
      if (T.head && y > 0 && y + lh * 3 > H) { c++; y = 0; }
      const padL = T.pad ? T.pad * em : 0;
      u.lines.forEach((list, li) => {
        const prep = u.prep[li]; let cur; let first = li === 0; let lastLine = null; let guard = 0;
        const isDC = first && u.dcChar;
        while (guard++ < 4000) {
          if (!layoutNextRichInlineLineRange(prep, colW, cur)) break; // paragraph finished
          if (y + lh > H) { c++; y = 0; }
          if (c >= cols) { out.fail = 1; return; }
          const colX = c * (colW + gutter);
          if (isDC && first && !u.dcRect) {
            const m = dropCapMetrics(u.dcChar, T);
            u.dcRect = { x: colX + padL, y, w: m.w, h: lh * 3, pad: 0, shape: 'rect', dc: 1, m };
            obs.push(u.dcRect);
          }
          const segs = freeSegs(colX + padL, colX + colW, y, y + lh, obs, em * 3);
          if (!segs.length) { y += lh; continue; }
          let produced = false, ended = false;
          for (let si = 0; si < segs.length; si++) {
            let [sx, ex] = segs[si];
            if (first && si === 0 && T.indent && !u.dcChar && !u.noIndent && Math.abs(sx - (colX + padL)) < 1) sx += T.indent * em;
            const r = layoutNextRichInlineLineRange(prep, ex - sx, cur);
            if (!r) { ended = true; break; }
            if (render) { lastLine = { u, prep, list, r, x: sx, y, w: ex - sx, lh, colX, padL, first, li, loose: r.width < (ex - sx) * 0.8 }; out.push(lastLine); }
            cur = r.end; produced = true;
            if (first && u.marker && render) lastLine.marker = u.marker;
            first = false;
          }
          y += lh; maxY = Math.max(maxY, y);
          if (ended) break;
        }
        if (lastLine) lastLine.last = 1;
      });
      if (u.dcRect) { maxY = Math.max(maxY, u.dcRect.y + u.dcRect.h); if (render) out.dcs = (out.dcs || []).concat([{ u, rect: u.dcRect }]); }
      if (!render) u.dcRect = null; else u.dcRect = null;
    });
    if (out.fail) break;
  }
  for (const ob of band.obstacles) maxY = Math.max(maxY, ob.y + ob.h + (ob.cap ? ob.cap.h : 0));
  return { ok: !out.fail, h: maxY, out };
}
let _mc; function ctx2d() { return (_mc = _mc || D.createElement('canvas').getContext('2d')); }
function measureW(t, font) { const c = ctx2d(); c.font = font; return c.measureText(t).width; }
// A three-line drop cap whose ink sits exactly between the first line's ink top and the third line's
// baseline (CJK: the third line's ideographic bottom), measured from the real glyphs rather than guessed.
const _dcm = new Map();
function dropCapMetrics(ch, T) {
  const key = ch + T.size + '/' + T.lh; if (_dcm.has(key)) return _dcm.get(key);
  const c = ctx2d(), cjk = /[\u3400-\u9fff\uf900-\ufaff]/.test(ch);
  c.font = `400 ${T.size}px ${SERIF}`;
  const ref = c.measureText(cjk ? '国' : 'H');
  const FA = ref.fontBoundingBoxAscent || T.size * .9, FD = ref.fontBoundingBoxDescent || T.size * .25;
  const base = k => k * T.lh + (T.lh - (FA + FD)) / 2 + FA; // baseline of line k inside the band
  const top = base(0) - ref.actualBoundingBoxAscent, bottom = base(2) + (cjk ? ref.actualBoundingBoxDescent : 0);
  c.font = `400 100px ${SERIF}`;
  const g = c.measureText(ch), inkH = (g.actualBoundingBoxAscent + (cjk ? g.actualBoundingBoxDescent : 0)) / 100 || .72;
  const size = (bottom - top) / inkH;
  c.font = `400 ${size}px ${SERIF}`;
  const G = c.measureText(ch);
  const gFA = G.fontBoundingBoxAscent || size * .9, gFD = G.fontBoundingBoxDescent || size * .25;
  // span with line-height = size: its baseline sits at (size - (gFA + gFD)) / 2 + gFA from its top
  const baseInSpan = (size - (gFA + gFD)) / 2 + gFA;
  const spanTop = top + G.actualBoundingBoxAscent - baseInSpan;
  const w = Math.ceil((G.actualBoundingBoxRight || G.width) - Math.min(0, -(G.actualBoundingBoxLeft || 0))) + Math.round(T.size * (cjk ? .55 : .5));
  const m = { size, top: spanTop, w, left: -(Math.min(0, -(G.actualBoundingBoxLeft || 0))) };
  _dcm.set(key, m); return m;
}

function fitBand(band) {
  let lo = 0;
  for (const ob of band.obstacles) lo = Math.max(lo, ob.y + ob.h + (ob.cap ? ob.cap.h : 0));
  let hi = Math.max(400, lo + 1);
  while (!layBand(band, hi, false).ok) { hi *= 1.6; if (hi > 60000) break; }
  // lower bound from area
  for (let i = 0; i < 18 && hi - lo > 2; i++) { const mid = (lo + hi) / 2; if (layBand(band, mid, false).ok) hi = mid; else lo = mid; }
  return Math.ceil(hi);
}
function renderBand(band, live) {
  // while a figure is being dragged keep the band height steady (no jumping page) unless it no longer fits
  const obBottom = band.obstacles.reduce((m, ob) => Math.max(m, ob.y + ob.h + (ob.cap ? ob.cap.h : 0)), 0);
  let H = live && band.H >= obBottom ? band.H : 0, res = H ? layBand(band, H, true) : null;
  if (!res || !res.ok) { H = fitBand(band); res = layBand(band, H, true); }
  band.H = H;
  // clear unit DOM
  for (const blk of band.blocks) if (blk.kind === 'prose') blk.units.forEach(u => u.el.replaceChildren());
  const linkFirst = new Map(); let n = 0;
  for (const L of res.out) {
    const line = h('span', 're-l' + (L.last || L.loose ? '' : ' j') + (L.u.T.quote ? ' q' : '') + (L.u.T.head ? ' hd' : '') + (L.u.T.mute ? ' mu' : ''));
    line.style.cssText = `left:${L.x.toFixed(2)}px;top:${L.y}px;width:${L.w.toFixed(2)}px;height:${L.lh}px;line-height:${L.lh}px`;
    if (L.u.T.quote) line.style.setProperty('--qx', (L.x - L.colX - 3).toFixed(1) + 'px');
    const m = materializeRichInlineLineRange(L.prep, L.r);
    for (const fr of m.fragments) {
      if (fr.gapBefore > 0) line.append(' ');
      const it = L.list[fr.itemIndex];
      const sp = h('span', it.cls || null); sp.style.font = it.font; sp.textContent = fr.text;
      let node = sp;
      for (let k = it.chain.length - 1; k >= 0; k--) {
        const src = it.chain[k]; const cl = src.cloneNode(false);
        if (linkFirst.has(src)) { cl.removeAttribute('id'); if (cl.tagName === 'A') cl.tabIndex = -1; cl.dataset.reCont = ''; }
        else linkFirst.set(src, 1);
        cl.append(node); node = cl;
      }
      line.append(node);
    }
    // keep word boundaries in the text (copy / screen readers) where a Latin line broke at a space
    if (!L.last && /[\x21-\x7e\u00c0-\u024f]$/.test(line.textContent)) line.append(' ');
    if (L.marker) { const mk = h('span', 're-mk', { 'aria-hidden': 'true', text: L.marker }); mk.style.cssText = `left:${(L.colX + L.padL - L.u.T.size * 1.6).toFixed(1)}px;top:${L.y}px;line-height:${L.lh}px`; L.u.el.append(mk); }
    L.u.el.append(line); n++;
  }
  for (const d of res.out.dcs || []) {
    const m = d.rect.m, dc = h('span', 're-dc', { text: d.u.dcChar });
    dc.style.cssText = `left:${(d.rect.x + m.left).toFixed(2)}px;top:${(d.rect.y + m.top).toFixed(2)}px;font-size:${m.size.toFixed(2)}px;line-height:${m.size.toFixed(2)}px`;
    d.u.el.prepend(dc);
  }
  drawRules(band, H);
  band.el.style.height = H + 'px';
  band.lines = n;
  // place figures
  for (const ob of band.obstacles) if (ob.el) { ob.el.style.left = ob.x + 'px'; ob.el.style.top = ob.y + 'px'; }
  return n;
}

// hairline column rules, interrupted wherever a figure or the moon crosses the gutter
function drawRules(band, H) {
  let box = band.rules; if (!box) { box = band.rules = h('div', 're-rules', { 'aria-hidden': 'true' }); }
  if (box.parentNode !== band.el) band.el.prepend(box);
  const segs = [];
  for (let c = 1; c < band.cols; c++) {
    const x = c * (band.colW + band.gutter) - band.gutter / 2;
    let parts = [[0, H]];
    for (const ob of band.obstacles) {
      const x0 = ob.x - 6, x1 = ob.x + ob.w + 6; if (x < x0 || x > x1) continue;
      const y0 = ob.y - 14, y1 = ob.y + ob.h + (ob.cap ? ob.cap.h : 0) + 14;
      parts = parts.flatMap(([a, b]) => (y1 <= a || y0 >= b) ? [[a, b]] : [[a, y0], [y1, b]].filter(([p, q]) => q - p > 24));
    }
    for (const [a, b] of parts) segs.push(`<i style="left:${x.toFixed(1)}px;top:${a.toFixed(0)}px;height:${(b - a).toFixed(0)}px"></i>`);
  }
  box.innerHTML = segs.join('');
}

/* ---------- page layout ---------- */
function columnsFor(w) { return w >= 900 ? 3 : w >= 600 ? 2 : 1; }
function layoutPage(i) {
  const p = S.pages[i]; if (!p) return;
  const bodyW = p.body.clientWidth;
  const cols = columnsFor(bodyW);
  p.cols = cols; p.w = bodyW; p.laid = true; p.moon = 0;
  let lines = 0;
  qsa('.re-run', p.body).forEach(runEl => { lines += layoutRun(runEl._run, bodyW, cols, p); });
  p.lines = lines; S.linesSet = S.pages.reduce((a, q) => a + (q.lines || 0), 0);
  setStat('lines', cols === 1 ? '流式 · 单栏' : `${S.linesSet.toLocaleString('zh-CN')} · ${cols} 栏`);
}
function layoutRun(run, W, cols, p) {
  const el = run.el;
  // tear down
  el.replaceChildren(); el.classList.toggle('re-flow', cols === 1);
  if (cols === 1) {
    for (const b of run.blocks) { if (b.kind === 'prose') b.units.forEach(restoreUnit); el.append(b.el); if (b.kind === 'figure') { b.el.classList.remove('re-ob'); b.el.style.cssText = ''; qs('.re-plate-img', b.el)?.style.removeProperty('height'); } }
    // single column: a CSS drop cap (initial-letter) on the story's opening paragraph
    const story = el.closest('.re-story'), firstRun = el.parentElement && el === qs('.re-run', el.parentElement);
    const fb = run.blocks.find(b => b.kind === 'prose'), fu = fb && fb.units[0];
    if (firstRun && fu && fu.type === 'p' && fb === run.blocks[0] && story && (story === qs('.re-story', story.parentElement) || story.querySelector(':scope > h2.re-hl'))) fu.el.classList.add('re-dropflow');
    return 0;
  }
  const gutter = 30, colW = (W - gutter * (cols - 1)) / cols;
  const capH = Math.max(320, Math.min(innerHeight * 0.82, 760));
  const bands = []; let band = null, est = 0;
  const newBand = () => { band = { el: h('div', 're-band'), blocks: [], obstacles: [], cols, colW, gutter, W }; band.el._band = band; bands.push(band); est = 0; };
  let leadDone = !el.closest('.re-leadstory') || el.previousElementSibling?.classList.contains('re-run');
  run.blocks.forEach((b, bi) => {
    if (b.kind === 'figure') {
      const next = run.blocks[bi + 1];
      if (cols < 3 || !next || next.kind !== 'prose') { if (band && band.blocks.length) band = null; const s = h('div', 're-band re-figrow'); s.append(b.el); b.el.classList.remove('re-ob'); b.el.style.cssText = ''; bands.push({ el: s, solid: 1 }); band = null; return; }
      newBand();
      const fw = colW * 2 + gutter;
      b.el.classList.add('re-ob'); b.el.style.width = fw + 'px';
      band.el.append(b.el);
      band.blocks.push(b);
      const ob = { el: b.el, x: colW + gutter, y: 0, w: fw, h: 0, pad: 12, shape: 'rect' };
      if (b.pos && b.pos.W === W) { ob.x = b.pos.x; ob.y = b.pos.y; }
      band.obstacles.push(ob); b.ob = ob; ob.band = band;
      est += 0;
      return;
    }
    b.units.forEach(u => { u.dropcap = false; u.noIndent = false; });
    if (!band || (est > capH * cols * 0.9 && band.blocks.some(x => x.kind === 'prose'))) newBand();
    band.blocks.push(b); band.el.append(b.el);
    b.units.forEach(u => { prepUnitFresh(u); est += estimate(u, colW); });
  });
  // drop cap + no-indent on the first paragraph of each story's first run
  const firstRun = el.parentElement && el === qs('.re-run', el.parentElement);
  if (firstRun) {
    const fb = bands.find(bd => !bd.solid && bd.blocks.some(x => x.kind === 'prose'));
    const fu = fb && fb.blocks.find(x => x.kind === 'prose')?.units[0];
    const story = el.closest('.re-story');
    const firstOfPage = story && story === qs('.re-story', story.parentElement);
    if (fu && fu.type === 'p') { fu.noIndent = true; if (firstOfPage || (story && story.querySelector(':scope > h2.re-hl'))) { fu.dropcap = true; prepUnitFresh(fu); } }
  }
  // the moon ornament in the lead story (page 1) — a circle the text flows around on both sides
  if (cols === 3 && firstRun && !p.moon) {
    const fb = bands.find(bd => !bd.solid && !bd.obstacles.length && bd.blocks.reduce((a, x) => a + (x.units ? x.units.reduce((q, u) => q + u.orig.textContent.length, 0) : 0), 0) > 900);
    if (fb && S.pages.indexOf(p) === 0) { addMoonOrnament(fb); p.moon = 1; }
  }
  let lines = 0;
  for (const bd of bands) { el.append(bd.el); if (!bd.solid) { measureObstacles(bd); lines += renderBand(bd); } }
  run.bands = bands;
  return lines;
}
function prepUnitFresh(u) { if (!u.prep || u._dcState !== !!u.dropcap) { u.prep = null; prepUnit(u); u._dcState = !!u.dropcap; } }
function estimate(u, colW) { const chars = u.el.textContent.length || u.orig.textContent.length; return Math.ceil(chars * u.T.size / colW + 0.5) * u.T.lh + u.T.gap; }
function restoreUnit(u) { u.el.replaceChildren(...u.orig.cloneNode(true).childNodes); }
function measureObstacles(band) {
  for (const ob of band.obstacles) {
    if (!ob.el) continue;
    if (ob.moon) continue;
    const img = ob.el._img; const ar = img && img.naturalWidth ? img.naturalHeight / img.naturalWidth : (img && +img.getAttribute('height') / +img.getAttribute('width')) || 0.6;
    const pw = ob.w; ob.el.style.width = pw + 'px';
    if (img && img.naturalWidth) ob.el._ar = 1;
    const plate = qs('.re-plate-img', ob.el); if (plate) plate.style.height = Math.round(pw * ar) + 'px';
    // measure once per size; reading offsetHeight on every drag frame would force layout each time
    if (ob._mw !== pw || ob._mar !== ar) { ob._mh = ob.el.offsetHeight || Math.round(pw * ar + 40); ob._mw = pw; ob._mar = ar; }
    ob.h = ob._mh;
    ob.x = clamp(ob.x, 0, band.W - ob.w); ob.y = Math.max(0, ob.y);
  }
}
function relayoutBandOf(el) { const bandEl = el.closest('.re-band'); const band = bandEl && bandEl._band; if (!band) return; measureObstacles(band); renderBand(band); }

/* ---------- moon ---------- */
function moonPhase(date = new Date()) {
  const syn = 29.530588853, ref = Date.UTC(2000, 0, 6, 18, 14) / 864e5;
  const age = ((date / 864e5 - ref) % syn + syn) % syn; const ph = age / syn;
  return { ph, illum: (1 - Math.cos(ph * 2 * Math.PI)) / 2, waxing: ph < 0.5 };
}
function addMoonOrnament(band) {
  const size = Math.round(Math.min(168, band.colW * 0.62));
  const fig = h('figure', 're-moonfig re-ob');
  fig.tabIndex = 0;
  const mp = moonPhase();
  fig.setAttribute('aria-label', `装饰插图：今夜月相，亮面约 ${Math.round(mp.illum * 100)}%。可用方向键或拖动移动，正文随之重排`);
  const cv = h('canvas', 're-mooncv', { 'aria-hidden': 'true' }); cv.style.width = cv.style.height = size + 'px';
  const cap = h('figcaption', '', { 'aria-hidden': 'true', text: `今夜月相 · 亮面 ${Math.round(mp.illum * 100)}%${mp.waxing ? ' · 盈' : ' · 亏'}` });
  fig.append(cv, cap); fig._moon = cv; fig.style.width = size + 'px';
  band.el.append(fig);
  // straddle the gutter between columns 2 and 3 so the text runs on both sides
  const ob = { el: fig, moon: 1, x: band.colW * 2 + band.gutter * 1.5 - size / 2, y: Math.round(band.colW * 0.5), w: size, h: size, pad: 10, shape: 'circle', band };
  ob.cap = { w: Math.min(size + 40, band.colW), h: 30 };
  cap.style.cssText = `position:absolute;left:50%;top:${size + 4}px;width:${ob.cap.w}px;transform:translateX(-50%);margin:0 !important`;
  band.obstacles.push(ob); fig._ob = ob;
  band.blocks.push({ kind: 'orn', el: fig, ob });
  requestAnimationFrame(() => drawMoon(cv, size, mp));
}
function hash2(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi; const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return (hash2(xi, yi) * (1 - u) + hash2(xi + 1, yi) * u) * (1 - v) + (hash2(xi, yi + 1) * (1 - u) + hash2(xi + 1, yi + 1) * u) * v; }
function fbm(x, y) { let a = 0, f = 1, amp = .55; for (let o = 0; o < 4; o++) { a += amp * vnoise(x * f, y * f); f *= 2.03; amp *= .5; } return a; }
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function cssRGB(v) { const c = ctx2d(); c.fillStyle = '#000'; c.fillStyle = v; const x = c.fillStyle; return x[0] === '#' ? [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16)) : (x.match(/\d+/g) || [0, 0, 0]).slice(0, 3).map(Number); }
// A clean, continuous-tone moon: a lit sphere (Lambert, soft terminator, faint maria, gentle limb
// darkening) for tonight's phase. No dithering. Light edition: shadow in deep ink-blue, lit side pale;
// night edition: lit side warm paper-white, shadow barely above the paper with a little earthshine.
function drawMoon(cv, css, mp) {
  const dpr = Math.min(2, devicePixelRatio || 1), n = Math.round(css * dpr); if (!n) return; cv.width = cv.height = n;
  const cs = getComputedStyle(S.sheet || root), dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const blue = cssRGB(cs.getPropertyValue('--re-blue').trim() || '#2434cc'), paper = cssRGB(cs.getPropertyValue('--re-paper').trim() || '#f1eee6');
  const litC = dark ? [236, 231, 219] : [paper[0] * .93 + blue[0] * .07, paper[1] * .93 + blue[1] * .07, paper[2] * .93 + blue[2] * .07];
  const mariaC = dark ? [176, 172, 165] : [blue[0] * .3 + paper[0] * .7, blue[1] * .3 + paper[1] * .7, blue[2] * .3 + paper[2] * .7];
  const darkC = dark ? [paper[0] + 9, paper[1] + 10, paper[2] + 14] : blue.map(v => v * .92);
  const th = mp.ph * 2 * Math.PI, Lx = Math.sin(th), Lz = -Math.cos(th);
  const c = cv.getContext('2d'), id = c.createImageData(n, n), d = id.data;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i + .5) / n * 2 - 1, y = (j + .5) / n * 2 - 1, r2 = x * x + y * y; if (r2 > 1.02) continue;
    const z = Math.sqrt(Math.max(0, 1 - r2)), ndl = x * Lx + z * Lz;
    const lit = smooth(-.035, .085, ndl), limb = .82 + .18 * Math.pow(z, .6);
    const maria = clamp(smooth(.42, .78, fbm(x * 2.1 + 3.1, y * 2.1 - 1.7)) * .85 + (fbm(x * 9 + 9, y * 9) - .5) * .12, 0, 1);
    const k = (o, ch) => { const L = litC[ch] + (mariaC[ch] - litC[ch]) * maria; const lv = L * (.86 + .14 * clamp(ndl * 1.6, 0, 1)) * limb; return darkC[ch] + (lv - darkC[ch]) * lit; };
    const o = (j * n + i) * 4; d[o] = k(o, 0); d[o + 1] = k(o, 1); d[o + 2] = k(o, 2);
    d[o + 3] = 255 * clamp((1 - Math.sqrt(r2)) * n / 2 + .5, 0, 1); // antialiased rim
  }
  c.putImageData(id, 0, 0);
}

/* ---------- dragging figures (live reflow) ---------- */
function bindDrag() {
  let drag = null;
  S.sheet.addEventListener('pointerdown', e => {
    const f = e.target.closest('figure.re-ob'); if (!f || e.button !== 0) return;
    const band = f.closest('.re-band')?._band; const ob = band && band.obstacles.find(o => o.el === f); if (!ob) return;
    drag = { f, band, ob, sx: e.clientX, sy: e.clientY, ox: ob.x, oy: ob.y, moved: false, id: e.pointerId };
    f.setPointerCapture(e.pointerId); e.preventDefault();
  });
  let pend = 0;
  S.sheet.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved) { drag.moved = true; drag.f.classList.add('re-dragging'); root.classList.add('re-grabbing'); }
    drag.ob.x = clamp(drag.ox + dx, 0, drag.band.W - drag.ob.w);
    drag.ob.y = clamp(drag.oy + dy, 0, Math.max(0, parseFloat(drag.band.el.style.height) - drag.ob.h * 0.35));
    if (!pend) pend = requestAnimationFrame(() => { pend = 0; if (drag) { renderBand(drag.band, true); remember(drag); } });
  });
  const end = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null; root.classList.remove('re-grabbing'); d.f.classList.remove('re-dragging');
    if (!d.moved && !d.ob.moon) openLightbox(d.f);
    else { renderBand(d.band); remember(d); }
  };
  S.sheet.addEventListener('pointerup', end); S.sheet.addEventListener('pointercancel', end);
  S.sheet.addEventListener('keydown', e => {
    const f = e.target.closest && e.target.closest('figure.re-fig, figure.re-moonfig'); if (!f || e.target !== f) return;
    if (e.key === 'Enter' || e.key === ' ') { if (!f._moon) { e.preventDefault(); openLightbox(f); } return; }
    const band = f.closest('.re-band')?._band; const ob = band && band.obstacles.find(o => o.el === f); if (!ob) return;
    const st = e.shiftKey ? 48 : 12; const mv = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key]; if (!mv) return;
    e.preventDefault(); e.stopPropagation();
    ob.x = clamp(ob.x + mv[0], 0, band.W - ob.w); ob.y = clamp(ob.y + mv[1], 0, parseFloat(band.el.style.height));
    renderBand(band, true); remember({ f, ob, band });
  });
}
function remember(d) { const blk = d.band.blocks.find(b => b.el === d.f); if (blk) blk.pos = { x: d.ob.x, y: d.ob.y, W: d.band.W }; }

/* ---------- lightbox ---------- */
let lb;
function openLightbox(f) {
  const img = f._img; if (!img) return;
  if (!lb) {
    lb = h('dialog', 're-lb', { 'aria-label': '大图' });
    lb.innerHTML = '<button type="button" class="re-lb-x" aria-label="关闭">×</button><img alt=""><p></p>';
    lb.addEventListener('click', e => { if (e.target === lb || e.target.closest('.re-lb-x')) lb.close(); });
    D.body.append(lb);
  }
  qs('img', lb).src = img.currentSrc || img.src; qs('img', lb).alt = img.alt;
  const cap = qs('figcaption', f); qs('p', lb).textContent = cap ? cap.textContent.replace(/^图 (\d+)/, '图 $1 — ') : '';
  lb.showModal(); lb._from = f;
  lb.addEventListener('close', () => lb._from && lb._from.focus(), { once: true });
}

/* ---------- pages & turning ---------- */
function showPage(i) {
  S.pages.forEach((p, k) => { if (k === i) { p.el.hidden = false; p.el.removeAttribute('hidden'); } else p.el.setAttribute('hidden', 'until-found'); });
  S.cur = i;
  const nx = S.pages[i + 1];
  S.corner.hidden = !nx;
  S.corner.setAttribute('aria-label', nx ? `翻到第 ${nx.folio} 版：${nx.title}` : '');
  setStat('pages', `${S.pages[i].folio} / ${S.pages.length}`);
  updateControls();
}
function pageOf(el) { if (!el) return -1; return S.pages.findIndex(p => p.el.contains(el)); }
function safeTarget(hash) { try { return D.getElementById(decodeURIComponent(hash.slice(1))); } catch (e) { return null; } }
let turning = false;
async function turnTo(i, opt = {}) {
  if (i < 0 || i >= S.pages.length || i === S.cur || turning) return;
  turning = true;
  const fwd = i > S.cur, animate = opt.animate !== false && !RM.matches;
  let overlay = null;
  if (animate) overlay = snapshotOverlay();
  showPage(i);
  if (!S.pages[i].laid || S.pages[i].w !== S.pages[i].body.clientWidth) layoutPage(i);
  const top = S.sheet.getBoundingClientRect().top + scrollY - 12;
  if (!opt.keepScroll) scrollTo({ top: Math.max(0, top), behavior: 'instant' });
  if (overlay) await rollAway(overlay, fwd);
  else if (opt.animate !== false && RM.matches) { S.sheet.animate([{ opacity: .55 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' }); }
  turning = false;
  if (opt.focus !== false) { const p = S.pages[i].el; p.tabIndex = -1; p.focus({ preventScroll: true }); }
}
function snapshotOverlay() {
  const r = S.sheet.getBoundingClientRect();
  const vx = Math.max(0, r.left), vy = Math.max(0, r.top), vw = Math.min(innerWidth, r.right) - vx, vh = Math.min(innerHeight, r.bottom) - vy;
  const ov = h('div', 're-turn', { 'aria-hidden': 'true' });
  ov.style.cssText = `left:${vx}px;top:${vy}px;width:${vw}px;height:${vh}px`;
  const paper = h('div', 're-turn-paper');
  const clone = S.sheet.cloneNode(true); clone.removeAttribute('id'); clone.classList.add('re-clone');
  qsa('[id]', clone).forEach(e => e.removeAttribute('id'));
  const srcC = qsa('canvas', S.sheet), dstC = qsa('canvas', clone);
  dstC.forEach((c, k) => { const s = srcC[k]; if (s && s.width) { c.width = s.width; c.height = s.height; c.getContext('2d').drawImage(s, 0, 0); } });
  clone.style.cssText = `position:absolute;left:${r.left - vx}px;top:${r.top - vy}px;width:${r.width}px;margin:0`;
  paper.append(clone, h('div', 're-lift')); ov.append(h('div', 're-cast'), paper, h('div', 're-roll'));
  D.body.append(ov);
  return ov;
}
function rollAway(ov, fwd) {
  // The old page rolls up from its leading edge into a soft cylinder that travels across and away.
  // Timing: a slow lift, then the roll gathers pace and eases out (≈820 ms). Shading is a matte
  // cylinder (no specular), plus the paper just ahead of the roll darkening as it lifts, and a soft
  // contact shadow cast on the page being revealed.
  const W = ov.clientWidth, paper = qs('.re-turn-paper', ov), roll = qs('.re-roll', ov), lift = qs('.re-lift', ov), cast = qs('.re-cast', ov);
  const dur = 820, ease = 'cubic-bezier(.58,.02,.22,1)';
  if (!fwd) ov.classList.add('rev');
  const o = { duration: dur, easing: ease, fill: 'forwards' };
  const R = 21, at = (p) => fwd ? W * (1 - p) : W * p; // x of the roll's axis at progress p
  const a1 = paper.animate(fwd ? [{ clipPath: 'inset(0 0 0 0)' }, { clipPath: `inset(0 ${W}px 0 0)` }] : [{ clipPath: 'inset(0 0 0 0)' }, { clipPath: `inset(0 0 0 ${W}px)` }], o);
  const tr = (p, s) => `translateX(${(at(p) - R).toFixed(1)}px) scaleX(${s})`;
  roll.animate([{ transform: tr(0, .35), opacity: 0 }, { transform: tr(.06, .7), opacity: 1, offset: .08 }, { transform: tr(.92, 1), opacity: 1, offset: .9 }, { transform: tr(1, 1), opacity: 0 }], o);
  const lt = p => `translateX(${(fwd ? at(p) - R - 90 : at(p) + R).toFixed(1)}px)`;
  lift.animate([{ transform: lt(0), opacity: 0 }, { transform: lt(.06), opacity: 1, offset: .08 }, { transform: lt(.92), opacity: 1, offset: .9 }, { transform: lt(1), opacity: 0 }], o);
  const ct = p => `translateX(${(fwd ? at(p) + R - 6 : at(p) - R - 64).toFixed(1)}px)`;
  cast.animate([{ transform: ct(0), opacity: 0 }, { transform: ct(.06), opacity: .9, offset: .08 }, { transform: ct(.9), opacity: .7, offset: .9 }, { transform: ct(1), opacity: 0 }], o);
  return a1.finished.then(() => ov.remove(), () => ov.remove());
}

/* ---------- fold / unfold ---------- */
function foldOverlay() {
  const r = S.sheet.getBoundingClientRect();
  const vh = Math.min(r.height, innerHeight - Math.max(0, r.top) - 24), W = r.width, half = W / 2;
  const ov = h('div', 're-fold');
  ov.style.cssText = `left:${r.left}px;top:${Math.max(0, r.top)}px;width:${W}px;height:${vh}px`;
  const mk = () => { const c = S.sheet.cloneNode(true); c.removeAttribute('id'); c.classList.add('re-clone'); qsa('[id]', c).forEach(e => e.removeAttribute('id'));
    const sc = qsa('canvas', S.sheet), dc = qsa('canvas', c); dc.forEach((cv, k) => { const s = sc[k]; if (s && s.width) { cv.width = s.width; cv.height = s.height; cv.getContext('2d').drawImage(s, 0, 0); } });
    c.style.cssText = `position:absolute;left:0;top:${Math.min(0, r.top)}px;width:${W}px;margin:0`; return c; };
  const left = h('div', 're-fold-left'); left.append(mk());
  const flap = h('div', 're-fold-flap');
  const back = h('div', 're-face re-back'); const show = mk(); show.classList.add('re-showthrough'); show.style.transformOrigin = `${half}px 0`; show.style.transform = 'scaleX(-1)'; back.append(show, h('div', 're-shade'));
  const front = h('div', 're-face re-front'); const fr = mk(); fr.style.left = -half + 'px'; front.append(fr, h('div', 're-shade'));
  flap.append(back, front);
  left.append(h('div', 're-castshadow'));
  ov.append(left, flap);
  return { ov, W, half, vh };
}
function foldIntro() {
  return new Promise(resolve => {
    scrollTo({ top: 0, behavior: 'instant' });
    const F = foldOverlay();
    const btn = h('button', 're-unfold', { type: 'button', 'aria-label': '展开这份报纸（回车、空格、点按或滚动）' });
    btn.style.cssText = `left:${F.ov.style.left};top:${F.ov.style.top};width:${F.half}px;height:${F.vh}px`;
    const hint = h('p', 're-hint', { 'aria-hidden': 'true', text: '轻点展开 · 按 H 显示/隐藏控制' });
    root.classList.add('re-folded');
    F.ov.style.transform = `translateX(${F.half / 2}px)`; btn.style.transform = `translateX(${F.half / 2}px)`;
    D.body.append(F.ov, btn, hint);
    btn.focus({ preventScroll: true });
    let done = false;
    const go = () => {
      if (done) return; done = true;
      ['wheel', 'touchmove', 'keydown'].forEach(t => removeEventListener(t, onAny, true));
      btn.remove(); hint.classList.add('out');
      sessionStorage.setItem('re-opened:' + location.pathname, '1');
      unfold(F).then(() => { hint.remove(); resolve(); });
    };
    const onAny = e => { if (e.type === 'keydown' && /^(Tab|Shift|Alt|Control|Meta|h|H)$/.test(e.key)) return; if (e.cancelable) e.preventDefault(); go(); };
    btn.addEventListener('click', go);
    ['wheel', 'touchmove', 'keydown'].forEach(t => addEventListener(t, onAny, { capture: true, passive: false }));
  });
}
function unfold(F, reverse) {
  // The flap swings over its hinge, lands, and settles with a small paper-like rebound. Shading
  // follows the angle to the light: each face darkens as it turns edge-on (~90°), the left half
  // takes the flap's shadow while it is raised, and nothing ever glows.
  const dur = 1380;
  const flap = qs('.re-fold-flap', F.ov);
  const o = { duration: dur, fill: 'forwards', direction: reverse ? 'reverse' : 'normal' };
  const E = EASE.paper, S2 = EASE.settle;
  const anims = [
    flap.animate([{ transform: 'rotateY(0deg)', easing: E }, { transform: 'rotateY(180deg)', offset: .8, easing: 'cubic-bezier(.25,.6,.4,1)' }, { transform: 'rotateY(176.2deg)', offset: .89, easing: S2 }, { transform: 'rotateY(180deg)' }], o),
    F.ov.animate([{ transform: `translateX(${F.half / 2}px)`, easing: E }, { transform: 'translateX(0)', offset: .8 }, { transform: 'translateX(0)' }], o),
    qs('.re-back .re-shade', F.ov).animate([{ opacity: 0, easing: 'ease-in' }, { opacity: .34, offset: .4 }, { opacity: .34 }], o),
    qs('.re-front .re-shade', F.ov).animate([{ opacity: .3 }, { opacity: .3, offset: .4, easing: 'ease-out' }, { opacity: .02, offset: .8 }, { opacity: .07, offset: .89 }, { opacity: 0 }], o),
    qs('.re-castshadow', F.ov).animate([{ opacity: .5, easing: 'ease-in' }, { opacity: .22, offset: .42 }, { opacity: 0, offset: .8 }, { opacity: .05, offset: .89 }, { opacity: 0 }], o),
  ];
  return anims[0].finished.then(() => { if (!reverse) { F.ov.remove(); root.classList.remove('re-folded'); } });
}
async function foldUp() {
  if (RM.matches || turning || NARROW()) return;
  scrollTo({ top: 0, behavior: 'smooth' }); await new Promise(r => setTimeout(r, 380));
  const F = foldOverlay(); root.classList.add('re-folded'); D.body.append(F.ov);
  await unfold(F, true);
  const btn = h('button', 're-unfold', { type: 'button', 'aria-label': '再次展开报纸' });
  btn.style.cssText = `left:${F.ov.style.left};top:${F.ov.style.top};width:${F.half}px;height:${F.vh}px;transform:translateX(${F.half / 2}px)`;
  D.body.append(btn); btn.focus();
  btn.addEventListener('click', () => { btn.remove(); unfold(F); }, { once: true });
}

/* ---------- controls (H) ---------- */
function controls() {
  const c = h('nav', 're-ctl', { 'aria-label': '阅读控制' });
  c.innerHTML = `<button type="button" data-a="prev" aria-label="上一版">←</button>
<label class="re-sel"><span class="sr">版面</span><select data-a="go"></select></label>
<button type="button" data-a="next" aria-label="下一版">→</button>
<button type="button" data-a="fold" title="把报纸折起来">折起</button>
<button type="button" data-a="hide" aria-label="隐藏控制（H）" title="隐藏（H）">×</button>`;
  const sel = qs('select', c);
  S.pages.forEach((p, i) => sel.append(h('option', '', { value: i, text: `${p.folio} · ${p.title.slice(0, 28)}` })));
  c.addEventListener('click', e => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'prev') turnTo(S.cur - 1); else if (a === 'next') turnTo(S.cur + 1);
    else if (a === 'fold') foldUp(); else if (a === 'hide') toggleCtl(false);
  });
  sel.addEventListener('change', () => turnTo(+sel.value));
  const hint = h('p', 're-ctl-hint', { 'aria-hidden': 'true', text: '按 H 显示控制' });
  D.body.append(c, hint); S.ctl = c; S.ctlHint = hint;
  if (localStorage.getItem('re-ctl') === 'off') toggleCtl(false);
}
function toggleCtl(on) { on = on ?? root.classList.contains('re-ctl-off'); root.classList.toggle('re-ctl-off', !on); localStorage.setItem('re-ctl', on ? 'on' : 'off'); }
function updateControls() { if (!S.ctl) return; qs('select', S.ctl).value = S.cur; qs('[data-a=prev]', S.ctl).disabled = S.cur === 0; qs('[data-a=next]', S.ctl).disabled = S.cur === S.pages.length - 1; }

/* ---------- global bindings ---------- */
function bindGlobal() {
  bindDrag();
  // corner: click / drag to turn
  let cd = null;
  S.corner.addEventListener('pointerdown', e => { cd = { x: e.clientX, y: e.clientY, id: e.pointerId }; S.corner.setPointerCapture(e.pointerId); });
  S.corner.addEventListener('pointermove', e => { if (!cd) return; const d = clamp(Math.hypot(e.clientX - cd.x, e.clientY - cd.y), 0, 160); S.corner.style.setProperty('--peel', d + 'px'); });
  S.corner.addEventListener('pointerup', e => { if (!cd) return; cd = null; S.corner.style.removeProperty('--peel'); turnTo(S.cur + 1); });
  S.corner.addEventListener('pointercancel', () => { cd = null; S.corner.style.removeProperty('--peel'); });
  S.corner.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); turnTo(S.cur + 1); } });
  // keyboard
  addEventListener('keydown', e => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || /INPUT|SELECT|TEXTAREA/.test(D.activeElement?.tagName) || root.classList.contains('re-folded')) return;
    if (e.key === 'h' || e.key === 'H') { toggleCtl(); }
    else if (e.key === 'ArrowRight' && !e.target.closest?.('figure')) { if (nearBottom()) turnTo(S.cur + 1); }
    else if (e.key === 'ArrowLeft' && !e.target.closest?.('figure')) { if (scrollY < S.sheet.offsetTop + 40) turnTo(S.cur - 1); }
    else if ((e.key === 'PageDown' || e.key === ' ') && nearBottom(4) && S.cur < S.pages.length - 1) { e.preventDefault(); turnTo(S.cur + 1); }
  });
  // in-page anchors across pages
  D.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]'); if (!a) return;
    const t = safeTarget(a.getAttribute('href')); const pi = pageOf(t); if (pi < 0) return;
    if (pi !== S.cur) { e.preventDefault(); turnTo(pi, { animate: false, focus: false, keepScroll: true }).then(() => { t.scrollIntoView(); history.pushState(null, '', a.getAttribute('href')); }); }
  });
  addEventListener('hashchange', () => { const t = safeTarget(location.hash); const pi = pageOf(t); if (pi >= 0 && pi !== S.cur) turnTo(pi, { animate: false, focus: false, keepScroll: true }).then(() => t.scrollIntoView()); });
  // find-in-page (hidden=until-found)
  S.pages.forEach((p, i) => p.el.addEventListener('beforematch', () => { if (i !== S.cur) { showPage(i); if (!p.laid) layoutPage(i); } }));
  // resize → re-set type
  let rw = S.sheet.clientWidth, pend = 0;
  new ResizeObserver(() => { if (pend) return; pend = requestAnimationFrame(() => { pend = 0; const w = S.sheet.clientWidth; if (Math.abs(w - rw) < 1) return; rw = w; S.pages.forEach(p => p.laid = false); layoutPage(S.cur); }); }).observe(S.sheet);
  D.fonts.addEventListener && D.fonts.addEventListener('loadingdone', () => { S.pages.forEach(p => { p.laid = false; qsa('.re-run', p.el).forEach(r => r._run.blocks.forEach(b => b.units && b.units.forEach(u => u.prep = null))); }); layoutPage(S.cur); });
  addEventListener('scroll', () => { if (!statPend) statPend = requestAnimationFrame(() => { statPend = 0; readStat(); }); }, { passive: true });
  addEventListener('beforeprint', () => S.pages.forEach(p => p.el.removeAttribute('hidden')));
  addEventListener('afterprint', () => showPage(S.cur));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => requestAnimationFrame(() => { if (S.plateMoon) drawMoon(S.plateMoon, S.plateMoon._css, moonPhase()); qsa('.re-moonfig', S.sheet).forEach(f => drawMoon(f._moon, parseFloat(f._moon.style.width), moonPhase())); }));
}
function nearBottom(px = 140) { return innerHeight + scrollY >= S.sheet.getBoundingClientRect().bottom + scrollY - px; }

/* ---------- live stats ---------- */
let statPend = 0;
function setStat(id, v) { const e = D.getElementById('re-st-' + id); if (e) e.textContent = v; }
function readStat() {
  S.pages.forEach(p => { if (p.len == null) p.len = p.el.textContent.length; });
  const tot = S.pages.reduce((a, p) => a + p.len, 0) || 1;
  const before = S.pages.slice(0, S.cur).reduce((a, p) => a + p.len, 0);
  const r = S.sheet.getBoundingClientRect(); const frac = clamp((innerHeight - r.top) / r.height, 0, 1);
  setStat('read', Math.round((before + frac * S.pages[S.cur].len) / tot * 100) + '%');
}
function tickStats() {
  const mp = moonPhase();
  setStat('moon', Math.round(mp.illum * 100) + '%' + (mp.waxing ? ' 盈' : ' 亏'));
  setStat('figs', S.figN ? `${S.figN} 幅` : '无');
  const chars = S.chars;
  setStat('chars', chars > 10000 ? (chars / 10000).toFixed(1) + ' 万' : chars.toLocaleString('zh-CN'));
  readStat();
  const pm = S.plateMoon; if (pm) { const css = Math.round(parseFloat(getComputedStyle(pm).width) || 80); pm._css = css; pm.style.height = css + 'px'; drawMoon(pm, css, mp); }
  const t = () => { const s = Math.floor((performance.now() - S.t0) / 1000); setStat('since', `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`); };
  t(); setInterval(t, 1000);
}
