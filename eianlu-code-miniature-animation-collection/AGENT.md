# AGENT.md — 复刻 Eian「孟菲斯微缩世界」代码动画（可执行任务书）

> 来源：Eian（[@EianLu](https://x.com/EianLu)）在 X 公开的提示词与回复（2026-10-26 / 10-27 SGT）。聚合页：<https://breakdimbo.github.io/zh-blog-mirrors/eianlu-code-miniature-animation-collection/>
> 原帖：<https://x.com/EianLu/status/2114695987424063730>（提示词） · <https://x.com/EianLu/status/2114650892934975667>（稻田 / 玉林路）
> 本文件由 zh-blog-mirrors 整理，**非作者本人发布**。标注约定：**【作者】** = 作者原文或作者在回复中明确说过；**【推断】** = 本站为了让 agent 能跑通而补的工程细节，作者没有公开。
> 移除请求：<https://github.com/BreakDimbo/zh-blog-mirrors/issues/new?title=Removal%20request>

---

## 0. 给 agent 的一句话任务

用代码（不用任何视频/图像生成模型）做一支 20 秒、1080×1080、60fps 的「孟菲斯微缩世界」小动画：把 **{场景}** 做成桌上会动的微缩模型，一镜到底，带代码合成的配乐与音效。先交 4 张样帧拼图等确认，再渲全片。

## 1. 作者原提示词（照录，原样可用）【作者】

```text
用代码做一支 20 秒的"孟菲斯微缩世界"小动画，1080×1080，60fps。
画面：把一个场景做成会动的微缩模型。暖白底，内容放在居中的圆角画框里，四周多留白；画框边缘是颗粒状消散的边（像喷漆），开场从中心颗粒状长出来，结尾收回去。
配色：孟菲斯风格。饱和原色 + 粉彩（黄 #FFC93C、粉 #FF8DB5、钴蓝 #2E5BE6、珊瑚红 #FF5A5F、薄荷绿 #A9E6C6、天蓝 #8DD3F6、淡紫 #D3BEFF），所有物体有深靛色 #25214A 描边和不模糊的硬投影，大色块上铺圆点、条纹、折线这类小图案。
镜头：一镜到底，缓慢匀速移动，可以带一点旋转和推近。
节奏：靠画面里的小动静撑起来，比如鸟飞过、云影掠过、鱼游、人走、车开、叶子飘落，至少安排一两个有"剧情"的瞬间。
文字：画框下方三行居中小字：标题（中英）/ 季节 · 一句描述（中英）/ 随镜头变化的经纬度。
做法：用 Canvas 写一个确定性的 frame(i) 函数，输入帧号输出一张图，场景按坐标和固定随机种子生成；用无头 Chrome 逐帧导出，ffmpeg 合成。配乐也用代码合成：五声音阶的轻旋律 + 环境声，画面里的事件要和音效卡上。
先给我看 4 张样帧拼图，我确认后再渲全片。
场景：【在这里写你的场景】
```

作者补充（回复区）【作者】：
- 用的是 **Opus 5.5**；是 **直接提示词**，不是 skill。
- **镜头可以调，不一定非要俯视**（成都平原是俯视，玉林路是等轴测斜视，曲院风荷是水上水下剖面）。
- 配乐用代码生成“其实是可以的，不过没有自己找音乐好”。
- 认可：4 张样帧里留一张开场、一张收尾，用来验颗粒进出场和字幕边距。
- 前一帖说法：Canvas 写 `frame(i)` 逐帧画、ffmpeg 合成、“配音也用代码生成”；“也可以做网页动画，可以交互”。

## 2. 风格框架变量（把提示词拆成可改参数）

| 变量 | 作者值【作者】 | 说明 / 可改范围【推断】 |
|---|---|---|
| `DURATION` | 20 s | 改时长只改它；帧内时间一律 `t = i / FPS` |
| `SIZE` | 1080×1080 | 竖版可用 1080×1350，画框与字幕同比缩放 |
| `FPS` | 60 | 样帧/预览可用 30，终片 60 |
| `BG` | 暖白 | 本站样片取 `#FFF8EE`（作者未给色值） |
| `FRAME` | 居中圆角画框，四周多留白 | 样片：760×760、圆角 48、上边距 120（1080 空间） |
| `EDGE` | 颗粒状消散（喷漆），开场从中心长出、结尾收回 | 固定种子的粒子带；进出各约 0.8–1.2 s |
| `PALETTE` | `#FFC93C #FF8DB5 #2E5BE6 #FF5A5F #A9E6C6 #8DD3F6 #D3BEFF` | 换风格就换这 7 个 + 描边色 |
| `INK` | `#25214A` 描边 + 不模糊硬投影 | 样片：线宽 3、投影偏移 (6,6)、无 blur |
| `PATTERN` | 大色块上铺圆点、条纹、折线 | 每种大色块固定一种图案 |
| `CAMERA` | 一镜到底、缓慢匀速、可带旋转和推近 | 样片：推 1.00→1.10、转 −1.5°→+1.5°、平移 ≤ 40 px |
| `VIEW` | 不一定俯视（作者回复） | 俯视 / 等轴测 / 剖面（水上水下）三选一 |
| `BEATS` | 鸟、云影、鱼、人、车、落叶 + 至少 1–2 个“剧情瞬间” | 每 2–3 s 一个新看点【推断】 |
| `CAPTION` | 3 行居中：标题（中英）/ 季节 · 描述（中英）/ 随镜头变化的经纬度 | 经纬度按相机位置插值，保留 4 位小数（作者成片即 4 位） |
| `MUSIC` | 代码合成：五声音阶轻旋律 + 环境声；事件卡音效 | 见 §6 |
| `GATE` | 先看 4 张样帧拼图，确认后渲全片 | 4 张须含开场、收尾 |
| `SCENE` | 【在这里写你的场景】 | 见 §9 |


### 2.1 从作者成片封面帧可直接看到的细节【成片观察，非作者文字】

- 画框边缘是**很宽的细颗粒噪点带**（喷漆雾化），视觉上接近方形、圆角很小，并不是清晰的圆角描边；颗粒颜色取自画框内的邻近色。
- 字幕上方有一行三个小孟菲斯符号（黄圆点 · 粉三角 · 蓝波浪）作为分隔。
- 字幕：第 1 行深靛色中文 + 英文标题；第 2 行灰色小字“季节 · 中文描述 + 英文描述”；第 3 行更浅的等宽小字经纬度（4 位小数）。
- 大色块图案确有：田块上的圆点网点、斜条纹；河面上的折线波纹；屋顶上的圆点。
- 物体描边细而均匀，投影是同色系深色的硬边偏移，没有模糊。
- 画面内水印 “@Eian” 很淡，居中偏上。

## 3. 项目文件结构【推断】

```
project/
  package.json            # "type":"module", 依赖 puppeteer-core（用系统 Chrome）
  scene/
    cues.js               # 节拍表（唯一时间来源）：fps / duration / seed / 字幕 / events[]
    index.html            # 只放 <canvas>，按顺序加载 cues.js、frame.js
    frame.js              # 场景数据（由 seed 一次性生成）+ window.frame(i)
  render/export.mjs       # 无头 Chrome 逐帧导出 PNG；--only= 只导出指定帧（样帧）
  audio/music.mjs         # 读同一份 cues.js，合成 WAV（旋律 + 环境声 + 事件音效）
  out/                    # contact.png / frames/*.png / audio.wav / final.mp4（可删）
```

## 4. 确定性 `frame(i)` 渲染契约

【作者】输入帧号输出一张图；场景按坐标和固定随机种子生成。
【推断】为了保证“同一帧号永远同一张图”，再加这些硬规则：

1. `t = i / FPS`，所有运动都是 `t` 的纯函数（解析式：`sin`、缓动、参数路径）。**禁止** `Date.now()`、`performance.now()`、`requestAnimationFrame` 计时、`Math.random()`、CSS 动画/过渡。
2. 随机只用带种子的 PRNG（如 mulberry32），并且**只在构建场景时调用一次**，生成坐标/尺寸/颜色表；`frame(i)` 内不再消耗随机数（否则跳帧导出会错位）。
3. `frame(i)` 不依赖上一帧状态：每帧先 `setTransform` 复位、铺满背景，再从头画。
4. 事件（鸟入画、青蛙跳、落水）的时间点全部来自 `cues.js` 的 `events[]`；画面和音频读同一份数据，不手抄时间。
5. 字体：导出前 `await document.fonts.ready`；只用本机已装或随项目打包的字体，避免回退成豆腐块。
6. 画布像素尺寸 = 输出尺寸（`deviceScaleFactor: 1`），布局写在 1080 空间里再乘缩放系数。
7. 验收：同一帧导出两次 md5 相同；`--only=` 单独导出的帧与整片导出的同号帧 md5 相同。

绘制顺序（样片做法，可照搬）【推断】：暖白底 → 以“圆角矩形 ∩ 中心增长圆”为裁剪区 → 相机变换（平移/旋转/推近）→ 世界层（水/地大色块 + 图案 → 静物 → 动物/车/人 → 事件特效 → 云影）→ 还原变换 → 画框颗粒边（进出场时贴着增长圆，稳定后贴着圆角矩形）→ 三行字幕（透明度跟随进出场）。
“硬投影”的画法：同一路径先在 `(+6,+6)` 用 `#25214A` 填充，再原位填色、描边，**不要**用 `shadowBlur`。

## 5. 无头 Chrome 导出脚本（已在本站验证可运行）【推断】

```js
// render/export.mjs — node render/export.mjs [--w=1080] [--only=0,30,60,119]
import puppeteer from "puppeteer-core"; import fs from "node:fs"; import path from "node:path";
const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || "").split("=")[1];
const W = +(arg("w") || 1080), only = arg("only"), outDir = path.resolve(only ? "out/contact" : "out/frames");
fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none", "--force-color-profile=srgb", "--hide-scrollbars"] });
const page = await browser.newPage(); await page.setViewport({ width: W, height: W, deviceScaleFactor: 1 });
await page.goto("file://" + path.resolve("scene/index.html") + `?w=${W}`); await page.evaluate(() => document.fonts.ready);
const N = await page.evaluate(() => window.FRAMES);
const list = only ? only.split(",").map(Number) : [...Array(N).keys()];
for (const i of list) {
  const b64 = await page.evaluate(i => { window.frame(i); return document.getElementById("c").toDataURL("image/png").split(",")[1]; }, i);
  fs.writeFileSync(path.join(outDir, String(i).padStart(5, "0") + ".png"), Buffer.from(b64, "base64"));
}
await browser.close();
```

要点：用 `canvas.toDataURL` 取像素而不是截屏（不受页面滚动/缩放影响）；20 s×60 fps = 1200 帧，1080² PNG 约 0.3 MB/帧，预留 ~400 MB 临时盘，合成后删除 `out/frames/`。

## 6. 代码配乐（五声音阶 + 环境声 + 事件卡点）

【作者】五声音阶的轻旋律 + 环境声，画面事件和音效卡上；作者也说代码配乐“没有自己找音乐好”。
【推断】一种零依赖做法（Node 直接写 48 kHz 16-bit 立体声 WAV）：

- **旋律**：C 大调五声（C D E G A，可升八度），约 96 BPM 八分音符网格，种子 PRNG 决定音高与 25% 休止；每个音 = 正弦 + 0.25×二次谐波，起音 5 ms、指数衰减（拨弦/八音盒感），左右交替轻微声像。
- **环境声**：白噪声一阶低通（水声）+ 慢速起伏；可叠鸟叫、风、远处人声。
- **事件音效**（时间来自 `cues.js`）：鸟 = 3 次快速上滑短鸣；青蛙 = 短促方波“咕”；落水 = 650→120 Hz 下滑正弦 + 短噪声；落叶/花瓣 = 高音短“叮”。
- **收尾**：音量包络跟画框颗粒进出场一致（同样的 intro/outro 秒数）；峰值归一到 −1 dBFS。
- 想更好听：保留代码生成的事件音效轨，把旋律换成自己挑的授权音乐（作者原话的含义）。

完整实现见 §11 附录 `audio/music.mjs`。

## 7. ffmpeg 命令

```bash
# 4 张样帧拼图（含开场与收尾）——审批关卡
node render/export.mjs --only=0,400,800,1199
ffmpeg -y -pattern_type glob -i 'out/contact/*.png' -vf "scale=540:540,tile=2x2" out/contact.png

# 全片：PNG 序列 + WAV -> H.264/AAC（-framerate 必须等于 CUES.fps）
node render/export.mjs && node audio/music.mjs
ffmpeg -y -framerate 60 -i out/frames/%05d.png -i out/audio.wav \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -movflags +faststart out/final.mp4

# 验收
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,nb_frames,duration -of compact out/final.mp4
ffmpeg -i out/final.mp4 -vf blackdetect=d=0.2:pix_th=0.05 -an -f null - 2>&1 | grep black_start || echo "no black frames"
ffmpeg -i out/final.mp4 -af ebur128=peak=true -f null - 2>&1 | tail -12

# 封面帧（取中段一帧）
ffmpeg -y -i out/frames/00600.png -vf scale=720:720 -c:v libwebp -quality 80 out/poster.webp
```

（@zealdin 在评论区的建议、作者未反驳：帧里时间用 `i/fps` 算，合成时再指定 `-framerate`，以后改时长帧率不用重写动画。）

## 8. 执行流程（给 agent）

1. 读 §9 场景槽，写出：视角（俯视/等轴测/剖面）、6–10 个“小动静”、1–2 个剧情瞬间（含起止秒）、标题/季节句（中英）、真实经纬度。把这些写进 `cues.js`。
2. 写 `frame.js`：先静态构图（t=10 s 那一帧要能当海报），再加运动。
3. 导出 4 张样帧（**第 0 帧附近的开场、两个剧情瞬间、收尾**）拼 2×2，**停下来等人确认**。【作者】
4. 确认后：全片 PNG → 音频 → ffmpeg 合成 → §10 自检 → 交付 `final.mp4`、`poster.webp`、`contact.png`、`cues.js`。
5. 清理 `out/frames/`。

## 9. 场景槽与作者已用过的场景

```text
场景：【在这里写你的场景】
```

作者成片里能读到的字幕（来自视频封面帧，可作为写法参考）【作者成片】：
- 《成都平原 Chengdu Plain》 · 春 · 油菜花开，秧田放水 / Spring · rapeseed in bloom over flooded paddies · 30.9447° N 103.6181° E（俯视：田块、河流、红色小桥、林盘、白鹭、小黄车）
- 《玉林路 Yulin Road, Chengdu》 · 秋 · 银杏、小酒馆和慢悠悠的街 / Autumn · ginkgo, little bars and a slow street · 30.6285° N 104.0601° E（等轴测街区：银杏、遮阳棚、斑马线、行人）
- 《曲院风荷 West Lake Lotus Pond》 · 夏 · 水面之上，水面之下 / Summer · above and below the waterline · 30.2563° N 120.1362° E（水上水下剖面：荷花荷叶、蜻蜓、乌龟、锦鲤、鱼群、青蛙、远处宝塔）

社区跟做者写的场景槽示例（@huqinyiyayuguan，北京央视大楼，节选）：“镜头沿道路缓慢前行，以行车视角掠过街景……一辆明黄色公交车从镜头旁驶过，恰好露出后方完整的央视大楼；随后，一片落叶被车流卷起，短暂跟随镜头飘动，再落向路边。”——好的场景槽 = 地点 + 季节/时刻 + 镜头路径 + 一个因果链式的剧情瞬间。

## 10. QA 清单

- [ ] 1080×1080、60 fps、20.00 s、帧数 1200；H.264 yuv420p + AAC；无黑帧。
- [ ] 第 0 帧不是纯空白太久：颗粒从中心长出 ≤ 1.2 s；最后 ≤ 1.2 s 收回。
- [ ] 7 个色值 + `#25214A` 之外没有“野色”（阴影/云影用 `#25214A` 低透明度）。
- [ ] 所有物体都有描边 + 硬投影，投影方向统一，没有 `shadowBlur`。
- [ ] 大色块上有图案（圆点/条纹/折线），图案不随帧闪烁。
- [ ] 镜头一镜到底、匀速，无跳切；旋转 ≤ 3°。
- [ ] 每 2–3 s 至少一个新看点；有 1–2 个剧情瞬间，且对应音效与画面同帧（偏差 ≤ 1 帧）。
- [ ] 三行字幕居中、不贴边、不被颗粒边吃掉；中英无错字；经纬度随镜头变化且合理。
- [ ] 同一帧导出两次 md5 一致（确定性）。
- [ ] 音频峰值 ≤ −1 dBFS，结尾随画面淡出，无爆音。
- [ ] 临时帧已删除。

## 11. 附录：可运行的参考实现（本站 4 秒样片，30 fps）【推断】

> 这是本站为验证本任务书写的最小实现，不是作者代码，画面精细度远不如作者成片，只用于跑通管线。源文件也在聚合页 `sample/` 目录。

<details><summary>scene/cues.js</summary>

```js
var CUES = {
  fps: 30, duration: 4.0, seed: 20261026,
  title: ["曲水荷塘 · 样片", "Lotus Pond · sample"],
  season: ["夏 · 一只青蛙跳进荷塘", "Summer · a frog leaps in"],
  geo: { lat: 30.2563, lon: 120.1362 },
  intro: 0.8, outro: 0.8,
  events: [
    { t: 0.9, type: "bird_in" },
    { t: 1.9, type: "frog_jump" },
    { t: 2.25, type: "splash" },
    { t: 2.9, type: "petal_land" }
  ]
};
if (typeof module !== "undefined") module.exports = CUES;
```
</details>

<details><summary>scene/index.html</summary>

```html
<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#FFF8EE}canvas{display:block}</style>
<canvas id="c"></canvas>
<script src="cues.js"></script>
<script src="frame.js"></script>
```
</details>

<details><summary>scene/frame.js</summary>

```js
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
```
</details>

<details><summary>audio/music.mjs</summary>

```js
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
```
</details>

运行：`npm i puppeteer-core@24 && node render/export.mjs && node audio/music.mjs && ffmpeg -y -framerate 30 -i out/frames/%05d.png -i out/audio.wav -c:v libx264 -crf 24 -pix_fmt yuv420p -c:a aac -shortest out/sample.mp4`（本站实测：120 帧导出约 4 s，成片 0.77 MB）。

## 12. 未知 / 作者未公开

- 作者的实际代码、对话轮数、迭代次数、渲染耗时、Token/费用：均未公开（有人问 60fps 20 s 的体积与渲染时间，作者未答）。
- 作者成片的配乐是否就是代码生成的那版、有无后期混音：未说明（只说代码配乐“可以，但没有自己找音乐好”）。
- “刷到一支稻田的俯视小动画”——启发作者的原作是谁：帖中未署名。
- 暖白底色值、画框尺寸、颗粒数量、投影偏移、线宽、字体：未给，以上取值均为【推断】。
- 作者说之后会用这个风格做 30–60 秒短片，且 lemo-opuscar 作者将把这个风格收入其风格库（经作者同意）：截至 2026-10-28 尚未见发布。
