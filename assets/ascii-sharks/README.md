# ascii-sharks on the hub

Original: https://github.com/stackedlol/ascii-sharks (commit a0074c1), MIT, Copyright (c) 2026 drewdi — see `LICENSE` (verbatim).

- `ascii-sharks.js` — esbuild IIFE bundle of the original `src/` (world, species, math, renderer) plus `hub.ts`, minified, license header kept.
- `MODIFICATIONS.patch` — every change made to the original sources (all marked `[zh-blog-mirrors]`).
- `hub.ts` — the hub mount: a page-sized world drawn through a viewport-sized canvas behind the page; the bookshelves
  (and the opaque filter bar, the list view, an opened case) are keep-out rects for fish and sharks and are cut out of
  the canvas with a CSS mask; text is thinned, not covered; zones are re-measured on resize / layout change.
- `ascii-sharks.css` — layer, fade-in, mobile strip, print.

Rebuild: clone upstream at a0074c1, `git apply` the patch inside it (paths `src.orig/`→`src/`), copy `hub.ts` next to `src/`, then
`npx esbuild hub.ts --bundle --format=iife --target=es2020 --minify --legal-comments=none --banner:js="<header from ascii-sharks.js>" --outfile=ascii-sharks.js`.
