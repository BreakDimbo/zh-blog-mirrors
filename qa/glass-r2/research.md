# Glass shelf r2 — research notes (2026-11-04, UTC+8)

Only sources actually opened this round are cited.

## 1. Apple: what glass is *for*
- **Apple HIG · Materials** (developer.apple.com/design/human-interface-guidelines/materials, read via the HIG JSON feed):
  - "Liquid Glass forms a distinct functional layer for controls and navigation elements … **Don't use Liquid Glass in the content layer.**" Content-layer elements get standard materials instead.
  - "Use Liquid Glass effects sparingly … overusing this material … can provide a subpar user experience by distracting from that content."
  - "Thicker materials, which are more opaque, can provide better contrast for text … Thinner materials … help people retain their context."
  - visionOS glass "limits the range of background color information so a window can continue to provide contrast for app content"; "Prefer translucency to opaque colors in windows. Areas of opacity can block people's view."
- **Apple Newsroom, 9 Jun 2025, "Apple introduces a delightful and elegant new software design"**: Liquid Glass "is translucent and behaves like glass in the real world. Its color is informed by surrounding content"; it "reflects and refracts its surroundings"; icons and widgets are "crafted from multiple layers" with specular highlights.
- **Apple Developer · Liquid Glass overview** (technologyoverviews/liquid-glass): "Be judicious with your use of color … allow your content to infuse them and shine through."

**What this means for us.** The bookshelf is *content*, not chrome. The r1 mistake was treating it like a UI panel: a big frosted rectangle behind the books. That is exactly the "glass in the content layer" Apple warns against, and it blocks context ("areas of opacity"), which is why it cut the page in half. Apple's lesson for content is to make a **physical object out of real glass**: thin, clear, its colour coming from what is around it (the paper and the spines), built from a few layers (top face, polished edge, arrises, reflection), with no frosted slab.

## 2. Real float glass
- **Artistry in Glass, "What Color or Tint of Glass Should My Shelves Be?"** (artistry-in-glass.com):
  - Clear float glass "has a pale blue-green tint owing to … about 0.1% of ferric oxide. The color is hard to see when looking down on a 1/4″ sheet … but becomes very conspicuous when the optical path length is long. Looking down the length of a large shelf, the edge will look almost black."
  - Low-iron ("Crystal Clear / Starfire") glass "has only a very pale aquamarine tint when viewed through long edges", and "knowledgeable and sophisticated consumers will appreciate" it for display shelves.
  - Shelves are commonly 1/4″–3/8″ (6–10 mm) and polished.
- Search-result summaries (Guardian Glass, GlassOnline) say the same: thicker glass and edge views show more green, and low-iron glass has an "azure-blue edge". These were seen only as search snippets, not opened, so they are not relied on.

**What this means for us.**
- The face of the plate is almost colourless: just a whisper of tint.
- All the colour lives in the **polished front edge**, which is the long optical path. Use a pale, desaturated aqua-green (low-iron) and avoid saturated "jade", which would fight the warm paper.
- The edge is darker in its middle, where light travels farthest, with a bright top arris and a lighter lower arris. Those are geometry, not glow.
- At a grazing view the top face is a weak mirror (Fresnel), so the spines show faintly in it.
- A polished edge is also a total-internal-reflection mirror, so the colours of the books above smear into the edge as soft bands.
- Glass casts a light shadow, not a black one. Light bent through the thick edge lands as a slightly less dark line inside that shadow (the caustic), which is never brighter than the paper.
- 10 mm glass at the cassette scale (252 px ≈ 187 mm) comes to about 13 px of edge.

## 3. Wiki (/home/box/wiki, read-only)
- `pages/concepts/design-taste.md` gives the self-review rule we use: score screenshots on a rubric, aim for an average of 8 or more with no item below 7 (from the MotionSites skill). Taste also means restraint and subtraction.
- `pages/sources/mg-styles-15.md` (#10 "aurora glass") and `pages/sources/techartist-every-joule.md` ("liquid glass" magnifier = MeshPhysicalMaterial transmission + dispersion) are WebGL examples of real refraction. Both are expensive and both use dispersion. Dispersion would be chromatic aberration here, which the user has ruled out. Not used.
- `pages/entities/zh-blog-mirrors.md` is the site history only; it says nothing about glass.

## 4. Performance facts in this codebase
- The ink-fish canvas is `position:fixed; z-index:-1` under all content and is **erased under `.shelves .unit`** (an obstacle). So behind the shelf there is only flat page background.
- A `backdrop-filter` there blurs a flat colour. That costs a full-area blur every frame while the water redraws, and buys nothing.
- **Decision:** zero backdrop-filter. Every glass layer is a static gradient or a pseudo-element that is painted once and then composited.

## 5. Two directions, one chosen

**A — one thick low-iron float-glass plate floating in the paper (chosen).**
No back pane, no box, no hardware. The books stand directly on a 15 mm-feeling plate
(desktop: 15px top face + 17px polished front edge; mobile 12+14). Material cues, all static CSS
gradients on three thin elements per shelf (`.unit::before` back band, `.board` top face, `.ledge` edge):
- pale aquamarine *edge*, almost colourless *face* (low-iron glass: colour comes from the long path through the edge);
- 1px bright arris on the front edge and on the back edge of the top face;
- each spine's own colour mirrored on the top face (`.tape::after`, `--c`) and smeared into the edge
  (`.tape::before`, TIR-style, horizontally feathered so neighbours blend into one band, not "piano keys");
- a soft, tinted cast shadow below with a faint caustic line that is less dark but never brighter than the paper;
- bookends become standing glass fins with the same edge stack (no wood anywhere).

Why: Apple HIG says glass belongs to the functional/navigation layer, not over content — so the shelf
must be a physical glass *object* the books sit on, never a frosted panel in front of or behind them.
Removing the r1 frosted back pane removes the grey box that cut the page in half; spines now sit on the
paper itself, which is the most legible ground they can have. Zero backdrop-filter is needed: the ink-fish
canvas is erased under `.shelves .unit`, so there is nothing behind the shelf to blur.

**B — glass cabinet pane (rejected).** A clear glass door / vitrine in front of the books with a reflective sheen.
Rejected: it puts a layer of glass over the spines (legibility cost on every title), needs a large-area
effect (sheen or blur over ~1000×360px per shelf, the opposite of "static, small"), and reads as UI chrome
rather than furniture — the exact failure mode of r1.
