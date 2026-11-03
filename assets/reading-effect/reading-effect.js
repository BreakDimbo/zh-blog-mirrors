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
// 12345 → "12,345" (what toLocaleString('zh-CN') gives for integers, without its first-call cost)
const group3 = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const raf = () => new Promise(r => requestAnimationFrame(() => r()));

/* ---------- type scale (must match reading-effect.css) ---------- */
const SERIF = '"Geist Serif", "Noto Serif SC", "Source Han Serif SC", "Songti SC", serif';
const MONO = '"Geist Mono", ui-monospace, Menlo, Consolas, monospace';
// readable long-form CJK: 17px body on a 31px line (1.82), captions ≥ 13.5px, a clear head scale
const BODY = { size: 17, lh: 31 };
const TYPES = {
  p: { size: 17, lh: 31, gap: 10, indent: 2 },
  caption: { size: 13.5, lh: 23, gap: 6, indent: 0, mute: 1 },
  h3: { size: 21, lh: 32, gap: 26, indent: 0, head: 1 },
  h4: { size: 18, lh: 30, gap: 18, indent: 0, head: 1 },
  li: { size: 17, lh: 31, gap: 5, indent: 0, pad: 1.6 },
  q: { size: 16.5, lh: 30, gap: 8, indent: 0, pad: 1.3, quote: 1 },
};
const INLINE_OK = new Set(['A', 'STRONG', 'B', 'EM', 'I', 'CODE', 'SUP', 'SUB', 'BR', 'SPAN', 'SMALL', 'MARK', 'ABBR', 'TIME', 'KBD', 'U', 'S', 'DEL', 'INS', 'Q', 'CITE', 'DFN', 'VAR', 'SAMP', 'WBR']);
const NARROW = () => innerWidth < 640;
const EASE = { paper: 'cubic-bezier(.6,.02,.28,1)', out: 'cubic-bezier(.2,.7,.2,1)', settle: 'cubic-bezier(.3,0,.4,1)' };

/* ---------- boot ---------- */
const page = qs('.za-page'), content = qs('.za-content'), headEl = qs('.za-head'), footEl = qs('.za-foot');
const off = !page || !content || D.body.hasAttribute('data-re-off') || /[?&]re=off\b/.test(location.search);
if (off) root.classList.remove('re-js'); else boot().catch(err => { console.error('[reading-effect]', err); root.classList.remove('re-js', 're-on', 're-prep'); });

const S = { pages: [], cur: 0, cols: 0, sheetW: 0, linesSet: 0, t0: performance.now(), figN: 0 };

async function boot() {
  await fontsReady();
  build();
  // re-prep: the sheet is laid out but not shown yet (and the page keeps its loading look), so the
  // first screen and the folded paper can be prepared over several short tasks and then appear together
  root.classList.add('re-on', 're-prep');
  const hashPage = location.hash ? pageOf(safeTarget(location.hash)) : -1;
  S.cur = hashPage >= 0 ? hashPage : 0;
  showPage(S.cur);
  const fold = hashPage < 0 && !RM.matches && !sessionStorage.getItem('re-opened:' + location.pathname);
  await yieldTask();
  chunkSolids();
  await yieldTask();
  // set the first screen (in slices); the rest of the page follows in small slices so nothing blocks for long
  const job = layoutPage(S.cur, { sliced: true, prep: true });
  await job.shown;
  bindGlobal();
  tickStats();
  let F = null;
  if (fold) { scrollTo({ top: 0, behavior: 'instant' }); F = foldOverlay(false, await foldSnaps()); scrollTo({ top: 0, behavior: 'instant' }); }
  root.classList.remove('re-prep'); root.classList.add('re-ready');
  job.done.then(() => { idle(prelayoutNeighbours); warmPage(); });
  if (hashPage >= 0) { await job.done; const t = safeTarget(location.hash); t && t.scrollIntoView(); }
  else if (F) await foldInteract(F);
  else requestAnimationFrame(() => developVisible(true));
}
// After a page is set, quiet moments are used to get ahead: the plates' tone fields are computed and the
// deferred children of very large blocks (data-re-cv) are laid out in small batches, so a later scroll or a
// jump to the end does not have to lay out thousands of boxes at once. Never while the reader is scrolling,
// turning or unfolding, nor while a plate is printing in, nor for a while after any input or motion has ended.
const busy = () => turning || S.foldAnim || S.devN > 0 || performance.now() - Math.max(S.lastInput || 0, S.calmAt || 0) < 700;
// (the sheet's own entrance, before the reader has done anything, needs no pause after it)
const calm = () => { if (S.lastInput) S.calmAt = performance.now(); };
function warmPage() {
  const p = S.pages[S.cur]; if (!p || p.warm) return; p.warm = 1;
  // small blocks first, a few per idle period; a block too big to split (a long table) goes last, alone, in a full idle period
  const all = qsa('[data-re-cv]', p.el), big = e => e.getElementsByTagName('*').length >= 400;
  const list = all.filter(e => !big(e)).concat(all.filter(big));
  const plates = (p.mosaics || []).filter(Boolean);
  // the page's pictures for its first screens start loading now (as the old one-pass layout used to start
  // them), so they do not arrive, and re-flow, mid-scroll. Found by an observer (no forced layout); a picture
  // inside a deferred block is found by the block's placeholder box, since its own box is not laid out
  // (only once the reader is idle, so that a page just turned to does not fetch and decode during the turn)
  let eager = 'IntersectionObserver' in window;
  const loadAhead = () => {
    eager = false; const boxes = new Map();
    for (const im of p.el.getElementsByTagName('img')) if (im.loading === 'lazy') { const b = im.closest('[data-re-cv]') || im; (boxes.get(b) || boxes.set(b, []).get(b)).push(im); }
    if (boxes.size) { const io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); boxes.get(e.target).forEach(im => { im.loading = 'eager'; }); } setTimeout(() => io.disconnect(), 0); },
      { rootMargin: `0px 0px ${22 * innerHeight}px 0px` }); boxes.forEach((_, b) => io.observe(b)); }
  };
  let k = 0, pc = 0, fix = 1e9, ok = 0;
  const wt = e => e.textContent.length + 60 * e.getElementsByTagName('*').length + 1;
  const release = e => { e.removeAttribute('data-re-cv'); e.style.removeProperty('contain-intrinsic-size'); if (!e.getAttribute('style')) e.removeAttribute('style'); };
  const step = dl => {
    if (!p.el.isConnected || p.el.hidden) { p.warm = 0; return; }
    if (busy()) return void setTimeout(() => idle(step), 300);
    if (eager) loadAhead();
    const t0 = performance.now(), left = () => (dl.didTimeout ? 6 : Math.min(W.budget, dl.timeRemaining())) - (performance.now() - t0);
    for (const M of plates) if (!M.field && !ensureField(M, performance.now() + 6)) return void idle(step);
    while (k < list.length && left() > 1) {
      if (big(list[k])) { if (!dl.didTimeout && dl.timeRemaining() < 40) break; release(list[k++]); void p.el.offsetHeight; continue; }
      // the cost of a layout follows the boxes and text set; batches are sized from the cost per unit so far,
      // and a block that would not fit what is left of this idle period waits for the next one
      // (while the sheet still lies folded nothing on it moves, so batches may be larger)
      const room = Math.min(folded() ? W.fold : W.hi, left()), t1 = performance.now(); let ch = 0;
      while (k < list.length && !big(list[k])) { const c = wt(list[k]);
        if (ch ? (!pc || fix + (ch + c) * pc > room || ch + c > Math.max(1500, 2 * ok)) : (pc && fix + c * pc > left() && t1 - t0 > 1)) break; ch += c; release(list[k++]); }
      if (!ch) break;
      void p.el.offsetHeight;
      // a layout has a fixed part (the smallest seen) and a part per unit
      const dt = performance.now() - t1; fix = Math.min(fix, dt); const r = Math.max(dt - fix, 0.5) / ch;
      pc = !pc ? r : dt > Math.max(room, 10) * 1.5 ? Math.max(pc, r) : pc * 0.6 + r * 0.4;
      // the estimate is rough (a few blocks cost far more than their size suggests), so a batch grows to at most
      // twice the largest one that has fitted, and shrinks back after one that overran
      if (dt <= room) ok = Math.max(ok, ch); else if (dt > room * 1.5) ok = Math.min(ok, ch / 2);
    }
    if (k < list.length) idle(step);
  };
  idle(step);
}
// idle-time budgets (ms): per idle period, per batch, per batch while the sheet lies folded
const W = { budget: 40, hi: 16, fold: 30 };
const folded = () => root.classList.contains('re-folded');
const idle = fn => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(() => fn({ didTimeout: true, timeRemaining: () => 0 }), 400));
// yield to the browser between slices of work (input and frames get a chance to run)
const yieldTask = () => new Promise(r => (window.scheduler && scheduler.yield ? scheduler.yield().then(r) : setTimeout(r, 0)));
function prelayoutNeighbours() {
  for (const j of [S.cur + 1, S.cur - 1]) { const p = S.pages[j]; if (p && !p.laid) { layoutPage(j, { sliced: true, syncPx: 0 }); return void p.pendingDone.then(() => idle(prelayoutNeighbours)); } }
}
const DARK_MQ = matchMedia('(prefers-color-scheme: dark)'); // one live query (isDark runs every animation frame)
const isDark = () => { const t = root.getAttribute('data-theme'); return t ? t === 'dark' : DARK_MQ.matches; };

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

