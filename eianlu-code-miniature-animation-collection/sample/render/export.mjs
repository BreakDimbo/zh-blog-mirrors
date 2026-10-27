// node render/export.mjs [--w=1080] [--only=0,30,60,119] -> out/frames/00000.png ...
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
  if (i % 30 === 0) process.stdout.write(`frame ${i}/${N}\n`);
}
await browser.close(); console.log(`done: ${list.length} frames -> ${outDir}`);
