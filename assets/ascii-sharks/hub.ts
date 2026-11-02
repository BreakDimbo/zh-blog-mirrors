// [zh-blog-mirrors] Hub driver for the original ascii-sharks World + AsciiRenderer.
// The water is page-sized: fish and sharks may swim anywhere on the page except over the
// bookshelves (and under the title/hint/nav/footer text the water thins to a whisper).
// The canvas is a viewport-sized window onto that world, re-positioned only when the scroll
// nears its edge, so scrolling stays on the compositor. The loop is OceanEngine's (fixed 1/60 s
// step, at most 4 steps a frame, reduced-motion still frame, pointer input), adapted to page
// coordinates; engine.ts itself is not used.
import { World, type Ellipse, type Rect, type SharkSpec } from "./src/world";
import { AsciiRenderer, type HubPalette } from "./src/renderer";

const STEP = 1 / 60;
const MAX_STEPS = 4;
const STRIP = 150; // phones: water strip below the hero text (matches the CSS padding)
const MOBILE = "(max-width: 720px)";
const FONT = '600 16px "Geist Mono"';

type Pal = HubPalette;

function hexToRgb(v: string): [number, number, number] | null {
  const m = v.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.replace(/./g, "$&$&");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function readPalette(): Pal {
  const cs = getComputedStyle(document.documentElement);
  const bg = hexToRgb(cs.getPropertyValue("--bg")) || [241, 236, 227];
  const ink = hexToRgb(cs.getPropertyValue("--ink")) || [30, 28, 25];
  const acc = hexToRgb(cs.getPropertyValue("--acc")) || [135, 104, 58];
  const dark = bg[0] + bg[1] + bg[2] < 384;
  // Ink on paper reads stronger than light on black, so light mode carries a little less of it.
  return dark ? { bg, ink, acc, strength: 0.78, grid: 0.04 } : { bg, ink, acc, strength: 0.6, grid: 0.032 };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: number[], b: number[], t: number) => a.map((v, k) => lerp(v, b[k], t)) as [number, number, number];
/** CSS `ease` (the page's background-color transition), so the water changes with the paper. */
function ease(x: number) {
  // cubic-bezier(.25,.1,.25,1), solved for t by bisection
  let lo = 0, hi = 1, t = x;
  for (let k = 0; k < 18; k++) {
    t = (lo + hi) / 2;
    const bx = 3 * 0.25 * t * (1 - t) ** 2 + 3 * 0.25 * t * t * (1 - t) + t ** 3;
    if (bx < x) lo = t;
    else hi = t;
  }
  return 3 * 0.1 * t * (1 - t) ** 2 + 3 * 1 * t * t * (1 - t) + t ** 3;
}

function boot() {
  const hero = document.querySelector<HTMLElement>("header.hero");
  const wrap = document.querySelector<HTMLElement>(".wrap") || document.body;
  if (!hero || !window.CanvasRenderingContext2D) return;
  const mq = window.matchMedia(MOBILE);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const canvas = document.createElement("canvas");
  canvas.className = "ash-ocean";
  canvas.setAttribute("aria-hidden", "true");
  document.body.insertBefore(canvas, document.body.firstChild);

  const renderer = new AsciiRenderer(canvas);
  renderer.setFontFamily(getComputedStyle(canvas).fontFamily);
  let world: World;
  let mobile = mq.matches;
  let W = 0, H = 0, dpr = 1, vh = 0, viewTop = 0, viewH = 0;
  let obstacles: Rect[] = [];

  // ── page layout → world zones (page coordinates) ─────────────────────
  const pageRect = (el: Element | null, grow = 0): Rect | null => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    return { l: r.left + scrollX - grow, t: r.top + scrollY - grow, r: r.right + scrollX + grow, b: r.bottom + scrollY + grow };
  };
  const union = (els: (Element | null)[]) => {
    let u: Rect | null = null;
    for (const el of els) {
      const r = pageRect(el);
      if (!r) continue;
      u = u ? { l: Math.min(u.l, r.l), t: Math.min(u.t, r.t), r: Math.max(u.r, r.r), b: Math.max(u.b, r.b) } : r;
    }
    return u;
  };
  const ell = (r: Rect, gx: number, gy: number): Ellipse => ({
    x: (r.l + r.r) / 2, y: (r.t + r.b) / 2, rx: (r.r - r.l) / 2 + gx, ry: (r.b - r.t) / 2 + gy,
  });

  interface Zones { home: Rect; obstacles: Rect[]; clear: Ellipse[]; text: { r: Rect; keep: number; feather: number }[] }
  const measure = (): Zones => {
    const heroR = pageRect(hero) || { l: 0, t: 0, r: W, b: Math.min(H, vh) };
    const heroBottom = Math.round(heroR.b);
    const main = document.querySelector("main");
    const mainTop = main ? pageRect(main)?.t ?? heroBottom : heroBottom;
    const obs: Rect[] = [];
    // The bookshelves (and in list view the list, or an opened case) are solid.
    document.querySelectorAll(".shelves .unit, .flat, #case").forEach((el) => {
      const r = pageRect(el);
      if (r) obs.push(r);
    });
    // The sticky filter bar is opaque: in its in-flow spot (between hero and shelves) it's a wall.
    const bar = pageRect(document.querySelector(".bar"));
    if (bar) obs.push({ l: bar.l, t: heroBottom, r: bar.r, b: Math.max(heroBottom + 1, mainTop) });
    const text: Zones["text"] = [];
    const clear: Ellipse[] = [];
    const title = union([hero.querySelector(".eyebrow"), hero.querySelector("h1"), hero.querySelector(".intro")]);
    const howto = union([hero.querySelector(".howto")]);
    const top = union([document.querySelector(".top")]);
    if (title) {
      text.push({ r: title, keep: mobile ? 0.3 : 0.18, feather: 48 });
      // Sharks keep clear of the headline itself (as the original keeps clear of its centre);
      // the eyebrow and intro are only thinned, so the patrol still has the hero's width.
      const h1 = pageRect(hero.querySelector("h1"));
      if (h1) clear.push(ell(h1, mobile ? 12 : 28, mobile ? 8 : 16));
    }
    if (howto) {
      text.push({ r: howto, keep: mobile ? 0.34 : 0.24, feather: 36 });
      if (!mobile) clear.push(ell(howto, 30, 26));
    }
    if (top) for (const el of Array.from(document.querySelector(".top")!.children)) {
      const r = pageRect(el);
      if (r) text.push({ r, keep: 0.24, feather: 26 });
    }
    document.querySelectorAll("body > footer, .wrap > footer, main > .empty").forEach((el) => {
      const r = pageRect(el);
      if (r) text.push({ r, keep: 0.22, feather: 34 });
    });
    // Sharks patrol the hero; on phones, the lower hero (intro, hint and the open strip).
    const home: Rect = mobile
      ? { l: 0, t: Math.max(0, heroBottom - STRIP - 170), r: W, b: heroBottom }
      : { l: 0, t: 0, r: W, b: heroBottom };
    return { home, obstacles: obs, clear, text };
  };

  // ── mask: hard cut-outs at the shelves, soft thinning under text ─────
  let maskURL = "";
  let maskSeq = 0;
  const buildMask = (z: Zones) => {
    const s = 0.25;
    const mc = document.createElement("canvas");
    mc.width = Math.max(1, Math.ceil(W * s));
    mc.height = Math.max(1, Math.ceil(H * s));
    const g = mc.getContext("2d")!;
    g.fillStyle = "#000";
    g.fillRect(0, 0, mc.width, mc.height);
    g.globalCompositeOperation = "destination-out";
    const OFF = mc.width + 4000;
    const soft = (r: Rect, grow: number, feather: number, alpha: number) => {
      // shadowBlur feathers on every engine (ctx.filter isn't universal)
      g.shadowColor = `rgba(0,0,0,${alpha})`;
      g.shadowBlur = feather * s;
      g.shadowOffsetX = OFF;
      g.fillStyle = "#000";
      g.fillRect((r.l - grow) * s - OFF, (r.t - grow) * s, (r.r - r.l + 2 * grow) * s, (r.b - r.t + 2 * grow) * s);
    };
    for (const t of z.text) soft(t.r, t.feather * 0.12, t.feather, 1 - t.keep);
    for (const o of z.obstacles) soft(o, 14, 28, 1);
    g.shadowColor = "transparent";
    g.fillStyle = "#000";
    for (const o of z.obstacles) g.fillRect((o.l - 6) * s, (o.t - 6) * s, (o.r - o.l + 12) * s, (o.b - o.t + 12) * s);
    const seq = ++maskSeq;
    mc.toBlob((blob) => {
      if (!blob || seq !== maskSeq) return;
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        if (seq !== maskSeq) return URL.revokeObjectURL(url);
        const old = maskURL;
        maskURL = url;
        const st = canvas.style as CSSStyleDeclaration & Record<string, string>;
        st.webkitMaskImage = st.maskImage = `url(${url})`;
        placeMask();
        if (old) setTimeout(() => URL.revokeObjectURL(old), 1000);
        maskReady();
      };
      img.src = url;
    });
  };
  const placeMask = () => {
    const st = canvas.style as CSSStyleDeclaration & Record<string, string>;
    st.webkitMaskSize = st.maskSize = `${W}px ${H}px`;
    st.webkitMaskPosition = st.maskPosition = `0px ${-viewTop}px`;
  };

  // ── window onto the world ─────────────────────────────────────────────
  const ch = () => renderer.cellHeight;
  const placeView = (force = false) => {
    const c = ch();
    const pad = Math.round((vh * 0.35) / c) * c;
    const wantH = Math.min(Math.ceil(H / c) * c, Math.ceil((vh + 2 * pad) / c) * c + c);
    const y = scrollY;
    const margin = vh * 0.08;
    const inside = y >= viewTop + (viewTop > 0 ? margin : -1) && y + vh <= viewTop + viewH - (viewTop + viewH < H ? margin : -1);
    if (!force && inside && wantH === viewH) return false;
    viewH = wantH;
    const maxTop = Math.max(0, Math.floor((H - viewH) / c) * c + c);
    viewTop = Math.max(0, Math.min(maxTop, Math.floor((y - pad) / c) * c));
    canvas.style.top = viewTop + "px";
    canvas.style.height = viewH + "px";
    renderer.setView(viewTop, viewH, gridBottom);
    placeMask();
    return true;
  };

  let gridBottom = 0;
  let sharkSpecs: SharkSpec[] = [];
  const newWorld = (z: Zones, fishCount: number) => {
    sharkSpecs = mobile ? [{ kind: "classic", size: 0.8 }] : [
      { kind: "classic", size: 1.35 },
      { kind: "classic", size: 1.0 },
      { kind: "classic", size: 0.8 },
    ];
    world = new World(sharkSpecs, fishCount);
    applyZones(z);
  };
  const applyZones = (z: Zones) => {
    world.home = z.home;
    world.obstacles = z.obstacles;
    world.clearZones = z.clear;
    obstacles = z.obstacles;
  };
  /** Open water on the page, for the population (the original: one fish per 4400 px²). */
  const freeArea = (z: Zones) => {
    let n = 0;
    const g = 24;
    for (let y = g / 2; y < H; y += g)
      for (let x = g / 2; x < W; x += g) {
        let free = true;
        for (const o of z.obstacles) if (x > o.l - 20 && x < o.r + 20 && y > o.t - 20 && y < o.b + 20) { free = false; break; }
        if (free) n++;
      }
    return n * g * g;
  };

  let lastZ: Zones | null = null;
  let lastDims = [0, 0, 0, 0];
  let maskT = 0;
  const maskSoon = (z: Zones) => {
    clearTimeout(maskT);
    maskT = window.setTimeout(() => buildMask(z), 140);
  };
  const layout = () => {
    W = document.documentElement.clientWidth;
    H = Math.max(Math.ceil(wrap.getBoundingClientRect().bottom + scrollY), hero.getBoundingClientRect().bottom + scrollY);
    vh = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nowMobile = mq.matches;
    const flipped = nowMobile !== mobile;
    mobile = nowMobile;
    const z = measure();
    const sized = W !== lastDims[0] || H !== lastDims[1] || dpr !== lastDims[2] || vh !== lastDims[3] || flipped || !world;
    gridBottom = z.home.b;
    lastZ = z;
    if (!sized) {
      // Same page size (e.g. the shelf re-flowing): just move the walls; the mask follows shortly.
      applyZones(z);
      maskSoon(z);
      return;
    }
    lastDims = [W, H, dpr, vh];
    renderer.resize(W, H, dpr);
    const area = freeArea(z);
    const fish = nowMobile ? Math.round(Math.min(110, Math.max(56, (W * z.home.b) / 2600))) : Math.round(Math.min(340, Math.max(85, area / 4400)));
    if (!world || flipped) newWorld(z, fish);
    else applyZones(z);
    world.resize(W, H, renderer.cellWidth, renderer.cellHeight);
    placeView(true);
    buildMask(z);
    if (shown && !running) renderer.render(world, 0);
  };

  // ── palette (tweened with the page's own .5s background transition) ──
  let pal = readPalette();
  let from = pal, to = pal, tweenAt = -1, gridSwapped = true;
  renderer.setPalette(pal);
  const syncPalette = () => {
    const p = readPalette();
    if (JSON.stringify(p) === JSON.stringify(to)) return;
    from = pal;
    to = p;
    tweenAt = performance.now();
    gridSwapped = false;
    if (!running) requestAnimationFrame(stillTween);
  };
  const tickPalette = (now: number) => {
    if (tweenAt < 0) return false;
    const k = Math.min(1, (now - tweenAt) / 500);
    const e = ease(k);
    pal = {
      bg: lerp3(from.bg, to.bg, e), ink: lerp3(from.ink, to.ink, e), acc: lerp3(from.acc, to.acc, e),
      strength: lerp(from.strength, to.strength, e), grid: lerp(from.grid, to.grid, e),
    };
    if (k >= 1) (pal = to), (tweenAt = -1);
    // Tones follow every frame; the faint grid is repainted once, at the midpoint, and
    // cross-faded (repainting it each frame would cost a full-canvas raster per frame).
    const second = e >= 0.5;
    if (second && !gridSwapped) renderer.setPalette(to, true); // grid in the new theme
    renderer.setPalette(pal, false);
    if (second) gridSwapped = true;
    renderer.gridAlpha = k >= 1 ? 1 : Math.abs(1 - 2 * e);
    return true;
  };
  const stillTween = (now: number) => {
    if (running) return;
    if (tickPalette(now)) {
      renderer.render(world, 0);
      requestAnimationFrame(stillTween);
    }
  };
  new MutationObserver(syncPalette).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncPalette);
  window.addEventListener("pageshow", syncPalette);

  // ── loop (OceanEngine's) ──────────────────────────────────────────────
  let raf = 0, last = 0, acc = 0, running = false, shown = false;
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < MAX_STEPS) {
      world.step(STEP);
      acc -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS) acc = 0;
    placeView();
    tickPalette(now);
    renderer.render(world, dt);
    raf = requestAnimationFrame(frame);
  };
  const schedule = () => {
    cancelAnimationFrame(raf);
    running = false;
    if (!shown || document.hidden || reduced.matches) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };
  /** Reduced motion: let the ecosystem settle, then show a single frame (as upstream). */
  const drawStill = () => {
    if (!world) return;
    if (world.time < 4) for (let i = 0; i < 240; i++) world.step(STEP);
    renderer.render(world, STEP);
  };
  document.addEventListener("visibilitychange", schedule);
  reduced.addEventListener("change", () => (reduced.matches ? (schedule(), drawStill()) : schedule()));
  window.addEventListener("scroll", () => {
    if (!running && world && placeView()) renderer.render(world, 0);
  }, { passive: true });

  // ── pointer (fish shy from the cursor; a click in open water startles them) ─
  const interactive = "a,button,input,select,textarea,label,summary,[role=button],[tabindex],.tape,.unit,.bar,.flat";
  window.addEventListener("pointermove", (e) => {
    if (!world) return;
    const x = e.clientX + scrollX, y = e.clientY + scrollY;
    world.pointer.x = x;
    world.pointer.y = y;
    world.pointer.active = e.pointerType !== "touch" && world.isFree(x, y, 8);
  }, { passive: true });
  window.addEventListener("pointerdown", (e) => {
    if (!world || reduced.matches || !running) return;
    const t = e.target as Element | null;
    if (t && t.closest && t.closest(interactive)) return;
    const x = e.clientX + scrollX, y = e.clientY + scrollY;
    if (world.isFree(x, y, 8)) world.splash(x, y);
  }, { passive: true });
  const leave = () => world && (world.pointer.active = false);
  document.documentElement.addEventListener("pointerleave", leave);
  window.addEventListener("blur", leave);

  // ── relayout on any size change ───────────────────────────────────────
  let lraf = 0;
  const relayout = () => {
    cancelAnimationFrame(lraf);
    lraf = requestAnimationFrame(layout);
  };
  // Content reflows (filters, list view, a case opening) settle first; measuring mid-animation
  // would force a second layout every frame.
  let lt = 0;
  new ResizeObserver(() => {
    clearTimeout(lt);
    lt = window.setTimeout(relayout, 120);
  }).observe(wrap);
  window.addEventListener("resize", relayout);
  mq.addEventListener("change", relayout);

  // ── first paint: wait for the mono face and the mask, pre-settle the schools, then fade in ─
  let maskOk = false, fontOk = false;
  const maskReady = () => {
    maskOk = true;
    reveal();
  };
  const fontTimeout = new Promise((r) => setTimeout(r, 1600));
  Promise.race([fontLoaded, fontTimeout]).then(() => {
    fontOk = true;
    renderer.setFontFamily(getComputedStyle(canvas).fontFamily);
    reveal();
  });
  let warm = reduced.matches ? 10 : 0;
  const reveal = () => {
    if (shown || !maskOk || !fontOk) return;
    // ~1.5 s of simulation in small slices (no long task), so schools have formed before anyone sees them.
    if (warm < 10) {
      warm++;
      for (let i = 0; i < 9; i++) world.step(STEP);
      requestAnimationFrame(reveal);
      return;
    }
    shown = true;
    if (reduced.matches) drawStill();
    else renderer.render(world, STEP);
    canvas.classList.add("on");
    schedule();
  };

  layout();
  (window as any).__ash = { get world() { return world; }, renderer, layout, get view() { return [viewTop, viewH]; }, get obstacles() { return obstacles; }, get zones() { return lastZ; } };
}

// Load the original's mono face (Geist Mono 600) without blocking; subset to the drawn glyphs.
const fontLoaded = new Promise<unknown>((done) => {
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = "https://fonts.googleapis.com/css2?family=Geist+Mono:wght@600&display=swap&text=" +
    encodeURIComponent("-:;t%SX8#@'.,`o*·");
  l.onload = () => (document.fonts ? document.fonts.load(FONT).then(done, done) : done(0));
  l.onerror = done;
  document.head.appendChild(l);
});

// Start after the page's own first layout and paint, so measuring never forces a layout early.
const start = () => requestAnimationFrame(() => setTimeout(boot, 0));
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();
