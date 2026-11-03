/*! ink-fish v1.3.1 — brush-ink fish swimming behind your page. MIT © 2026 BreakDimbo
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
   in muted pigment washes. Optional (v1.3, water: "real"): one WebGL2 layer for real water: dispersive
   Cauchy–Poisson rings, fish and shadows refracted by the slope, area-ratio caustics, a faint Fresnel
   sky (methods after Ultra Water, MIT, see THIRD_PARTY_NOTICES.md); Canvas 2D stays the fallback.

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
    trail: true,              // with ripples on: press and drag in open water to draw one long water trail (a line source)
    ripples: false,           // faint water rings under the cursor (and on tap/click) that refract the fish they cross; "real" = ripples + water "real"
    water: false,             // false (flat, Canvas 2D) | "real": a WebGL2 surface (dispersive rings, refraction, caustics, Fresnel); falls back to flat
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
  // ── real water (v1.3, opt-in): one WebGL2 layer over the two Canvas 2D layers ─────────────────────
  // The methods follow Humpalumps/Ultra-Water (MIT, see THIRD_PARTY_NOTICES.md) scaled down to a
  // top-down pond a hand's depth deep; no code is copied from it.
  //  · Ripples are Cauchy–Poisson rings: a point disturbance released on deep water, summed over
  //    wavenumber with the capillary–gravity dispersion ω² = gk + (σ/ρ)k³ (σ/ρ = 7.4e-5 m³/s², the value
  //    Ultra Water uses for its capillary band) and viscous damping e^(−2νk²t). Short waves run ahead,
  //    so a ring is a train of finer wavelets in front of a quiet centre, and the finest die first.
  //    The radial profile of each live ring is integrated on the GPU every frame from a Bessel table.
  //  · A faint ambient swell is a dozen dispersive plane waves (a hand-picked Tessendorf-style spectrum).
  //  · Caustics are Evan Wallace's area-ratio splat: a grid refracted through the smoothed (cubic
  //    B-spline) slopes onto the floor, each triangle adding old area / new area, so the light only moves
  //    around (mean 1) and the slopes never land as beads.
  //  · The fish and their shadows are refracted by the slope (deeper layers shift further), seen through
  //    a Beer–Lambert water column, and the surface adds a Fresnel-weighted reflection of a soft sky.
  var WATER = (function () {
    var S = 6e-4, G = 9.81, SR = 7.4e-5;   // metres per CSS px; g; σ/ρ
    var SLOW = 0.22, ASLOW = 0.1;           // slow motion of the rings, of the ambient swell
    var NU = 6e-6;                          // kinematic viscosity, ×6 for a pond's surface film
    var SRC = 7, NK = 192, NR = 512, RMAX = 640, SLOTS = 8, SIM = 0.5;
    // a press-and-drag trail is a line source: NA profile rows over its life LS (ages bunched young), up to NS points
    var NA = 12, LS = 3.4, NS = 64, ROWS = SLOTS + NA;
    var DK = 4.2 / SRC / NK, KP = new Float32Array(NK), W = new Float32Array(NK), VD = new Float32Array(NK);
    for (var i = 0; i < NK; i++) { var kp = (i + 0.5) * DK, km = kp / S; KP[i] = kp; W[i] = Math.sqrt(G * km + SR * km * km * km); VD[i] = 2 * NU * km * km; }
    // Bessel J0, J1: Abramowitz & Stegun 9.4.1–9.4.6 (|error| < 1e-7)
    var j0 = function (x) {
      if (x < 3) { var y = x * x / 9; return 1 + y * (-2.2499997 + y * (1.2656208 + y * (-0.3163866 + y * (0.0444479 + y * (-0.0039444 + y * 0.00021))))); }
      var z = 3 / x, f = 0.79788456 + z * (-0.00000077 + z * (-0.0055274 + z * (-0.00009512 + z * (0.00137237 + z * (-0.00072805 + z * 0.00014476)))));
      var t = x - 0.78539816 + z * (-0.04166397 + z * (-0.00003954 + z * (0.00262573 + z * (-0.00054125 + z * (-0.00029333 + z * 0.00013558)))));
      return f * Math.cos(t) / Math.sqrt(x);
    };
    var j1 = function (x) {
      if (x < 3) { var y = x * x / 9; return x * (0.5 + y * (-0.56249985 + y * (0.21093573 + y * (-0.03954289 + y * (0.00443319 + y * (-0.00031761 + y * 0.00001109)))))); }
      var z = 3 / x, f = 0.79788456 + z * (0.00000156 + z * (0.01659667 + z * (0.00017105 + z * (-0.00249511 + z * (0.00113653 - z * 0.00020033)))));
      var t = x - 2.35619449 + z * (0.12499612 + z * (0.0000565 + z * (-0.00637879 + z * (0.00074348 + z * (0.00079824 - z * 0.00029166)))));
      return f * Math.cos(t) / Math.sqrt(x);
    };
    var JT = null, JL = null, NORM = 1, NORML = 1;
    // the spectrum of one ring at time t (s): source k·e^(−k²a²/4), phase ω·t, viscous decay
    var spec = function (t, A, out, o) {
      var tp = t * SLOW;
      for (var k = 0; k < NK; k++) { var kp = KP[k]; out[o + k] = A * DK * kp * Math.exp(-kp * kp * SRC * SRC / 4 - VD[k] * tp) * Math.cos(W[k] * tp); }
    };
    // a line impulse (the 1-D Cauchy–Poisson problem across the stroke): the same dispersion and decay, with
    // cos(k·d) for J0(k·r) and without the radial measure k
    var specL = function (t, A, out, o) {
      var tp = t * SLOW;
      for (var k = 0; k < NK; k++) { var kp = KP[k]; out[o + k] = A * DK * Math.exp(-kp * kp * SRC * SRC / 4 - VD[k] * tp) * Math.cos(W[k] * tp); }
    };
    var tableL = function () {
      if (JL) return JL;
      JL = new Float32Array(NR * NK * 2);
      for (var k = 0; k < NK; k++) for (var r = 0; r < NR; r++) {
        var x = KP[k] * r * RMAX / (NR - 1);
        JL[(k * NR + r) * 2] = Math.cos(x); JL[(k * NR + r) * 2 + 1] = -KP[k] * Math.sin(x);
      }
      var F = new Float32Array(NK), mx = 0; specL(0.5, 1, F, 0);
      for (var q = 0; q < NR; q++) { var s = 0; for (var kk = 0; kk < NK; kk++) s += F[kk] * JL[(kk * NR + q) * 2 + 1]; if (Math.abs(s) > mx) mx = Math.abs(s); }
      NORML = 1 / mx;
      return JL;
    };
    // the age of trail profile row i, and back (rows bunched toward the young end, where the profile changes fastest)
    var rowAge = function (i) { var u = i / (NA - 1); return LS * u * u; };
    var table = function () {
      if (JT) return JT;
      JT = new Float32Array(NR * NK * 2);
      for (var k = 0; k < NK; k++) for (var r = 0; r < NR; r++) {
        var x = KP[k] * r * RMAX / (NR - 1);
        JT[(k * NR + r) * 2] = j0(x); JT[(k * NR + r) * 2 + 1] = -KP[k] * j1(x); // η and dη/dr kernels
      }
      // normalise: a unit ring has its steepest slope = 1 at t = 0.5 s
      var F = new Float32Array(NK), mx = 0; spec(0.5, 1, F, 0);
      for (var q = 0; q < NR; q++) { var s = 0; for (var kk = 0; kk < NK; kk++) s += F[kk] * JT[(kk * NR + q) * 2 + 1]; if (Math.abs(s) > mx) mx = Math.abs(s); }
      NORM = 1 / mx;
      return JT;
    };
    var HEAD = "#version 300 es\nprecision highp float;precision highp sampler2D;\n";
    var VS_FULL = HEAD + "in vec2 a;out vec2 v;void main(){v=a*.5+.5;gl_Position=vec4(a,0.,1.);}";
    // per ring: η(r) and dη/dr summed over wavenumber
    var FS_PROF = HEAD + "uniform sampler2D J,F;out vec4 o;void main(){ivec2 c=ivec2(gl_FragCoord.xy);vec2 s=vec2(0.);" +
      "for(int k=0;k<" + NK + ";k++)s+=texelFetch(F,ivec2(k,c.y),0).r*texelFetch(J,ivec2(c.x,k),0).rg;o=vec4(s,0.,1.);}";
    // the surface at half resolution: height, slope (screen axes, y down) and where water shows
    var FS_SIM = HEAD + "uniform sampler2D P;uniform vec2 vp;uniform vec4 I[" + SLOTS + "],A[16],R[32],K[32],S[" + NS + "];uniform int nR,nS;in vec2 v;out vec4 o;" +
      "void main(){vec2 p=vec2(v.x,1.-v.y)*vp;float h=0.;vec2 s=vec2(0.);" +
      "for(int i=0;i<16;i++){vec4 a=A[i];float t=dot(a.xy,p)-a.w;h+=a.z*sin(t);s+=a.z*cos(t)*a.xy;}" +
      "for(int i=0;i<" + SLOTS + ";i++){vec4 q=I[i];if(q.z<=0.)continue;vec2 d=p-q.xy;float r=length(d);if(r>=" + RMAX.toFixed(1) + ")continue;" +
      "vec2 e=texture(P,vec2(r*" + ((NR - 1) / NR / RMAX).toFixed(9) + "+" + (0.5 / NR).toFixed(9) + ",(float(i)+.5)/" + ROWS.toFixed(1) + ")).rg;h+=e.x;s+=e.y*d/max(r,.001);}" +
      // the trail: the nearest point of the stroke polyline gives the distance, the age there and the strength
      "if(nS>1){float bd=1e9,ba=0.,bs=0.;vec2 bv=vec2(0.);for(int i=1;i<" + NS + ";i++){if(i>=nS)break;vec4 a=S[i-1],b=S[i];if(a.w<=0.||b.w<=0.)continue;" +
      "vec2 ab=b.xy-a.xy,ap=p-a.xy;float u=clamp(dot(ap,ab)/max(dot(ab,ab),1e-3),0.,1.);vec2 dv=ap-ab*u;float dd=dot(dv,dv);if(dd<bd){bd=dd;bv=dv;ba=mix(a.z,b.z,u);bs=mix(a.w,b.w,u);}}" +
      "float r=sqrt(bd);if(r<" + RMAX.toFixed(1) + "){float u=sqrt(clamp(ba/" + LS.toFixed(2) + ",0.,1.))*" + (NA - 1).toFixed(1) + ";" +
      "vec2 e=texture(P,vec2(r*" + ((NR - 1) / NR / RMAX).toFixed(9) + "+" + (0.5 / NR).toFixed(9) + ",(" + SLOTS.toFixed(1) + "+u+.5)/" + ROWS.toFixed(1) + ")).rg*bs;h+=e.x;s+=e.y*bv/max(r,.001);}}" +
      "float m=1.;for(int i=0;i<32;i++){if(i>=nR)break;vec4 b=R[i];vec2 dd=max(max(b.xy-p,p-b.zw),0.);m=min(m,mix(K[i].x,1.,smoothstep(0.,K[i].y,length(dd))));}" +
      "o=vec4(h,s,m);}";
    // caustics (after Evan Wallace): a grid refracted onto the floor; each triangle adds old area / new area
    // (the slope is box-filtered over one grid cell first: a wavelength shorter than two cells would alias into dashes)
    var VS_CAU = HEAD + "in vec2 a;uniform sampler2D Wt;uniform vec2 ws,vp;uniform float D,E;out vec2 o0;" +
      "vec4 bs(vec2 uv){vec2 x=uv*ws-.5,b=floor(x),f=x-b,f2=f*f,f3=f2*f;" +
      "vec2 w0=(1.-3.*f+3.*f2-f3)/6.,w1=(4.-6.*f2+3.*f3)/6.,w2=(1.+3.*f+3.*f2-3.*f3)/6.,w3=f3/6.,g0=w0+w1,g1=w2+w3;" +
      "vec2 h0=(b-.5+w1/g0)/ws,h1=(b+1.5+w3/g1)/ws;" +
      "return g0.y*(g0.x*texture(Wt,h0)+g1.x*texture(Wt,vec2(h1.x,h0.y)))+g1.y*(g0.x*texture(Wt,vec2(h0.x,h1.y))+g1.x*texture(Wt,h1));}" +
      "uniform vec2 G;void main(){vec2 uv=mix(vec2(-E),vec2(1.+E),a),g=vec2(G.x,-G.y);vec2 s=.25*(bs(uv+G).yz+bs(uv-G).yz+bs(uv+g).yz+bs(uv-g).yz);vec2 p=vec2(uv.x,1.-uv.y)*vp,q=p+D*s;o0=p;" +
      "gl_Position=vec4(q.x/vp.x*2.-1.,1.-q.y/vp.y*2.,0.,1.);}";
    var FS_CAU = HEAD + "in vec2 o0;uniform float px;out vec4 o;void main(){vec2 x=dFdx(o0),y=dFdy(o0);o=vec4(min(abs(x.x*y.y-x.y*y.x)/px,10.),0.,0.,1.);}";
    // the sky is not a point: its penumbra blurs the floor light by about depth × its angular size (half resolution);
    // never less than one grid cell, so a young ring's tight wavelengths don't print the triangles as dashes
    var FS_BLUR = HEAD + "uniform sampler2D C;uniform vec2 cb;in vec2 v;out vec4 o;float cl(vec2 u){return min(texture(C,u).r,2.5);}" +
      "void main(){vec2 h=cb*.5,e=vec2(cb.x,-cb.y);" +
      "o=vec4(.2*cl(v)+.12*(cl(v+cb)+cl(v-cb)+cl(v+e)+cl(v-e))+.08*(cl(v+vec2(h.x,0.))+cl(v-vec2(h.x,0.))+cl(v+vec2(0.,h.y))+cl(v-vec2(0.,h.y))),0.,0.,1.);}";
    // composite: refracted fish over the refracted shadow on the caustic-lit floor, then the reflection.
    // Refraction never reaches past the canvas (no smeared edge texels). Steep facets also catch the brighter
    // sky away from the zenith (k2.z: a faint cool line on a ring's crests in a dark room). A blue-noise-ish
    // dither of ±½ step keeps the smooth light from banding in 8 bits.
    // Output is premultiplied "multiply the paper by (1−a), then add rgb", so the page shows through.
    var FS_COMP = HEAD + "uniform sampler2D Fi,Sh,Wt,B;uniform vec2 vp,ss;uniform vec3 lit,ins,sky,tr;uniform vec4 k1,k2;uniform vec2 ld;in vec2 v;out vec4 o;" +
      "float inb(vec2 u){return step(0.,min(min(u.x,u.y),1.-max(u.x,u.y)));}" +
      "void main(){vec2 p=vec2(v.x,1.-v.y)*vp;vec4 w=texture(Wt,v);vec2 s=w.yz;float m=w.w;" +
      "vec2 uf=(p+k1.x*s)/vp,us=(p+k1.y*s)*ss;vec4 f=texture(Fi,uf)*inb(uf);float sh=texture(Sh,us).a*inb(us);" +
      "float c=texture(B,v).r;" +
      "float L=1.+(c-1.)*k1.z*m,e=(1.-sh)*L;" +
      "float mul=min(e,1.);vec3 add=lit*max(e-1.,0.)+ins*sh*k2.y;" +
      "add=add*(1.-f.a)+f.rgb*tr+ins*f.a*k2.x;mul*=1.-f.a;" +
      "vec3 n=normalize(vec3(-s,1.));float F=.02+.98*pow(1.-n.z,5.);vec2 r=2.*n.z*n.xy;" +
      "float q=(F*(1.+k2.w*dot(r,ld))-.02)*k1.w*m,hz=min(k2.z*dot(s,s),.1)*m;add+=sky*(max(q,0.)+hz);mul*=(1.+min(q,0.))*(1.-hz);" +
      "float d=(fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))))-.5)/255.;" +
      "o=vec4(add+d,1.-mul+d);}";

    function create(D) {
      var c = D.createElement("canvas"), gl = null;
      try { gl = c.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "low-power" }); } catch (e) { gl = null; }
      if (!gl || !gl.getExtension("EXT_color_buffer_float")) return null;
      var sh = function (type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
      var prog = function (vs, fs) {
        var p = gl.createProgram(), a = sh(gl.VERTEX_SHADER, vs), b = sh(gl.FRAGMENT_SHADER, fs);
        gl.attachShader(p, a); gl.attachShader(p, b); gl.bindAttribLocation(p, 0, "a"); gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
        var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (var i = 0; i < n; i++) { var nm = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, ""); u[nm] = gl.getUniformLocation(p, nm); }
        return { p: p, u: u };
      };
      var Pp = prog(VS_FULL, FS_PROF), Ps = prog(VS_FULL, FS_SIM), Pc = prog(VS_CAU, FS_CAU), Pb = prog(VS_FULL, FS_BLUR), Po = prog(VS_FULL, FS_COMP);
      if (!Pp || !Ps || !Pc || !Pb || !Po) return null;
      var tex = function (fmt, w, h, filt, type, data, f2) {
        var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (w) gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, f2, type, data || null);
        return t;
      };
      var fbo = function (t) { var f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE; gl.bindFramebuffer(gl.FRAMEBUFFER, null); return ok ? f : null; };
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      var tJ = tex(gl.RG32F, NR, NK, gl.NEAREST, gl.FLOAT, table(), gl.RG);
      var tJL = tex(gl.RG32F, NR, NK, gl.NEAREST, gl.FLOAT, tableL(), gl.RG);
      var tF = tex(gl.R32F, NK, ROWS, gl.NEAREST, gl.FLOAT, null, gl.RED);
      var tP = tex(gl.RGBA16F, NR, ROWS, gl.LINEAR, gl.HALF_FLOAT, null, gl.RGBA), fP = fbo(tP);
      var tW = tex(gl.RGBA16F, 1, 1, gl.LINEAR, gl.HALF_FLOAT, null, gl.RGBA), fW = fbo(tW);
      var tC = tex(gl.RGBA16F, 1, 1, gl.LINEAR, gl.HALF_FLOAT, null, gl.RGBA), fC = fbo(tC);
      var tB = tex(gl.RGBA16F, 1, 1, gl.LINEAR, gl.HALF_FLOAT, null, gl.RGBA), fB = fbo(tB);
      if (!fP || !fW || !fC || !fB) return null;
      var tFi = tex(0, 0, 0, gl.LINEAR), tSh = tex(0, 0, 0, gl.LINEAR);
      var tri = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, tri); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      var vaoT = gl.createVertexArray(); gl.bindVertexArray(vaoT); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      var vaoG = gl.createVertexArray(), gB = gl.createBuffer(), gI = gl.createBuffer(), gN = 0;
      gl.bindVertexArray(vaoG); gl.bindBuffer(gl.ARRAY_BUFFER, gB); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gI); gl.bindVertexArray(null);

      // ambient swell: wavelengths 56–240 px from a broad fan of directions (crossing trains make the
      // caustic a cell network, not a weave), slopes a few thousandths
      var AMB = new Float32Array(64), AW = [], seed = Math.random() * 6.283;
      for (var a = 0; a < 16; a++) {
        var lam = 56 * Math.pow(240 / 56, (a + Math.random()) / 16), k = 6.2832 / lam, km = k / S;
        var dir = seed + (a * 0.618034 % 1 - 0.5) * 3.4 + (Math.random() - 0.5) * 0.4;
        AW.push({ kx: Math.cos(dir) * k, ky: Math.sin(dir) * k, amp: (0.0042 + Math.random() * 0.003) / k, w: Math.sqrt(G * km + SR * km * km * km) * ASLOW, ph: Math.random() * 6.283 });
      }
      var Fd = new Float32Array(NK * ROWS), Su = new Float32Array(NS * 4), Iu = new Float32Array(SLOTS * 4), Ru = new Float32Array(128), Ku = new Float32Array(128);
      var W_ = 0, H_ = 0, sw = 0, shh = 0, lost = false, hadRings = true, Q = 0, RS = [0, 0, 0, 0];
      // the surface and its caustics are re-simulated only when something moved them: every frame while rings
      // live, on scroll or a layout change, else at ~30 Hz for the slow ambient swell (simT, simK)
      var simT = -9, simK = NaN, work = { comp: 0, sim: 0, cau: 0, prof: 0, up: 0 };
      c.addEventListener("webglcontextlost", function (e) { e.preventDefault(); lost = true; api.onlost && api.onlost(); });
      // quality 0: the device pixels of the 2D canvas, a caustic vertex every 6 CSS px; 1 (a slow GPU): 1 px per CSS px, every 8
      var resize = function (cssW, cssH, pw, ph) {
        RS = [cssW, cssH, pw, ph];
        if (Q) { pw = Math.max(1, Math.round(cssW)); ph = Math.max(1, Math.round(cssH)); }
        if (cssW === W_ && cssH === H_ && pw === c.width && ph === c.height) return;
        grid = Q ? 8 : 6;
        W_ = cssW; H_ = cssH; c.width = pw; c.height = ph; c.style.width = cssW + "px"; c.style.height = cssH + "px";
        sw = Math.max(2, Math.ceil(cssW * SIM)); shh = Math.max(2, Math.ceil(cssH * SIM));
        [tW, tC, tB].forEach(function (t) { gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, sw, shh, 0, gl.RGBA, gl.HALF_FLOAT, null); });
        // the caustic grid reaches 4% past each edge
        var E = 0.04, nx = Math.ceil(cssW * (1 + 2 * E) / grid) + 1, ny = Math.ceil(cssH * (1 + 2 * E) / grid) + 1;
        var V = new Float32Array(nx * ny * 2), Ix = new Uint32Array((nx - 1) * (ny - 1) * 6), n = 0;
        for (var y = 0; y < ny; y++) for (var x = 0; x < nx; x++) { V[(y * nx + x) * 2] = x / (nx - 1); V[(y * nx + x) * 2 + 1] = y / (ny - 1); }
        for (var yy = 0; yy < ny - 1; yy++) for (var xx = 0; xx < nx - 1; xx++) { var i0 = yy * nx + xx; Ix[n++] = i0; Ix[n++] = i0 + 1; Ix[n++] = i0 + nx; Ix[n++] = i0 + 1; Ix[n++] = i0 + nx + 1; Ix[n++] = i0 + nx; }
        gN = n; gV = nx * ny; simK = NaN;
        gl.bindVertexArray(vaoG); gl.bindBuffer(gl.ARRAY_BUFFER, gB); gl.bufferData(gl.ARRAY_BUFFER, V, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gI); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, Ix, gl.STATIC_DRAW); gl.bindVertexArray(null);
      };
      var gV = 0, grid = 6;
      var upload = function (t, src, wh) {
        gl.bindTexture(gl.TEXTURE_2D, t);
        if (wh[0] !== src.width || wh[1] !== src.height) { wh[0] = src.width; wh[1] = src.height; gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); }
        else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
      };
      var szF = [0, 0], szS = [0, 0];
      var bindT = function (P, name, unit, t) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(P.u[name], unit); };
      /* frame: fish/shadow canvases, rings [{x,y,t,s}], rects [{l,t,r,b,keep,f}] in CSS px of the canvas, time (s), look */
      var draw = function (fishC, shC, SHs, rings, rects, T, sy, look, trail) {
        if (lost) return;
        gl.disable(gl.BLEND);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        upload(tFi, fishC, szF); upload(tSh, shC, szS);
        work.up = fishC.width * fishC.height + shC.width * shC.height; work.prof = work.sim = work.cau = 0;
        // 1 · ring profiles, one row per live ring
        var nI = 0;
        for (var i = 0; i < rings.length && nI < SLOTS; i++) {
          var R0 = rings[i], env = Math.min(1, R0.t / 0.5), life = R0.life;
          env *= env * (3 - 2 * env) * (R0.t > life - 1.4 ? Math.max(0, (life - R0.t) / 1.4) : 1);
          if (env <= 0 || !(R0.s > 0)) continue;
          spec(R0.t, NORM * R0.s * look.ring * env, Fd, nI * NK);
          Iu[nI * 4] = R0.x; Iu[nI * 4 + 1] = R0.y; Iu[nI * 4 + 2] = 1; nI++;
        }
        for (var z = nI; z < SLOTS; z++) Iu[z * 4 + 2] = 0;
        if (nI) {
          gl.bindTexture(gl.TEXTURE_2D, tF); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, NK, nI, gl.RED, gl.FLOAT, Fd);
          gl.bindFramebuffer(gl.FRAMEBUFFER, fP); gl.viewport(0, 0, NR, nI); gl.useProgram(Pp.p);
          bindT(Pp, "J", 0, tJ); bindT(Pp, "F", 1, tF);
          gl.bindVertexArray(vaoT); gl.drawArrays(gl.TRIANGLES, 0, 3);
          work.prof = NR * nI;
        }
        // 1b · the trail's profiles: one row per age, a line source each
        var nS = trail && trail.n > 1 ? Math.min(NS, trail.n) : 0;
        if (nS) {
          for (var ai = 0; ai < NA; ai++) {
            var ag = rowAge(ai), en = Math.min(1, ag / 0.12 + 0.15) * Math.pow(Math.max(0, 1 - ag / LS), 1.7);
            specL(ag, NORML * look.ring * en, Fd, (SLOTS + ai) * NK);
          }
          gl.bindTexture(gl.TEXTURE_2D, tF); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, SLOTS, NK, NA, gl.RED, gl.FLOAT, Fd.subarray(SLOTS * NK));
          gl.bindFramebuffer(gl.FRAMEBUFFER, fP); gl.viewport(0, SLOTS, NR, NA); gl.useProgram(Pp.p);
          bindT(Pp, "J", 0, tJL); bindT(Pp, "F", 1, tF);
          gl.bindVertexArray(vaoT); gl.drawArrays(gl.TRIANGLES, 0, 3);
          work.prof += NR * NA;
          for (var si = 0; si < nS * 4; si++) Su[si] = trail.a[si];
        }
        // 2 · the surface, 3 · caustics, their penumbra: only when something moved them
        var nR = Math.min(32, rects.n != null ? rects.n : rects.length), key = sy + look.amb * 7 + look.cd * 13 + look.cb * 17 + nR * 19;
        for (var q = 0; q < nR; q++) { var b = rects[q]; key += b.l * 3 + b.t * 5 + b.r * 7 + b.b * 11 + b.keep; Ru[q * 4] = b.l; Ru[q * 4 + 1] = b.t; Ru[q * 4 + 2] = b.r; Ru[q * 4 + 3] = b.b; Ku[q * 4] = b.keep; Ku[q * 4 + 1] = Math.max(1, b.f); }
        if (nI || nS || hadRings || key !== simK || T - simT >= 1 / 31 || T < simT) {
          simT = T; simK = key;
          for (var a = 0; a < 16; a++) {
            var w = AW[a], ph = (w.w * T + w.ph - w.ky * sy) % 6.283185;
            AMB[a * 4] = w.kx; AMB[a * 4 + 1] = w.ky; AMB[a * 4 + 2] = w.amp * look.amb; AMB[a * 4 + 3] = ph;
          }
          gl.bindFramebuffer(gl.FRAMEBUFFER, fW); gl.viewport(0, 0, sw, shh); gl.useProgram(Ps.p);
          bindT(Ps, "P", 0, tP);
          gl.uniform2f(Ps.u.vp, W_, H_); gl.uniform4fv(Ps.u.I, Iu); gl.uniform4fv(Ps.u.A, AMB);
          gl.uniform4fv(Ps.u.R, Ru); gl.uniform4fv(Ps.u.K, Ku); gl.uniform1i(Ps.u.nR, nR); gl.uniform1i(Ps.u.nS, nS); if (nS) gl.uniform4fv(Ps.u.S, Su);
          gl.bindVertexArray(vaoT); gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.bindFramebuffer(gl.FRAMEBUFFER, fC); gl.viewport(0, 0, sw, shh);
          gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
          gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
          gl.useProgram(Pc.p); bindT(Pc, "Wt", 0, tW);
          gl.uniform2f(Pc.u.ws, sw, shh); gl.uniform2f(Pc.u.vp, W_, H_); gl.uniform1f(Pc.u.D, look.cd); gl.uniform1f(Pc.u.E, 0.04); gl.uniform2f(Pc.u.G, grid * 0.5 / W_, grid * 0.5 / H_);
          gl.uniform1f(Pc.u.px, (W_ / sw) * (H_ / shh));
          gl.bindVertexArray(vaoG); gl.drawElements(gl.TRIANGLES, gN, gl.UNSIGNED_INT, 0);
          gl.disable(gl.BLEND);
          gl.bindFramebuffer(gl.FRAMEBUFFER, fB); gl.viewport(0, 0, sw, shh); gl.useProgram(Pb.p);
          bindT(Pb, "C", 0, tC); var cr = Math.max(look.cb, grid); gl.uniform2f(Pb.u.cb, cr / W_, cr / H_);
          gl.bindVertexArray(vaoT); gl.drawArrays(gl.TRIANGLES, 0, 3);
          work.sim = sw * shh * 2; work.cau = gV;
        }
        hadRings = nI > 0 || nS > 0;
        // 4 · composite
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, c.width, c.height); gl.useProgram(Po.p);
        bindT(Po, "Fi", 0, tFi); bindT(Po, "Sh", 1, tSh); bindT(Po, "Wt", 2, tW); bindT(Po, "B", 3, tB);
        gl.uniform2f(Po.u.vp, W_, H_); gl.uniform2f(Po.u.ss, SHs / shC.width, SHs / shC.height);
        gl.uniform3fv(Po.u.lit, look.lit); gl.uniform3fv(Po.u.ins, look.ins); gl.uniform3fv(Po.u.sky, look.sky); gl.uniform3fv(Po.u.tr, look.tr);
        gl.uniform4f(Po.u.k1, look.fd, look.sd, look.cs, look.fr); gl.uniform4f(Po.u.k2, look.fi, look.si, look.hz || 0, look.sg);
        gl.uniform2f(Po.u.ld, -0.6, -0.8);
        gl.bindVertexArray(vaoT); gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
        work.comp = c.width * c.height;
      };
      var api = {
        canvas: c, resize: resize, draw: draw, work: work,
        get lost() { return lost; },
        get quality() { return Q; },
        setQuality: function (q) { q = q ? 1 : 0; if (q === Q) return; Q = q; W_ = -1; resize(RS[0], RS[1], RS[2], RS[3]); },
        destroy: function () { var x = gl.getExtension("WEBGL_lose_context"); if (x) x.loseContext(); if (c.parentNode) c.parentNode.removeChild(c); }
      };
      return api;
    }
    // the radius of a ring's steepest crest (CSS px) at t seconds, for the fish it nudges
    var front = function (t) { return 14 + 68 * t; };
    return { create: create, front: front, life: 5, trailLife: LS, trailN: NS };
  })();

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
    // real water: wanted unless reduced motion, or WebGL2 failed / the device proved too slow
    var water = null, waterFail = false, realLive = false, booted = false;
    var realWant = function () { return (O.water === "real" || O.ripples === "real") && !RM.matches && !waterFail; };
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
    // the paper under the pond (for the light the caustics add); read only with real water on
    var paperOf = function (dark) {
      if (realWant()) for (var e = page ? D.body : host; e && e.nodeType === 1; e = e.parentElement) {
        var m = (getComputedStyle(e).backgroundColor || "").match(/[\d.]+/g);
        if (m && m.length >= 3 && (m.length < 4 || +m[3] > 0.5)) return [m[0] / 255, m[1] / 255, m[2] / 255];
      }
      return dark ? [0.067, 0.063, 0.051] : [0.949, 0.929, 0.894];
    };
    var readPal = function () {
      var dark = isDark(), src = O.ink, pp = paperOf(dark);
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
            wh: [226, 220, 208], wb: 1.32, wl: 0.3, wn: 0, pc: 0.8, ob: 1.42, sp: 0.065, fn: 0.7, gr: 0, eye: [20, 18, 16],
            // real water: caustic light, in-scatter, sky, fish transmittance; depths (px of shift per unit slope),
            // caustic contrast, Fresnel gain, in-scatter on fish / shadow, sky gradient, ring and swell slopes
            qlit: [pp[0] * 0.5 + 0.1, pp[1] * 0.5 + 0.095, pp[2] * 0.5 + 0.08], qins: [0.07, 0.1, 0.115], qsky: [0.55, 0.64, 0.74], qtr: [0.86, 0.95, 0.97],
            qfd: 22, qsd: 40, qcd: 40, qcb: 5, qcs: 0.3, qfr: 2.3, qfi: 0.2, qsi: 0.5, qsg: 4, qring: 0.14, qamb: 1.1, qhz: 9 }
        : { ink: [ink[0] + 8, ink[1] + 4, ink[2]], a: 1 * op, sh: [52, 38, 22], sa: 0.13 * sh,
            rs: [38, 48, 60], rsa: 0.15 * op, rh: [255, 255, 252], rha: 0.5 * op,
            cin: [178, 62, 38], cid: [132, 40, 24], och: [178, 130, 62], ocd: [140, 92, 34], sumi: [28, 26, 24], pa: 0.7 * op,
            wh: [255, 253, 247], wb: 0.24, wl: 0.55, wn: 1, pc: 0.68, ob: 1, sp: 0.12, fn: 1, gr: 0.16, eye: [24, 22, 20],
            qlit: [pp[0] * 0.9, pp[1] * 0.9, pp[2] * 0.9], qins: [0.34, 0.42, 0.45], qsky: [0.9, 0.93, 0.95], qtr: [0.86, 0.95, 0.97],
            qfd: 22, qsd: 40, qcd: 40, qcb: 5, qcs: 0.14, qfr: 1.3, qfi: 0.1, qsi: 0.35, qsg: 4, qring: 0.11, qamb: 1.1, qhz: 6 };
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
      if (water) water.resize(cw, ch, cv.width, cv.height);
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
      // the bristles split only at the very end of the stroke, so they don't scratch across the hi
      for (var b = 0; b < 5; b++) B0.push(line(ue - R(0.0, 0.08), ue + R(0.12, 0.3), (b / 4 - 0.5) * wk * 1.2 + R(-0.1, 0.1) * wk, R(-0.03, 0.03)));
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
    var rip = [], ripLast = { x: -1e5, y: -1e5, t: -1e5 }, RIP_LIFE = 3.6, RIP_MAX = 5, fronts = [], wakeN = 0;
    var ripLife = function () { return realLive ? WATER.life : RIP_LIFE; };
    var rpz = function () { return page && !O.fixed ? 1 : 0; }; // in parallax mode the rings ride on the page
    // the surface holds about one firm ring's worth of disturbance (Σ strength × envelope ≤ RIP_SUM); past
    // RIP_MAX rings the oldest is retired over 0.8 s, never cut. A click may exceed the budget; a move may not.
    var RIP_SUM = 1.05;
    var ripLoad = function () { var u = 0; for (var i = 0; i < rip.length; i++) { var r = rip[i]; if (!r.die) u += r.s * r.e * M.max(0, 1 - r.t / r.life); } return u; };
    var addRipple = function (x, y, s, firm) {
      if (!O.ripples || RM.matches) return false;
      if (!firm) { s = M.min(s, RIP_SUM - ripLoad()); if (s < 0.12) return false; }
      var live = 0;
      for (var i = rip.length - 1; i >= 0; i--) if (!rip[i].die && ++live >= RIP_MAX) rip[i].die = 1;
      rip.push({ x: x, y: y + sy * rpz(), t: 0, s: s, e: 1, q: rnd(0, TAU), life: ripLife() });
      wake();
      return true;
    };
    // ── the trail: press and drag lays one long line source; each point keeps its own age, so the wave
    // leaves the stroke on both sides as it is drawn and dies along it in the same order ──
    // mouse/pen: starts after 6 px with the button held. touch: after a ~250 ms hold, or when the first move is
    // clearly horizontal; a vertical swipe stays a scroll (we never preventDefault; if the browser takes the
    // gesture it sends pointercancel and the stroke simply ends there)
    var trl = [], press = null, TRL_LS = 3.4, TRL_N = 64, trA = { n: 0, a: new Float32Array(TRL_N * 4) };
    var trOn = function () { return O.ripples && O.trail !== false && !RM.matches; };
    var trCut = function () { if (trl.length && trl[trl.length - 1].s > 0) trl.push({ x: 0, y: 0, t: 0, s: 0 }); };
    var trMove = function (x, y, sp, now) {
      var P = press, py = y + sy * rpz();
      if (!P.act) {
        var dx = x - P.x0, dy = y - P.y0, d = hyp(dx, dy);
        if (P.touch) {
          if (d < 8) return;
          if (!P.held && M.abs(dy) > M.abs(dx) * 0.8) { press = null; return; } // moved before the hold, and not sideways: a scroll
        } else if (d < 6) return;
        P.act = true; trCut();
        if (P.ring && P.ring.t < 0.4) P.ring.s *= 0.55; // a press that becomes a stroke: a softer splash, the line carries it
        trl.push(P.first = { x: P.x0, y: P.y0 + sy * rpz(), t: 0, s: P.s });
        trl.push({ x: x, y: py, t: 0, s: P.s, h: 1 }); // the head follows the pointer until it is committed
        wake(); return;
      }
      if (!inside(x, y) || !free(x, py, 6)) { if (trl.length && trl[trl.length - 1].h) trl[trl.length - 1].h = 0; trCut(); P.gap = 1; return; }
      var st = clamp(0.36 + sp / 3200, 0.36, 0.62);
      P.s = P.s * 0.8 + st * 0.2;
      var H = trl[trl.length - 1];
      if (P.gap || !H || !H.h) { P.gap = 0; trl.push({ x: x, y: py, t: 0, s: P.s }); trl.push({ x: x, y: py, t: 0, s: P.s, h: 1 }); wake(); return; }
      var A = trl[trl.length - 2];
      H.x = x; H.y = py; H.t = 0; H.s = P.s;
      if (A && A.s > 0 && hyp(x - A.x, py - A.y) >= M.max(10, sp * 0.03)) { H.h = 0; trl.push({ x: x, y: py, t: 0, s: P.s, h: 1 }); }
      if (trl.length > TRL_N) { // too long: thin out the older half, never the separators
        var keep = [], half = trl.length >> 1;
        for (var i = 0; i < trl.length; i++) if (i >= half || trl[i].s <= 0 || i % 2 === 0) keep.push(trl[i]);
        trl = keep.length > TRL_N ? keep.slice(keep.length - TRL_N) : keep;
      }
      wake();
    };
    var trEnd = function () {
      if (press && press.act) { ripLast.x = press.lx; ripLast.y = press.ly; ripLast.t = performance.now(); } // hover rings resume after fresh travel
      if (press && trl.length && trl[trl.length - 1].h) trl[trl.length - 1].h = 0;
      press = null;
    };
    var kick = function (f, k) { f.mode = 1; f.tm = rnd(0.35, 0.6); f.thT = M.max(f.thT, k); };
    var inside = function (x, y) { return page || (x >= 0 && y >= 0 && x <= vw && y <= vh); };
    on(Wn, "pointermove", function (e) {
      if (!O.interactive) return;
      var o = origin(), cx = e.clientX - o[0], cy = e.clientY - o[1];
      var now = performance.now();
      if (press && e.pointerId === press.id) {
        if (!press.touch && !(e.buttons & 1)) trEnd();
        else { var pdt = M.max(8, now - press.t), psp = hyp(cx - press.lx, cy - press.ly) / pdt * 1000; press.sp = press.sp * 0.6 + psp * 0.4; press.lx = cx; press.ly = cy; press.t = now; trMove(cx, cy, press.sp, now); }
      }
      if (e.pointerType === "touch") { ptr.on = false; return; }
      var dt = M.max(8, now - ptr.t);
      var sp = hyp(cx - ptr.x, cy - ptr.y) / dt * 1000;
      ptr.sp = ptr.sp * 0.7 + sp * 0.3; ptr.x = cx; ptr.y = cy; ptr.t = now; ptr.idle = 0;
      ptr.on = inside(cx, cy) && free(cx, cy + sy, 6);
      if (ptr.on && O.ripples && !(press && press.act)) { // while a trail is drawn, the trail is the only source
        // slow moves leave delicate rings ~130 px apart; a quick pass becomes one calm wake: sparser sources,
        // each weaker than the last, which interfere into a single train behind the cursor
        var rd = hyp(cx - ripLast.x, cy - ripLast.y), fw = clamp((ptr.sp - 450) / 900, 0, 1);
        if (now - ripLast.t > 700 || ptr.sp < 300) wakeN = 0;
        if (rd > 130 + 190 * fw && now - ripLast.t > 380 - 180 * fw) {
          var s0 = fw > 0 ? 0.46 * M.pow(0.62, wakeN) : clamp(0.28 + ptr.sp / 3600, 0.28, 0.4);
          if (addRipple(cx, cy, s0)) { if (fw > 0) wakeN++; ripLast.x = cx; ripLast.y = cy; ripLast.t = now; }
        }
      }
      wake();
    }, { passive: true });
    var off = function () { ptr.on = false; trEnd(); };
    on(Wn, "pointerup", function (e) { if (press && e.pointerId === press.id) trEnd(); }, { passive: true });
    on(Wn, "pointercancel", function (e) {
      if (!press || e.pointerId !== press.id) return;
      // the browser took the gesture (a scroll) right away: drop the stub rather than leave a dash
      var i0 = press.first ? trl.indexOf(press.first) : -1, len = 0;
      for (var i = i0 + 1; i0 >= 0 && i < trl.length; i++) if (trl[i].s > 0 && trl[i - 1].s > 0) len += hyp(trl[i].x - trl[i - 1].x, trl[i].y - trl[i - 1].y);
      if (i0 >= 0 && len < 48) trl.length = i0;
      trEnd();
    }, { passive: true });
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
      addRipple(x, y, 1, true); // a single, slightly stronger ring (touch: ripples on tap only)
      if (trOn() && (e.pointerType !== "mouse" || e.button === 0)) press = { ring: rip[rip.length - 1], id: e.pointerId, touch: e.pointerType === "touch", x0: x, y0: y, t0: performance.now(), t: performance.now(), lx: x, ly: y, sp: 0, s: 0.4, act: false, gap: 0, held: false };
      if (press && press.touch) { var P0 = press; setTimeout(function () { if (press === P0 && !P0.act) P0.held = true; }, 250); } // still for 250 ms = a hold
      ripLast.x = x; ripLast.y = y; ripLast.t = performance.now();
      for (var i = 0; i < fish.length; i++) {
        var f = fish[i], dx = f.x - x, dy = f.y - sy * f.pz - y, d = hyp(dx, dy);
        if (d < 240 * (0.6 + f.d)) { f.a = wrapA(f.a + clamp(wrapA(M.atan2(dy, dx) - f.a), -1.4, 1.4) * 0.5); kick(f, 1); }
      }
    }, { passive: true });
    if (page) on(Wn, "scroll", function () { sy = Wn.scrollY || 0; wake(); }, { passive: true });

    // ── simulation ────────────────────────────────────────────────────────────
    var ripR = function (r) { if (realLive) return WATER.front(r.t); var t = r.t * (r.s >= 1 ? 1.12 : 1); return 78 * t / (1 + 0.2 * t); };
    var ripEnv = function (r) { var u = r.t / r.life; return M.min(1, r.t / 0.2) * M.pow(M.max(0, 1 - u), 1.7) * r.s * r.e; };
    var step = function (dt) {
      T += dt;
      var rm = RM.matches;
      ptr.idle += dt;
      for (var ri = rip.length - 1; ri >= 0; ri--) {
        var rq = rip[ri]; rq.t += dt; if (rq.die) rq.e -= dt / 0.8;
        if (rq.t > rq.life || rq.e <= 0 || rm) rip.splice(ri, 1);
      }
      if (rm || !trOn()) { trl.length = 0; press = null; }
      for (var ti = 0; ti < trl.length; ti++) trl[ti].t += dt; // a held-still head ages too: no standing bump
      while (trl.length && (trl[0].s <= 0 || trl[0].t > TRL_LS)) trl.shift();
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
        // koi (k 3) answer a toggle in ~0.6 s out, 1 s in; the shoal changes slowly
        if (f.dying) { f.fade -= dt * (f.k === 3 ? 1.6 : 0.6); if (f.fade <= 0) { f.dead = 1; gone++; } }
        else f.fade = M.min(1, f.fade + dt * (f.k === 3 ? 1 : 0.5));
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

    var stats = { n: 0, ms: 0, max: 0, drawn: 0, ring: new Float32Array(600), water: "flat", gw: { n: 0, comp: 0, sim: 0, cau: 0, prof: 0, up: 0 }, get dpr() { return dpr; }, get trail() { return trl.length; } };
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
        // (on the dark pond only the broad band: the narrow one stacked on it read as a pale stripe down the spine)
        g.fillStyle = rgba(whRGB, fa * pal.wl * 0.36);
        g.fill(band(F, 0.8)); if (!koiLite && pal.wn) g.fill(band(F, 0.42));
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
        if (!koiLite) { g.lineCap = "butt"; g.strokeStyle = rgba(sumiRGB, sa * pal.pc * 0.36); g.lineWidth = F.L * 0.006 + 0.35; g.stroke(DP); g.lineCap = "round"; }
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
      for (var ri = 0; ri < (realLive ? 0 : rip.length); ri++) {
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
      // the trail, flat: the stroke's two wavefronts leave it on both sides (a crest and a fainter trough line)
      if (!realLive && trl.length > 1) {
        var tsy2 = sy * rpz(), tnx = [], tny = [];
        for (var a0 = 0; a0 < trl.length; a0++) {
          var pa = trl[a0 - 1], pb = trl[a0 + 1], pc = trl[a0];
          if (!pa || pa.s <= 0) pa = pc; if (!pb || pb.s <= 0) pb = pc;
          var nx = -(pb.y - pa.y), ny = pb.x - pa.x, nl = hyp(nx, ny) || 1; tnx[a0] = nx / nl; tny[a0] = ny / nl;
        }
        g.lineCap = "round";
        for (var wv = 0; wv < 2; wv++) for (var sd = -1; sd <= 1; sd += 2) for (var a1 = 1; a1 < trl.length; a1++) {
          var A1 = trl[a1 - 1], B1 = trl[a1];
          if (A1.s <= 0 || B1.s <= 0) continue;
          var tm = (A1.t + B1.t) / 2, en2 = M.min(1, tm / 0.2) * M.pow(M.max(0, 1 - tm / TRL_LS), 1.7) * (A1.s + B1.s) / 2;
          var rA = 78 * A1.t / (1 + 0.2 * A1.t) - wv * 14, rB = 78 * B1.t / (1 + 0.2 * B1.t) - wv * 14;
          if (rA < 1 && rB < 1) continue;
          var r2 = M.max(rA, rB), ak2 = en2 * [1, 0.5][wv] / (1 + r2 / 110);
          if (ak2 < 0.004) continue;
          var lw2 = 1 + r2 * 0.006;
          rA = M.max(0, rA); rB = M.max(0, rB);
          // like a ring's front: a hairline of shade on the stroke side, one of light outside it
          for (var hl = wv ? 1 : 0; hl < 2; hl++) {
            var oA = rA + (hl ? -lw2 * 0.6 : lw2 * 0.6) * (wv ? 0 : 1), oB = rB + (hl ? -lw2 * 0.6 : lw2 * 0.6) * (wv ? 0 : 1);
            g.lineWidth = hl ? lw2 * 0.7 : lw2;
            g.strokeStyle = rgba(hl ? rsRGB : rhRGB, ak2 * (hl ? pal.rsa : pal.rha));
            g.beginPath();
            g.moveTo(A1.x + tnx[a1 - 1] * M.max(0, oA) * sd, A1.y - tsy2 + tny[a1 - 1] * M.max(0, oA) * sd);
            g.lineTo(B1.x + tnx[a1] * M.max(0, oB) * sd, B1.y - tsy2 + tny[a1] * M.max(0, oB) * sd);
            g.stroke();
          }
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

    // ── real water: lifecycle and per-frame inputs ─────────────────────────────
    var syncWater = function () {
      var want = realWant() && booted;
      if (want && !water && O.adaptive && remembered()) { waterFail = true; want = false; } // this tab already fell back
      if (want && !water) {
        water = WATER.create(D);
        if (!water) { waterFail = true; want = false; }
        else {
          var wc = water.canvas;
          wc.className = cv.className + " ink-fish--water" + (cv.classList.contains("on") ? " on" : "");
          if (!O.fadeIn) wc.style.transition = "none";
          wc.setAttribute("aria-hidden", "true"); wc.style.pointerEvents = "none";
          host.insertBefore(wc, cv.nextSibling);
          water.onlost = function () { waterFail = true; syncWater(); };
          water.resize(cw, ch, cv.width, cv.height);
        }
      }
      var live = !!(want && water && !water.lost);
      if (live !== realLive) for (var i = 0; i < rip.length; i++) rip[i].life = live ? WATER.life : RIP_LIFE;
      if (live && !realLive) judgeReset(performance.now(), 1000); // shaders compile, textures settle
      realLive = live;
      cv.style.display = shc.style.display = live ? "none" : "";
      if (water) water.canvas.style.display = live ? "" : "none";
      stats.water = live ? "real" : waterFail && (O.water === "real" || O.ripples === "real") ? "fallback" : "flat";
    };
    var wrects = [], wrings = [], wlook = {};
    var paint = function () {
      render();
      if (!realLive) return;
      // mask: none under the obstacles, thinned under text (screen coordinates)
      var n = 0;
      var put = function (l, t, r, b, keep, f) {
        if (b < -f || t > vh + f || n >= 32) return;
        var o = wrects[n] || (wrects[n] = {}); o.l = l; o.t = t; o.r = r; o.b = b; o.keep = keep; o.f = f; n++;
      };
      for (var i = 0; i < obs.length; i++) { var R = obs[i]; put(R.l - 2, R.t - sy - 2, R.r + 2, R.b - sy + 2, 0, 3); }
      for (var j = 0; j < texts.length; j++) { var X = texts[j]; put(X.r.l, X.r.t - sy, X.r.r, X.r.b - sy, M.sqrt(X.keep), X.f); }
      wrects.n = n;
      wrings.length = 0;
      for (var k = 0; k < rip.length; k++) {
        var rp = rip[k], o2 = wrings[k] || {}; o2.x = rp.x; o2.y = rp.y - sy * rpz(); o2.t = rp.t; o2.s = rp.s * M.max(0, rp.e); o2.life = rp.life; wrings.push(o2);
      }
      var L = wlook;
      L.lit = pal.qlit; L.ins = pal.qins; L.sky = pal.qsky; L.tr = pal.qtr; L.fd = pal.qfd; L.sd = pal.qsd; L.cd = pal.qcd; L.cb = pal.qcb; L.cs = pal.qcs;
      L.fr = pal.qfr; L.fi = pal.qfi; L.si = pal.qsi; L.sg = pal.qsg; L.ring = pal.qring; L.amb = pal.qamb; L.hz = pal.qhz;
      var tn = 0, tsy = sy * rpz();
      for (var q = 0; q < trl.length && tn < TRL_N; q++, tn++) {
        var tp = trl[q], ta = trA.a;
        ta[tn * 4] = tp.x; ta[tn * 4 + 1] = tp.y - tsy; ta[tn * 4 + 2] = tp.t; ta[tn * 4 + 3] = tp.s;
      }
      trA.n = tn;
      water.draw(cv, shc, SH, wrings, wrects, T, sy * rpz(), L, trA);
      stats.wq = water.quality;
      // GPU work, summed (pixels shaded / uploaded, caustic vertices), for QA: divide by gw.n
      var gw = stats.gw, wk = water.work; gw.n++; gw.comp += wk.comp; gw.sim += wk.sim; gw.cau += wk.cau; gw.prof += wk.prof; gw.up += wk.up;
    };

    // ── real water on a slow GPU: measure, try the cheaper quality, and only then fall back ──
    // Judged on the median frame interval of 60-frame (or 2 s) windows, skipping a 1 s warm-up, resumes (> 1 s)
    // and frames that followed a long main-thread task (the page's jank, not the GPU's). When slow, quality 1
    // (1 px per CSS px) is tried for a window: if that is clearly faster the GPU was the limit, so keep it,
    // or fall back to the flat water if it is still slow. If it is no faster (a 30 Hz power-saving cap, a busy
    // page), real water stays and the test backs off (10 s, 20 s, … 2 min). Below ~25 fps with no gain from
    // quality 1 (or at once, below ~12 fps), the flat water is tried once, for one window, the same way. A fallback is remembered for the tab
    // session (30 min), so the next page of the site starts flat instead of janking again.
    var AJ = { st: 0, buf: [], warm: 0, m0: 0, next: 0, back: 10000, slow: 0, sus: 0 }, longAt = -1e9, SKEY = "ink-fish:water-fallback", lobs = null;
    try { if (typeof PerformanceObserver === "function") (lobs = new PerformanceObserver(function (l) { var e = l.getEntries(); for (var i = 0; i < e.length; i++) longAt = M.max(longAt, e[i].startTime + e[i].duration); })).observe({ type: "longtask" }); } catch (e) {}
    var remembered = function () { try { var v = +Wn.sessionStorage.getItem(SKEY); return v > 0 && Date.now() - v < 18e5; } catch (e) { return false; } };
    var judgeReset = function (now, ms) { AJ.buf.length = 0; AJ.warm = now + ms; };
    // a gap over a second is a resume (sleep, a backgrounded tab): start again after a warm-up. A frame that
    // follows someone else's long task (a script, a GC, the host's layout) is a hitch, not the water: skipped,
    // unless nearly every frame is one, which is what a device that can't draw the water looks like (there the
    // frame itself is the long task). Gaps are capped so a few-fps device still lands in the median
    var judgeSkip = function (now, gap) {
      if (gap > 1000) { judgeReset(now, 1000); AJ.sus = 0; return true; }
      if (now < AJ.warm) return true;
      if (longAt > last - 20) { if (++AJ.sus < 20) return true; } else AJ.sus = 0;
      AJ.buf.push(M.min(gap, 250));
      return false;
    };
    // the median of a window: 60 frames or two seconds; under ~12 fps, eight frames (and a second) are enough
    var judgeMed = function () {
      var B = AJ.buf, n = B.length, t = 0;
      for (var i = 0; i < n; i++) t += B[i];
      if (n < 8 || (n < 60 && t < 2000 && !(t > 800 && n >= 8))) return 0;
      var m = B.slice().sort(function (x, y) { return x - y; })[n >> 1];
      return n >= 60 || t >= 2000 || m > 80 ? m : 0;
    };
    var flatTrial = function (now) { AJ.st = 2; AJ.tried = 1; waterFail = true; syncWater(); judgeReset(now, 500); AJ.flat = 1; };
    var judgeWater = function (now, gap) {
      if (judgeSkip(now, gap)) return;
      var m = judgeMed(); if (!m) return;
      AJ.buf.length = 0;
      var slow = m > 21;
      if (AJ.st === 0) {
        if (!slow) { AJ.slow = 0; return; }
        if (now < AJ.next) return;
        if (water.quality === 0 && m > 80 && !AJ.tried) { AJ.m0 = m; flatTrial(now); } // a few fps: straight to the flat trial
        else if (water.quality === 0) { AJ.m0 = m; AJ.st = 1; water.setQuality(1); judgeReset(now, 500); }
        else if (++AJ.slow >= 3) fallBack(); // quality 1 was kept earlier and is slow again, three windows running
      } else if (AJ.st === 1) {
        if (m < AJ.m0 * 0.85) { if (slow) fallBack(); else AJ.st = 0; }
        else if (AJ.m0 > 40 && !AJ.tried) flatTrial(now);
        else { water.setQuality(0); AJ.st = 0; AJ.next = now + AJ.back; AJ.back = M.min(AJ.back * 2, 12e4); judgeReset(now, 500); }
      }
    };
    // the one-window flat trial (below ~25 fps): judged by the same median, now with real water off
    var judgeFlat = function (now, gap) {
      if (judgeSkip(now, gap)) return;
      var m = judgeMed(); if (!m) return;
      AJ.buf.length = 0; AJ.flat = 0;
      if (m < AJ.m0 * 0.85) fallBack();
      else { waterFail = false; water.setQuality(0); AJ.st = 0; AJ.next = now + AJ.back; AJ.back = M.min(AJ.back * 2, 12e4); syncWater(); judgeReset(now, 500); }
    };
    var fallBack = function () {
      AJ.st = 3; waterFail = true; syncWater();
      try { Wn.sessionStorage.setItem(SKEY, String(Date.now())); } catch (e) {}
    };

    // ── loop ──────────────────────────────────────────────────────────────────
    var STEP = 1 / 60, raf = 0, last = 0, acc = 0, running = false, shown = false, rmLast = 0;
    var waterOnScreen = function () {
      if (!onScreen) return false;
      if (!page || fixedOn() || sy < heroB || rip.length || trl.length) return true;
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
      // (with real water on, slow frames count too, capped, so a GPU that only manages a few fps still trips it)
      var gap = now - last;
      if (O.adaptive && !RM.matches && realLive) judgeWater(now, gap);
      else if (AJ.flat && O.adaptive && !RM.matches) judgeFlat(now, gap);
      else if (O.adaptive && !RM.matches && gap < 100 && dprCap > 1) {
        fema = fema * 0.96 + gap * 0.04;
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
      if (realWant() !== realLive) syncWater();
      tickPal(now);
      paint();
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
    var lastDims = "", lt = 0, lraf = 0;
    var layout = function () {
      if (dead || !booted) return;
      var old = lastDims;
      measure();
      var dims = vw + "x" + PH + "@" + mobile;
      lastDims = dims;
      if (!fish.length || dims.split("x")[0] !== old.split("x")[0] || mobile !== (old.indexOf("true") > 0)) populate();
      if (shown) { tickPal(performance.now()); paint(); wake(); }
    };
    var relayout = function () { cancelAnimationFrame(lraf); lraf = requestAnimationFrame(layout); };
    var RO = Wn.ResizeObserver ? new ResizeObserver(function () { clearTimeout(lt); lt = setTimeout(relayout, 120); }) : null;
    if (RO) RO.observe(page ? (q(O.habitat) || D.body) : host);
    on(Wn, "resize", relayout);
    // the page's own background may cross-fade with the theme: read it again once that has settled
    var palT = 0, MO = new MutationObserver(function () { syncPal(); clearTimeout(palT); palT = setTimeout(syncPal, 900); });
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
        syncWater();
        paint();
        [shc, cv].concat(water ? [water.canvas] : []).forEach(function (c) { if (!O.fadeIn) c.style.transition = "none"; c.classList.add("on"); });
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
      /** "real" while the WebGL water is drawing, "flat" (Canvas 2D), or "fallback" (asked for, not available). */
      get water() { return stats.water; },
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
        if (!trOn()) { trl.length = 0; press = null; }
        if (booted) {
          if (shown) syncWater();
          measure();
          if (repop) { populate(); for (var k = 0; k < fish.length; k++) fish[k].fade = 1; }
          else if (recon) reconcile();
          if (shown) { tickPal(performance.now()); paint(); wake(); }
        }
        return api;
      },
      destroy: function () {
        if (dead) return;
        dead = true; running = false;
        cancelAnimationFrame(raf); cancelAnimationFrame(lraf); clearTimeout(lt); clearTimeout(palT);
        if (water) { water.destroy(); water = null; }
        if (lobs) lobs.disconnect();
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

  return { mount: mount, init: autoInit, defaults: DEFAULTS, instances: instances, version: "1.3.1" };
});
