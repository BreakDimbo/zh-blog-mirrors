
## 新增一篇文章（维护说明）

1. 新建 `<slug>/index.html`（及其资源）。
2. 在 `entries.json` 追加一条：`{"slug","title","desc","source","date":"YYYY-MM-DD","type":"全文镜像|翻译|导读|评述|画廊"}`（可选 `"featured": true`）。
3. 运行：
   ```bash
   python3 tools/restyle_articles.py   # 文字类页面套用 templates/article.html + assets/article.css（幂等；特殊交互页在脚本 SKIP 中）
   python3 tools/inject_nav.py   # 给所有子页面幂等注入「← 中文镜像文库」返回链接（共享 assets/nav.css + nav.js）
   python3 tools/build_hub.py    # 由 entries.json 生成首页 index.html（新的在前）
   ```
4. 提交并推送。`personal-sites-gallery/` 的返回链接写在 `/workspace/zara-sites/template.html`（中英文自动切换），重建不会丢失。

## 文章页统一样式

- 所有文字类子页面使用 `templates/article.html` 模板 + `assets/article.css`（与首页同一套设计 token：Noto Serif SC 标题、暖白底、金棕强调色、自动深色、打印样式）+ `assets/article.js`（宽屏长文自动生成侧边粘性目录）。
- 新文章：照旧写 `<slug>/index.html`（含 `<header class="meta"><h1>…</h1>来源行…</header>`、正文、可选 `<footer class="note">`），再运行 `tools/restyle_articles.py <slug>` 即套入模板；也可直接复制 `templates/article.html` 填充占位符。
- 页头 kicker / 日期 / 来源取自 `entries.json`；可选字段 `"subtitle"`（英文原题，斜体副标题）、`"original_url"`（原文链接）。
- 页面专属组件（卡片网格、Slack 模拟、CTA 等）的 CSS 会保留在 `<style data-za-legacy>` 中；通用排版规则被移除，由 article.css 接管。
- 不套模板的特殊页面：`personal-sites-gallery/`（独立生成器与模板）。
