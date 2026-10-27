// cue sheet: single source of truth for picture AND sound (seconds)
var CUES = {
  fps: 30, duration: 4.0, seed: 20261026,
  title: ["曲水荷塘 · 样片", "Lotus Pond · sample"],
  season: ["夏 · 一只青蛙跳进荷塘", "Summer · a frog leaps in"],
  geo: { lat: 30.2563, lon: 120.1362 },
  intro: 0.8, outro: 0.8,            // grow-in / shrink-out (particle edge)
  events: [
    { t: 0.9, type: "bird_in" },
    { t: 1.9, type: "frog_jump" },
    { t: 2.25, type: "splash" },
    { t: 2.9, type: "petal_land" }
  ]
};
if (typeof module !== "undefined") module.exports = CUES;