// many articles keep their whole text in one plain <article>/<main>/<section> wrapper; set as a single
// block it would get no columns, so a bare wrapper that holds most of the text is opened up and its children
// become the page's blocks (text and order unchanged; only the empty wrapper element goes)
function unwrapBare() {
  const total = content.textContent.length || 1;
  for (let pass = 0; pass < 3; pass++) {
    const w = [...content.children].find(el => /^(ARTICLE|MAIN|SECTION|DIV)$/.test(el.tagName) && !el.className && !el.id && !el.attributes.length
      && el.textContent.length > total * 0.6 && el.querySelectorAll(':scope > p, :scope > h2, :scope > h3').length >= 3);
    if (!w) return;
    w.replaceWith(...w.childNodes);
  }
}
function build() {
  unwrapBare();
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
  top.append(h('span', '', { text: `${meta.type || '文章'} · 录像带书店 · READING EDITION` }),
    h('span', 're-quote', { text: meta.sub ? `“${meta.sub.textContent.trim()}”` : '' }),
    h('span', '', { text: cnDate(meta.date) }));
  const plate = h('div', 're-plate', { role: 'presentation' });
  plate.innerHTML = '<span>录像带</span>';
  const moon = h('canvas', 're-moon', { 'aria-hidden': 'true', width: 10, height: 10 });
  plate.append(moon, h('span', '', { text: '书店' }));
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
  r.append(h('span', '', { text: `${folio} · 录像带书店` }),
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
  if (st.h2) { st.h2.classList.add('re-hl'); a.append(st.h2); a.append(h('p', 're-byline', { 'aria-hidden': 'true', text: `第 ${pi + 1} 版 · 第 ${si + 1} 篇 · 录像带书店编辑部` })); }
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
function prepSolid(n) { qsa('figure', n).forEach(f => f.querySelector('img') && prepFigure(f, true)); if (n.tagName === 'FIGURE' && n.querySelector('img')) prepFigure(n, true); if (n.getElementsByTagName('*').length >= CHUNK_MIN) (S.chunkQ || (S.chunkQ = [])).push(n); }
// A whole article kept as one block (some mirrors wrap everything in <article>) would be laid out in one go
// — thousands of boxes — as soon as any of it is near the screen. Its children skip layout and paint until
// they come near instead (content-visibility, like the bands); an estimate holds their place until then.
// Containment must not move anything once a block is on screen, so a child is only deferred when it
// cannot: a plain block (no list marker), whose children's margins do not collapse through its edges, with
// no floats, out-of-flow boxes or counters inside that would reach past it. (Run once the page styles apply.)
const CHUNK_MIN = 300, NO_CHUNK = /^(TABLE|THEAD|TBODY|TFOOT|TR|UL|OL|DL|PRE|SUMMARY|PICTURE|VIDEO|IFRAME|svg|SVG)$/;
function chunkSolids() {
  const q = S.chunkQ || [], marks = []; S.chunkQ = null;
  // margins and paddings are read as computed values (typed OM): the resolved ones getComputedStyle gives
  // would lay the whole page out first. Without typed OM the blocks are simply not deferred.
  if (!q.length || !D.body.computedStyleMap) return;
  q.forEach(n => chunkSolid(n, marks)); // all reads first (one style pass) …
  for (const c of marks) { c.setAttribute('data-re-cv', ''); c.style.setProperty('contain-intrinsic-size', `auto ${chunkEst(c)}px`); } // … then the writes
}
function chunkSafe(c, cs) {
  if (!/^(block|flow-root|flex|grid)$/.test(cs.display) || cs.position === 'fixed' || cs.position === 'sticky' || cs.cssFloat !== 'none') return false;
  if (!c.textContent.trim() && !c.querySelector('img,svg,canvas,video,iframe')) return false;
  const bfc = cs.display !== 'block' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
  // margin/padding as computed: px, or NaN when it depends on layout (a percentage) — treated as a margin that
  // collapses. (Border widths come from getComputedStyle: they need no layout and are 0 when there is no border.)
  const px = (el, prop) => { const v = el.computedStyleMap().get(prop);
    if (v instanceof CSSUnitValue) return v.unit === 'px' || !v.value ? v.value : NaN;
    return v && String(v) === 'auto' && prop.startsWith('margin') ? 0 : NaN; };
  const has = (el, prop) => px(el, prop) !== 0; // non-zero, or unknown
  // a child margin that would collapse through the top or bottom edge
  const through = (el, top, d) => {
    let ch = top ? el.firstElementChild : el.lastElementChild;
    for (let n = top ? el.firstChild : el.lastChild; n; n = top ? n.nextSibling : n.previousSibling) { if (n.nodeType === 3 && n.textContent.trim()) return false; if (n.nodeType === 1) { ch = n; break; } }
    if (!ch) return false; const k = getComputedStyle(ch);
    if (k.display === 'none' || k.position === 'absolute' || k.position === 'fixed' || k.cssFloat !== 'none') return true;
    if (/^inline/.test(k.display)) return false;
    if (has(ch, top ? 'margin-top' : 'margin-bottom')) return true;
    if (px(ch, top ? 'padding-top' : 'padding-bottom') > 0 || parseFloat(top ? k.borderTopWidth : k.borderBottomWidth) > 0 || k.display !== 'block' || k.overflowY !== 'visible') return false;
    return d > 6 || through(ch, top, d + 1);
  };
  if (!bfc && ((!(px(c, 'padding-top') > 0) && !(parseFloat(cs.borderTopWidth) > 0) && through(c, true, 0)) || (!(px(c, 'padding-bottom') > 0) && !(parseFloat(cs.borderBottomWidth) > 0) && through(c, false, 0)))) return false;
  const positioned = cs.position !== 'static';
  for (const e of c.getElementsByTagName('*')) {
    const k = getComputedStyle(e);
    if (k.cssFloat !== 'none' && !bfc) return false;
    if (k.position === 'fixed' || k.position === 'sticky') return false;
    if (k.position === 'absolute' && !positioned) { let a = e.parentElement, ok = false; while (a && a !== c) { if (getComputedStyle(a).position !== 'static') { ok = true; break; } a = a.parentElement; } if (!ok) return false; }
    for (const v of [k.counterReset, k.counterIncrement, k.counterSet]) if (v && v !== 'none' && !/^list-item(\s+-?\d+)?$/.test(v)) return false;
  }
  return true;
}
function chunkSolid(n, marks) {
  if (n.getElementsByTagName('*').length < CHUNK_MIN || NO_CHUNK.test(n.tagName)) return;
  const kids = [...n.children];
  // a float among the children would wrap around a deferred block differently
  if (kids.some(c => getComputedStyle(c).cssFloat !== 'none')) return;
  for (const c of kids) {
    if (c.tagName === 'SUMMARY' || c.tagName === 'SCRIPT' || c.tagName === 'STYLE') continue;
    if (chunkSafe(c, getComputedStyle(c))) marks.push(c);
    if (c.getElementsByTagName('*').length >= CHUNK_MIN && !NO_CHUNK.test(c.tagName) && c.tagName !== 'DETAILS') chunkSolid(c, marks);
  }
}
function chunkEst(c) {
  const img = c.tagName === 'IMG' ? c : c.querySelector('img'), t = c.textContent, W = 1000;
  let cjk = 0; for (let k = 0; k < t.length; k++) if (t.charCodeAt(k) > 0x2e7f) cjk++;
  const em = cjk + (t.length - cjk) * .55, lines = c.tagName === 'PRE' ? t.split('\n').length : Math.ceil(em * 17 / W);
  let hgt = lines * (c.tagName === 'PRE' ? 22 : 30) + 24;
  if (img) { const w = +img.getAttribute('width'), hh = +img.getAttribute('height'); hgt += w && hh ? Math.min(880, w) * hh / w : 360; }
  return Math.round(Math.min(hgt, 6000));
}
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
  if (!img.hasAttribute('decoding')) img.decoding = 'async';
  // a gentle fade-in once the picture has actually arrived; already-cached images just appear
  if (img.complete && img.naturalWidth) wrap.classList.add('re-in', 're-now');
  else {
    img.addEventListener('load', () => { wrap.classList.add('re-in'); const bd = f.closest('.re-band')?._band, ob = bd && bd.obstacles.find(o => o.el === f); if (ob && ob._mar && Math.abs(ob._mar - img.naturalHeight / img.naturalWidth) > .004) dirtyBand(bd); }, { once: true });
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
  if (ob.shape === 'rows') { // a silhouette: per-row ink extents (every ROW px) read back from the plate
    const R = ob.rows; if (!R) return null; let l = Infinity, r = -Infinity;
    const a0 = Math.max(0, Math.floor((y0 - ob.pad - ob.y) / ROW)), a1 = Math.min(R.length - 1, Math.floor((y1 + ob.pad - ob.y) / ROW));
    for (let k = a0; k <= a1; k++) { const sp = R[k]; if (sp) { if (sp[0] < l) l = sp[0]; if (sp[1] > r) r = sp[1]; } }
    return l <= r ? [ob.x + l - ob.pad, ob.x + r + ob.pad] : null;
  }
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
      if (T.head && y > 0 && y + lh + 3 * BODY.lh > H) { c++; y = 0; }
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
  for (const blk of band.blocks) if (blk.kind === 'prose') blk.units.forEach(prepUnitFresh);
  // while a figure is being dragged keep the band height steady (no jumping page) unless it no longer fits
  const obBottom = band.obstacles.reduce((m, ob) => Math.max(m, ob.y + ob.h + (ob.cap ? ob.cap.h : 0)), 0);
  let H = live && band.H >= obBottom ? band.H : 0, res = H ? layBand(band, H, true) : null;
  if (!res || !res.ok) { H = fitBand(band); res = layBand(band, H, true); }
  band.H = H;
  // clear unit DOM
  for (const blk of band.blocks) if (blk.kind === 'prose') blk.units.forEach(u => u.el.replaceChildren());
  const linkFirst = new Map(); let n = 0;
  for (const L of res.out) {
    const line = h('span', 're-l' + (L.u.T.quote ? ' q' : '') + (L.u.T.head ? ' hd' : '') + (L.u.T.mute ? ' mu' : ''));
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
  band.el.style.height = H + 'px'; band.el.classList.remove('re-pending'); band.estH = H;
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
// columns: two on a wide sheet (each ≥ ~460px ≈ 27 CJK characters at 17px), otherwise one readable column
function columnsFor(w) { return w >= 960 ? 2 : 1; }
function layoutPage(i, opt = {}) {
  const p = S.pages[i]; if (!p) return { done: Promise.resolve() };
  const gen = p.gen = (p.gen || 0) + 1;
  // while planning, the article's own paragraphs stay out of layout (only the column width is read)
  p.body.classList.add('re-planning');
  const bodyW = p.body.clientWidth;
  const cols = columnsFor(bodyW);
  p.cols = cols; p.w = bodyW; p.laid = true; p.moon = 0; p.el.dataset.cols = cols;
  // 1) plan every run into bands (DOM moves only — no text measuring yet)
  const all = [];
  qsa('.re-run', p.body).forEach(runEl => { for (const bd of layoutRun(runEl._run, bodyW, cols, p)) all.push(bd); });
  p.body.classList.remove('re-planning');
  // 2) read every figure height in one go (one forced layout instead of one per band)
  measureAll(all);
  placeMosaics(p, all, cols, bodyW);
  const finish = () => {
    if (p.gen !== gen) return;
    p.pending = null; p.lines = all.reduce((a, b) => a + (b.lines || 0), 0);
    S.linesSet = S.pages.reduce((a, q) => a + (q.lines || 0), 0);
    if (i === S.cur) setStat('lines', cols === 1 ? '流式 · 单栏' : `${group3(S.linesSet)} · ${cols} 栏`);
  };
  // 3) set type band by band: what is on (or near) the first screen right away, the rest in slices
  const pd = p.pending = { all, k: 0, gen };
  const syncPx = opt.sliced ? (opt.syncPx ?? innerHeight * 1.4) : Infinity;
  let y = i === 0 ? 420 : 120;
  const rest = async () => {
    while (p.gen === gen && pd.k < all.length) {
      await yieldTask();
      const t0 = performance.now();
      while (p.gen === gen && pd.k < all.length && performance.now() - t0 < 9) renderBand(all[pd.k++]);
    }
    finish();
  };
  if (opt.prep) { // not on screen yet: the first screen is set in slices as well
    const shown = (async () => {
      let t0 = performance.now();
      while (p.gen === gen && pd.k < all.length && y < syncPx) {
        if (performance.now() - t0 > 8) { await yieldTask(); t0 = performance.now(); }
        y += all[pd.k].estH || 0; renderBand(all[pd.k++]);
      }
    })();
    p.pendingDone = shown.then(rest);
    return { done: p.pendingDone, shown };
  }
  while (pd.k < all.length && y < syncPx) { y += all[pd.k].estH || 0; renderBand(all[pd.k++]); }
  if (pd.k >= all.length) { finish(); p.pendingDone = Promise.resolve(); return { done: p.pendingDone, shown: p.pendingDone }; }
  p.pendingDone = rest();
  return { done: p.pendingDone, shown: Promise.resolve() };
}
// finish any bands still waiting (e.g. before a snapshot or a jump to an anchor)
function flushPage(p) { const pd = p && p.pending; if (!pd) return; while (pd.k < pd.all.length) renderBand(pd.all[pd.k++]); }
function layoutRun(run, W, cols, p) {
  const el = run.el;
  // tear down
  el.replaceChildren();
  const gutter = 44, colW = (W - gutter * (cols - 1)) / cols;
  const flow = cols === 1 || run.blocks.every(b => b.kind !== 'prose') ||
    run.blocks.reduce((a, b) => a + (b.kind === 'prose' ? b.units.reduce((q, u) => q + estimate(u, colW), 0) : 0), 0) < BODY.lh * 12;
  el.classList.toggle('re-flow', flow);
  if (flow) {
    for (const b of run.blocks) { if (b.kind === 'prose') b.units.forEach(restoreUnit); el.append(b.el); if (b.kind === 'figure') { b.el.classList.remove('re-ob'); b.el.style.cssText = ''; qs('.re-plate-img', b.el)?.style.removeProperty('height'); } }
    // single column: a CSS drop cap (initial-letter) on the story's opening paragraph
    const story = el.closest('.re-story'), firstRun = el.parentElement && el === qs('.re-run', el.parentElement);
    const fb = run.blocks.find(b => b.kind === 'prose'), fu = fb && fb.units[0];
    if (firstRun && fu && fu.type === 'p' && fb === run.blocks[0] && fu.orig.textContent.length * BODY.size > Math.min(W, 720) * 3.5 && story && (story === qs('.re-story', story.parentElement) || story.querySelector(':scope > h2.re-hl'))) fu.el.classList.add('re-dropflow');
    run.bands = [];
    return [];
  }
  const capH = Math.max(320, Math.min(innerHeight * 0.82, 760));
  const bands = []; let band = null, est = 0;
  const newBand = () => { band = { el: h('div', 're-band re-pending'), blocks: [], obstacles: [], cols, colW, gutter, W, est: 0, first: !bands.length }; band.el._band = band; bands.push(band); est = 0; };
  run.blocks.forEach((b, bi) => {
    if (b.kind === 'figure') {
      const next = run.blocks[bi + 1];
      if (true) { if (band && band.blocks.length) band = null; const s = h('div', 're-band re-figrow'); s.append(b.el); b.el.classList.remove('re-ob'); b.el.style.cssText = ''; bands.push({ el: s, solid: 1 }); band = null; return; }
      newBand();
      const fw = colW * 2 + gutter;
      b.el.classList.add('re-ob'); b.el.style.width = fw + 'px';
      band.el.append(b.el);
      band.blocks.push(b);
      const ob = { el: b.el, x: colW + gutter, y: 0, w: fw, h: 0, pad: 12, shape: 'rect' };
      if (b.pos && b.pos.W === W) { ob.x = b.pos.x; ob.y = b.pos.y; }
      band.obstacles.push(ob); b.ob = ob; ob.band = band;
      band.est += fw * 0.6 * cols;
      return;
    }
    b.units.forEach(u => { u.dropcap = false; u.noIndent = false; });
    if (!band || (est > capH * cols * 0.9 && band.blocks.some(x => x.kind === 'prose'))) newBand();
    band.blocks.push(b); band.el.append(b.el);
    b.units.forEach(u => { const e = estimate(u, colW); est += e; band.est += e; });
  });
  // drop cap + no-indent on the first paragraph of each story's first run
  const firstRun = el.parentElement && el === qs('.re-run', el.parentElement);
  run.first = firstRun;
  if (firstRun) {
    const fb = bands.find(bd => !bd.solid && bd.blocks.some(x => x.kind === 'prose'));
    const fu = fb && fb.blocks.find(x => x.kind === 'prose')?.units[0];
    const story = el.closest('.re-story');
    const firstOfPage = story && story === qs('.re-story', story.parentElement);
    if (fu && fu.type === 'p') { fu.noIndent = true; if (firstOfPage || (story && story.querySelector(':scope > h2.re-hl'))) fu.dropcap = true; }
  }
  // the moon ornament in the lead story (page 1) — a circle the text flows around on both sides
  if (cols === 3 && firstRun && !p.moon) {
    const fb = bands.find(bd => !bd.solid && !bd.obstacles.length && bd.blocks.reduce((a, x) => a + (x.units ? x.units.reduce((q, u) => q + u.orig.textContent.length, 0) : 0), 0) > 900);
    if (fb && S.pages.indexOf(p) === 0) { addMoonOrnament(fb); p.moon = 1; }
  }
  const out = [];
  for (const bd of bands) {
    el.append(bd.el);
    if (!bd.solid) { bd.estH = Math.round(bd.est / cols) + 18; bd.el.style.height = bd.estH + 'px'; bd.story = el.closest('.re-story'); bd.runFirst = firstRun; out.push(bd); }
  }
  run.bands = bands;
  return out;
}
function prepUnitFresh(u) { if (!u.prep || u._dcState !== !!u.dropcap) { u.prep = null; prepUnit(u); u._dcState = !!u.dropcap; } }
function estimate(u, colW) { const chars = u.orig.textContent.length; return Math.ceil(chars * u.T.size / colW + 0.5) * u.T.lh + u.T.gap; }
function restoreUnit(u) { u.el.replaceChildren(...u.orig.cloneNode(true).childNodes); }
function figAR(ob) { const img = ob.el._img; return img && img.naturalWidth ? img.naturalHeight / img.naturalWidth : (img && +img.getAttribute('height') / +img.getAttribute('width')) || 0.6; }
function measureAll(bands) {
  const obs = [];
  for (const bd of bands) for (const ob of bd.obstacles) if (ob.el && !ob.moon && !ob.mosaic) obs.push(ob);
  for (const ob of obs) { const ar = ob._ar = figAR(ob); ob.el.style.width = ob.w + 'px'; const plate = qs('.re-plate-img', ob.el); if (plate) plate.style.height = Math.round(ob.w * ar) + 'px'; }
  for (const ob of obs) if (ob._mw !== ob.w || ob._mar !== ob._ar) { ob._mh = ob.el.offsetHeight || Math.round(ob.w * ob._ar + 40); ob._mw = ob.w; ob._mar = ob._ar; }
  for (const bd of bands) for (const ob of bd.obstacles) { if (ob._mh) ob.h = ob._mh; ob.x = clamp(ob.x, 0, bd.W - ob.w); ob.y = Math.max(0, ob.y); }
}
function measureObstacles(band) {
  for (const ob of band.obstacles) {
    if (!ob.el || ob.moon || ob.mosaic) continue;
    const ar = ob._ar = figAR(ob);
    const pw = ob.w; ob.el.style.width = pw + 'px';
    const plate = qs('.re-plate-img', ob.el); if (plate) plate.style.height = Math.round(pw * ar) + 'px';
    // measure once per size; reading offsetHeight on every drag frame would force layout each time
    if (ob._mw !== pw || ob._mar !== ar) { ob._mh = ob.el.offsetHeight || Math.round(pw * ar + 40); ob._mw = pw; ob._mar = ar; }
    ob.h = ob._mh;
    ob.x = clamp(ob.x, 0, band.W - ob.w); ob.y = Math.max(0, ob.y);
  }
  keepPlatesClear(band);
}
// a decorative plate never sits on a real picture: if a picture grew (late image load), push the plate down
function keepPlatesClear(band) {
  for (const m of band.obstacles) if (m.mosaic && !m.dragged) for (const o of band.obstacles) if (!o.mosaic && o.x < m.x + m.w + 20 && m.x < o.x + o.w + 20 && o.y < m.y + m.h + 40 && m.y < o.y + o.h + 40) m.y = o.y + o.h + 70;
}
// re-set bands whose figures turned out a different shape once loaded — batched, at most ~8ms a frame
const _dirty = new Set(); let _dirtyRaf = 0;
function dirtyBand(bd) { _dirty.add(bd); if (!_dirtyRaf) _dirtyRaf = requestAnimationFrame(flushDirty); }
function flushDirty() { _dirtyRaf = 0; const t0 = performance.now(); for (const bd of _dirty) { _dirty.delete(bd); if (bd.el.isConnected && !bd.el.classList.contains('re-pending')) { measureObstacles(bd); renderBand(bd); } if (performance.now() - t0 > 8) break; } if (_dirty.size) _dirtyRaf = requestAnimationFrame(flushDirty); }
function relayoutBandOf(el) { const bandEl = el.closest('.re-band'); const band = bandEl && bandEl._band; if (!band) return; measureObstacles(band); renderBand(band); }

/* ---------- decorative mosaic plates (装饰插图) ----------
 * Our own procedural pictures, printed in blue ink with an ordered dither, a blue-noise (R2) dither, a 45°
 * halftone or a line engraving. They are decoration only (aria-hidden, captioned 装饰插图 with the method),
 * live in their own canvases and never touch the article's original figures. On first view they "develop":
 * the cell size steps from coarse to fine while the ink rises from blank, and the text wraps the
 * silhouette as it grows. Double-click one to re-print it with the next method; drag it to re-flow. */
const ROW = 4, CELLS = [20, 16, 13, 11, 9, 7, 6, 5, 4, 3, 2], DEV_MS = 1500;
const MODES = [
  { id: 'bayer', label: 'BAYER 8×8 有序抖动' }, { id: 'r2', label: 'R2 蓝噪声抖动' },
  { id: 'tone', label: '45° 半调网点' }, { id: 'line', label: '线刻' },
];
const BAYER = (() => { let m = [[0]]; for (let n = 1; n < 8; n *= 2) { const z = []; for (let y = 0; y < n * 2; y++) { z.push([]); for (let x = 0; x < n * 2; x++) z[y].push(4 * m[y % n][x % n] + [0, 2, 3, 1][(y >= n) * 2 + (x >= n)]); } m = z; } return m; })();
function strHash(t) { let x = 2166136261; for (let i = 0; i < t.length; i++) { x ^= t.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }
function rng(seed) { let a = seed >>> 0 || 1; return () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return (a >>> 0) / 4294967296; }; }
// scenes: tone(x, y) in unit square → ink 0..1, or -1 for "no paper here" (outside the silhouette)
const SCENES = {
  moonrise: { zh: '月出', ar: 1, make: r => { const cx = .5, cy = .46, R = .34, cl = [0, 1, 2].map(() => [r() * .8 + .1, .55 + r() * .3, .1 + r() * .12]);
    return (x, y) => { const dx = (x - cx) / R, dy = (y - cy) / R, d2 = dx * dx + dy * dy; let v = -1;
      if (d2 < 1) { const z = Math.sqrt(1 - d2), lit = clamp(dx * -.55 + dy * -.35 + z * .76, 0, 1); v = .16 + (1 - lit) * .62 + smooth(.45, .8, fbm(x * 7 + 2, y * 7)) * .3; }
      for (const [a, b, w] of cl) { const q = ((x - a) / (w * 1.9)) ** 2 + ((y - b) / w) ** 2 + (fbm(x * 9, y * 9) - .5) * .5; if (q < 1) v = Math.max(v, (1 - q) * .55 + .05); }
      return v > 1 ? 1 : v; }; } },
  stars: { zh: '星野', ar: 1, make: r => { const st = []; for (let i = 0; i < 70; i++) st.push([r(), r(), r() ** 3 * .02 + .004]);
    return (x, y) => { const dx = x - .5, dy = y - .5, d = Math.sqrt(dx * dx + dy * dy) * 2; if (d > 1) return -1;
      const band = Math.exp(-(((y - .5) - (x - .5) * .55) ** 2) / .018) * (.25 + .5 * fbm(x * 6, y * 6)); let v = .06 + band * (1 - smooth(.75, 1, d));
      for (const [a, b, s] of st) { const q = (x - a) ** 2 + (y - b) ** 2; if (q < s * s) v = 1; }
      return d > .93 ? v * (1 - smooth(.93, 1, d)) - .001 : v; }; } },
  orbit: { zh: '轨道', ar: .82, make: r => { const tilt = -.32 + r() * .2;
    return (x, y) => { const cx = .5, cy = .5, R = .3, dx = (x - cx) / R, dy = (y - cy) / R, d2 = dx * dx + dy * dy;
      const rx = (x - cx) * Math.cos(tilt) + (y - cy) * Math.sin(tilt), ry = -(x - cx) * Math.sin(tilt) + (y - cy) * Math.cos(tilt);
      const e = (rx / .47) ** 2 + (ry / .11) ** 2, ring = e > .62 && e < 1 ? .5 + .4 * Math.sin(e * 40) * .5 : -1;
      if (d2 < 1) { const z = Math.sqrt(1 - d2), lit = clamp(dx * -.6 + dy * -.4 + z * .7, 0, 1); const v = .1 + (1 - lit) * .85 + Math.sin((dy + dx * .2) * 14) * .06;
        return ring >= 0 && ry > 0 ? Math.max(ring, .2) : clamp(v, 0, 1); }
      return ring; }; } },
  tide: { zh: '潮汐', ar: .78, make: r => { const ph = r() * 6;
    return (x, y) => { const dx = x - .5, dy = y - .62; if (dy > .02 + .3 * Math.sqrt(Math.max(0, .25 - dx * dx))) return -1; if (dx * dx + (y - .5) ** 2 > .245) return -1;
      const sun = (x - .5) ** 2 + (y - .42) ** 2 < .022 ? .92 : -1; if (y < .5) return sun > 0 ? sun : .05 + y * .1;
      const w = Math.sin(x * 26 + ph + Math.sin(y * 30) * 1.4) * .5 + .5; return clamp(.25 + (y - .5) * 1.6 + w * .35 * (1 - (y - .5) * 2), 0, 1); }; } },
  title: { zh: '题图构成', ar: 1, make: r => { const sh = []; for (let i = 0; i < 4; i++) sh.push({ x: .26 + r() * .48, y: .26 + r() * .48, R: .13 + r() * .17, t: .25 + r() * .7, q: (r() * 4) | 0 });
    return (x, y) => { let v = -1;
      for (const c of sh) { const dx = x - c.x, dy = y - c.y; if (dx * dx + dy * dy < c.R * c.R) { const quarter = c.q === 0 || (c.q === 1 ? dx > 0 : c.q === 2 ? dy < 0 : dx * dy < 0); if (quarter) v = v < 0 ? c.t : Math.min(1, Math.abs(v - c.t) + .15); } }
      return v; }; } },
};
function mosaicFigure(scene, seed, mode, size) {
  const sc = SCENES[scene], w = size, hgt = Math.round(size * sc.ar);
  const fig = h('figure', 're-mosaic re-ob', { 'aria-hidden': 'true' });
  const cv = h('canvas', 're-mosaic-cv'); cv.style.width = w + 'px'; cv.style.height = hgt + 'px';
  const cap = h('figcaption', 're-mosaic-cap');
  fig.append(cv, cap); fig.style.width = w + 'px';
  const M = { fig, cv, cap, scene, seed, mode, w, h: hgt, e: 0, cell: CELLS[0], bias: -1, state: 'blank' };
  fig._m = M;
  setCaption(M);
  return M;
}
function setCaption(M) { M.cap.textContent = `装饰插图 · ${SCENES[M.scene].zh} — ${MODES[M.mode].label}`; }
// tone field, one sample per 2 css px (the finest cell), computed the first time the plate inks
// the tone field, row by row; with a deadline it stops when time is up and carries on at the next call
function ensureField(M, until) {
  if (M.field) return true;
  if (!M._fd || M._fd.w !== M.w || M._fd.h !== M.h) { const sc = SCENES[M.scene], fw = Math.ceil(M.w / 2), fh = Math.ceil(M.h / 2);
    M._fd = { w: M.w, h: M.h, sc, f: sc.make(rng(M.seed)), fw, fh, field: new Float32Array(fw * fh), j: 0 }; }
  const d = M._fd, { f, fw, fh, field, sc } = d;
  for (; d.j < fh; d.j++) { const j = d.j; for (let i = 0; i < fw; i++) field[j * fw + i] = f((i * 2 + 1) / M.w, (j * 2 + 1) * sc.ar / M.h);
    if (until && performance.now() > until && d.j + 1 < fh) { d.j++; return false; } }
  M.field = field; M.fw = fw; M.fh = fh; M._fd = null; return true;
}
function toneAt(M, x, y) { const i = clamp((x / 2) | 0, 0, M.fw - 1), j = clamp((y / 2) | 0, 0, M.fh - 1); return M.field[j * M.fw + i]; }
// the silhouette the text wraps: per ROW-px row, the extent of cells that carry ink at this bias
function silhouette(M) {
  ensureField(M); const rows = [], th = .03 - M.bias;
  for (let y = 0; y < M.h; y += ROW) { let l = Infinity, r = -Infinity;
    for (let yy = y; yy < Math.min(M.h, y + ROW); yy += 2) for (let x = 0; x < M.w; x += 2) if (toneAt(M, x, yy) > th) { if (x < l) l = x; if (x > r) r = x + 2; }
    rows.push(l <= r ? [l, r] : null); }
  return rows;
}
// the plates' ink (--re-blue) only changes with the theme; reading it every frame would force a style pass
let _ink = null;
function inkBlue() { const k = isDark(); if (!_ink || _ink.k !== k) _ink = { k, v: getComputedStyle(S.sheet || root).getPropertyValue('--re-blue').trim() || '#2638b4' }; return _ink.v; }
function drawMosaic(M) {
  const cv = M.cv, dpr = Math.min(2, devicePixelRatio || 1), W = Math.round(M.w * dpr), H = Math.round(M.h * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, M.w, M.h);
  if (M.bias <= -.999) return;
  ensureField(M);
  c.fillStyle = inkBlue();
  const cell = M.cell, b = M.bias, mode = MODES[M.mode].id;
  c.beginPath();
  if (mode === 'tone') { // 45° screen: dots on a rotated lattice, area ∝ tone
    const sp = cell * 1.25, R = M.w + M.h, k = Math.SQRT1_2;
    for (let v = -R; v < R; v += sp) {
      // u where both x and y can fall inside [-sp, size + sp]; start one lattice step early, the test below still decides
      const lo = Math.max(v + (-sp - M.w / 2) / k, -v + (-sp - M.h / 2) / k), n0 = Math.max(0, Math.floor((lo + R) / sp) - 1);
      const hi = Math.min(v + (M.w / 2 + sp) / k, -v + (M.h / 2 + sp) / k);
      for (let u = -R + n0 * sp; u < R && u <= hi + sp; u += sp) {
      const x = (u - v) * k + M.w / 2, y = (u + v) * k + M.h / 2; if (x < -sp || y < -sp || x > M.w + sp || y > M.h + sp) continue;
      const t = toneAt(M, x, y); if (t < 0) continue; const tt = t + b; if (tt <= .02) continue;
      const r = sp * .62 * Math.sqrt(Math.min(1, tt)); c.moveTo(x + r, y); c.arc(x, y, r, 0, 6.2832);
    } }
  } else if (mode === 'line') { // engraving: horizontal rules that swell with the tone and ride a gentle wave
    const sp = Math.max(2.5, cell * 1.3);
    for (let y0 = sp / 2; y0 < M.h; y0 += sp) for (let x = 0; x < M.w; x += Math.max(1, cell / 2)) {
      const y = y0 + Math.sin(x * .045 + y0 * .11) * sp * .18, t = toneAt(M, x, y); if (t < 0) continue; const tt = t + b; if (tt <= .03) continue;
      const th = sp * .92 * Math.min(1, tt); c.rect(x, y - th / 2, Math.max(1, cell / 2) + .25, th);
    }
  } else {
    for (let y = 0, cy = 0; y < M.h; y += cell, cy++) for (let x = 0, cx = 0; x < M.w; x += cell, cx++) {
      const t = toneAt(M, x + cell / 2, y + cell / 2); if (t < 0) continue;
      const thr = mode === 'bayer' ? (BAYER[cy & 7][cx & 7] + .5) / 64 : ((.7548776662 * cx + .56984029 * cy) % 1);
      if (t + b > thr) c.rect(x, y, cell, cell);
    }
  }
  c.fill();
}
const _mosaicIO = 'IntersectionObserver' in window ? new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting && e.intersectionRatio > .3 && !root.classList.contains('re-folded')) { _mosaicIO.unobserve(e.target); develop(e.target._m, 0); } }, { threshold: [0, .35] }) : null;
// one plate per page, standing on its own between paragraphs (centred, nothing wraps around it): an
// ornament that never narrows the measure of the text beside it
function placeMosaics(p, bands, cols, W) {
  const pi = S.pages.indexOf(p);
  p.mosaics = p.mosaics || [];
  const h0 = strHash(location.pathname + ':' + pi);
  for (const st of qsa('.re-story', p.body)) {
    const run = qs('.re-run', st); if (!run) continue;
    let anchor = null;
    if (run.classList.contains('re-flow')) { const paras = qsa(':scope > p', run); if (paras.length >= 4) anchor = paras[2]; }
    else if (qsa(':scope > .re-band:not(.re-figrow)', run).length >= 2) anchor = run; // after the story's opening run
    if (!anchor) continue;
    let M = p.mosaics[0]; const size = cols === 1 ? Math.round(Math.min(150, innerWidth * .4)) : 176;
    if (!M || M.w !== size) {
      const old = M;
      M = p.mosaics[0] = mosaicFigure(['moonrise', 'stars', 'orbit', 'tide', 'title'][(pi === 0 ? 0 : h0) % 5], h0, old ? old.mode : h0 % MODES.length, size);
      if (old && old.state === 'done') { M.state = 'done'; M.e = 1; M.cell = 2; M.bias = 0; }
    }
    M.fig.style.cssText = `width:${size}px`; M.fig.classList.add('re-flowplate'); M.fig.classList.remove('re-ob'); M.cap.style.cssText = ''; M.ob = null;
    if (anchor === run) run.after(M.fig); else anchor.before(M.fig);
    requestAnimationFrame(() => { drawMosaic(M); if (M.state !== 'done' && M.state !== 'running' && _mosaicIO) _mosaicIO.observe(M.fig); });
    break;
  }
}
// print-in: CELLS coarse → fine, ink rising from blank (bias −1 → 0, cubic ease), text re-flowing as it grows
function develop(M, delay) {
  if (!M || M.state === 'running' || M.state === 'done') return;
  if (RM.matches) { M.state = 'done'; M.e = 1; M.cell = 2; M.bias = 0; drawMosaic(M); reflowMosaic(M, true); return; }
  M.state = 'running'; S.devN = (S.devN || 0) + 1; const t0 = performance.now() + delay; let lastCell = 0, slow = false;
  const step = now => {
    if (!M.fig.isConnected) { M.state = 'blank'; S.devN--; calm(); return; }
    const e = clamp((now - t0) / DEV_MS, 0, 1); M.e = e;
    if (now < t0) return void requestAnimationFrame(step);
    M.cell = CELLS[Math.min(CELLS.length - 1, Math.floor(e * CELLS.length))]; M.bias = -Math.pow(1 - e, 3);
    drawMosaic(M);
    if (M.cell !== lastCell) { lastCell = M.cell; if (!slow) { const a = performance.now(); reflowMosaic(M, false); slow = performance.now() - a > 22; } }
    if (e < 1) requestAnimationFrame(step); else { M.state = 'done'; S.devN--; calm(); reflowMosaic(M, true); }
  };
  requestAnimationFrame(step);
}
function reflowMosaic(M, final) {
  const ob = M.ob; if (!ob || !ob.band || !ob.band.el.isConnected) return;
  ob.rows = final ? (M.finalRows || (M.finalRows = silhouette(M))) : silhouette(M);
  renderBand(ob.band, !final);
}
// plates on screen print in, a little staggered (after the sheet opens, or on load when it is already open)
function developVisible(stagger) {
  const p = S.pages[S.cur]; if (!p || !p.mosaics) return;
  const ms = p.mosaics.filter(M => M && M.fig.isConnected && M.state !== 'done' && M.state !== 'running'); if (!ms.length) return;
  if (!('IntersectionObserver' in window)) { let i = 0; for (const M of ms) { const r = M.fig.getBoundingClientRect(); if (r.bottom > 0 && r.top < innerHeight) develop(M, stagger ? 240 + 210 * i++ : 0); } return; }
  // the observer reports with the next frame, without forcing a layout now; the stagger keeps its timing
  const t = performance.now();
  const io = new IntersectionObserver(es => { io.disconnect(); const late = performance.now() - t; let i = 0;
    const on = new Set(es.filter(e => e.isIntersecting && e.boundingClientRect.bottom > 0 && e.boundingClientRect.top < innerHeight).map(e => e.target));
    for (const M of ms) { if (!on.has(M.fig) || M.state === 'done' || M.state === 'running') continue; _mosaicIO && _mosaicIO.unobserve(M.fig); develop(M, stagger ? Math.max(0, 240 + 210 * i++ - late) : 0); } });
  ms.forEach(M => io.observe(M.fig));
}
function redrawMosaics() { for (const p of S.pages) for (const M of p.mosaics || []) if (M && M.state === 'done') drawMosaic(M); }

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
// lattice noise from a fixed table (fast; the same values on every load)
const _HT = (() => { const t = new Float32Array(65536); let a = 0x9e3779b9; for (let i = 0; i < t.length; i++) { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; t[i] = (a >>> 0) / 4294967296; } return t; })();
function hash2(x, y) { return _HT[(x & 255) | ((y & 255) << 8)]; }
function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi; const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return (hash2(xi, yi) * (1 - u) + hash2(xi + 1, yi) * u) * (1 - v) + (hash2(xi, yi + 1) * (1 - u) + hash2(xi + 1, yi + 1) * u) * v; }
function fbm(x, y) { let a = 0, f = 1, amp = .55; for (let o = 0; o < 4; o++) { a += amp * vnoise(x * f, y * f); f *= 2.03; amp *= .5; } return a; }
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function cssRGB(v) { const c = ctx2d(); c.fillStyle = '#000'; c.fillStyle = v; const x = c.fillStyle; return x[0] === '#' ? [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16)) : (x.match(/\d+/g) || [0, 0, 0]).slice(0, 3).map(Number); }
// A clean, continuous-tone moon: a lit sphere (Lambert, soft terminator, faint maria, gentle limb
// darkening) for tonight's phase. No dithering. Light edition: shadow in deep ink-blue, lit side pale;
// night edition: lit side warm paper-white, shadow barely above the paper with a little earthshine.
const _moonCache = new Map();
function drawMoon(cv, css, mp) {
  const dpr = Math.min(2, devicePixelRatio || 1), n = Math.round(css * dpr); if (!n) return; cv.width = cv.height = n;
  const key = n + '/' + isDark() + '/' + mp.ph.toFixed(3), hit = _moonCache.get(key);
  if (hit) { cv.getContext('2d').putImageData(hit, 0, 0); return; }
  const cs = getComputedStyle(S.sheet || root), dark = isDark();
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
  c.putImageData(id, 0, 0); _moonCache.set(key, id);
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
    if (!drag.moved) { drag.moved = true; drag.f.classList.add('re-dragging'); drag.band.el.classList.add('re-live'); root.classList.add('re-grabbing'); }
    drag.ob.x = clamp(drag.ox + dx, 0, drag.band.W - drag.ob.w);
    drag.ob.y = clamp(drag.oy + dy, 0, Math.max(0, parseFloat(drag.band.el.style.height) - drag.ob.h * 0.35));
    if (!pend) pend = requestAnimationFrame(() => { pend = 0; if (drag) { renderBand(drag.band, true); remember(drag); } });
  });
  const end = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null; root.classList.remove('re-grabbing'); d.f.classList.remove('re-dragging'); d.band.el.classList.remove('re-live');
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
function remember(d) { if (d.ob.mosaic) { d.ob.dragged = true; d.ob.mosaic.pos = { x: d.ob.x, y: d.ob.y, W: d.band.W }; return; } const blk = d.band.blocks.find(b => b.el === d.f); if (blk) blk.pos = { x: d.ob.x, y: d.ob.y, W: d.band.W }; }

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
  // read while the current page is still laid out: the sheet's top and the column width are the same on every page
  const top = S.sheet.getBoundingClientRect().top + scrollY - 12, bw = S.pages[S.cur].body.clientWidth;
  showPage(i);
  if (!S.pages[i].laid || S.pages[i].w !== bw) layoutPage(i, { sliced: true });
  if (!opt.keepScroll) scrollTo({ top: Math.max(0, top), behavior: 'instant' });
  if (overlay) await rollAway(overlay, fwd);
  else if (opt.animate !== false && RM.matches) { S.sheet.animate([{ opacity: .55 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' }); }
  turning = false; calm();
  S.pages[i].pendingDone ? S.pages[i].pendingDone.then(warmPage) : warmPage();
  if (opt.focus !== false) { const p = S.pages[i].el; p.tabIndex = -1; p.focus({ preventScroll: true }); }
}
// A lightweight copy of what is on screen of the current page (sheet coordinates y0..y1): bands, boxes and
// lines outside that window are left out, so a snapshot of a long page costs about one screen of DOM.
function copyCanvases(src, dst) { const a = qsa('canvas', src), b = qsa('canvas', dst); b.forEach((c, k) => { const s = a[k]; if (s && s.width) { c.width = s.width; c.height = s.height; c.getContext('2d').drawImage(s, 0, 0); } }); }
// clone just the part of the current page inside a sheet-space rect: whole subtrees outside it are dropped
// (walks the live page once, reading rects only where a box straddles the edge), so a fold or turn
// composites a few hundred nodes rather than the whole article
function sheetSnapshot(y0, y1, x0 = -1e9, x1 = 1e9) {
  const pg = S.pages[S.cur].el, r = S.sheet.getBoundingClientRect(), M = 40;
  const ax = r.left + x0 - M, bx = r.left + x1 + M, ay = r.top + y0 - M, by = r.top + y1 + M;
  // the copy is built while walking (read only on the live page, so several snapshots in a row cost one
  // layout): boxes wholly inside the window are cloned whole, boxes outside keep their size but lose their
  // contents, and only boxes straddling the edge are opened up. Nothing outside the window is ever cloned.
  const pairs = [];
  const whole = o => { const c = o.cloneNode(true); if (o.children.length || /^(CANVAS|VIDEO|IFRAME)$/.test(o.tagName)) pairs.push([o, c]); return c; };
  const fill = (el, cl, d) => {
    for (const n of el.childNodes) {
      if (n.nodeType !== 1) { cl.append(n.cloneNode(true)); continue; }
      const ch = n, b = ch.getBoundingClientRect();
      const open = () => { const c = ch.cloneNode(false); fill(ch, c, d + 1); cl.append(c); };
      if (!b.width && !b.height) { if (d < 14 && ch.children.length) open(); else cl.append(whole(ch)); continue; }
      if (b.bottom < ay || b.top > by || b.right < ax || b.left > bx) {
        if (/^inline/.test(getComputedStyle(ch).display)) { cl.append(whole(ch)); continue; }
        // a box outside the window keeps its size (so nothing around it re-flows) but loses its contents
        const e = /^(IMG|SVG|CANVAS|VIDEO|IFRAME|svg)$/.test(ch.tagName) ? whole(ch) : ch.cloneNode(false);
        e.style.cssText += `;box-sizing:border-box;width:${b.width}px;height:${b.height}px;min-height:0;max-height:none;min-width:0;max-width:none;flex:none;visibility:hidden;overflow:hidden;padding:0;border-color:transparent`;
        cl.append(e); continue;
      }
      if (b.top >= ay && b.bottom <= by && b.left >= ax && b.right <= bx) { cl.append(whole(ch)); continue; }
      if (d < 14 && ch.children.length) open(); else cl.append(whole(ch));
    }
  };
  const c = pg.cloneNode(false); fill(pg, c, 0);
  const self = (e, sel) => (e.matches(sel) ? [e] : []).concat(qsa(sel, e));
  const media = [], cmedia = [];
  for (const [o, k] of pairs) {
    const a = self(o, 'canvas'), b = self(k, 'canvas');
    b.forEach((cv, j) => { const s = a[j]; if (s && s.width) { cv.width = s.width; cv.height = s.height; cv.getContext('2d').drawImage(s, 0, 0); } });
    media.push(...self(o, 'video, iframe')); cmedia.push(...self(k, 'video, iframe'));
  }
  c.removeAttribute('hidden'); c.removeAttribute('id'); qsa('[id]', c).forEach(e => e.removeAttribute('id'));
  // moving pictures become a still of their current frame (a cloned <video> would start blank)
  cmedia.forEach((e, k) => { const o = media[k], w = o.offsetWidth, hh = o.offsetHeight;
    const cv = h('canvas', 're-clone-media'); cv.className = o.className; cv.style.cssText = o.style.cssText + `;width:${w}px;height:${hh}px;display:block`;
    if (o.tagName === 'VIDEO' && o.readyState >= 2) { cv.width = Math.min(800, w); cv.height = Math.round(cv.width * hh / Math.max(1, w)); try { cv.getContext('2d').drawImage(o, 0, 0, cv.width, cv.height); } catch (_) {} }
    e.replaceWith(cv); });
  const wrap = h('div', 're-sheet re-clone'); wrap.append(c);
  wrap.style.cssText = `position:absolute;left:0;top:0;width:${r.width}px;margin:0;box-sizing:border-box;max-width:none`;
  return { el: wrap, r };
}
function cloneSnap(sn) { const c = sn.el.cloneNode(true); copyCanvases(sn.el, c); return c; }
function snapshotOverlay() {
  const r = S.sheet.getBoundingClientRect();
  const vx = Math.max(0, r.left), vy = Math.max(0, r.top), vw = Math.min(innerWidth, r.right) - vx, vh = Math.min(innerHeight, r.bottom) - vy;
  const ov = h('div', 're-turn', { 'aria-hidden': 'true' });
  ov.style.cssText = `left:${vx}px;top:${vy}px;width:${vw}px;height:${vh}px`;
  const paper = h('div', 're-turn-paper');
  const sn = sheetSnapshot(vy - r.top, vy - r.top + vh), clone = sn.el;
  clone.style.left = (r.left - vx) + 'px'; clone.style.top = (r.top - vy) + 'px';
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

/* ---------- fold / unfold: the sheet arrives folded in quarters ----------
 * The first screen of the sheet (W × Hs) is folded twice: the bottom half up behind the top, then the right
 * half back behind the left. So the folded paper shows the FRONT of its top-left quarter (the masthead) and
 * nothing is ever seen from behind. Opening reverses that, one crease at a time: the right half swings out
 * from behind (θ: π → 0), then the bottom half swings down from behind (φ: π → 0). Folding up goes φ first,
 * then θ. Both angles are damped springs (k 46, ζ .94), driven by click / Enter, a drag (sideways for the
 * first step, down for the second) or the wheel; shading follows each panel's angle to the light, and the
 * creases stay faintly on the sheet afterwards. Everything is transforms + opacity on a few layers. */
const PI = Math.PI, LIGHT = (() => { const v = [-.3, -.55, 1], n = Math.hypot(...v); return v.map(x => x / n); })();
function foldGeom() {
  const r = S.sheet.getBoundingClientRect();
  const W = Math.round(r.width), Hs = Math.round(Math.max(240, Math.min(r.height, innerHeight - Math.max(0, r.top) - 18)));
  return { r, W, Hs, hw: W / 2, hh: Hs / 2 };
}
// the four quarters' copies, one short task each (used while the sheet is still being prepared off screen)
async function foldSnaps() {
  const g = foldGeom(), snaps = [];
  for (const [qx, qy] of [[0, 0], [g.hw, 0], [0, g.hh], [g.hw, g.hh]]) { snaps.push(sheetSnapshot(qy, qy + g.hh, qx, qx + g.hw).el); await yieldTask(); }
  return { g, snaps };
}
function foldOverlay(open, pre) {
  const g = pre ? pre.g : foldGeom(), { r, W, Hs, hw, hh } = g; let qi = 0;
  const ov = h('div', 're-fold', { 'aria-hidden': 'true' });
  ov.style.cssText = `left:${r.left}px;top:${Math.max(0, r.top)}px;width:${W}px;height:${Hs}px`;
  const shadow = h('div', 're-fshadow'); shadow.style.cssText = `width:${W}px;height:${Hs}px`;
  const stage = h('div', 're-fstage'); stage.style.cssText = `width:${W}px;height:${Hs}px`;
  // a quarter panel: front (a window onto the snapshot), a plain back, angle shade and crease marks
  const quarter = (qx, qy, cls) => {
    const q = h('div', 're-q ' + cls); q.style.cssText = `width:${hw}px;height:${hh}px`;
    const f = h('div', 're-qf'); const c = pre ? pre.snaps[qi++] : sheetSnapshot(qy, qy + hh, qx, qx + hw).el; c.style.left = -qx + 'px'; c.style.top = -qy + 'px'; f.append(c);
    const sh = h('div', 're-qs'), cr = h('div', 're-qc');
    f.append(sh, cr); q.append(f, h('div', 're-qb'));
    q._shade = sh; q._crease = cr; return q;
  };
  const TL = quarter(0, 0, 'tl'), TR = quarter(hw, 0, 'tr'), BL = quarter(0, hh, 'bl'), BR = quarter(hw, hh, 'br');
  const pBL = h('div', 're-piv re-pv-b'); pBL.style.cssText = `left:0;top:${hh}px;width:${hw}px;height:${hh}px`; pBL.append(BL);
  const pR = h('div', 're-piv re-pv-r'); pR.style.cssText = `left:${hw}px;top:0;width:${hw}px;height:${Hs}px`;
  const pBR = h('div', 're-piv re-pv-b'); pBR.style.cssText = `left:0;top:${hh}px;width:${hw}px;height:${hh}px`; pBR.append(BR);
  pR.append(TR, pBR);
  stage.append(TL, pBL, pR);
  ov.append(shadow, stage);
  const F = { ov, stage, shadow, TL, TR, BL, BR, pBL, pR, pBR, W, Hs, hw, hh, r,
    th: open ? 0 : PI, ph: open ? 0 : PI, vth: 0, vph: 0, u: open ? 2 : 0, lx: 0, ly: 0, tlx: 0, tly: 0, lift: 0, tlift: 0, drag: null };
  renderFold(F);
  return F;
}
// shading: Lambert against an upper-left light, relative to a flat sheet; plus a valley along each crease
function litOf(n) { return Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / LIGHT[2]; }
function renderFold(F) {
  const { th, ph, hw, hh } = F;
  const ox = (hw / 2) * (th / PI), oy = (hh / 2) * (ph / PI) * .9;
  const foldedness = (th + ph) / (2 * PI);
  F.stage.style.transform = `translate3d(${ox.toFixed(2)}px,${oy.toFixed(2)}px,0) translateZ(${F.lift.toFixed(2)}px) rotateX(${(F.ly * foldedness).toFixed(3)}deg) rotateY(${(F.lx * foldedness).toFixed(3)}deg)`;
  F.pR.style.transform = `translateZ(${(-3 * th / PI).toFixed(3)}px) rotateY(${th.toFixed(4)}rad)`;
  const b = `translateZ(${(-1 * ph / PI).toFixed(3)}px) rotateX(${(-ph).toFixed(4)}rad)`;
  F.pBL.style.transform = b; F.pBR.style.transform = b;
  const st = Math.sin(th), ct = Math.cos(th), sp = Math.sin(ph), cp = Math.cos(ph);
  const nTR = [st, 0, ct], nBL = [0, sp, cp], nBR = [cp * st, sp, cp * ct];
  const dark = isDark() ? .75 : 1;
  const shade = n => (clamp(1 - litOf(n), 0, 1) * .55 * dark).toFixed(3);
  F.TL._shade.style.opacity = (F.lift > .5 ? .02 : 0); F.TR._shade.style.opacity = shade(nTR); F.BL._shade.style.opacity = shade(nBL); F.BR._shade.style.opacity = shade(nBR);
  // crease valleys: strong while a crease is bent, a faint residue once flat
  const cv = .3 + .7 * Math.sin(Math.min(th, PI - .001) / 2), chz = .3 + .7 * Math.sin(Math.min(ph, PI - .001) / 2);
  for (const q of [F.TL, F.TR, F.BL, F.BR]) { q._crease.style.setProperty('--cv', cv.toFixed(3)); q._crease.style.setProperty('--ch', chz.toFixed(3)); }
  // the paper's shadow on the desk grows with what is open
  const ex = hw + hw * Math.max(0, ct), ey = hh + hh * Math.max(0, cp);
  F.shadow.style.transform = `translate3d(${ox.toFixed(1)}px,${(oy + 4 + F.lift * .6).toFixed(1)}px,0) scale(${(ex / F.W).toFixed(4)},${(ey / F.Hs).toFixed(4)})`;
  F.shadow.style.opacity = (.75 + F.lift * .02).toFixed(3);
}
function spring(x, v, target, k, dt) { const c = 2 * .94 * Math.sqrt(k); const a = -k * (x - target) - c * v; v += a * dt; x += v * dt; return [x, v]; }
function foldTargets(F) {
  let thT = PI * (1 - clamp(F.u, 0, 1)), phT = PI * (1 - clamp(F.u - 1, 0, 1));
  if (thT > F.th + 1e-3 && F.ph < .82 * PI) thT = F.th;  // folding up: the bottom half goes first
  if (phT < F.ph - 1e-3 && F.th > .2 * PI) phT = F.ph;   // opening: the right half first
  return [thT, phT];
}
function runFold(F) {
  if (F.running) return; F.running = S.foldAnim = true; let last = performance.now();
  const tick = now => {
    if (F.dead) { S.foldAnim = false; calm(); return; }
    let dt = Math.min(.05, (now - last) / 1000); last = now;
    const k = F.drag ? 170 : 46, steps = 4, h2 = dt / steps;
    for (let s = 0; s < steps; s++) {
      const [thT, phT] = foldTargets(F);
      [F.th, F.vth] = spring(F.th, F.vth, thT, k, h2); [F.ph, F.vph] = spring(F.ph, F.vph, phT, k, h2);
      [F.lx, F.tlxv] = spring(F.lx, F.tlxv || 0, F.tlx, 60, h2); [F.ly, F.tlyv] = spring(F.ly, F.tlyv || 0, F.tly, 60, h2);
      [F.lift, F.liftv] = spring(F.lift, F.liftv || 0, F.tlift, 120, h2);
    }
    F.th = clamp(F.th, 0, PI); F.ph = clamp(F.ph, 0, PI);
    renderFold(F);
    const [thT, phT] = foldTargets(F);
    const still = Math.abs(F.th - thT) < .002 && Math.abs(F.ph - phT) < .002 && Math.abs(F.vth) + Math.abs(F.vph) < .01 && Math.abs(F.lx - F.tlx) < .02 && Math.abs(F.ly - F.tly) < .02 && Math.abs(F.lift - F.tlift) < .05 && !F.drag;
    if (still) { F.th = thT; F.ph = phT; renderFold(F); F.running = S.foldAnim = false; calm(); F.onRest && F.onRest(); return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function setHint(F) {
  if (!F.hint) return; const st = F.u < .5 ? 0 : F.u < 1.5 ? 1 : 2;
  F.hint.textContent = st === 0 ? '轻点、滚动或向右拖动 —— 打开右半版 · 按 H 显示控制' : st === 1 ? '再轻点或向下拖动 —— 展开下半版' : '';
  F.btn && F.btn.setAttribute('aria-label', st === 0 ? '展开报纸：先打开右半版（回车、空格、点按或滚动）' : '继续展开下半版（回车、空格、点按或滚动）');
}
// interaction while the sheet is (partly) folded; resolves once it lies fully open
function foldInteract(F) {
  return new Promise(resolve => {
    root.classList.add('re-folded');
    const btn = F.btn = h('button', 're-unfold', { type: 'button' });
    btn.style.cssText = `left:${F.ov.style.left};top:${F.ov.style.top};width:${F.W}px;height:${F.Hs}px`;
    const hint = F.hint = h('p', 're-hint', { 'aria-hidden': 'true' });
    D.body.append(F.ov, btn, hint); setHint(F);
    btn.focus({ preventScroll: true });
    const step = d => { F.u = clamp(Math.round(F.u) + d, 0, 2); setHint(F); runFold(F); };
    let wheelT = 0;
    const onWheel = e => { if (e.cancelable) e.preventDefault(); F.u = clamp(F.u + e.deltaY * .0032, 0, 2); runFold(F);
      clearTimeout(wheelT); wheelT = setTimeout(() => { const fl = Math.floor(F.u), fr = F.u - fl; F.u = fr > .3 ? Math.min(2, fl + 1) : fl; setHint(F); runFold(F); }, 200); };
    const onKey = e => { if (/^(Tab|Shift|Alt|Control|Meta|h|H)$/.test(e.key)) return;
      if (/^(Enter| |ArrowDown|ArrowRight|PageDown)$/.test(e.key)) { e.preventDefault(); step(1); }
      else if (/^(ArrowUp|ArrowLeft|PageUp)$/.test(e.key)) { e.preventDefault(); step(-1); } };
    const onDown = e => { if (e.button !== 0 || e.target.closest('.zbm-nav, .re-ctl')) return; F.drag = { x: e.clientX, y: e.clientY, u: F.u, moved: false, id: e.pointerId }; F.tlift = 10; runFold(F); };
    const onMove = e => {
      if (!F.drag) { // lean towards the pointer while folded
        F.tlx = (e.clientX / innerWidth - .5) * 9; F.tly = -(e.clientY / innerHeight - .5) * 7; runFold(F); return; }
      if (e.pointerId !== F.drag.id) return;
      const dx = e.clientX - F.drag.x, dy = e.clientY - F.drag.y; if (!F.drag.moved && Math.hypot(dx, dy) > 6) F.drag.moved = true;
      if (!F.drag.moved) return;
      const u0 = F.drag.u;
      if (u0 < 1) { const a = clamp(u0 + dx / F.hw, 0, 1); F.u = a >= 1 ? clamp(1 + Math.max(0, dy) / F.hh, 1, 2) : a; }
      else F.u = clamp(u0 + dy / F.hh, 1, 2);
      runFold(F);
    };
    const onUp = e => { if (!F.drag || e.pointerId !== F.drag.id) return; const d = F.drag; F.drag = null; F.tlift = 0;
      if (!d.moved) step(1); else { const fl = Math.floor(F.u), fr = F.u - fl; F.u = fr > .2 ? Math.min(2, fl + 1) : fl; setHint(F); }
      runFold(F); };
    const opts = { capture: true, passive: false };
    addEventListener('wheel', onWheel, opts); addEventListener('keydown', onKey, true);
    addEventListener('pointerdown', onDown, true); addEventListener('pointermove', onMove, true); addEventListener('pointerup', onUp, true); addEventListener('pointercancel', onUp, true);
    const touch = e => { if (e.cancelable) e.preventDefault(); }; addEventListener('touchmove', touch, opts);
    const hold = () => { if (scrollY) scrollTo(0, 0); }; addEventListener('scroll', hold, { passive: true });
    btn.addEventListener('click', e => e.preventDefault());
    F.onRest = () => {
      if (F.u < 2 || F.th > .002 || F.ph > .002) return;
      removeEventListener('wheel', onWheel, opts); removeEventListener('keydown', onKey, true);
      removeEventListener('pointerdown', onDown, true); removeEventListener('pointermove', onMove, true); removeEventListener('pointerup', onUp, true); removeEventListener('pointercancel', onUp, true);
      removeEventListener('touchmove', touch, opts);
      removeEventListener('scroll', hold, { passive: true });
      F.dead = true; btn.remove(); hint.classList.add('out'); setTimeout(() => hint.remove(), 600);
      F.ov.remove(); root.classList.remove('re-folded');
      sessionStorage.setItem('re-opened:' + location.pathname, '1');
      addCreases(F);
      requestAnimationFrame(() => developVisible(true));
      resolve();
    };
    runFold(F);
  });
}
function addCreases(F) { let c = qs('.re-creases', S.sheet); if (!c) { c = h('div', 're-creases', { 'aria-hidden': 'true' }); S.sheet.append(c); } c.style.height = F.Hs + 'px'; c.style.setProperty('--hh', F.hh + 'px'); }
let folding = false;
async function foldUp() {
  if (RM.matches || turning || folding || root.classList.contains('re-folded')) return;
  folding = true;
  if (scrollY > 0) { scrollTo({ top: 0, behavior: scrollY < innerHeight * 2 ? 'smooth' : 'instant' }); await new Promise(r => { const t0 = performance.now(); const w = () => (scrollY < 1 || performance.now() - t0 > 900) ? r() : requestAnimationFrame(w); w(); }); }
  flushPage(S.pages[S.cur]);
  const F = foldOverlay(true); F.u = 0;
  folding = false;
  await foldInteract(F);
}

/* ---------- controls (H) ---------- */
function controls() {
  const c = h('nav', 're-ctl', { 'aria-label': '阅读控制' });
  c.innerHTML = `<button type="button" data-a="prev" aria-label="上一版">←</button>
<label class="re-sel"><span class="sr">版面</span><select data-a="go"></select></label>
<button type="button" data-a="next" aria-label="下一版">→</button>
<button type="button" data-a="fold" title="把报纸折起来（或双击报头）">折起</button>
<button type="button" data-a="theme" aria-label="切换日间 / 夜间版" title="日间 / 夜间">日 · 夜</button>
<button type="button" data-a="hide" aria-label="隐藏控制（H）" title="隐藏（H）">×</button>`;
  const sel = qs('select', c);
  S.pages.forEach((p, i) => sel.append(h('option', '', { value: i, text: `${p.folio} · ${p.title.slice(0, 28)}` })));
  c.addEventListener('click', e => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'prev') turnTo(S.cur - 1); else if (a === 'next') turnTo(S.cur + 1);
    else if (a === 'fold') foldUp(); else if (a === 'hide') toggleCtl(false); else if (a === 'theme') setTheme(isDark() ? 'light' : 'dark', true);
  });
  sel.addEventListener('change', () => turnTo(+sel.value));
  const hint = h('p', 're-ctl-hint', { 'aria-hidden': 'true', text: '按 H 显示控制' });
  D.body.append(c, hint); S.ctl = c; S.ctlHint = hint;
  if (localStorage.getItem('re-ctl') === 'off') toggleCtl(false);
}
// one theme for the whole site: the hub and every article read and write localStorage 'zbm-theme'
// (an explicit choice beats prefers-color-scheme; the <head> snippet applies it before first paint)
function setTheme(t, save) {
  if (t) root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
  if (save) try { localStorage.setItem('zbm-theme', t); } catch (e) {}
  requestAnimationFrame(() => { if (S.plateMoon) drawMoon(S.plateMoon, S.plateMoon._css, moonPhase()); qsa('.re-moonfig', S.sheet).forEach(f => drawMoon(f._moon, parseFloat(f._moon.style.width), moonPhase())); redrawMosaics(); });
}
function syncTheme() { let t = null; try { t = localStorage.getItem('zbm-theme'); } catch (e) {} if (t !== 'light' && t !== 'dark') t = null; if (t !== root.getAttribute('data-theme')) setTheme(t, false); }
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
  // the width comes with the observation (reading clientWidth here would force a layout)
  let rw = -1, pend = 0, nw = 0;
  new ResizeObserver(es => { const e = es[es.length - 1]; nw = e.contentBoxSize && e.contentBoxSize[0] ? e.contentBoxSize[0].inlineSize : e.contentRect.width;
    if (rw < 0) { rw = nw; return; } if (pend) return; pend = requestAnimationFrame(() => { pend = 0; if (Math.abs(nw - rw) < 1) return; rw = nw; S.pages.forEach(p => p.laid = false); layoutPage(S.cur, { sliced: true }); }); }).observe(S.sheet);
  let fT = 0;
  // re-set only if a face we set type with arrived after the first layout (not for the batch we already waited on)
  const seen = new Set([...D.fonts].filter(f => f.status === 'loaded'));
  D.fonts.addEventListener && D.fonts.addEventListener('loadingdone', e => { if (!(e.fontfaces || []).some(f => !seen.has(f) && /Geist Serif|Noto Serif SC/.test(f.family))) return; (e.fontfaces || []).forEach(f => seen.add(f)); clearTimeout(fT); fT = setTimeout(() => { S.pages.forEach(p => { p.laid = false; qsa('.re-run', p.el).forEach(r => r._run.blocks.forEach(b => b.units && b.units.forEach(u => u.prep = null))); }); layoutPage(S.cur, { sliced: true }); }, 350); });
  for (const ev of ['wheel', 'keydown', 'touchmove', 'pointerdown', 'pointermove']) addEventListener(ev, () => { S.lastInput = performance.now(); }, { passive: true, capture: true });
  addEventListener('scroll', () => { S.lastInput = performance.now(); if (!statPend) statPend = requestAnimationFrame(() => { statPend = 0; readStat(); }); }, { passive: true });
  addEventListener('beforeprint', () => S.pages.forEach(p => p.el.removeAttribute('hidden')));
  addEventListener('afterprint', () => showPage(S.cur));
  DARK_MQ.addEventListener('change', () => { if (!root.getAttribute('data-theme')) setTheme(null, false); });
  addEventListener('storage', e => { if (e.key === 'zbm-theme') syncTheme(); });
  addEventListener('pageshow', syncTheme);
  // fold it back up: double-click the masthead / running head, or keep pulling up at the very top
  S.sheet.addEventListener('dblclick', e => { if (e.target.closest('.re-mast, .re-running')) { e.preventDefault(); foldUp(); } });
  let pull = 0, pullT = 0;
  addEventListener('wheel', e => { if (root.classList.contains('re-folded') || scrollY > 0 || e.deltaY >= 0) { pull = 0; return; } pull += -e.deltaY; clearTimeout(pullT); pullT = setTimeout(() => pull = 0, 500); if (pull > 900) { pull = 0; foldUp(); } }, { passive: true });
  // mosaics: double-click re-prints with the next method
  S.sheet.addEventListener('dblclick', e => { const f = e.target.closest('.re-mosaic'); const M = f && f._m; if (!M || M.state === 'running') return; e.preventDefault(); M.mode = (M.mode + 1) % MODES.length; setCaption(M); M.state = 'blank'; M.finalRows = null; develop(M, 0); });
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
  setStat('chars', chars > 10000 ? (chars / 10000).toFixed(1) + ' 万' : group3(chars));
  readStat();
  const pm = S.plateMoon; if (pm) { const css = Math.round(parseFloat(getComputedStyle(pm).width) || 80); pm._css = css; pm.style.height = css + 'px'; drawMoon(pm, css, mp); }
  const t = () => { const s = Math.floor((performance.now() - S.t0) / 1000); setStat('since', `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`); };
  t(); setInterval(() => { if (!D.hidden && scrollY < innerHeight * 1.5) t(); }, 1000);
}
