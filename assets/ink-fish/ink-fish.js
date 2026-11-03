/* ink-fish: brush-ink fish in the paper behind the hub bookshelves. Decorative only.
   One fixed, viewport-sized Canvas 2D (DPR <= 1.5) and one rAF loop, paused when the tab is hidden
   or no open water is on screen. Three depth layers (far minnows, mid carp, near koi), each with
   scroll parallax. Every fish has a spine of segments that follows its head's path. A body wave runs
   from head to tail, its tail beat tied to speed and thrust, and it swims in burst-and-glide rhythm.
   Fish school with their own layer (separation / alignment / cohesion), keep clear of the shelves and
   headline, ease away from a fast cursor and drift curiously towards a still one. Soft shadows are
   drawn on a quarter-res layer and scaled up, so they cost no blur filter. Shelves, the list and an
   opened case are erased from the canvas; ink under text is thinned. Layout is read only on
   resize/reflow, never inside the frame. */
(function () {
  "use strict";
  var D = document, Wn = window, M = Math, PI = M.PI, TAU = PI * 2;
  var hero = D.querySelector("header.hero"), wrap = D.querySelector(".wrap") || D.body;
  if (!hero || !Wn.CanvasRenderingContext2D || !Wn.requestAnimationFrame) return;
  var RM = Wn.matchMedia("(prefers-reduced-motion: reduce)"), MOB = Wn.matchMedia("(max-width: 720px)");
  var cv = D.createElement("canvas");
  cv.className = "ink-water";
  cv.setAttribute("aria-hidden", "true");
  D.body.insertBefore(cv, D.body.firstChild);
  var g = cv.getContext("2d");
  var shc = D.createElement("canvas"), sg = shc.getContext("2d");
  var SH = 0.25; // shadow layer scale

  var vw = 0, vh = 0, dpr = 1, PW = 0, PH = 0, sy = Wn.scrollY || 0, heroB = 0, mobile = MOB.matches;
  var obs = [], walls = [], texts = [], title = null, fish = [], T = 0;
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var rnd = function (a, b) { return a + M.random() * (b - a); };
  var wrapA = function (a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; };
  var sstep = function (a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };

  // ── palette: ink on paper in light mode, pale ink on the dark paper ────────
  var hex = function (v) {
    var m = (v || "").trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return null;
    var h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1], n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  var pal = null, palFrom = null, palTo = null, palAt = -1;
  var readPal = function () {
    var cs = getComputedStyle(D.documentElement);
    var bg = hex(cs.getPropertyValue("--bg")) || [241, 236, 227], ink = hex(cs.getPropertyValue("--ink")) || [30, 28, 25];
    var dark = bg[0] + bg[1] + bg[2] < 384;
    // ink: a warm sumi in light mode; in dark mode the page's pale ink, a touch warmer.
    return dark
      ? { ink: [ink[0] * 0.94 + 10, ink[1] * 0.92 + 6, ink[2] * 0.86], a: 1.12, sh: [0, 0, 0], sa: 0.26 }
      : { ink: [ink[0] + 8, ink[1] + 4, ink[2]], a: 1, sh: [52, 38, 22], sa: 0.13 };
  };
  var mixPal = function (a, b, k) {
    var l = function (x, y) { return x + (y - x) * k; };
    return { ink: [l(a.ink[0], b.ink[0]), l(a.ink[1], b.ink[1]), l(a.ink[2], b.ink[2])], a: l(a.a, b.a), sh: [l(a.sh[0], b.sh[0]), l(a.sh[1], b.sh[1]), l(a.sh[2], b.sh[2])], sa: l(a.sa, b.sa) };
  };
  var syncPal = function () {
    var p = readPal();
    if (pal && JSON.stringify(p) === JSON.stringify(palTo)) return;
    if (!pal) { pal = palTo = p; return; }
    palFrom = pal; palTo = p; palAt = performance.now();
    wake();
  };
  var inkS = "", inkRGB = "";
  var tickPal = function (now) {
    if (palAt >= 0) {
      var k = clamp((now - palAt) / 500, 0, 1);
      pal = mixPal(palFrom, palTo, k * k * (3 - 2 * k));
      if (k >= 1) palAt = -1;
    }
    inkRGB = M.round(pal.ink[0]) + "," + M.round(pal.ink[1]) + "," + M.round(pal.ink[2]);
  };

  // ── layout (read only on resize / reflow) ──────────────────────────────────
  var rectOf = function (el, grow) {
    if (!el) return null;
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    grow = grow || 0;
    return { l: r.left - grow, t: r.top + sy - grow, r: r.right + grow, b: r.bottom + sy + grow };
  };
  var measure = function () {
    sy = Wn.scrollY || 0;
    vw = D.documentElement.clientWidth;
    vh = Wn.innerHeight;
    dpr = M.min(Wn.devicePixelRatio || 1, 1.5);
    mobile = MOB.matches;
    var hr = rectOf(hero);
    heroB = hr ? hr.b : vh;
    PH = M.max(M.ceil(wrap.getBoundingClientRect().bottom + sy), heroB);
    PW = vw;
    obs = [];
    D.querySelectorAll(".shelves .unit, .flat, #case").forEach(function (el) { var r = rectOf(el); if (r) obs.push(r); });
    walls = obs.slice();
    var bar = rectOf(D.querySelector(".bar"));
    if (bar) walls.push({ l: 0, t: bar.t, r: vw, b: bar.b }); // the in-flow filter bar is a wall too
    texts = [];
    var add = function (el, keep, f) { var r = rectOf(el); if (r) texts.push({ r: r, keep: keep, f: f }); };
    add(hero.querySelector(".eyebrow"), 0.3, 30);
    add(hero.querySelector("h1"), 0.16, 44);
    add(hero.querySelector(".intro"), 0.24, 34);
    add(hero.querySelector(".howto"), 0.26, 28);
    var top = D.querySelector(".top");
    if (top) for (var i = 0; i < top.children.length; i++) add(top.children[i], 0.3, 24);
    D.querySelectorAll("body > footer, .wrap > footer, main > .empty").forEach(function (el) { add(el, 0.24, 30); });
    title = rectOf(hero.querySelector("h1"), mobile ? 10 : 22);
    cv.width = M.round(vw * dpr); cv.height = M.round(vh * dpr);
    cv.style.width = vw + "px"; cv.style.height = vh + "px";
    shc.width = M.ceil(vw * SH); shc.height = M.ceil(vh * SH);
  };

  // ── species and population ────────────────────────────────────────────────
  // d: depth (0 far … 1 near). pz: scroll parallax (screen y = y − scrollY·pz).
  var KIND = [
    { name: "minnow", d: [0.2, 0.38], L: [15, 23], wr: 0.072, tl: 0.2, vmax: [34, 46], cruise: 0.42, school: 1, avoid: 0, fins: 0, tone: [0.1, 0.13] },
    { name: "carp", d: [0.5, 0.66], L: [32, 44], wr: 0.095, tl: 0.23, vmax: [38, 52], cruise: 0.2, school: 0.55, avoid: 1, fins: 1, tone: [0.17, 0.21] },
    { name: "koi", d: [0.86, 1], L: [62, 88], wr: 0.122, tl: 0.38, vmax: [30, 40], cruise: 0.08, school: 0.12, avoid: 1, fins: 2, tone: [0.27, 0.32] }
  ];
  var free = function (x, y, pad) {
    for (var i = 0; i < walls.length; i++) { var o = walls[i]; if (x > o.l - pad && x < o.r + pad && y > o.t - pad && y < o.b + pad) return false; }
    return true;
  };
  var habitatB = function (k) { return k === 2 ? heroB + (mobile ? 40 : 160) : PH; };
  var spawn = function (k, near) {
    var K = KIND[k], f = { k: k, K: K }, s = mobile ? 0.78 : 1, tries = 0;
    f.d = rnd(K.d[0], K.d[1]); f.pz = 0.55 + 0.45 * f.d;
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
    f.n = 11; f.seg = f.L / (f.n - 1); f.px = new Float32Array(f.n); f.py = new Float32Array(f.n);
    for (var i = 0; i < f.n; i++) { f.px[i] = f.x - M.cos(f.a) * f.seg * i; f.py[i] = f.y - M.sin(f.a) * f.seg * i; }
    return f;
  };
  var populate = function () {
    // open water on the page (24 px grid), excluding the shelves
    var area = 0, heroArea = vw * heroB;
    for (var y = 12; y < PH; y += 24) for (var x = 12; x < vw; x += 24) if (free(x, y, 16)) area += 576;
    var minnows = M.round(clamp(area / (mobile ? 10000 : 38000), mobile ? 10 : 16, mobile ? 20 : 36));
    var carp = M.round(clamp(area / (mobile ? 26000 : 70000), mobile ? 4 : 8, mobile ? 8 : 18));
    var koi = mobile ? 2 : M.round(clamp(heroArea / 160000, 3, 5));
    fish = [];
    // minnows arrive in small schools
    while (fish.length < minnows) { var lead = spawn(0), n = 3 + (M.random() * 5) | 0; fish.push(lead); for (var j = 1; j < n && fish.length < minnows; j++) fish.push(spawn(0, lead)); }
    for (var c = 0; c < carp; c++) fish.push(c % 3 && fish.length ? spawn(1, fish[fish.length - 1].k === 1 ? fish[fish.length - 1] : null) : spawn(1));
    for (var q = 0; q < koi; q++) fish.push(spawn(2));
    fish.sort(function (a, b) { return a.d - b.d; }); // paint far → near
  };

  // ── input ─────────────────────────────────────────────────────────────────
  var ptr = { x: 0, y: 0, on: false, sp: 0, t: 0, idle: 9 }, svel = 0, lastSy = sy;
  Wn.addEventListener("pointermove", function (e) {
    if (e.pointerType === "touch") { ptr.on = false; return; }
    var now = performance.now(), dt = M.max(8, now - ptr.t);
    var sp = M.hypot(e.clientX - ptr.x, e.clientY - ptr.y) / dt * 1000;
    ptr.sp = ptr.sp * 0.7 + sp * 0.3; ptr.x = e.clientX; ptr.y = e.clientY; ptr.t = now; ptr.idle = 0;
    ptr.on = free(e.clientX, e.clientY + sy, 6);
    wake();
  }, { passive: true });
  var off = function () { ptr.on = false; };
  D.documentElement.addEventListener("pointerleave", off);
  Wn.addEventListener("blur", off);
  Wn.addEventListener("pointerdown", function (e) {
    // a tap or click in open water startles the fish nearby (no ripple, no splash)
    var t = e.target;
    if (RM.matches || (t && t.closest && t.closest("a,button,input,label,.tape,.unit,.bar,.flat,#case"))) return;
    var x = e.clientX, y = e.clientY;
    if (!free(x, y + sy, 4)) return;
    for (var i = 0; i < fish.length; i++) {
      var f = fish[i], dx = f.x - x, dy = f.y - sy * f.pz - y, d = M.hypot(dx, dy);
      if (d < 240 * (0.6 + f.d)) { f.a = wrapA(f.a + clamp(wrapA(M.atan2(dy, dx) - f.a), -1.4, 1.4) * 0.5); kick(f, 1); }
    }
  }, { passive: true });
  Wn.addEventListener("scroll", function () { sy = Wn.scrollY || 0; wake(); }, { passive: true });

  var kick = function (f, k) { f.mode = 1; f.tm = rnd(0.35, 0.6); f.thT = M.max(f.thT, k); };

  // ── simulation ────────────────────────────────────────────────────────────
  var step = function (dt) {
    T += dt;
    var rm = RM.matches;
    ptr.idle += dt;
    for (var i = 0; i < fish.length; i++) {
      var f = fish[i], K = f.K, L = f.L, oy = sy * (1 - f.pz); // page y = layer y + oy
      var ca = M.cos(f.a), sa = M.sin(f.a);
      var fx = ca * 1.6, fy = sa * 1.6;
      // wander: two slow incommensurate sines, so courses curve without repeating
      var wa = f.a + (M.sin(T * f.w1 + f.p1) * 0.65 + M.sin(T * f.w2 + f.p2) * 0.35) * 1.1;
      fx += M.cos(wa) * 0.8; fy += M.sin(wa) * 0.8;
      // school with fish of the same kind
      if (K.school > 0) {
        var R = M.min(L * 5.5, f.k === 2 ? 170 : 200), R2 = R * R, sep = L * 1.25, n = 0, ax = 0, ay = 0, cx = 0, cy = 0, sx = 0, sy2 = 0;
        for (var j = 0; j < fish.length; j++) {
          var o = fish[j];
          if (o === f || o.k !== f.k) continue;
          var dx = o.x - f.x, dy = o.y - f.y, d2 = dx * dx + dy * dy;
          if (d2 > R2) continue;
          var d = M.sqrt(d2) || 1;
          n++; ax += M.cos(o.a); ay += M.sin(o.a); cx += dx; cy += dy;
          if (d < sep) { var k = (1 - d / sep); sx -= dx / d * k; sy2 -= dy / d * k; }
        }
        if (n) {
          fx += (ax / n) * 1.1 * K.school + (cx / n) / R * 1.4 * K.school + sx * 2.6;
          fy += (ay / n) * 1.1 * K.school + (cy / n) / R * 1.4 * K.school + sy2 * 2.6;
        }
      }
      // pond edges: fish may slip a little past the window's sides, never far
      var mx = L * 0.6 + 30, hb = habitatB(f.k) - oy, top = 24;
      if (f.x < -L * 0.4 + mx) fx += (1 - (f.x + L * 0.4) / mx) * 3;
      if (f.x > vw + L * 0.4 - mx) fx -= (1 - (vw + L * 0.4 - f.x) / mx) * 3;
      if (f.y < top + mx) fy += (1 - (f.y - top) / mx) * 3;
      if (f.y > hb - mx) fy -= (1 - (hb - f.y) / mx) * 3;
      // keep clear of shelves, case, list and the filter bar (probe the head and a point ahead)
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
        if (f.k === 2 && title) {
          var tx = clamp(f.x, title.l, title.r), ty = clamp(f.y + oy, title.t, title.b), ex = f.x - tx, ey = f.y + oy - ty, de = M.hypot(ex, ey);
          if (de < 50) { fx += (de ? ex / de : 0) * 1.4 * (1 - de / 50); fy += (de ? ey / de : -1) * 1.4 * (1 - de / 50); }
        }
      }
      // cursor: a quick movement scatters them; a still cursor in open water draws the curious ones in
      if (ptr.on && !rm) {
        var px = ptr.x, py = ptr.y + sy * f.pz, ex2 = f.x - px, ey2 = f.y - py, dp = M.hypot(ex2, ey2) || 1;
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
      // a fast scroll is felt as a current: a few fish dart, the rest lean with it
      if (!rm && M.abs(svel) > 1400 && M.random() < dt * 0.9 * (1 - f.d * 0.5)) kick(f, 0.8);
      fy += clamp(svel / 2400, -1, 1) * 0.5 * (1.2 - f.d);

      // ── turning: limited curvature, eased angular velocity ──
      var da = wrapA(M.atan2(fy, fx) - f.a);
      var wmax = (0.45 + 2.1 * f.v / f.vmax) * (f.k === 2 ? 0.7 : 1);
      var wt = clamp(da * 2.2, -wmax, wmax);
      f.w += (wt - f.w) * M.min(1, dt * 3);
      f.a = wrapA(f.a + f.w * dt);

      // ── rhythm: burst, then a long glide ──
      f.tm -= dt;
      if (f.tm <= 0) {
        if (f.mode === 1 || rm) { f.mode = 0; f.tm = rnd(1.1, 3.4) * (f.k === 2 ? 1.6 : 1) * (rm ? 3 : 1); f.thT = K.cruise * rnd(0.6, 1.3); }
        else { f.mode = 1; f.tm = rnd(0.35, 0.8) * (0.7 + L / 120); f.thT = rnd(0.55, 0.9); }
      }
      f.th += (f.thT - f.th) * M.min(1, dt * (f.thT > f.th ? 5 : 1.4));
      f.vm += (1 - f.vm) * M.min(1, dt * 0.6);
      var vt = f.vmax * (0.14 + 0.86 * f.th) * f.vm * (rm ? 0.35 : 1);
      f.v += (vt - f.v) * M.min(1, dt * (vt > f.v ? 2.4 : 0.5));
      f.x += M.cos(f.a) * f.v * dt; f.y += M.sin(f.a) * f.v * dt;
      // tail beat: faster with speed and thrust, faster for small fish; wider when thrusting or turning
      var fq = (0.3 + 2.3 * f.th + 0.8 * f.v / f.vmax) * M.pow(40 / L, 0.3);
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
      f.fade = M.min(1, f.fade + dt * 0.5);
    }
  };

  // ── drawing ───────────────────────────────────────────────────────────────
  var N = 11, CX = new Float32Array(N), CY = new Float32Array(N), NX = new Float32Array(N), NY = new Float32Array(N), WD = new Float32Array(N);
  var LX = new Float32Array(N), LY = new Float32Array(N), RX = new Float32Array(N), RY = new Float32Array(N);
  var shape = function (s) {
    // top-down fish: rounded head, widest at a third, slender peduncle
    return s < 0.3 ? 0.5 + 0.5 * M.sin(s / 0.3 * PI / 2) : 0.13 + 0.87 * M.pow(M.cos((s - 0.3) / 0.7 * PI / 2), 1.25);
  };
  var spine = function (f, oy) {
    var n = f.n;
    for (var i = 0; i < n; i++) {
      var s = i / (n - 1), a = f.px[i], b = f.py[i] - oy;
      var i0 = i > 0 ? i - 1 : 0, i1 = i < n - 1 ? i + 1 : n - 1;
      var tx = f.px[i0] - f.px[i1], ty = f.py[i0] - f.py[i1], tl = M.hypot(tx, ty) || 1;
      var nx = -ty / tl, ny = tx / tl;
      var o = f.amp * (0.14 + 0.86 * s * s) * M.sin(f.ph - s * 5.4);
      CX[i] = a + nx * o; CY[i] = b + ny * o;
    }
    var bank = clamp(f.w * 0.22, -0.3, 0.3);
    for (var k = 0; k < n; k++) {
      var j0 = k > 0 ? k - 1 : 0, j1 = k < n - 1 ? k + 1 : n - 1;
      var ux = CX[j0] - CX[j1], uy = CY[j0] - CY[j1], ul = M.hypot(ux, uy) || 1;
      NX[k] = -uy / ul; NY[k] = ux / ul;
      var w = f.L * f.K.wr * shape(k / (n - 1)) * (1 - M.abs(bank) * 0.25);
      WD[k] = w;
      LX[k] = CX[k] + NX[k] * w * (1 + bank); LY[k] = CY[k] + NY[k] * w * (1 + bank);
      RX[k] = CX[k] - NX[k] * w * (1 - bank); RY[k] = CY[k] - NY[k] * w * (1 - bank);
    }
  };
  var bodyPath = function (c, f, sc, dx, dy) {
    var n = f.n, hx = CX[0] - CX[1], hy = CY[0] - CY[1], hl = M.hypot(hx, hy) || 1;
    var tipX = CX[0] + hx / hl * f.L * 0.05, tipY = CY[0] + hy / hl * f.L * 0.05;
    c.moveTo((tipX + dx) * sc, (tipY + dy) * sc);
    c.quadraticCurveTo((LX[0] + dx) * sc, (LY[0] + dy) * sc, ((LX[0] + LX[1]) / 2 + dx) * sc, ((LY[0] + LY[1]) / 2 + dy) * sc);
    for (var i = 1; i < n - 1; i++) c.quadraticCurveTo((LX[i] + dx) * sc, (LY[i] + dy) * sc, ((LX[i] + LX[i + 1]) / 2 + dx) * sc, ((LY[i] + LY[i + 1]) / 2 + dy) * sc);
    c.lineTo((LX[n - 1] + dx) * sc, (LY[n - 1] + dy) * sc);
    c.lineTo((RX[n - 1] + dx) * sc, (RY[n - 1] + dy) * sc);
    for (var k = n - 2; k > 0; k--) c.quadraticCurveTo((RX[k] + dx) * sc, (RY[k] + dy) * sc, ((RX[k] + RX[k - 1]) / 2 + dx) * sc, ((RY[k] + RY[k - 1]) / 2 + dy) * sc);
    c.quadraticCurveTo((RX[0] + dx) * sc, (RY[0] + dy) * sc, (tipX + dx) * sc, (tipY + dy) * sc);
  };
  var tailPath = function (c, f, sc, dx, dy) {
    var n = f.n, e = n - 1, bx = CX[e], by = CY[e];
    var ta = M.atan2(CY[e] - CY[e - 2], CX[e] - CX[e - 2]);
    var lag = M.sin(f.ph - 5.4 - 1.1); // the fin trails the peduncle
    ta += lag * clamp(f.amp / f.L * 3.2, 0, 0.55);
    var lt = f.L * f.K.tl, spr = 0.36 + 0.16 * (1 - f.th), bend = lag * (f.k === 2 ? 0.4 : 0.22);
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
    var tx = CX[i] - CX[i + 1], ty = CY[i] - CY[i + 1], tl = M.hypot(tx, ty) || 1; tx /= tl; ty /= tl; // forward
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

  var stats = { n: 0, ms: 0, max: 0, drawn: 0, ring: new Float32Array(600) };
  var render = function () {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    sg.setTransform(1, 0, 0, 1, 0, 0);
    sg.clearRect(0, 0, shc.width, shc.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    sg.fillStyle = "#000";
    var drawn = 0, alphaAll = pal.a;
    // shadows: mid and near fish cast a soft shadow on the paper, offset by their height under the lamp
    sg.beginPath();
    for (var i = 0; i < fish.length; i++) {
      var f = fish[i];
      if (f.k === 0) continue;
      var oy = sy * f.pz, sx0 = f.x, sy0 = f.y - oy;
      if (sx0 < -f.L * 2 || sx0 > vw + f.L * 2 || sy0 < -f.L * 2 || sy0 > vh + f.L * 2) { f.vis = 0; continue; }
      spine(f, oy);
      var h = 3 + f.d * 9;
      bodyPath(sg, f, SH, h * 0.55, h);
    }
    sg.fill();
    g.globalAlpha = pal.sa;
    g.imageSmoothingEnabled = true;
    g.drawImage(shc, 0, 0, shc.width, shc.height, 0, 0, shc.width / SH, shc.height / SH);
    g.globalAlpha = 1;

    for (var q = 0; q < fish.length; q++) {
      var F = fish[q], oy2 = sy * F.pz, hx = F.x, hy = F.y - oy2;
      if (hx < -F.L * 2 || hx > vw + F.L * 2 || hy < -F.L * 2 || hy > vh + F.L * 2) continue;
      drawn++;
      spine(F, oy2);
      var al = F.tone * alphaAll * F.fade * fadeAt(CX[3], CY[3]);
      if (al < 0.004) continue;
      var e = F.n - 1;
      // fins first, paler than the body (ink thinned with water)
      g.fillStyle = "rgba(" + inkRGB + "," + (al * 0.5).toFixed(3) + ")";
      g.beginPath();
      var tail = tailPath(g, F, 1, 0, 0);
      if (F.K.fins) {
        var spl = 0.5 + 0.75 * (1 - F.th) + 0.12 * M.sin(F.ph * 0.5);
        var spr = 0.5 + 0.75 * (1 - F.th) + 0.12 * M.sin(F.ph * 0.5 + 1.7);
        var fl = F.L * (F.k === 2 ? 0.23 : 0.16);
        finPath(g, F, 2, 1, fl, spl + clamp(F.w * 0.4, -0.3, 0.3));
        finPath(g, F, 2, -1, fl, spr - clamp(F.w * 0.4, -0.3, 0.3));
        if (F.k === 2) { finPath(g, F, 6, 1, fl * 0.6, spl * 0.8); finPath(g, F, 6, -1, fl * 0.6, spr * 0.8); }
      }
      g.fill();
      // body: ink pooled at the head and along the back, washing out toward the tail
      var gr = g.createLinearGradient(CX[0], CY[0], CX[e], CY[e]);
      gr.addColorStop(0, "rgba(" + inkRGB + "," + (al * 1.05).toFixed(3) + ")");
      gr.addColorStop(0.45, "rgba(" + inkRGB + "," + (al * 0.82).toFixed(3) + ")");
      gr.addColorStop(1, "rgba(" + inkRGB + "," + (al * 0.5).toFixed(3) + ")");
      g.fillStyle = gr;
      g.beginPath();
      bodyPath(g, F, 1, 0, 0);
      g.fill();
      if (F.k > 0) {
        // the dorsal ridge: one darker brush stroke down the back
        g.strokeStyle = "rgba(" + inkRGB + "," + (al * 0.55).toFixed(3) + ")";
        g.lineWidth = F.L * (F.k === 2 ? 0.03 : 0.026);
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(CX[1], CY[1]);
        for (var s = 2; s < 7; s++) g.quadraticCurveTo(CX[s], CY[s], (CX[s] + CX[s + 1]) / 2, (CY[s] + CY[s + 1]) / 2);
        g.stroke();
        if (F.k === 2) {
          // fine rays in the tail
          g.lineWidth = 0.6;
          g.strokeStyle = "rgba(" + inkRGB + "," + (al * 0.38).toFixed(3) + ")";
          g.beginPath();
          for (var r2 = -1; r2 <= 1; r2 += 0.5) {
            var ra = tail[2] + r2 * tail[4] * 0.85, rl = tail[3] * (0.62 + 0.3 * M.abs(r2));
            g.moveTo(tail[0], tail[1]); g.lineTo(tail[0] + M.cos(ra) * rl, tail[1] + M.sin(ra) * rl);
          }
          g.stroke();
        }
        // eyes
        g.fillStyle = "rgba(" + inkRGB + "," + M.min(1, al * 1.9).toFixed(3) + ")";
        g.beginPath();
        var er = M.max(0.7, F.L * 0.014);
        var ex = (CX[0] * 0.7 + CX[1] * 0.3), ey = (CY[0] * 0.7 + CY[1] * 0.3), ew = WD[1] * 0.62;
        g.moveTo(ex + NX[0] * ew + er, ey + NY[0] * ew); g.arc(ex + NX[0] * ew, ey + NY[0] * ew, er, 0, TAU);
        g.moveTo(ex - NX[0] * ew + er, ey - NY[0] * ew); g.arc(ex - NX[0] * ew, ey - NY[0] * ew, er, 0, TAU);
        g.fill();
      }
    }
    // the shelves, the list and an opened case stay clean
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
    if (sy < heroB) return true;
    // below the hero: only the margins beside the shelves show water
    var m = 0;
    for (var i = 0; i < obs.length; i++) { var r = obs[i]; if (r.b > sy && r.t < sy + vh) m = M.max(m, M.min(r.l, vw - r.r)); }
    return m > 36 || !obs.length;
  };
  var frame = function (now) {
    raf = 0;
    if (!shown || D.hidden) { running = false; return; }
    var t0 = performance.now();
    var dt = M.min(0.1, (now - last) / 1000);
    last = now;
    svel = svel * 0.85 + ((sy - lastSy) / M.max(dt, 1 / 240)) * 0.15; lastSy = sy;
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
    if (running || !shown || D.hidden || !fish.length) return;
    running = true; last = performance.now(); rmLast = 0; lastSy = sy;
    raf = requestAnimationFrame(frame);
  }
  D.addEventListener("visibilitychange", function () { if (!D.hidden) wake(); });

  // ── relayout ──────────────────────────────────────────────────────────────
  var lastDims = "", lt = 0, lraf = 0;
  var layout = function () {
    var old = lastDims;
    measure();
    var dims = vw + "x" + PH + "@" + mobile;
    lastDims = dims;
    if (!fish.length || dims.split("x")[0] !== old.split("x")[0] || mobile !== (old.indexOf("true") > 0)) populate();
    if (shown) { tickPal(performance.now()); render(); wake(); }
  };
  var relayout = function () { cancelAnimationFrame(lraf); lraf = requestAnimationFrame(layout); };
  new ResizeObserver(function () { clearTimeout(lt); lt = setTimeout(relayout, 120); }).observe(wrap);
  Wn.addEventListener("resize", relayout);
  new MutationObserver(syncPal).observe(D.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  Wn.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncPal);
  Wn.addEventListener("pageshow", syncPal);
  RM.addEventListener("change", wake);

  // ── start after the page's first paint; settle the schools off-screen, then fade in ─
  var boot = function () {
    syncPal(); tickPal(0);
    measure(); lastDims = vw + "x" + PH + "@" + mobile;
    populate();
    var warm = 0;
    var settle = function () {
      for (var i = 0; i < 20; i++) step(STEP);
      if (++warm < 8) return requestAnimationFrame(settle);
      for (var k = 0; k < fish.length; k++) fish[k].fade = 1;
      shown = true;
      render();
      cv.classList.add("on");
      wake();
    };
    requestAnimationFrame(settle);
  };
  Wn.__inkfish = { get fish() { return fish; }, stats: stats, layout: layout, get running() { return running; } };
  var start = function () { requestAnimationFrame(function () { setTimeout(boot, 0); }); };
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", start, { once: true }); else start();
})();
