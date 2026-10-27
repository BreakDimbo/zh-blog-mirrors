// node audio/music.mjs -> out/audio.wav  (pentatonic melody + ambience + SFX locked to the same CUES)
import fs from "node:fs";
const CUES = new Function(fs.readFileSync(new URL("../scene/cues.js", import.meta.url), "utf8") + "; return CUES;")();
const SR = 48000, T = CUES.duration, N = Math.round(SR * T), L = new Float32Array(N), Rr = new Float32Array(N);
let s = CUES.seed; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
const add = (i, v, pan = 0) => { if (i >= 0 && i < N) { L[i] += v * (1 - pan) ; Rr[i] += v * (1 + pan); } };
// 1) melody: C-major pentatonic, plucked (sine + soft 2nd harmonic, exp decay)
const scale = [0, 2, 4, 7, 9].map(x => 261.63 * 2 ** (x / 12)); const beat = 60 / 96 / 2;
for (let t = 0.2, k = 0; t < T - 0.3; t += beat, k++) { if (rnd() < .25) continue;
  const f = scale[Math.floor(rnd() * 5)] * (rnd() < .3 ? 2 : 1), dur = .9, i0 = Math.round(t * SR);
  for (let j = 0; j < dur * SR; j++) { const x = j / SR, e = Math.exp(-x * 5) * Math.min(1, x * 200); add(i0 + j, .16 * e * (Math.sin(6.283 * f * x) + .25 * Math.sin(12.566 * f * x)), (k % 2 ? .3 : -.3)); } }
// 2) ambience: water = low-passed noise with slow swell
let lp = 0; for (let i = 0; i < N; i++) { lp += .02 * ((rnd() * 2 - 1) - lp); add(i, lp * .5 * (0.7 + .3 * Math.sin(i / SR * 1.3))); }
// 3) SFX on the cue sheet (same timestamps the picture uses)
const at = n => CUES.events.find(e => e.type === n).t;
const chirp = (t0, pan) => { for (let c = 0; c < 3; c++) { const i0 = Math.round((t0 + c * .12) * SR); for (let j = 0; j < .07 * SR; j++) { const x = j / SR; add(i0 + j, .12 * Math.sin(6.283 * (3200 + 9000 * x) * x) * Math.sin(Math.PI * x / .07), pan); } } };
chirp(at("bird_in"), -.6); chirp(at("bird_in") + .9, .4);
;{ const i0 = Math.round(at("frog_jump") * SR); for (let j = 0; j < .16 * SR; j++) { const x = j / SR; add(i0 + j, .18 * Math.sign(Math.sin(6.283 * 180 * x)) * Math.exp(-x * 18) * (x % .05 < .03 ? 1 : .2), .2); } }
;{ const i0 = Math.round(at("splash") * SR); let ph = 0; for (let j = 0; j < .35 * SR; j++) { const x = j / SR, f = 650 * Math.exp(-x * 9) + 120; ph += 6.283 * f / SR; add(i0 + j, .35 * Math.sin(ph) * Math.exp(-x * 10) + .05 * (rnd() * 2 - 1) * Math.exp(-x * 25), .25); } }
;{ const i0 = Math.round(at("petal_land") * SR); for (let j = 0; j < .25 * SR; j++) { const x = j / SR; add(i0 + j, .1 * Math.sin(6.283 * 1568 * x) * Math.exp(-x * 14)); } }
// fade in/out with the particle edge, normalise to -1 dBFS peak, write 16-bit WAV
let pk = 0; for (let i = 0; i < N; i++) { const t = i / SR, f = Math.min(1, t / CUES.intro, (T - t) / CUES.outro); L[i] *= f; Rr[i] *= f; pk = Math.max(pk, Math.abs(L[i]), Math.abs(Rr[i])); }
const gain = 0.89 / pk, buf = Buffer.alloc(44 + N * 4);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(L[i] * gain * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(Rr[i] * gain * 32767), 46 + i * 4); }
fs.mkdirSync("out", { recursive: true }); fs.writeFileSync("out/audio.wav", buf); console.log("out/audio.wav", T, "s");
