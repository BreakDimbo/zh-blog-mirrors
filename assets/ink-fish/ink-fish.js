/*! ink-fish v1.2.1 — brush-ink fish swimming behind your page. MIT © 2026 BreakDimbo
    https://github.com/BreakDimbo/ink-fish

   One Canvas 2D (DPR <= 1.5) and one rAF loop per instance, paused when the tab is hidden, the host is
   off screen, or no open water is visible. Three depth layers (far minnows, mid carp, near koi), each
   with scroll parallax. Every fish has a spine of segments that follows its head's path. A body wave
   runs from head to tail, its tail beat tied to speed and thrust, and it swims in burst-and-glide
   rhythm. Fish school with their own layer (separation / alignment / cohesion), keep clear of
   obstacles and the headline, ease away from a fast cursor and drift curiously towards a still one.
   Soft shadows are drawn on a quarter-res layer and scaled up, so they cost no blur filter. Obstacles
   are erased from the canvas; ink under text is thinned. Layout is read only on resize/reflow, never
   inside the frame. Optional (v1.1): a fixed pond that stays put while the page scrolls over it,
   restrained water rings under the cursor that refract the fish they cross, and a few koi painted
   in muted pigment washes.

   Usage:   var fish = InkFish.mount(document.body, { obstacles: ".card" });  …  fish.destroy();
   or:      <body data-ink-fish>   (options as JSON in the attribute value)                          */
