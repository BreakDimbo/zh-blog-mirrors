
## 新增一篇文章（维护说明）

1. 新建 `<slug>/index.html`（及其资源）。
2. 在 `entries.json` 追加一条：`{"slug","title","desc","source","date":"YYYY-MM-DD","type":"全文镜像|翻译|导读|评述|画廊"}`（可选 `"featured": true`）。
3. 运行：
   ```bash
   python3 tools/inject_nav.py   # 给所有子页面幂等注入「← 中文镜像文库」返回链接（共享 assets/nav.css + nav.js）
   python3 tools/build_hub.py    # 由 entries.json 生成首页 index.html（新的在前）
   ```
4. 提交并推送。`personal-sites-gallery/` 的返回链接写在 `/workspace/zara-sites/template.html`（中英文自动切换），重建不会丢失。
