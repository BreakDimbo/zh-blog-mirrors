
## 新增一篇文章（维护说明）

1. 新建 `<slug>/index.html`（及其资源）。
2. 在 `entries.json` 追加一条：`{"slug","title","desc","source","date":"YYYY-MM-DD","type":"全文镜像|翻译|导读|评述|画廊"}`（可选 `"featured": true`）。
3. 运行：
   ```bash
   python3 tools/restyle_articles.py   # 文字类页面套用 templates/article.html + assets/article.css（幂等；特殊交互页在脚本 SKIP 中）
   python3 tools/inject_nav.py   # 给所有子页面幂等注入「← 中文镜像文库」返回链接（共享 assets/nav.css + nav.js）
   python3 tools/inject_reading_effect.py   # 给标准文章页幂等注入报纸阅读模式（assets/reading-effect/；画廊/交互页自动跳过）
   python3 tools/build_hub.py    # 由 entries.json 生成首页 index.html（新的在前）
   ```
4. 提交并推送。`personal-sites-gallery/` 的返回链接写在 `/workspace/zara-sites/template.html`（中英文自动切换），重建不会丢失。

## 文章页统一样式

- 所有文字类子页面使用 `templates/article.html` 模板 + `assets/article.css`（与首页同一套设计 token：Noto Serif SC 标题、暖白底、金棕强调色、自动深色、打印样式）+ `assets/article.js`（宽屏长文自动生成侧边粘性目录）。
- 新文章：照旧写 `<slug>/index.html`（含 `<header class="meta"><h1>…</h1>来源行…</header>`、正文、可选 `<footer class="note">`），再运行 `tools/restyle_articles.py <slug>` 即套入模板；也可直接复制 `templates/article.html` 填充占位符。
- 页头 kicker / 日期 / 来源取自 `entries.json`；可选字段 `"subtitle"`（英文原题，斜体副标题）、`"original_url"`（原文链接）。
- 页面专属组件（卡片网格、Slack 模拟、CTA 等）的 CSS 会保留在 `<style data-za-legacy>` 中；通用排版规则被移除，由 article.css 接管。
- 不套模板的特殊页面：`personal-sites-gallery/`（独立生成器与模板）。

## 报纸阅读模式（reading effect）

- 所有标准文章页（含 `<!-- za:article v1 -->` 标记）在 `<head>` 里带一段 `<!-- re:head -->…<!-- /re:head -->`，加载 `assets/reading-effect/`（reading-effect.js / .css、pretext、Geist 字体）：折叠报纸展开、报头（今夜月相 + 实时版面数据）、逐行排字的多栏正文（首字下沉、两端对齐、栏间细线）、可拖动插图与月亮（正文实时绕排）、A1–A3 分版与卷页翻版、`H` 键显示/隐藏控制、深色夜间版、手机单栏、减少动态效果、键盘与打印支持。插图一律显示原图。
- 新文章：按上面的顺序运行 `tools/inject_reading_effect.py`（在 `inject_nav.py` 之后、`build_hub.py` 之前）即可；`restyle_articles.py` 重跑时会保留该块。只处理单篇：`python3 tools/inject_reading_effect.py <slug>`；检查：`--check`；移除：`--remove [slug]`。
- 跳过：首页、`entries.json` 中 type 为「画廊」的条目、脚本 `EXCLUDE` 中的交互/独立页面（personal-sites-gallery、classic、hub-preview、design-resources、motion-gallery、lemo-opuscar-98-styles、lemo-opuscar-evidence-films、_preview）。单页退出：给 `<body>` 加 `data-re-off`；读者可在网址后加 `?re=off` 看普通版式。
- 灵感来自 keshav（@kshvbgde）的 The Blue Hour，独立重写；许可与致谢见 `assets/reading-effect/LICENSES.md`。