(function (root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.InkFish = api;
})(typeof window !== "undefined" ? window : this, function (Wn) {
  "use strict";
  var M = Math, PI = M.PI, TAU = PI * 2;

  var DEFAULTS = {
    count: "auto",            // "auto" (from the open area), a total number, or { minnow, carp, koi }
    density: 1,               // multiplies the open area used by "auto"
    theme: "auto",            // "auto" | "light" | "dark"; auto = <html data-theme>, else prefers-color-scheme
    ink: { light: "#1e1c19", dark: "#e8e2d8" }, // your page's text colour (one hex, or per theme); CSS var --ink-fish-ink on the host wins
    opacity: 1,               // multiplies the ink alpha
    shadow: 1,                // multiplies the lamp-shadow alpha; 0 turns shadows off
    reducedMotion: "auto",    // "auto" (respect prefers-reduced-motion) | true (always calm) | false (ignore)
    interactive: true,        // fish react to the cursor, taps and fast scrolling
    obstacles: "",            // selector: fish swim around these, and the canvas is erased under them
    bands: "",                // selector: full-width horizontal walls (e.g. a toolbar); avoided, not erased
    text: "",                 // selector, or [{ selector, keep, feather }]: ink thins under this text
    title: "",                // selector: the big koi give this element room
    hero: "",                 // selector: koi stay above its bottom (+160px, +40px on mobile)
    habitat: "",              // selector (page mode): the habitat ends at this element's bottom; default <body>
    ignore: "a,button,input,select,textarea,label,[data-ink-fish-ignore]", // taps here don't startle fish
    mobileQuery: "(max-width: 720px)",
    maxDpr: 1.5,
    fadeIn: true,
    fixed: false,             // page mode: true = the pond stays fixed while the page scrolls over it; false = scroll parallax
    ripples: false,           // faint water rings under the cursor (and on tap/click) that refract the fish they cross
    adaptive: true,           // drop to DPR 1 if frames keep arriving late
    koi: false                // true (a few, by width) or a number: koi painted in muted pigment washes
  };

  var hex = function (v) {
    var m = (v || "").trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return null;
    var h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1], n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  var assign = function (a) {
    for (var i = 1; i < arguments.length; i++) { var b = arguments[i]; if (b) for (var k in b) if (Object.prototype.hasOwnProperty.call(b, k)) a[k] = b[k]; }
    return a;
  };
  var instances = [];

  function mount(host, options) {
    var D = Wn.document;
    if (typeof host === "string") host = D.querySelector(host);
    if (!host || host === D.documentElement) host = D.body;
    if (!Wn.CanvasRenderingContext2D || !Wn.requestAnimationFrame || !host) return null;
    if (host.__inkFish) host.__inkFish.destroy();
    var O = assign({}, DEFAULTS, options);
    var page = host === D.body; // page mode: fixed viewport canvas with scroll parallax; else local to the host
    var q = function (sel) { if (!sel) return null; return typeof sel === "string" ? D.querySelector(sel) : sel; };
    var qa = function (sel) { if (!sel) return []; return typeof sel === "string" ? Array.prototype.slice.call(D.querySelectorAll(sel)) : [].concat(sel); };

    var MQ = function (s) { return Wn.matchMedia ? Wn.matchMedia(s) : { matches: false, addEventListener: function () {}, removeEventListener: function () {} }; };
    var RMQ = MQ("(prefers-reduced-motion: reduce)"), MOB = MQ(O.mobileQuery), DARKQ = MQ("(prefers-color-scheme: dark)");
    var RM = { get matches() { return O.reducedMotion === "auto" ? RMQ.matches : !!O.reducedMotion; } };
    var cv = D.createElement("canvas");
    cv.className = "ink-fish" + (page ? "" : " ink-fish--local");
    cv.setAttribute("aria-hidden", "true");
    cv.style.pointerEvents = "none";
    var hostPos = null;
    if (!page && getComputedStyle(host).position === "static") { hostPos = host.style.position; host.style.position = "relative"; }
    host.classList.add("ink-fish-host");
    host.insertBefore(cv, host.firstChild);
    var g = cv.getContext("2d");
    // shadows live on their own quarter-res canvas just beneath; the compositor scales it up, so the
    // main canvas never pays for a full-size blit
    var shc = D.createElement("canvas"), sg = shc.getContext("2d");
    shc.className = cv.className + " ink-fish--shadow";
    shc.setAttribute("aria-hidden", "true");
    host.insertBefore(shc, cv);
    var SH = 0.25; // shadow layer scale

    var vw = 0, vh = 0, dpr = 1, PW = 0, PH = 0, sy = page ? (Wn.scrollY || 0) : 0, heroB = 0, mobile = MOB.matches;
    var obs = [], walls = [], texts = [], title = null, fish = [], T = 0, dead = false, onScreen = true;
    var hyp = function (x, y) { return M.sqrt(x * x + y * y); }; // Math.hypot is slow in V8
    var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
    var rnd = function (a, b) { return a + M.random() * (b - a); };
    var wrapA = function (a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; };
    var sstep = function (a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
    // origin of the canvas in client coordinates (page mode: the viewport, so 0,0)
    var origin = function () { if (page) return [0, 0]; var r = host.getBoundingClientRect(); return [r.left + host.clientLeft, r.top + host.clientTop]; };

    // ── palette: ink on paper in light mode, pale ink on dark paper ────────────
    var pal = null, palFrom = null, palTo = null, palAt = -1;
    var isDark = function () {
      if (O.theme === "dark") return true;
      if (O.theme === "light") return false;
      var t = D.documentElement.getAttribute("data-theme");
      if (t === "dark") return true;
      if (t === "light") return false;
      return DARKQ.matches;
    };
    var readPal = function () {
      var dark = isDark(), src = O.ink;
      var css = hex(getComputedStyle(host).getPropertyValue("--ink-fish-ink"));
      var ink = css || hex(typeof src === "string" ? src : (src && (dark ? src.dark : src.light))) || (dark ? [232, 226, 216] : [30, 28, 25]);
      var op = +O.opacity, sh = +O.shadow;
      if (!(op >= 0)) op = 1;
      if (!(sh >= 0)) sh = 1;
      // ink: a warm sumi in light mode; in dark mode the page's pale ink, a touch warmer.
      // rs/rh: the shaded and lit side of a water ring; cin/och: cinnabar and ochre pigment; pa: pigment
      // alpha; wb: the wash on a pale koi's body
      return dark
        ? { ink: [ink[0] * 0.94 + 10, ink[1] * 0.92 + 6, ink[2] * 0.86], a: 1.12 * op, sh: [0, 0, 0], sa: 0.26 * sh,
            rs: [0, 0, 0], rsa: 0.5 * op, rh: [ink[0] * 0.7, ink[1] * 0.78, ink[2] * 0.9], rha: 0.2 * op,
            cin: [168, 62, 42], cid: [110, 36, 26], och: [190, 148, 86], ocd: [146, 102, 48], sumi: [24, 22, 20], pa: 0.76 * op,
            wh: [226, 220, 208], wb: 1.32, wl: 0.3, pc: 0.8, ob: 1.42, sp: 0.065, fn: 0.7, gr: 0, eye: [20, 18, 16] }
        : { ink: [ink[0] + 8, ink[1] + 4, ink[2]], a: 1 * op, sh: [52, 38, 22], sa: 0.13 * sh,
            rs: [38, 48, 60], rsa: 0.15 * op, rh: [255, 255, 252], rha: 0.5 * op,
            cin: [178, 62, 38], cid: [132, 40, 24], och: [178, 130, 62], ocd: [140, 92, 34], sumi: [28, 26, 24], pa: 0.7 * op,
            wh: [255, 253, 247], wb: 0.24, wl: 0.55, pc: 0.68, ob: 1, sp: 0.12, fn: 1, gr: 0.16, eye: [24, 22, 20] };
    };
    var mixPal = function (a, b, k) {
      var o = {};
      for (var key in b) {
        var x = a[key], y = b[key];
        o[key] = y instanceof Array ? y.map(function (v, i) { return x[i] + (v - x[i]) * k; }) : x + (y - x) * k;
      }
      return o;
    };
    var syncPal = function () {
      if (dead) return;
      var p = readPal();
      if (pal && JSON.stringify(p) === JSON.stringify(palTo)) return;
      if (!pal) { pal = palTo = p; return; }
      palFrom = pal; palTo = p; palAt = performance.now();
      wake();
    };
    var inkRGB = "", rsRGB = "", rhRGB = "", cinRGB = "", ochRGB = "", cidRGB = "", ocdRGB = "", sumiRGB = "", whRGB = "";
    var rgb = function (c) { return M.round(c[0]) + "," + M.round(c[1]) + "," + M.round(c[2]); };
    var tickPal = function (now) {
      if (palAt >= 0) {
        var k = clamp((now - palAt) / 500, 0, 1);
        pal = mixPal(palFrom, palTo, k * k * (3 - 2 * k));
        if (k >= 1) palAt = -1;
      }
      inkRGB = rgb(pal.ink); rsRGB = rgb(pal.rs); rhRGB = rgb(pal.rh); cinRGB = rgb(pal.cin); ochRGB = rgb(pal.och);
      cidRGB = rgb(pal.cid); ocdRGB = rgb(pal.ocd); sumiRGB = rgb(pal.sumi); whRGB = rgb(pal.wh);
    };

    // ── layout (read only on resize / reflow) ──────────────────────────────────
    var ox = 0, oy0 = 0;
    var rectOf = function (el, grow) {
      if (!el) return null;
      var r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      grow = grow || 0;
      return { l: r.left - ox - grow, t: r.top - oy0 + sy - grow, r: r.right - ox + grow, b: r.bottom - oy0 + sy + grow };
    };
    var textSpecs = function () {
      var t = O.text;
      if (!t) return [];
      if (typeof t === "string") return [{ selector: t }];
      return [].concat(t);
    };
    var fixedOn = function () { return page && !!O.fixed; };
    var cw = 0, ch = 0, cdpr = 0, dprCap = 9, fema = 16.7, fcount = 0;
    var measure = function () {
      var o = origin(); ox = o[0]; oy0 = o[1];
      sy = page ? (Wn.scrollY || 0) : 0;
      vw = page ? D.documentElement.clientWidth : host.clientWidth;
      vh = page ? Wn.innerHeight : host.clientHeight;
      dpr = M.min(Wn.devicePixelRatio || 1, +O.maxDpr || 1.5, dprCap);
      mobile = MOB.matches;
      var hr = fixedOn() ? null : rectOf(q(O.hero));
      heroB = hr ? hr.b : vh;
      if (fixedOn()) PH = vh; // a fixed pond is the viewport
      else if (page) {
        var hab = q(O.habitat) || D.body;
        PH = M.max(M.ceil(hab.getBoundingClientRect().bottom + sy), heroB);
      } else PH = M.max(vh, heroB);
      PW = vw;
      obs = [];
      qa(O.obstacles).forEach(function (el) { var r = rectOf(el); if (r) obs.push(r); });
      walls = obs.slice();
      qa(O.bands).forEach(function (el) { var b = rectOf(el); if (b) walls.push({ l: 0, t: b.t, r: vw, b: b.b }); }); // full-width walls
      texts = [];
      textSpecs().forEach(function (s) {
        if (typeof s === "string" || (s && s.nodeType)) s = { selector: s };
        var keep = s.keep != null ? +s.keep : 0.24, f = s.feather != null ? +s.feather : 30;
        qa(s.selector).forEach(function (el) { var r = rectOf(el); if (r) texts.push({ r: r, keep: keep, f: f }); });
      });
      title = rectOf(q(O.title), mobile ? 10 : 22);
      // resize the backing store only when the size really changes (setting width clears and reallocates it);
      // a mobile URL bar that shows/hides keeps the taller canvas instead of reallocating mid-scroll
      var W = vw, H = vh;
      if (page && W === cw && dpr === cdpr && H <= ch && H > ch - 200) H = ch;
      if (W !== cw || H !== ch || dpr !== cdpr) {
        cw = W; ch = H; cdpr = dpr;
        cv.width = M.round(W * dpr); cv.height = M.round(H * dpr);
        cv.style.width = W + "px"; cv.style.height = H + "px";
        shc.width = M.ceil(W * SH); shc.height = M.ceil(H * SH);
        shc.style.width = shc.width / SH + "px"; shc.style.height = shc.height / SH + "px";
      }
    };

    // ── species and population ────────────────────────────────────────────────
    // d: depth (0 far … 1 near). pz: scroll parallax (screen y = y − scrollY·pz).
    var KIND = [
      { name: "minnow", d: [0.2, 0.38], L: [15, 23], wr: 0.072, tl: 0.2, vmax: [34, 46], cruise: 0.42, school: 1, avoid: 0, fins: 0, tone: [0.1, 0.13] },
      { name: "carp", d: [0.5, 0.66], L: [32, 44], wr: 0.095, tl: 0.23, vmax: [38, 52], cruise: 0.2, school: 0.55, avoid: 1, fins: 1, tone: [0.17, 0.21] },
      { name: "koi", d: [0.86, 1], L: [62, 88], wr: 0.122, tl: 0.38, vmax: [30, 40], cruise: 0.08, school: 0.12, avoid: 1, fins: 2, tone: [0.27, 0.32], big: 1 },
      // nishikigoi: painted koi, a little larger and slower
      { name: "nishiki", d: [0.88, 1], L: [72, 96], wr: 0.13, tl: 0.4, vmax: [24, 32], cruise: 0.06, school: 0.1, avoid: 1, fins: 2, tone: [0.27, 0.31], big: 1, color: 1 }
    ];
    // varieties. A patch is laid out in body space (s along the spine 0…1, t across it −1…1, beyond ±1 it
    // wraps over the flank and is clipped by the silhouette) with a lobed, scalloped rim from a few seeded
    // harmonics, so every fish is painted differently and the pigment bends with the body as it swims.
    var seeded = function (a) { return function () { a = (a + 0x6d2b79f5) | 0; var t = M.imul(a ^ (a >>> 15), 1 | a); t = (t + M.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
    var PN = 18;
    var mkPatch = function (r, c, s0, t0, ds, dt, rough) {
      var R = function (a, b) { return a + r() * (b - a); }, H = [];
      // low harmonics bend the outline into lobes; the high ones scallop the rim like a brush edge
      H.push([2, R(0.04, 0.14) * rough, R(0, TAU)], [3, R(0.04, 0.11) * rough, R(0, TAU)], [5, R(0.02, 0.06) * rough, R(0, TAU)],
        [7, R(0.015, 0.035) * rough, R(0, TAU)], [9, R(0.008, 0.02) * rough, R(0, TAU)]);
      var tilt = R(-0.35, 0.35), core = new Float32Array(PN * 2), inner = new Float32Array(PN * 2), outer = new Float32Array(PN * 2);
      var bang = R(0, TAU), bx = M.cos(bang) * 0.16, by = M.sin(bang) * 0.16; // the side the wet edge bled toward
      var ic = R(-0.25, 0.25), cs = M.cos(tilt), sn = M.sin(tilt);
      for (var j = 0; j < PN; j++) {
        var th = j / PN * TAU, rr = 1;
        for (var h = 0; h < H.length; h++) rr += H[h][1] * M.sin(H[h][0] * th + H[h][2]);
        var x = M.cos(th), y = M.sin(th), xr = x * cs - y * sn, yr = x * sn + y * cs;
        core[j * 2] = s0 + ds * rr * xr; core[j * 2 + 1] = t0 + dt * rr * yr;
        // the bleed: a hair wider, with its own wobble, so the halo is not a constant offset
        var ro = rr * (1.12 + 0.06 * M.sin(7 * th + H[1][2]) + 0.03 * M.sin(5 * th + H[2][2]));
        outer[j * 2] = s0 + ds * (ro * xr + bx * 0.75); outer[j * 2 + 1] = t0 + dt * (ro * yr + by * 0.75);
        var ri = 0.5 + 0.1 * M.sin(3 * th + H[0][2]);
        inner[j * 2] = s0 + ds * (ic * 0.4 + rr * ri * xr); inner[j * 2 + 1] = t0 + dt * (ic + rr * ri * yr);
      }
      return { c: c, core: core, inner: inner, outer: outer, tv: R(0, 1), s0: s0, ds: ds };
    };
    var mkBrush = function (r, s0, sd, len, sw, wk) {
      // a sumi mark laid with a loaded brush: it lands off the flank, sweeps over the back and runs dry,
      // so the body of the stroke is solid and the end splits into bristle streaks
      var R = function (a, b) { return a + r() * (b - a); }, bow = R(-0.05, 0.05);
      var line = function (u0, u1, ds, dt) {
        var A = new Float32Array(14);
        for (var j = 0; j < 7; j++) {
          var u = u0 + (u1 - u0) * j / 6;
          A[j * 2] = s0 + ds + sw * u + bow * M.sin(u * PI);
          A[j * 2 + 1] = sd * (1.3 - u * len) + dt;
        }
        return A;
      };
      // full width while the brush is loaded, then lifting (narrower), then only the bristles
      var ue = R(0.48, 0.6), M0 = [line(-0.1, ue, 0, 0)], T0 = [line(ue - 0.1, ue + R(0.14, 0.24), R(-0.25, 0.25) * wk, 0)];
      if (r() < 0.6) M0.push(line(R(-0.1, 0.05), ue - R(0.05, 0.15), R(-1, 1) * wk * 0.45, 0));
      var C0 = [line(R(0.0, 0.1), R(0.3, 0.45), R(-0.3, 0.3) * wk, 0)], B0 = [];
      for (var b = 0; b < 5; b++) B0.push(line(ue - R(0.0, 0.18), ue + R(0.16, 0.5), (b / 4 - 0.5) * wk * 1.2 + R(-0.1, 0.1) * wk, R(-0.03, 0.03)));
      return { c: 1, br: 1, m: M0, t: T0, k: C0, b: B0 };
    };
    var VARIETY = [
      { name: "kohaku", body: "pale", patch: function (r) {
        var R = function (a, b) { return a + r() * (b - a); }, P = [];
        if (r() < 0.85) P.push(mkPatch(r, 0, R(0.1, 0.15), R(-0.15, 0.15), R(0.065, 0.085), R(0.75, 1.05), 1));
        var at = R(0.27, 0.33), n = 1 + (r() < 0.65) + (r() < 0.35);
        for (var k = 0; k < n && at < 0.7; k++) {
          var ds = R(0.07, 0.115), sc = M.min(0.74, at + ds);
          P.push(mkPatch(r, 0, sc, R(-0.55, 0.55), ds, R(0.85, 1.45), 1.15));
          at = sc + ds + R(0, 0.07);
        }
        return P;
      } },
      { name: "tancho", body: "pale", patch: function (r) { return [mkPatch(r, 0, 0.115 + r() * 0.02, (r() - 0.5) * 0.14, 0.056 + r() * 0.01, 0.62 + r() * 0.1, 0.5)]; } },
      { name: "yamabuki", body: "och", patch: function () { return []; } },
      { name: "showa", body: "pale", patch: function (r) {
        var R = function (a, b) { return a + r() * (b - a); }, P = [];
        P.push(mkPatch(r, 0, R(0.11, 0.16), R(-0.3, 0.3), R(0.06, 0.08), R(0.7, 1), 1.1));
        P.push(mkPatch(r, 0, R(0.42, 0.56), R(-0.5, 0.5), R(0.08, 0.11), R(0.7, 1.1), 1.2));
        // sumi: brush strokes that climb out of alternate flanks and wrap over the back, one short one on the head;
        // spaced so the white between them stays open
        var sd = r() < 0.5 ? -1 : 1, hi = P.slice(), over = 0;
        P.push(mkBrush(r, R(0.05, 0.08), sd, R(1.2, 1.6), R(0.02, 0.05), 0.03));
        for (var k = 0, at = R(0.2, 0.27), n = 3 + (r() < 0.4); k < n && at < 0.82; k++, sd = -sd) {
          // mostly laid in the white between the hi, so the two pigments read apart; one may cross a hi
          for (var h = 0; h < hi.length; h++) if (M.abs(at - hi[h].s0) < hi[h].ds * 0.9 && over++) at = hi[h].s0 + hi[h].ds * 1.15;
          if (at > 0.82) break;
          P.push(mkBrush(r, at, sd, R(1.3, 2.2), R(-0.1, 0.12), 0.06));
          at += R(0.12, 0.19);
        }
        return P;
      } }
    ];
    var varAt = (M.random() * VARIETY.length) | 0;
    var free = function (x, y, pad) {
      for (var i = 0; i < walls.length; i++) { var o = walls[i]; if (x > o.l - pad && x < o.r + pad && y > o.t - pad && y < o.b + pad) return false; }
      return true;
    };
    var heroEl = function () { return !!q(O.hero); };
    var koiB = PH;
    var habitatB = function (k) { return KIND[k].big ? koiB : PH; };
    var spawn = function (k, near) {
      var K = KIND[k], f = { k: k, K: K }, s = mobile ? 0.78 : 1, tries = 0;
      f.d = rnd(K.d[0], K.d[1]); f.pz = fixedOn() ? 0 : 0.55 + 0.45 * f.d;
      f.L = rnd(K.L[0], K.L[1]) * s; f.vmax = rnd(K.vmax[0], K.vmax[1]) * (mobile ? 0.85 : 1);
      f.tone = rnd(K.tone[0], K.tone[1]);
      var hb = habitatB(k);
      do {
        f.x = near ? near.x + rnd(-60, 60) : rnd(20, vw - 20);
        f.y = near ? near.y + rnd(-40, 40) : rnd(20, hb - 20);
        tries++;
      } while (tries < 40 && (K.avoid && !free(f.x, f.y + sy * (1 - f.pz), f.L)));
      f.a = near ? near.a + rnd(-0.4, 0.4) : rnd(-PI, PI);
      f.v = f.vmax * 0.3; f.w = 0; f.th = K.cruise; f.thT = K.cruise; f.mode = 0; f.tm = rnd(0, 2);
      f.ph = rnd(0, TAU); f.amp = f.L * 0.05; f.vm = 1; f.cur = M.random(); f.fade = 0;
      f.w1 = rnd(0.07, 0.16); f.w2 = rnd(0.21, 0.37); f.p1 = rnd(0, TAU); f.p2 = rnd(0, TAU);
      if (K.color) { f.V = VARIETY[varAt++ % VARIETY.length]; f.patch = f.V.patch(seeded((M.random() * 4294967296) | 0)); f.tA = null; f.clk = rnd(0, 60); }
      f.n = 11; f.seg = f.L / (f.n - 1); f.px = new Float32Array(f.n); f.py = new Float32Array(f.n);
      for (var i = 0; i < f.n; i++) { f.px[i] = f.x - M.cos(f.a) * f.seg * i; f.py[i] = f.y - M.sin(f.a) * f.seg * i; }
      return f;
    };
    var counts = function () {
      var C = O.count;
      // painted koi: true = a few by width (3–6 on desktop, 2 on mobile), or a number
      var nk = O.koi === true ? (mobile ? 2 : M.round(clamp(vw / 360, 3, 6))) : M.max(0, M.round(+O.koi) || 0);
      var withKoi = function (c) { if (nk && c[2]) c[2] = M.max(1, c[2] - nk + 1); c.push(nk); return c; }; // fewer ink koi beside painted ones
      if (C && typeof C === "object") return [M.max(0, C.minnow | 0), M.max(0, C.carp | 0), M.max(0, C.koi | 0), nk];
      if (typeof C === "number" || (typeof C === "string" && C !== "auto" && !isNaN(+C))) {
        var n = M.max(0, M.round(+C)), kq = n >= 6 ? M.max(1, M.round(n * 0.08)) : 0, cq = M.round(n * 0.3);
        return withKoi([M.max(0, n - kq - cq), cq, kq]);
      }
      // "auto": open water on the canvas (24 px grid), excluding the obstacles
      var area = 0, heroArea = vw * heroB, dn = +O.density > 0 ? +O.density : 1;
      for (var y = 12; y < PH; y += 24) for (var x = 12; x < vw; x += 24) if (free(x, y, 16)) area += 576;
      area *= dn;
      return withKoi([
        M.round(clamp(area / (mobile ? 10000 : 38000), mobile ? 10 : 16, mobile ? 20 : 36)),
        M.round(clamp(area / (mobile ? 26000 : 70000), mobile ? 4 : 8, mobile ? 8 : 18)),
        mobile ? 2 : M.round(clamp(heroArea * dn / 160000, 3, 5))
      ]);
    };
    var populate = function () {
      koiB = heroEl() && !fixedOn() ? heroB + (mobile ? 40 : 160) : PH;
      var c = counts(), minnows = c[0], carp = c[1], koi = c[2];
      fish = [];
      // minnows arrive in small schools
      while (fish.length < minnows) { var lead = spawn(0), n = 3 + (M.random() * 5) | 0; fish.push(lead); for (var j = 1; j < n && fish.length < minnows; j++) fish.push(spawn(0, lead)); }
      for (var k = 0; k < carp; k++) fish.push(k % 3 && fish.length ? spawn(1, fish[fish.length - 1].k === 1 ? fish[fish.length - 1] : null) : spawn(1));
      for (var qk = 0; qk < koi; qk++) fish.push(spawn(2));
      for (var nq = 0; nq < c[3]; nq++) fish.push(spawn(3));
      fish.sort(function (a, b) { return a.d - b.d; }); // paint far → near
    };
    // change the population in place: extra fish fade out, new ones fade in (no reshuffle)
    var reconcile = function () {
      koiB = heroEl() && !fixedOn() ? heroB + (mobile ? 40 : 160) : PH;
      var c = counts(), have = [0, 0, 0, 0];
      for (var i = 0; i < fish.length; i++) { var f = fish[i]; if (f.dying) continue; if (have[f.k] >= c[f.k]) f.dying = 1; else have[f.k]++; }
      for (var k = 0; k < 4; k++) while (have[k] < c[k]) { fish.push(spawn(k, k === 0 && M.random() < 0.6 && fish.length ? fish[(M.random() * fish.length) | 0] : null)); have[k]++; }
      fish.sort(function (a, b) { return a.d - b.d; });
      wake();
    };

    // ── input ─────────────────────────────────────────────────────────────────
    var ptr = { x: 0, y: 0, on: false, sp: 0, t: 0, idle: 9 }, svel = 0, lastSy = sy;
    var L_ = []; // listeners to remove on destroy
    var on = function (t, ev, fn, o) { t.addEventListener(ev, fn, o); L_.push([t, ev, fn, o]); };
    // ── water rings: a few at a time, spawned by distance and time, never per mousemove ──
    var rip = [], ripLast = { x: -1e5, y: -1e5, t: -1e5 }, RIP_LIFE = 3.6, RIP_MAX = 5, fronts = [];
    var rpz = function () { return page && !O.fixed ? 1 : 0; }; // in parallax mode the rings ride on the page
    var addRipple = function (x, y, s) {
      if (!O.ripples || RM.matches) return;
      if (rip.length >= RIP_MAX) rip.shift();
      rip.push({ x: x, y: y + sy * rpz(), t: 0, s: s, q: rnd(0, TAU) });
      wake();
    };
    var kick = function (f, k) { f.mode = 1; f.tm = rnd(0.35, 0.6); f.thT = M.max(f.thT, k); };
    var inside = function (x, y) { return page || (x >= 0 && y >= 0 && x <= vw && y <= vh); };
    on(Wn, "pointermove", function (e) {
      if (!O.interactive) return;
      if (e.pointerType === "touch") { ptr.on = false; return; }
      var o = origin(), cx = e.clientX - o[0], cy = e.clientY - o[1];
      var now = performance.now(), dt = M.max(8, now - ptr.t);
      var sp = hyp(cx - ptr.x, cy - ptr.y) / dt * 1000;
      ptr.sp = ptr.sp * 0.7 + sp * 0.3; ptr.x = cx; ptr.y = cy; ptr.t = now; ptr.idle = 0;
      ptr.on = inside(cx, cy) && free(cx, cy + sy, 6);
      if (ptr.on && O.ripples) {
        var rd = hyp(cx - ripLast.x, cy - ripLast.y);
        if (rd > 120 && now - ripLast.t > 340) { addRipple(cx, cy, clamp(0.34 + ptr.sp / 4200, 0.34, 0.62)); ripLast.x = cx; ripLast.y = cy; ripLast.t = now; }
      }
      wake();
    }, { passive: true });
    var off = function () { ptr.on = false; };
    on(D.documentElement, "pointerleave", off);
    on(Wn, "blur", off);
    var ignoreSel = function () { return [O.ignore, typeof O.obstacles === "string" ? O.obstacles : "", typeof O.bands === "string" ? O.bands : ""].filter(Boolean).join(","); };
    on(Wn, "pointerdown", function (e) {
      // a tap or click in open water startles the fish nearby (no ripple, no splash)
      if (!O.interactive) return;
      var t = e.target, sel = ignoreSel();
      if (RM.matches || (sel && t && t.closest && t.closest(sel))) return;
      var o = origin(), x = e.clientX - o[0], y = e.clientY - o[1];
      if (!inside(x, y) || !free(x, y + sy, 4)) return;
      addRipple(x, y, 1); // a single, slightly stronger ring (touch: ripples on tap only)
      ripLast.x = x; ripLast.y = y; ripLast.t = performance.now();
      for (var i = 0; i < fish.length; i++) {
        var f = fish[i], dx = f.x - x, dy = f.y - sy * f.pz - y, d = hyp(dx, dy);
        if (d < 240 * (0.6 + f.d)) { f.a = wrapA(f.a + clamp(wrapA(M.atan2(dy, dx) - f.a), -1.4, 1.4) * 0.5); kick(f, 1); }
      }
    }, { passive: true });
    if (page) on(Wn, "scroll", function () { sy = Wn.scrollY || 0; wake(); }, { passive: true });

    // ── simulation ────────────────────────────────────────────────────────────
    var ripR = function (r) { var t = r.t * (r.s >= 1 ? 1.12 : 1); return 78 * t / (1 + 0.2 * t); };
    var ripEnv = function (r) { var u = r.t / RIP_LIFE; return M.min(1, r.t / 0.2) * M.pow(M.max(0, 1 - u), 1.7) * r.s; };
    var step = function (dt) {
      T += dt;
      var rm = RM.matches;
      ptr.idle += dt;
      for (var ri = rip.length - 1; ri >= 0; ri--) { rip[ri].t += dt; if (rip[ri].t > RIP_LIFE || rm) rip.splice(ri, 1); }
      var gone = 0;
      for (var ci = 0; ci < fish.length; ci++) { fish[ci].hc = M.cos(fish[ci].a); fish[ci].hs = M.sin(fish[ci].a); } // headings, for schooling
      for (var i = 0; i < fish.length; i++) {
        var f = fish[i], K = f.K, L = f.L, oy = sy * (1 - f.pz); // page y = layer y + oy
        var ca = M.cos(f.a), sa = M.sin(f.a);
        var fx = ca * 1.6, fy = sa * 1.6;
        // wander: two slow incommensurate sines, so courses curve without repeating
        var wa = f.a + (M.sin(T * f.w1 + f.p1) * 0.65 + M.sin(T * f.w2 + f.p2) * 0.35) * 1.1;
        fx += M.cos(wa) * 0.8; fy += M.sin(wa) * 0.8;
        // school with fish of the same kind
        if (K.school > 0) {
          var R = M.min(L * 5.5, K.big ? 170 : 200), R2 = R * R, sep = L * 1.25, n = 0, ax = 0, ay = 0, cx = 0, cy = 0, sx = 0, sy2 = 0;
          for (var j = 0; j < fish.length; j++) {
            var o = fish[j];
            if (o === f || o.k !== f.k) continue;
            var dx = o.x - f.x, dy = o.y - f.y, d2 = dx * dx + dy * dy;
            if (d2 > R2) continue;
            var d = M.sqrt(d2) || 1;
            n++; ax += o.hc; ay += o.hs; cx += dx; cy += dy;
            if (d < sep) { var k = (1 - d / sep); sx -= dx / d * k; sy2 -= dy / d * k; }
          }
          if (n) {
            fx += (ax / n) * 1.1 * K.school + (cx / n) / R * 1.4 * K.school + sx * 2.6;
            fy += (ay / n) * 1.1 * K.school + (cy / n) / R * 1.4 * K.school + sy2 * 2.6;
          }
        }
        // pond edges: fish may slip a little past the sides, never far
        var mx = L * 0.6 + 30, hb = habitatB(f.k) - oy, top = 24;
        if (f.x < -L * 0.4 + mx) fx += (1 - (f.x + L * 0.4) / mx) * 3;
        if (f.x > vw + L * 0.4 - mx) fx -= (1 - (vw + L * 0.4 - f.x) / mx) * 3;
        if (f.y < top + mx) fy += (1 - (f.y - top) / mx) * 3;
        if (f.y > hb - mx) fy -= (1 - (hb - f.y) / mx) * 3;
        // keep clear of obstacles and bands (probe the head and a point ahead)
        if (K.avoid) {
          var Mg = 22 + L * 0.55;
          for (var p = 0; p < 2; p++) {
            var qx = f.x + ca * L * 1.3 * p, qy = f.y + oy + sa * L * 1.3 * p;
            for (var w = 0; w < walls.length; w++) {
              var r = walls[w];
              if (qx < r.l - Mg || qx > r.r + Mg || qy < r.t - Mg || qy > r.b + Mg) continue;
              var dl = qx - (r.l - Mg), dr = r.r + Mg - qx, dt2 = qy - (r.t - Mg), db = r.b + Mg - qy, mn = M.min(dl, dr, dt2, db), s = 3.2 * (1 - mn / (Mg + 40)) + 0.6;
              if (mn === dl) fx -= s; else if (mn === dr) fx += s; else if (mn === dt2) fy -= s; else fy += s;
            }
          }
          // the large fish give the headline room
          if (K.big && title) {
            var tx = clamp(f.x, title.l, title.r), ty = clamp(f.y + oy, title.t, title.b), ex = f.x - tx, ey = f.y + oy - ty, de = hyp(ex, ey);
            if (de < 50) { fx += (de ? ex / de : 0) * 1.4 * (1 - de / 50); fy += (de ? ey / de : -1) * 1.4 * (1 - de / 50); }
          }
        }
        // cursor: a quick movement scatters them; a still cursor in open water draws the curious ones in
        if (ptr.on && !rm) {
          var px = ptr.x, py = ptr.y + sy * f.pz, ex2 = f.x - px, ey2 = f.y - py, dp = hyp(ex2, ey2) || 1;
          var reach = (130 + L) * (0.5 + f.d * 0.7);
          if (ptr.sp > 900 && ptr.idle < 0.15 && dp < reach) {
            fx += ex2 / dp * 4.5; fy += ey2 / dp * 4.5; if (f.mode === 0 || f.thT < 0.8) kick(f, 0.9 + 0.1 * f.d);
          } else if (f.k > 0 && f.cur > 0.45 && ptr.idle > 0.5 && dp < 320) {
            var ring = 46 + L * 0.9, kk = clamp((dp - ring) / ring, -1, 1);
            fx -= ex2 / dp * kk * 1.5; fy -= ey2 / dp * kk * 1.5;
            if (dp < ring * 1.6) { f.vm = M.min(f.vm, 0.45); if (f.mode === 1 && f.thT > 0.5) f.thT = 0.3; } // hover and look, don't circle
          } else if (dp < reach * 0.7) {
            var kq = 1 - dp / (reach * 0.7); fx += ex2 / dp * kq * 1.6; fy += ey2 / dp * kq * 1.6;
          }
        }
        // a passing ring nudges the fish it crosses, outward
        for (var rj = 0; rj < rip.length; rj++) {
          var rp = rip[rj], rr = ripR(rp), rcx = f.x - rp.x, rcy = (f.y - sy * f.pz) - (rp.y - sy * rpz()), rdd = hyp(rcx, rcy) || 1, del = rdd - rr;
          if (del > -L * 0.5 && del < 16) { var ra0 = ripEnv(rp) * (1 - M.abs(del + L * 0.17) / (L * 0.67 + 16)); fx += rcx / rdd * ra0 * 1.6; fy += rcy / rdd * ra0 * 1.6; }
        }
        // a fast scroll is felt as a current: a few fish dart, the rest lean with it
        if (!rm && O.interactive && M.abs(svel) > 1400 && M.random() < dt * 0.9 * (1 - f.d * 0.5)) kick(f, 0.8);
        fy += clamp(svel / 2400, -1, 1) * 0.5 * (1.2 - f.d);

        // ── turning: limited curvature, eased angular velocity ──
        var da = wrapA(M.atan2(fy, fx) - f.a);
        var wmax = (0.45 + 2.1 * f.v / f.vmax) * (K.color ? 0.52 : K.big ? 0.7 : 1);
        var wt = clamp(da * 2.2, -wmax, wmax);
        f.w += (wt - f.w) * M.min(1, dt * (K.color ? 1.7 : 3));
        f.a = wrapA(f.a + f.w * dt);

        // ── rhythm: burst, then a long glide ──
        f.tm -= dt;
        if (f.tm <= 0) {
          if (f.mode === 1 || rm) { f.mode = 0; f.tm = rnd(1.1, 3.4) * (K.color ? 2.2 : K.big ? 1.6 : 1) * (rm ? 3 : 1); f.thT = K.cruise * rnd(0.6, 1.3); }
          else { f.mode = 1; f.tm = rnd(0.35, 0.8) * (0.7 + L / 120) * (K.color ? 1.5 : 1); f.thT = K.color ? rnd(0.35, 0.62) : rnd(0.55, 0.9); }
        }
        f.th += (f.thT - f.th) * M.min(1, dt * (f.thT > f.th ? 5 : 1.4));
        f.vm += (1 - f.vm) * M.min(1, dt * 0.6);
        var vt = f.vmax * (0.14 + 0.86 * f.th) * f.vm * (rm ? 0.35 : 1);
        if (K.color) { f.clk += dt; vt *= 0.8 + 0.2 * M.sin(f.clk * 0.21) * M.sin(f.clk * 0.077 + 1); } // a koi's pace drifts
        f.v += (vt - f.v) * M.min(1, dt * (vt > f.v ? 2.4 : 0.5));
        f.x += M.cos(f.a) * f.v * dt; f.y += M.sin(f.a) * f.v * dt;
        // tail beat: faster with speed and thrust, faster for small fish; wider when thrusting or turning
        var fq = (0.3 + 2.3 * f.th + 0.8 * f.v / f.vmax) * (f.fqL === L ? f.fqk : (f.fqL = L, f.fqk = M.pow(40 / L, 0.3)));
        f.ph += TAU * fq * dt;
        var at = L * (0.03 + 0.1 * f.th + 0.06 * M.min(1, M.abs(f.w)));
        f.amp += (at - f.amp) * M.min(1, dt * 4);
        // spine follows the head's path
        f.px[0] = f.x; f.py[0] = f.y;
        for (var s2 = 1; s2 < f.n; s2++) {
          var vx = f.px[s2 - 1] - f.px[s2], vy = f.py[s2 - 1] - f.py[s2];
          // joints bend at most ~11°, so a tight turn reads as a curve, never a fold
          var ja = M.atan2(vy, vx), pa = s2 === 1 ? f.a : M.atan2(f.py[s2 - 2] - f.py[s2 - 1], f.px[s2 - 2] - f.px[s2 - 1]);
          ja = pa + clamp(wrapA(ja - pa), -0.2, 0.2);
          f.px[s2] = f.px[s2 - 1] - M.cos(ja) * f.seg; f.py[s2] = f.py[s2 - 1] - M.sin(ja) * f.seg;
        }
        if (f.dying) { f.fade -= dt * 0.6; if (f.fade <= 0) { f.dead = 1; gone++; } }
        else f.fade = M.min(1, f.fade + dt * 0.5);
      }
      if (gone) fish = fish.filter(function (f) { return !f.dead; });
    };

    // ── drawing ───────────────────────────────────────────────────────────────
    var N = 11, CX = new Float32Array(N), CY = new Float32Array(N), NX = new Float32Array(N), NY = new Float32Array(N), WD = new Float32Array(N);
    var LX = new Float32Array(N), LY = new Float32Array(N), RX = new Float32Array(N), RY = new Float32Array(N);
    var shape = function (s) {
      // top-down fish: rounded head, widest at a third, slender peduncle
      return s < 0.3 ? 0.5 + 0.5 * M.sin(s / 0.3 * PI / 2) : 0.13 + 0.87 * M.pow(M.cos((s - 0.3) / 0.7 * PI / 2), 1.25);
    };
    var BANK = 0;
    var kshape = function (s) { return s < 0.3 ? 0.64 + 0.36 * M.sin(s / 0.3 * PI / 2) : shape(s); };
    // the spine has a fixed number of points, so both outlines are tabulated once
    var SHP = new Float32Array(N), KSHP = new Float32Array(N);
    for (var si = 0; si < N; si++) { SHP[si] = shape(si / (N - 1)); KSHP[si] = kshape(si / (N - 1)); }
    var spine = function (f, oy) {
      var n = f.n;
      for (var i = 0; i < n; i++) {
        var s = i / (n - 1), a = f.px[i], b = f.py[i] - oy;
        var i0 = i > 0 ? i - 1 : 0, i1 = i < n - 1 ? i + 1 : n - 1;
        var tx = f.px[i0] - f.px[i1], ty = f.py[i0] - f.py[i1], tl = hyp(tx, ty) || 1;
        var nx = -ty / tl, ny = tx / tl;
        var o = f.amp * (0.14 + 0.86 * s * s) * M.sin(f.ph - s * 5.4);
        CX[i] = a + nx * o; CY[i] = b + ny * o;
      }
      // refraction: a ring passing over the fish bends its outline a pixel or two, radially
      for (var fr = 0; fr < fronts.length; fr++) {
        var F0 = fronts[fr], hdx = CX[0] - F0.x, hdy = CY[0] - F0.y, hd = M.sqrt(hdx * hdx + hdy * hdy);
        if (M.abs(hd - F0.r) > f.L + F0.b) continue;
        for (var pi = 0; pi < n; pi++) {
          var ddx = CX[pi] - F0.x, ddy = CY[pi] - F0.y, dd = M.sqrt(ddx * ddx + ddy * ddy) || 1, de = dd - F0.r;
          if (de <= -F0.b || de >= F0.b) continue;
          var disp = 2.6 * F0.a * M.sin(PI * de / F0.b);
          CX[pi] += ddx / dd * disp; CY[pi] += ddy / dd * disp;
        }
      }
      var bank = clamp(f.w * 0.22, -0.3, 0.3); BANK = bank;
      for (var k = 0; k < n; k++) {
        var j0 = k > 0 ? k - 1 : 0, j1 = k < n - 1 ? k + 1 : n - 1;
        var ux = CX[j0] - CX[j1], uy = CY[j0] - CY[j1], ul = hyp(ux, uy) || 1;
        NX[k] = -uy / ul; NY[k] = ux / ul;
        var w = f.L * f.K.wr * (f.K.color ? KSHP : SHP)[k] * (1 - M.abs(bank) * 0.25);
        WD[k] = w;
        LX[k] = CX[k] + NX[k] * w * (1 + bank); LY[k] = CY[k] + NY[k] * w * (1 + bank);
        RX[k] = CX[k] - NX[k] * w * (1 - bank); RY[k] = CY[k] - NY[k] * w * (1 - bank);
      }
    };
    var bodyPath = function (c, f, sc, dx, dy) {
      var n = f.n, hx = CX[0] - CX[1], hy = CY[0] - CY[1], hl = hyp(hx, hy) || 1;
      var tn = f.K.color ? 0.035 : 0.05, tipX = CX[0] + hx / hl * f.L * tn, tipY = CY[0] + hy / hl * f.L * tn;
      c.moveTo((tipX + dx) * sc, (tipY + dy) * sc);
      c.quadraticCurveTo((LX[0] + dx) * sc, (LY[0] + dy) * sc, ((LX[0] + LX[1]) / 2 + dx) * sc, ((LY[0] + LY[1]) / 2 + dy) * sc);
      for (var i = 1; i < n - 1; i++) c.quadraticCurveTo((LX[i] + dx) * sc, (LY[i] + dy) * sc, ((LX[i] + LX[i + 1]) / 2 + dx) * sc, ((LY[i] + LY[i + 1]) / 2 + dy) * sc);
      c.lineTo((LX[n - 1] + dx) * sc, (LY[n - 1] + dy) * sc);
      c.lineTo((RX[n - 1] + dx) * sc, (RY[n - 1] + dy) * sc);
      for (var k = n - 2; k > 0; k--) c.quadraticCurveTo((RX[k] + dx) * sc, (RY[k] + dy) * sc, ((RX[k] + RX[k - 1]) / 2 + dx) * sc, ((RY[k] + RY[k - 1]) / 2 + dy) * sc);
      c.quadraticCurveTo((RX[0] + dx) * sc, (RY[0] + dy) * sc, (tipX + dx) * sc, (tipY + dy) * sc);
    };
    var shadowPath = function (c, f, sc, dx, dy) {
      // the shadow is drawn at quarter size and blurred, so a coarse polygon (every other spine point) is enough
      var n = f.n, i;
      c.moveTo((CX[0] + dx) * sc, (CY[0] + dy) * sc);
      for (i = 1; i < n; i += 2) c.lineTo((LX[i] + dx) * sc, (LY[i] + dy) * sc);
      c.lineTo((CX[n - 1] + dx) * sc, (CY[n - 1] + dy) * sc);
      for (i = n - 2; i > 0; i -= 2) c.lineTo((RX[i] + dx) * sc, (RY[i] + dy) * sc);
      c.closePath();
    };
    var tailPath = function (c, f, sc, dx, dy) {
      var n = f.n, e = n - 1, bx = CX[e], by = CY[e];
      var ta = M.atan2(CY[e] - CY[e - 2], CX[e] - CX[e - 2]);
      var lag = M.sin(f.ph - 5.4 - 1.1); // the fin trails the peduncle
      ta += lag * clamp(f.amp / f.L * 3.2, 0, 0.55);
      var lt = f.L * f.K.tl, spr = 0.36 + 0.16 * (1 - f.th), bend = lag * (f.K.big ? 0.4 : 0.22);
      var t1 = ta + spr, t2 = ta - spr, w = WD[e] * 1.1;
      var nx = -M.sin(ta), ny = M.cos(ta), ux = M.cos(ta), uy = M.sin(ta);
      var p = function (x, y) { return [(x + dx) * sc, (y + dy) * sc]; };
      var A = p(bx + nx * w, by + ny * w), B = p(bx - nx * w, by - ny * w);
      var X1 = p(bx + M.cos(t1) * lt, by + M.sin(t1) * lt), X2 = p(bx + M.cos(t2) * lt, by + M.sin(t2) * lt);
      var C1 = p(bx + M.cos(t1 - bend) * lt * 0.55, by + M.sin(t1 - bend) * lt * 0.55), C2 = p(bx + M.cos(t2 - bend) * lt * 0.55, by + M.sin(t2 - bend) * lt * 0.55);
      var Nn = p(bx + ux * lt * 0.48, by + uy * lt * 0.48), NC1 = p(bx + M.cos(ta + spr * 0.5) * lt * 0.78, by + M.sin(ta + spr * 0.5) * lt * 0.78), NC2 = p(bx + M.cos(ta - spr * 0.5) * lt * 0.78, by + M.sin(ta - spr * 0.5) * lt * 0.78);
      c.moveTo(A[0], A[1]);
      c.quadraticCurveTo(C1[0], C1[1], X1[0], X1[1]);
      c.quadraticCurveTo(NC1[0], NC1[1], Nn[0], Nn[1]);
      c.quadraticCurveTo(NC2[0], NC2[1], X2[0], X2[1]);
      c.quadraticCurveTo(C2[0], C2[1], B[0], B[1]);
      c.closePath();
      return [bx, by, ta, lt, spr];
    };
    var finPath = function (c, f, i, side, len, splay) {
      // a teardrop fin from the body edge, swept back, its tip trailing the stroke
      var bx = CX[i] + NX[i] * WD[i] * 0.8 * side, by = CY[i] + NY[i] * WD[i] * 0.8 * side;
      var tx = CX[i] - CX[i + 1], ty = CY[i] - CY[i + 1], tl = hyp(tx, ty) || 1; tx /= tl; ty /= tl; // forward
      var bk = M.PI - splay, cs = M.cos(bk), sn = M.sin(bk) * side;
      var dx = tx * cs - ty * sn, dy = tx * sn + ty * cs; // rotate forward by (π − splay) towards the side
      var ex = bx + dx * len, ey = by + dy * len;
      var px = -dy, py = dx;
      c.moveTo(bx + tx * len * 0.16, by + ty * len * 0.16);
      c.quadraticCurveTo(bx + dx * len * 0.55 + px * len * 0.28 * side + tx * len * 0.1, by + dy * len * 0.55 + py * len * 0.28 * side + ty * len * 0.1, ex, ey);
      c.quadraticCurveTo(bx + dx * len * 0.4 - tx * len * 0.12, by + dy * len * 0.4 - ty * len * 0.12, bx - tx * len * 0.14, by - ty * len * 0.14);
      c.closePath();
    };
    var fadeAt = function (x, y) {
      // ink thins under text (screen coordinates)
      var k = 1;
      for (var i = 0; i < texts.length; i++) {
        var t = texts[i], r = t.r, top = r.t - sy, bot = r.b - sy;
        var ddx = x < r.l ? r.l - x : x > r.r ? x - r.r : 0, ddy = y < top ? top - y : y > bot ? y - bot : 0;
        if (ddx > t.f || ddy > t.f) continue;
        var d = M.sqrt(ddx * ddx + ddy * ddy);
        k = M.min(k, t.keep + (1 - t.keep) * sstep(0, t.f, d));
      }
      return k;
    };

    var stats = { n: 0, ms: 0, max: 0, drawn: 0, ring: new Float32Array(600), get dpr() { return dpr; } };
    // colour strings are cached per colour and alpha step (1/1000), so a frame builds almost none
    var RGBC = {}, RGBN = 0, inkG = null, inkGc = "";
    var rgba = function (c, a) {
      var q = a <= 0 ? 0 : a >= 1 ? 1000 : (a * 1000 + 0.5) | 0, cc = RGBC[c];
      if (!cc) { if (++RGBN > 48) { RGBC = {}; RGBN = 1; } cc = RGBC[c] = []; } // a theme cross-fade mints new colours
      return cc[q] || (cc[q] = "rgba(" + c + "," + q / 1000 + ")");
    };
    // ── painted koi ───────────────────────────────────────────────────────────
    // one small tile, made once: granulation, pigment settling into the paper's tooth
    var tile = function (n, paint) { var c = D.createElement("canvas"); c.width = c.height = n; paint(c.getContext("2d"), n); return c; };
    var grainT = tile(96, function (c, n) {
      // fine, uneven tooth: many faint specks, a few clustered darker ones
      for (var i = 0; i < 2200; i++) { c.fillStyle = "rgba(0,0,0," + (0.08 + M.random() * M.random() * 0.5).toFixed(2) + ")"; c.fillRect(M.random() * n, M.random() * n, 0.6 + M.random() * 0.7, 0.6 + M.random() * 0.7); }
    });
    var grainP = null, koiLite = false, PM = typeof DOMMatrix === "function" ? new DOMMatrix() : null;
    var patTo = function (P, x, y, a, k) {
      if (!P || !PM || !P.setTransform) return;
      var c = M.cos(a) * k, s = M.sin(a) * k;
      PM.a = c; PM.b = s; PM.c = -s; PM.d = c; PM.e = x; PM.f = y;
      P.setTransform(PM);
    };
    // body space → screen: s along the spine (0 snout … 1 peduncle), t across it in half-widths
    var QX = 0, QY = 0, TMAX = 0.98;
    var bmap = function (F, s, t) {
      // t is held just inside the silhouette (per side, as the body banks), and narrowed near the snout,
      // so pigment that "wraps over the flank" stops at the outline without a clip
      var e = F.n - 1, tm = TMAX * M.min(1, 0.5 + s * 5);
      if (s < 0.01) s = 0.01;
      t = t > tm ? tm : t < -tm ? -tm : t;
      t *= t > 0 ? 1 + BANK : 1 - BANK;
      var u = M.min(s, 1) * e, i = M.min(e - 1, u | 0), k = u - i, w = WD[i] + (WD[i + 1] - WD[i]) * k;
      QX = CX[i] + (CX[i + 1] - CX[i]) * k + (NX[i] + (NX[i + 1] - NX[i]) * k) * w * t;
      QY = CY[i] + (CY[i + 1] - CY[i]) * k + (NY[i] + (NY[i + 1] - NY[i]) * k) * w * t;
    };
    var RX2 = new Float32Array(64), RY2 = new Float32Array(64), DX = new Float32Array(N), DY = new Float32Array(N), DW = new Float32Array(N);
    var ring = function (P, F, A) {
      // a closed, smoothed outline through body-space points (quadratics between midpoints), added to P
      var n = A.length / 2;
      for (var j = 0; j < n; j++) { bmap(F, A[j * 2], A[j * 2 + 1]); RX2[j] = QX; RY2[j] = QY; }
      P.moveTo((RX2[n - 1] + RX2[0]) / 2, (RY2[n - 1] + RY2[0]) / 2);
      for (var k = 0; k < n; k++) { var kn = k + 1 < n ? k + 1 : 0; P.quadraticCurveTo(RX2[k], RY2[k], (RX2[k] + RX2[kn]) / 2, (RY2[k] + RY2[kn]) / 2); }
      P.closePath();
    };
    var stroke7 = function (P, F, A) {
      // an open, smoothed line through 7 body-space points, added to P (t is not held inside here: the caller clips)
      for (var j = 0; j < 7; j++) {
        var s = A[j * 2], t = A[j * 2 + 1], e = F.n - 1;
        if (s < 0.01) s = 0.01;
        t *= t > 0 ? 1 + BANK : 1 - BANK;
        var u = M.min(s, 1) * e, i = M.min(e - 1, u | 0), k = u - i, w = WD[i] + (WD[i + 1] - WD[i]) * k;
        RX2[j] = CX[i] + (CX[i + 1] - CX[i]) * k + (NX[i] + (NX[i + 1] - NX[i]) * k) * w * t;
        RY2[j] = CY[i] + (CY[i + 1] - CY[i]) * k + (NY[i] + (NY[i + 1] - NY[i]) * k) * w * t;
      }
      P.moveTo(RX2[0], RY2[0]);
      for (var q = 1; q < 6; q++) P.quadraticCurveTo(RX2[q], RY2[q], (RX2[q] + RX2[q + 1]) / 2, (RY2[q] + RY2[q + 1]) / 2);
      P.lineTo(RX2[6], RY2[6]);
    };
    var band = function (F, k) {
      // the body narrowed to k of its width, tapered shut at the snout: a band down the back
      var P = new Path2D(), e = F.n - 1;
      P.moveTo(CX[0], CY[0]);
      for (var i = 1; i <= e; i++) { var w = WD[i] * k * M.min(1, i / 2) * (1 + BANK); P.lineTo(CX[i] + NX[i] * w, CY[i] + NY[i] * w); }
      for (var j = e; j >= 1; j--) { var w2 = WD[j] * k * M.min(1, j / 2) * (1 - BANK); P.lineTo(CX[j] - NX[j] * w2, CY[j] - NY[j] * w2); }
      P.closePath();
      return P;
    };
    var koiFin = function (P, R, F, i, side, len, splay) {
      // a long rounded fan from the body edge, swept back; its rays drawn into R
      var bx = CX[i] + NX[i] * WD[i] * 0.88 * side, by = CY[i] + NY[i] * WD[i] * 0.88 * side; // rooted at the edge, so nothing shows through the body
      var tx = CX[i] - CX[i + 1], ty = CY[i] - CY[i + 1], tl = hyp(tx, ty) || 1; tx /= tl; ty /= tl;
      var dir = function (a) { var bk = PI - a, cs = M.cos(bk), sn = M.sin(bk) * side; return [tx * cs - ty * sn, tx * sn + ty * cs]; };
      var d0 = dir(splay + 0.36), d1 = dir(splay - 0.3), dm = dir(splay + 0.05), dl = dir(splay + 0.5), dt2 = dir(splay - 0.42);
      P.moveTo(bx + tx * len * 0.12, by + ty * len * 0.12);
      P.quadraticCurveTo(bx + dl[0] * len * 0.55, by + dl[1] * len * 0.55, bx + d0[0] * len * 0.9, by + d0[1] * len * 0.9);
      P.quadraticCurveTo(bx + dm[0] * len * 1.22, by + dm[1] * len * 1.22, bx + d1[0] * len * 0.82, by + d1[1] * len * 0.82);
      P.quadraticCurveTo(bx + dt2[0] * len * 0.42, by + dt2[1] * len * 0.42, bx - tx * len * 0.12, by - ty * len * 0.12);
      P.closePath();
      for (var r = 0; r < 6; r++) {
        var dr = dir(splay + 0.3 - r * 0.115), lr = len * (0.86 + 0.1 * M.sin(r / 5 * PI));
        R.moveTo(bx + dr[0] * len * 0.14, by + dr[1] * len * 0.14); R.lineTo(bx + dr[0] * lr, by + dr[1] * lr);
      }
    };
    var koiTail = function (P, R, F) {
      // long and loose: it lags behind the peduncle on a turn, and each lobe lags a little more
      var e = F.n - 1, bx = CX[e], by = CY[e];
      var ta = M.atan2(CY[e] - CY[e - 2], CX[e] - CX[e - 2]), lag = M.sin(F.ph - 6.5);
      ta += lag * clamp(F.amp / F.L * 3.2, 0, 0.55);
      if (F.tA === null) F.tA = ta;
      F.tA = wrapA(F.tA + wrapA(ta - F.tA) * 0.2);
      var A = F.tA, drag = clamp(wrapA(A - ta), -0.5, 0.5), lt = F.L * 0.42, spr = 0.34 + 0.14 * (1 - F.th);
      var bend = lag * 0.45 - drag * 0.8, w = WD[e] * 1.15, nx = -M.sin(A), ny = M.cos(A);
      var pt = function (a, l) { return [bx + M.cos(a) * l, by + M.sin(a) * l]; };
      var X1 = pt(A + spr - bend * 0.25, lt), X2 = pt(A - spr - bend * 0.25, lt * 0.97);
      var C1 = pt(A + spr * 1.05 - bend, lt * 0.5), C2 = pt(A - spr * 1.05 - bend, lt * 0.5);
      var Nn = pt(A - bend * 0.3, lt * 0.5), N1 = pt(A + spr * 0.5 - bend * 0.4, lt * 0.82), N2 = pt(A - spr * 0.5 - bend * 0.4, lt * 0.8);
      P.moveTo(bx + nx * w, by + ny * w);
      P.quadraticCurveTo(C1[0], C1[1], X1[0], X1[1]);
      P.quadraticCurveTo(N1[0], N1[1], Nn[0], Nn[1]);
      P.quadraticCurveTo(N2[0], N2[1], X2[0], X2[1]);
      P.quadraticCurveTo(C2[0], C2[1], bx - nx * w, by - ny * w);
      P.closePath();
      for (var r = -4; r <= 4; r++) {
        var u = r / 4, ra = A + u * spr * 0.95 - bend * 0.25 * M.abs(u), rl = lt * (0.56 + 0.4 * M.abs(u)), mc = pt(A + u * spr * 0.9 - bend * 0.7, rl * 0.5);
        R.moveTo(bx, by); R.quadraticCurveTo(mc[0], mc[1], bx + M.cos(ra) * rl, by + M.sin(ra) * rl);
      }
    };
    var drawKoi = function (F, al, fa) {
      var e = F.n - 1, V = F.V, pa = pal.pa * fa, gold = V.body === "och";
      if (!grainP) grainP = g.createPattern(grainT, "repeat");
      var hx = CX[0], hy = CY[0], ha = M.atan2(CY[0] - CY[2], CX[0] - CX[2]);
      // fins and tail: thin washes with fine rays, a slightly firmer wet edge
      var FP = new Path2D(), RP = new Path2D();
      koiTail(FP, RP, F);
      var lagP = M.sin(F.ph * 0.5 - 1.2), fl = F.L * 0.27, tw = clamp(F.w * 0.45, -0.35, 0.35);
      koiFin(FP, RP, F, 2, 1, fl, 0.55 + 0.7 * (1 - F.th) + 0.14 * lagP + tw);
      koiFin(FP, RP, F, 2, -1, fl, 0.55 + 0.7 * (1 - F.th) + 0.14 * M.sin(F.ph * 0.5 + 0.5) - tw);
      koiFin(FP, RP, F, 5, 1, fl * 0.5, 0.6 + 0.5 * (1 - F.th) + 0.1 * lagP);
      koiFin(FP, RP, F, 5, -1, fl * 0.5, 0.6 + 0.5 * (1 - F.th) - 0.1 * lagP);
      var finC = gold ? ochRGB : inkRGB, finA = (gold ? pa * 0.3 : al * 0.2) * pal.fn;
      g.fillStyle = rgba(finC, finA); g.fill(FP);
      if (!koiLite) { g.lineWidth = 0.7; g.strokeStyle = rgba(finC, finA * 0.9); g.stroke(FP); }
      g.lineWidth = 0.45; g.strokeStyle = rgba(gold ? ocdRGB : inkRGB, gold ? pa * 0.32 : al * 0.34); g.stroke(RP);
      // the body: a pale wash, lit along the back and shading off into the flanks
      var BP = new Path2D(); bodyPath(BP, F, 1, 0, 0);
      var gr = g.createLinearGradient(CX[0], CY[0], CX[e], CY[e]);
      if (gold) {
        var ob = pa * pal.ob;
        gr.addColorStop(0, rgba(ochRGB, ob * 0.74)); gr.addColorStop(0.55, rgba(ochRGB, ob * 0.6)); gr.addColorStop(1, rgba(ochRGB, ob * 0.28));
      } else {
        var wb = al * pal.wb;
        gr.addColorStop(0, rgba(inkRGB, wb * 1.05)); gr.addColorStop(0.5, rgba(inkRGB, wb * 0.8)); gr.addColorStop(1, rgba(inkRGB, wb * 0.5));
      }
      g.fillStyle = gr; g.fill(BP);
      if (gold) {
        // yamabuki: the gold deepens down the spine and pales toward the belly
        g.fillStyle = rgba(ocdRGB, pa * pal.sp * 1.1); g.fill(band(F, 0.72));
        g.fillStyle = rgba(ocdRGB, pa * pal.sp * 0.8); g.fill(band(F, 0.38));
      } else {
        // white koi: the back catches the light, the flanks keep the ink
        g.fillStyle = rgba(whRGB, fa * pal.wl * 0.36);
        g.fill(band(F, 0.8)); if (!koiLite) g.fill(band(F, 0.42));
      }
      // pigment, one colour at a time (sumi over cinnabar): a soft bleed, the wash, a darker wet rim where
      // it dried, a paler heart, then granulation
      var P = F.patch;
      var BR = [];
      for (var pc = 0; pc < 2; pc++) {
        var CP = null, OP = null, IP = null, tv = 0, sumi = pc === 1;
        for (var i = 0; i < P.length; i++) {
          var p = P[i];
          if (p.c !== pc) continue;
          if (p.br) { BR.push(p); continue; }
          if (!CP) { CP = new Path2D(); OP = new Path2D(); IP = new Path2D(); tv = p.tv; }
          ring(CP, F, p.core); if (!koiLite) { ring(OP, F, p.outer); if (!sumi) ring(IP, F, p.inner); }
        }
        if (!CP) continue;
        var ca = (sumi ? fa * 0.84 : pa) * 0.93, col = sumi ? sumiRGB : cinRGB;
        // the bleed: a thin, lopsided wash beyond the edge, wider on the side it ran toward
        if (!koiLite) { g.fillStyle = rgba(col, ca * 0.2); g.fill(OP); }
        // the wash itself is translucent, so the body's shading shows through, and it pools unevenly down the body
        var pk = ca * pal.pc * (sumi ? 0.86 : 1), pg = g.createLinearGradient(hx, hy, CX[e], CY[e]);
        for (var q = 0; q < 3; q++) pg.addColorStop(q / 2, rgba(col, pk * (0.8 + 0.28 * M.sin(q * 3.3 + tv * TAU))));
        g.fillStyle = pg; g.fill(CP);
        g.lineWidth = sumi ? 1.1 : 0.9; g.lineJoin = "round"; g.strokeStyle = rgba(sumi ? sumiRGB : cidRGB, ca * (sumi ? 0.24 : 0.32)); g.stroke(CP);
        if (koiLite) continue;
        if (!sumi) { g.fillStyle = rgba(whRGB, ca * pal.wl * 0.26); g.fill(IP); }
        // granulation: the tile at device scale and on whole device pixels, the cheapest pattern to rasterise
        if (grainP && pal.gr > 0) { patTo(grainP, M.round(hx * dpr) / dpr, M.round(hy * dpr) / dpr, 0, 1 / dpr); g.globalAlpha = sumi ? pal.gr * 0.7 : pal.gr; g.fillStyle = grainP; g.fill(CP); g.globalAlpha = 1; }
      }
      if (BR.length) {
        // sumi brushwork, clipped to the body so the strokes wrap off the flanks: a loaded stroke, a darker
        // pool where the brush pressed, and the dry streaks it trails; the layers overlap at different strengths
        var MP = new Path2D(), TP = new Path2D(), KP = new Path2D(), DP = new Path2D(), sa = fa * 0.84 * 0.93;
        for (var bi = 0; bi < BR.length; bi++) {
          var bq = BR[bi], bj;
          for (bj = 0; bj < bq.m.length; bj++) stroke7(MP, F, bq.m[bj]);
          for (bj = 0; bj < bq.k.length; bj++) stroke7(KP, F, bq.k[bj]);
          stroke7(TP, F, bq.t[0]);
          if (!koiLite) for (bj = 0; bj < bq.b.length; bj++) stroke7(DP, F, bq.b[bj]);
        }
        g.save(); g.clip(BP);
        g.lineCap = "round"; g.lineJoin = "round";
        if (!koiLite) { g.strokeStyle = rgba(sumiRGB, sa * 0.1); g.lineWidth = F.L * 0.12; g.stroke(MP); }
        g.strokeStyle = rgba(sumiRGB, sa * pal.pc * 0.95); g.lineWidth = F.L * 0.088; g.stroke(MP);
        g.lineWidth = F.L * 0.05; g.stroke(TP);
        if (!koiLite) { g.lineCap = "butt"; g.strokeStyle = rgba(sumiRGB, sa * pal.pc * 0.5); g.lineWidth = F.L * 0.006 + 0.35; g.stroke(DP); g.lineCap = "round"; }
        g.strokeStyle = rgba(sumiRGB, sa * pal.pc * 0.42); g.lineWidth = F.L * 0.05; g.stroke(KP);
        g.restore();
      }
      // outline, as on paper
      g.strokeStyle = rgba(inkRGB, al * (gold ? 0.3 : 0.46));
      g.lineWidth = 0.75; g.stroke(BP);
      // dorsal fin: a long, thin leaf down the back, fullest at its root and trailing off; it flops a little with the beat
      g.lineCap = "round";
      g.fillStyle = rgba(gold ? ocdRGB : inkRGB, gold ? pa * 0.3 : al * 0.17);
      g.beginPath();
      var df = M.sin(F.ph - 2.4) * 0.12, dw = F.L * 0.014;
      for (var s = 3; s <= 7; s++) { var wv = WD[s] * df * (s - 2) / 4, hw = dw * M.sin((s - 2.7) / 4.3 * PI) * (s < 4 ? 0.7 : 1); DX[s] = CX[s] + NX[s] * wv; DY[s] = CY[s] + NY[s] * wv; DW[s] = hw; }
      g.moveTo(DX[3] - NX[3] * DW[3], DY[3] - NY[3] * DW[3]);
      for (var s1 = 3; s1 <= 7; s1++) g.lineTo(DX[s1] + NX[s1] * DW[s1], DY[s1] + NY[s1] * DW[s1]);
      for (var s2 = 6; s2 >= 3; s2--) g.lineTo(DX[s2] - NX[s2] * DW[s2], DY[s2] - NY[s2] * DW[s2]);
      g.fill();
      // barbels and eyes
      var fx = M.cos(ha), fy = M.sin(ha), nx0 = -fy, ny0 = fx, bl = F.L * 0.05;
      g.lineWidth = 0.6; g.strokeStyle = rgba(inkRGB, al * 0.4);
      g.beginPath();
      for (var sd = -1; sd <= 1; sd += 2) {
        var bx0 = CX[0] + fx * F.L * 0.022 + nx0 * WD[0] * 0.5 * sd, by0 = CY[0] + fy * F.L * 0.022 + ny0 * WD[0] * 0.5 * sd;
        g.moveTo(bx0, by0); g.quadraticCurveTo(bx0 + fx * bl * 0.5 + nx0 * bl * 0.5 * sd, by0 + fy * bl * 0.5 + ny0 * bl * 0.5 * sd, bx0 - fx * bl * 0.15 + nx0 * bl * 0.95 * sd, by0 - fy * bl * 0.15 + ny0 * bl * 0.95 * sd);
      }
      g.stroke();
      g.fillStyle = rgba(rgb(pal.eye), M.min(1, 0.85 * fa));
      g.beginPath();
      var er = M.max(0.8, F.L * 0.012), ex = CX[0] * 0.62 + CX[1] * 0.38, ey = CY[0] * 0.62 + CY[1] * 0.38, ew = WD[1] * 0.7;
      g.moveTo(ex + NX[0] * ew + er, ey + NY[0] * ew); g.arc(ex + NX[0] * ew, ey + NY[0] * ew, er, 0, TAU);
      g.moveTo(ex - NX[0] * ew + er, ey - NY[0] * ew); g.arc(ex - NX[0] * ew, ey - NY[0] * ew, er, 0, TAU);
      g.fill();
    };
    var render = function () {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, cv.width, cv.height);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      var drawn = 0, alphaAll = pal.a;
      // ring wavefronts for this frame (screen space): each ring is a short train of three
      fronts.length = 0;
      for (var ri = 0; ri < rip.length; ri++) {
        var rp = rip[ri], r0 = ripR(rp), en = ripEnv(rp), ry = rp.y - sy * rpz();
        for (var wk = 0; wk < 3; wk++) {
          var rk = r0 - wk * (14 + r0 * 0.07);
          if (rk < 2) break;
          var ak = en * [1, 0.55, 0.28][wk] / (1 + rk / 110);
          if (ak > 0.004) fronts.push({ x: rp.x, y: ry, r: rk, b: 8 + rk * 0.06, a: ak, w: [1, 0.8, 0.62][wk], q: rp.q });
        }
      }
      sg.setTransform(1, 0, 0, 1, 0, 0);
      sg.clearRect(0, 0, shc.width, shc.height);
      // shadows: mid and near fish cast a soft shadow on the paper, offset by their height under the lamp;
      // their outlines are gathered in the fish loop below (one spine per fish per frame) and filled after it
      var shd = pal.sa > 0;
      sg.beginPath();

      for (var qq = 0; qq < fish.length; qq++) {
        var F = fish[qq], oy2 = sy * F.pz, hx = F.x, hy = F.y - oy2;
        if (hx < -F.L * 2 || hx > vw + F.L * 2 || hy < -F.L * 2 || hy > vh + F.L * 2) continue;
        drawn++;
        spine(F, oy2);
        if (shd && F.k !== 0) { var h = 3 + F.d * 9; shadowPath(sg, F, SH, h * 0.55, h); }
        var fa = F.fade * fadeAt(CX[3], CY[3]), al = F.tone * alphaAll * fa;
        if (al < 0.004) continue;
        var e = F.n - 1;
        if (F.K.color) { drawKoi(F, al, fa); continue; }
        // fins first, paler than the body (ink thinned with water)
        g.fillStyle = rgba(inkRGB, (al * 0.5));
        g.beginPath();
        var tail = tailPath(g, F, 1, 0, 0);
        if (F.K.fins) {
          var spl = 0.5 + 0.75 * (1 - F.th) + 0.12 * M.sin(F.ph * 0.5);
          var spr = 0.5 + 0.75 * (1 - F.th) + 0.12 * M.sin(F.ph * 0.5 + 1.7);
          var fl = F.L * (F.K.big ? 0.23 : 0.16);
          finPath(g, F, 2, 1, fl, spl + clamp(F.w * 0.4, -0.3, 0.3));
          finPath(g, F, 2, -1, fl, spr - clamp(F.w * 0.4, -0.3, 0.3));
          if (F.K.big) { finPath(g, F, 6, 1, fl * 0.6, spl * 0.8); finPath(g, F, 6, -1, fl * 0.6, spr * 0.8); }
        }
        g.fill();
        // body: ink pooled at the head and along the back, washing out toward the tail
        // one shared unit gradient, laid along each fish by the transform at fill time (the path is already placed)
        if (inkGc !== inkRGB) { inkG = g.createLinearGradient(0, 0, 1, 0); inkG.addColorStop(0, rgba(inkRGB, 1)); inkG.addColorStop(1, rgba(inkRGB, 0.5 / 1.05)); inkGc = inkRGB; }
        g.fillStyle = inkG;
        g.beginPath();
        bodyPath(g, F, 1, 0, 0);
        var gx = (CX[e] - CX[0]) * dpr, gy = (CY[e] - CY[0]) * dpr;
        g.globalAlpha = M.min(1, al * 1.05);
        g.setTransform(gx, gy, -gy, gx, CX[0] * dpr, CY[0] * dpr);
        g.fill();
        g.setTransform(dpr, 0, 0, dpr, 0, 0); g.globalAlpha = 1;
        if (F.k > 0) {
          // the dorsal ridge: one darker brush stroke down the back
          g.strokeStyle = rgba(inkRGB, (al * 0.55));
          g.lineWidth = F.L * (F.K.big ? 0.03 : 0.026);
          g.lineCap = "round";
          g.beginPath();
          g.moveTo(CX[1], CY[1]);
          for (var s = 2; s < 7; s++) g.quadraticCurveTo(CX[s], CY[s], (CX[s] + CX[s + 1]) / 2, (CY[s] + CY[s + 1]) / 2);
          g.stroke();
          if (F.K.big) {
            // fine rays in the tail
            g.lineWidth = 0.6;
            g.strokeStyle = rgba(inkRGB, (al * 0.38));
            g.beginPath();
            for (var r2 = -1; r2 <= 1; r2 += 0.5) {
              var ra = tail[2] + r2 * tail[4] * 0.85, rl = tail[3] * (0.62 + 0.3 * M.abs(r2));
              g.moveTo(tail[0], tail[1]); g.lineTo(tail[0] + M.cos(ra) * rl, tail[1] + M.sin(ra) * rl);
            }
            g.stroke();
          }
          // eyes
          g.fillStyle = rgba(inkRGB, M.min(1, al * 1.9));
          g.beginPath();
          var er = M.max(0.7, F.L * 0.014);
          var ex = (CX[0] * 0.7 + CX[1] * 0.3), ey = (CY[0] * 0.7 + CY[1] * 0.3), ew = WD[1] * 0.62;
          g.moveTo(ex + NX[0] * ew + er, ey + NY[0] * ew); g.arc(ex + NX[0] * ew, ey + NY[0] * ew, er, 0, TAU);
          g.moveTo(ex - NX[0] * ew + er, ey - NY[0] * ew); g.arc(ex - NX[0] * ew, ey - NY[0] * ew, er, 0, TAU);
          g.fill();
        }
      }
      if (shd) {
        sg.fillStyle = rgba("0,0,0", pal.sa);
        sg.fill();
        sg.globalCompositeOperation = "destination-out";
        sg.fillStyle = "#000";
        for (var so = 0; so < obs.length; so++) {
          var SR = obs[so];
          if (SR.b - sy < 0 || SR.t - sy > vh) continue;
          sg.fillRect((SR.l - 2) * SH, (SR.t - sy - 2) * SH, (SR.r - SR.l + 4) * SH, (SR.b - SR.t + 4) * SH);
        }
        sg.globalCompositeOperation = "source-over";
      }

      // water rings: a hairline of shade on the inner slope, a hairline of light on the outer one
      if (fronts.length) {
        g.lineCap = "butt";
        for (var fq = 0; fq < fronts.length; fq++) {
          var W0 = fronts[fq], lw = (1 + W0.r * 0.007) * W0.w, qx = M.cos(W0.q) * lw * 0.45, qy = M.sin(W0.q) * lw * 0.45;
          // two hairlines a little off-centre from each other: the ring thickens on one side, thins on the other
          g.lineWidth = lw * 0.7;
          g.strokeStyle = rgba(rsRGB, (W0.a * pal.rsa));
          g.beginPath(); g.arc(W0.x, W0.y, M.max(0.5, W0.r - lw * 0.55), 0, TAU); g.stroke();
          g.beginPath(); g.arc(W0.x + qx, W0.y + qy, M.max(0.5, W0.r - lw * 0.75), 0, TAU); g.stroke();
          g.lineWidth = lw;
          g.strokeStyle = rgba(rhRGB, (W0.a * pal.rha));
          g.beginPath(); g.arc(W0.x - qx * 0.6, W0.y - qy * 0.6, W0.r + lw * 0.6, 0, TAU); g.stroke();
        }
      }
      // obstacles stay clean
      g.globalCompositeOperation = "destination-out";
      g.fillStyle = "#000";
      for (var o = 0; o < obs.length; o++) {
        var R = obs[o];
        if (R.b - sy < 0 || R.t - sy > vh) continue;
        g.fillRect(R.l - 2, R.t - sy - 2, R.r - R.l + 4, R.b - R.t + 4);
      }
      g.globalCompositeOperation = "source-over";
      stats.drawn = drawn;
    };

    // ── loop ──────────────────────────────────────────────────────────────────
    var STEP = 1 / 60, raf = 0, last = 0, acc = 0, running = false, shown = false, rmLast = 0;
    var waterOnScreen = function () {
      if (!onScreen) return false;
      if (!page || fixedOn() || sy < heroB || rip.length) return true;
      // below the hero: only the margins beside the obstacles show water
      var m = 0;
      for (var i = 0; i < obs.length; i++) { var r = obs[i]; if (r.b > sy && r.t < sy + vh) m = M.max(m, M.min(r.l, vw - r.r)); }
      return m > 36 || !obs.length;
    };
    var frame = function (now) {
      raf = 0;
      if (dead || !shown || D.hidden || !onScreen) { running = false; return; }
      var t0 = performance.now();
      var dt = M.min(0.1, (now - last) / 1000);
      // adaptive resolution: if frames keep arriving late (a slow device rasterising a large canvas),
      // drop to 1 device pixel per CSS pixel, once
      if (O.adaptive && !RM.matches && now - last < 100 && dprCap > 1) {
        fema = fema * 0.96 + (now - last) * 0.04;
        // the same signal also lightens the koi (no bleed, heart, grain or fin outlines)
        if (++fcount > 60 && fema > 21 && dpr > 1) { dprCap = 1; koiLite = true; measure(); }
      }
      last = now;
      svel = page ? svel * 0.85 + ((sy - lastSy) / M.max(dt, 1 / 240)) * 0.15 : 0; lastSy = sy;
      if (RM.matches) {
        // nearly still: a slow drift, drawn ~10 times a second
        if (now - rmLast < 100) { raf = requestAnimationFrame(frame); return; }
        step(M.min(0.1, (now - rmLast) / 1000) * 0.25); rmLast = now;
      } else {
        acc += dt;
        var n = 0;
        while (acc >= STEP && n < 4) { step(STEP); acc -= STEP; n++; }
        if (n === 4) acc = 0;
      }
      tickPal(now);
      render();
      var ms = performance.now() - t0;
      stats.ring[stats.n % 600] = ms; stats.n++; stats.ms += ms; if (ms > stats.max) stats.max = ms;
      if (!waterOnScreen() && palAt < 0) { running = false; return; } // nothing to see; scroll wakes it
      raf = requestAnimationFrame(frame);
    };
    function wake() {
      if (dead || running || !shown || D.hidden || !onScreen || !fish.length) return;
      running = true; last = performance.now(); rmLast = 0; lastSy = sy;
      raf = requestAnimationFrame(frame);
    }
    on(D, "visibilitychange", function () { if (!D.hidden) wake(); });

    // ── relayout ──────────────────────────────────────────────────────────────
    var lastDims = "", lt = 0, lraf = 0, booted = false;
    var layout = function () {
      if (dead || !booted) return;
      var old = lastDims;
      measure();
      var dims = vw + "x" + PH + "@" + mobile;
      lastDims = dims;
      if (!fish.length || dims.split("x")[0] !== old.split("x")[0] || mobile !== (old.indexOf("true") > 0)) populate();
      if (shown) { tickPal(performance.now()); render(); wake(); }
    };
    var relayout = function () { cancelAnimationFrame(lraf); lraf = requestAnimationFrame(layout); };
    var RO = Wn.ResizeObserver ? new ResizeObserver(function () { clearTimeout(lt); lt = setTimeout(relayout, 120); }) : null;
    if (RO) RO.observe(page ? (q(O.habitat) || D.body) : host);
    on(Wn, "resize", relayout);
    var MO = new MutationObserver(syncPal);
    MO.observe(D.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    if (!page) MO.observe(host, { attributes: true, attributeFilter: ["class", "style"] });
    on(DARKQ, "change", syncPal);
    on(Wn, "pageshow", syncPal);
    on(RMQ, "change", wake);
    // element mode: pause while the host is scrolled out of view
    var IO = !page && Wn.IntersectionObserver ? new IntersectionObserver(function (es) {
      onScreen = es[es.length - 1].isIntersecting;
      if (onScreen) wake();
    }) : null;
    if (IO) IO.observe(host);

    // ── start after the page's first paint; settle the schools off-screen, then fade in ─
    var boot = function () {
      if (dead) return;
      booted = true;
      syncPal(); tickPal(0);
      measure(); lastDims = vw + "x" + PH + "@" + mobile;
      populate();
      var warm = 0;
      var settle = function () {
        if (dead) return;
        for (var i = 0; i < 20; i++) step(STEP);
        if (++warm < 8) return requestAnimationFrame(settle);
        for (var k = 0; k < fish.length; k++) fish[k].fade = 1;
        shown = true;
        render();
        [shc, cv].forEach(function (c) { if (!O.fadeIn) c.style.transition = "none"; c.classList.add("on"); });
        wake();
      };
      requestAnimationFrame(settle);
    };
    var start = function () { requestAnimationFrame(function () { setTimeout(boot, 0); }); };
    if (D.readyState === "loading") on(D, "DOMContentLoaded", start, { once: true }); else start();

    var api = {
      canvas: cv,
      stats: stats,
      get fish() { return fish; },
      get running() { return running; },
      /** Re-read layout (obstacles, text, sizes) after your page changes without a resize. */
      layout: layout,
      /** Change options at runtime, e.g. set({ theme: "dark" }) or set({ count: 20 }). */
      set: function (o) {
        o = o || {};
        var repop = "count" in o || "density" in o || ("fixed" in o && !!o.fixed !== !!O.fixed);
        var recon = "koi" in o && o.koi !== O.koi;
        assign(O, o);
        syncPal();
        if (!O.ripples) rip.length = 0;
        if (booted) {
          measure();
          if (repop) { populate(); for (var k = 0; k < fish.length; k++) fish[k].fade = 1; }
          else if (recon) reconcile();
          if (shown) { tickPal(performance.now()); render(); wake(); }
        }
        return api;
      },
      destroy: function () {
        if (dead) return;
        dead = true; running = false;
        cancelAnimationFrame(raf); cancelAnimationFrame(lraf); clearTimeout(lt);
        L_.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3]); });
        if (RO) RO.disconnect(); MO.disconnect(); if (IO) IO.disconnect();
        if (cv.parentNode) cv.parentNode.removeChild(cv);
        if (shc.parentNode) shc.parentNode.removeChild(shc);
        host.classList.remove("ink-fish-host");
        if (hostPos !== null) host.style.position = hostPos;
        if (host.__inkFish === api) delete host.__inkFish;
        var i = instances.indexOf(api); if (i >= 0) instances.splice(i, 1);
      }
    };
    host.__inkFish = api;
    instances.push(api);
    return api;
  }

  // ── auto-init: <body data-ink-fish> or <div data-ink-fish='{"count":30}'> ──
  var autoInit = function () {
    var D = Wn.document;
    Array.prototype.forEach.call(D.querySelectorAll("[data-ink-fish]"), function (el) {
      if (el.__inkFish) return;
      var raw = el.getAttribute("data-ink-fish"), opts = {};
      if (raw && raw.trim()) { try { opts = JSON.parse(raw); } catch (e) { if (Wn.console) console.warn("ink-fish: data-ink-fish is not valid JSON", e); } }
      mount(el, opts);
    });
  };
  if (Wn && Wn.document) {
    if (Wn.document.readyState === "loading") Wn.document.addEventListener("DOMContentLoaded", autoInit, { once: true });
    else autoInit();
  }

  return { mount: mount, init: autoInit, defaults: DEFAULTS, instances: instances, version: "1.2.1" };
});
