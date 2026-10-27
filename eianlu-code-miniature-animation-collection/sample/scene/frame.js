// Deterministic renderer: frame(i) -> pixels. No Date, no Math.random, no rAF, no state carried between frames.
(function () {
  const P = { yellow:"#FFC93C", pink:"#FF8DB5", cobalt:"#2E5BE6", coral:"#FF5A5F", mint:"#A9E6C6", sky:"#8DD3F6", lilac:"#D3BEFF", ink:"#25214A", paper:"#FFF8EE" };
  const q = new URLSearchParams(location.search);
  const W = +(q.get("w") || 1080), H = W, S = W / 1080;          // all layout in 1080-space, scaled by S
  const cv = document.getElementById("c"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  const FPS = CUES.fps, N = Math.round(CUES.duration * FPS);
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const ease = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  const cue = name => CUES.events.find(e => e.type === name).t;
  // ---------- scene built ONCE from seed (pure data) ----------
  const R = rng(CUES.seed);
  const pads = Array.from({ length: 14 }, () => ({ x: 120 + R() * 760, y: 330 + R() * 520, r: 28 + R() * 34, a: R() * 6.28, flower: R() < .35 }));
  pads.push({ x: 640, y: 560, r: 52, a: 0.4, flower: false, frog: true });
  const koi = Array.from({ length: 5 }, (_, k) => ({ cx: 300 + R() * 400, cy: 520 + R() * 260, rx: 90 + R() * 120, ry: 40 + R() * 70, sp: .25 + R() * .35, ph: R() * 6.28, col: [P.coral, P.yellow, P.coral, P.paper, P.yellow][k] }));
  const reeds = Array.from({ length: 22 }, () => ({ x: 60 + R() * 880, y: 180 + R() * 120, h: 30 + R() * 50 }));
  const edge = Array.from({ length: 1400 }, () => ({ u: R(), d: Math.pow(R(), 2.2), s: 1 + R() * 3.2, c: R() }));
  const dots = Array.from({ length: 160 }, () => ({ x: R() * 1000, y: 120 + R() * 200 }));
  // ---------- helpers ----------
  function shape(path, fill, sh = 7) { g.save(); g.translate(sh, sh); path(); g.fillStyle = P.ink; g.fill(); g.restore(); path(); g.fillStyle = fill; g.fill(); g.lineWidth = 3; g.strokeStyle = P.ink; g.stroke(); }
  function ell(x, y, rx, ry, rot = 0) { return () => { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, 7); }; }
  function rr(x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
  // ---------- world (1000x1000 units) ----------
  function world(t) {
    g.fillStyle = P.sky; g.fillRect(-200, -200, 1400, 1400);
    g.strokeStyle = "rgba(255,255,255,.55)"; g.lineWidth = 3;               // water stripes (pattern on big colour block)
    for (let y = 340; y < 1000; y += 34) { g.beginPath(); for (let x = -100; x <= 1100; x += 20) g.lineTo(x, y + Math.sin(x * .02 + t * 1.6 + y) * 4); g.stroke(); }
    shape(() => { g.beginPath(); g.moveTo(-200, -200); g.lineTo(1200, -200); g.lineTo(1200, 300); for (let x = 1200; x >= -200; x -= 50) g.lineTo(x, 300 + Math.sin(x * .013) * 26); g.closePath(); }, P.mint, 6);
    g.fillStyle = "rgba(37,33,74,.35)"; dots.forEach(d => { g.beginPath(); g.arc(d.x, d.y - 40, 3, 0, 7); g.fill(); });   // dot pattern on bank
    shape(() => rr(80, 140, 840, 42, 21), P.yellow, 5);                      // path
    g.strokeStyle = P.ink; g.lineWidth = 2.5; g.beginPath(); for (let x = 100; x < 900; x += 24) { g.lineTo(x, 152); g.lineTo(x + 12, 170); } g.stroke(); // zigzag
    reeds.forEach((r, k) => { const sw = Math.sin(t * 2 + k) * 4; g.strokeStyle = P.ink; g.lineWidth = 3; g.beginPath(); g.moveTo(r.x, r.y + 120); g.quadraticCurveTo(r.x, r.y + 60, r.x + sw, r.y + 60 - r.h); g.stroke(); });
    shape(() => rr(150, 240, 150, 110, 18), P.coral, 7);                     // pavilion
    shape(() => rr(165, 205, 120, 40, 12), P.cobalt, 6);
    // koi under pads
    koi.forEach(k => { const a = k.ph + t * k.sp * 2.4, x = k.cx + Math.cos(a) * k.rx, y = k.cy + Math.sin(a) * k.ry, dir = Math.atan2(Math.cos(a) * k.ry, -Math.sin(a) * k.rx);
      shape(ell(x, y, 26, 11, dir), k.col, 4); g.fillStyle = P.ink; g.beginPath(); g.arc(x + Math.cos(dir) * 15, y + Math.sin(dir) * 15, 2.5, 0, 7); g.fill(); });
    // ripples from splash (event-driven, pure function of t)
    const ts = cue("splash"); if (t > ts) for (let k = 0; k < 3; k++) { const a = t - ts - k * .18; if (a > 0 && a < 1.4) { g.strokeStyle = `rgba(255,255,255,${1 - a / 1.4})`; g.lineWidth = 4; g.beginPath(); g.ellipse(700, 650, 20 + a * 110, 8 + a * 44, 0, 0, 7); g.stroke(); } }
    pads.forEach(p => { shape(() => { g.beginPath(); g.moveTo(p.x, p.y); g.arc(p.x, p.y, p.r, p.a + .3, p.a + 6.0); g.closePath(); }, P.mint, 6);
      if (p.flower) { for (let k = 0; k < 6; k++) shape(ell(p.x + Math.cos(k) * 12, p.y + Math.sin(k) * 12, 15, 8, k), P.pink, 3); g.fillStyle = P.yellow; g.beginPath(); g.arc(p.x, p.y, 7, 0, 7); g.fill(); g.stroke(); } });
    // frog: sits, jumps on cue, lands in water at splash
    const tj = cue("frog_jump"); let fx = 640, fy = 545, vis = true;
    if (t > tj) { const u = clamp((t - tj) / (ts - tj)); fx = 640 + 60 * u; fy = 545 - Math.sin(u * Math.PI) * 90 + 105 * u; vis = u < 1; }
    if (vis) { shape(ell(fx, fy, 22, 17), P.mint, 5); g.fillStyle = P.paper; [[-9, -12], [9, -12]].forEach(([dx, dy]) => { g.beginPath(); g.arc(fx + dx, fy + dy, 6, 0, 7); g.fill(); g.stroke(); }); }
    // falling petal (lands on cue)
    const tp = cue("petal_land"), u = clamp(t / tp); shape(ell(420 + Math.sin(t * 3) * 30, 300 + 330 * u, 9, 5, t * 2), P.pink, 3);
    // bird crossing (enters on cue)
    const tb = cue("bird_in"); if (t > tb) { const v = (t - tb) / 2.2, bx = -60 + v * 1150, by = 420 - v * 160, fl = Math.sin(t * 22) * 14;
      g.lineWidth = 3; g.strokeStyle = P.ink; g.fillStyle = P.lilac; g.beginPath(); g.moveTo(bx - 52, by + fl * 2); g.lineTo(bx, by); g.lineTo(bx + 52, by + fl * 2); g.lineTo(bx, by + 16); g.closePath(); g.fill(); g.stroke(); }
    // cloud shadow sweeping
    g.fillStyle = "rgba(37,33,74,.10)"; g.beginPath(); g.ellipse(-300 + t * 260, 600, 260, 120, .2, 0, 7); g.fill();
  }
  // ---------- frame(i) ----------
  window.FRAMES = N;
  window.frame = function (i) {
    const t = i / FPS, T = CUES.duration;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = P.paper; g.fillRect(0, 0, W, H); g.scale(S, S);
    const box = { x: 160, y: 120, w: 760, h: 760, r: 48 }, cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const grow = Math.min(ease(clamp(t / CUES.intro)), ease(clamp((T - t) / CUES.outro)));   // 0..1
    const reach = Math.hypot(box.w, box.h) / 2 * grow;
    // camera: one continuous move, slow push + slight rotation + pan
    const k = t / T, zoom = 1.0 + .10 * k, rot = (-1.5 + 3 * k) * Math.PI / 180, panX = 40 * k, panY = -25 * k;
    g.save(); rr(box.x, box.y, box.w, box.h, box.r); g.clip(); g.beginPath(); g.arc(cx, cy, Math.max(reach, .01), 0, 7); g.clip();
    g.translate(cx, cy); g.rotate(rot); g.scale(zoom * .78, zoom * .78); g.translate(-500 - panX, -540 - panY); world(t); g.restore();
    // spray-paint particle edge (fixed seed; the same particles every frame, so no flicker)
    const cols = [P.sky, P.mint, P.ink, P.pink];
    edge.forEach(p => { const ang = p.u * 6.283; let ex, ey;
      if (grow < .999) { ex = cx + Math.cos(ang) * (reach + p.d * 26); ey = cy + Math.sin(ang) * (reach + p.d * 26); if (reach < 2) return; }
      else { const per = p.u * 4; const side = Math.floor(per), f = per - side; const off = p.d * 22;
        [ex, ey] = [[box.x + f * box.w, box.y - off], [box.x + box.w + off, box.y + f * box.h], [box.x + box.w - f * box.w, box.y + box.h + off], [box.x - off, box.y + box.h - f * box.h]][side]; }
      g.globalAlpha = (1 - p.d) * .9; g.fillStyle = cols[Math.floor(p.c * cols.length)]; g.beginPath(); g.arc(ex, ey, p.s, 0, 7); g.fill(); });
    g.globalAlpha = 1;
    // captions: 3 centered lines; geo follows camera
    const a = clamp(grow * 1.4 - .3); g.globalAlpha = a; g.fillStyle = P.ink; g.textAlign = "center";
    g.font = '600 30px "Noto Sans CJK SC","Noto Serif CJK SC",sans-serif'; g.fillText(CUES.title.join("  "), 540, 945);
    g.font = '22px "Noto Sans CJK SC","Noto Serif CJK SC",sans-serif'; g.fillText(CUES.season.join("  ·  "), 540, 985);
    const lat = (CUES.geo.lat + panY * -2e-5).toFixed(4), lon = (CUES.geo.lon + panX * 2e-5).toFixed(4);
    g.font = '20px "DejaVu Sans Mono",monospace'; g.fillText(`${lat}° N  ${lon}° E`, 540, 1022); g.globalAlpha = 1;
  };
})();
