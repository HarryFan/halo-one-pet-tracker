# HALO One — 智慧寵物追蹤器 product page

**Live demo:** https://harryfan.github.io/halo-one-pet-tracker/

Scroll-driven product page for a smart pet tracker. A single PixiJS v8 `Application` draws a
procedural hand-illustrated city; as you scroll through one day (06:00 → 22:00) a dog head-pin
walks the real GPS track, and the geofence breach at 08:54 fires an alert that unwinds when you
scroll back. Vanilla JS, no framework, no build step, no model files.

The city, the track and the geofence are all procedural `Graphics`; the only raster
assets are the two dog portraits in `assets/`.

Why Pixi rather than Three: a top-down map has no camera path and no lighting, but it
does have a few thousand strokes redrawn under a moving camera — a GPU 2D job, not a 3D one.

```bash
cd halo-one-pet-tracker
python3 -m http.server 8765
open http://localhost:8765/
```

## Files

| File | What it is |
|---|---|
| `track-data.js` | Single source of truth: `WAYPOINTS` (world x/z + minute-of-day + `kind`), `CITY` grid (240 × 240, roads every 24 units), `FENCE_EVENT`, `BREEDS`, `PALETTE`, and all page copy in `COPY`. Nothing else holds strings. |
| `map-scene.js` | **World layer** — procedural city blocks, park, river, geofence ring, walked-track polyline, all inside a `camera` container that pans/zooms (the 2D equivalent of camera keyframes). World units × `SCALE 7` = map pixels. |
| `ui-layer.js` | **Screen layer** — timeline marks, locator ring, cursor time bubble, breach box. Never moves with the camera. Shares one `Application` and one ticker with the world layer, so the two can't drift apart. |
| `dog-sprite.js` | The head-pin. Loads `assets/<breed>-head.png` into a circle-masked sprite; if that fetch fails (opened over `file://`, offline, asset deleted) it silently keeps the hand-coded `Graphics` head instead — same silhouette, palette and motion, plus blinking. Head-only on purpose: a full body needs a walk cycle and facing, and turns to mush when scaled down. Breed shape params live in `BREEDS` (shiba = triangle ears + cream brows; corgi = round ears + forehead blaze). |
| `assets/` | `shiba-head.png`, `corgi-head.png` — 512² flat-illustration portraits generated for this project (Higgsfield `z_image`, prompt in *Assets* below), cropped to the head. Originally licensed art was rejected on purpose: the obvious source for this style (いらすとや) forbids redistributing the asset itself, which a public repo does. |
| `app.js` | Orchestration: one rAF, scroll writes `target` only and all interpolation happens in the frame loop (no camera jitter on fast scroll). `#journey-section` is a 600vh single scroll axis; four beats are revealed by `fit()` ranges — structure archetype E. |
| `index.html` | Page shell, 6-colour token sheet shared by CSS and Pixi, DOM copy, controls. |
| `DESIGN.md` | The design system: palette with roles, type scale, the two layout contracts, motion constants, Pixi conventions, and what this page refuses to do. Read it before changing anything visual. |
| `smoke-test.mjs` | 25 Playwright checks (see below). |

### Layout contract

Text never sits on top of the map. `#map-stage` is an invisible fixed rect that owns the
only region the map is allowed to perform in; the camera centres the dog on **that** rect,
not on the viewport. Copy lives in the complement: a left rail on desktop, a bottom sheet
under 900px. Two consequences worth knowing before editing the CSS:

- Move the rail, and the camera follows automatically — `app.js` measures `#map-stage`
  rather than hard-coding an offset.
- On mobile the sheet height is measured from the live card (`--card-h`) and the breach
  strip docks to it, while the map yields `--card-h + alert height` (`--sheet-h`). The two
  variables are deliberately separate: a single one makes the alert chase the height it
  just caused.

Two smoke checks enforce this at 1440×900 and 390×844 — any card, alert or HUD overlapping
the stage by more than 400px² fails the run.

### The map recedes in four steps

Once the story is told the map stops competing with the copy. `app.js` writes
`body[data-map]` from scroll position and CSS does the rest:

| Phase | Sections | Canvas | Why |
|---|---|---|---|
| `story` | hero, journey | 1 | The map *is* the argument. |
| `console` | tech + controls | 0.58 | Sliders and swatches change the map live, so it has to stay visible; the cards go near-opaque instead. |
| `statement` | manifesto | 0.22 | One sentence, map as paper texture. HUD and alert retire here. |
| `ground` | specs, scenarios, trust, FAQ, CTA | 0 | Dense reading. Solid ground, and the render loop skips the map entirely. |

Text HUD stays in the DOM — selectable, translatable, screen-reader readable. The Pixi
layers draw shapes only.

## Signature moments

- **Scroll = time.** `#journey-section` maps 600vh onto 06:00 → 22:00; the pin walks the
  real waypoint track, the camera follows, the walked polyline grows behind it.
- **Geofence breach.** At 08:54 the dog crosses the fence radius; the alert box fires with
  a timestamp and clears again when you scroll back — the state is reversible, not a
  one-shot trigger.
- **Hover the path** anywhere to get that point's arrival time and distance from home.
- **Console controls** below the fold: fence-radius slider, four collar swatches, a
  timeline scrubber, shiba ⇄ corgi toggle. Scrolling back through the journey section
  hands time control back to the scroll axis by design.

## Verify

```bash
node smoke-test.mjs            # needs playwright resolvable; --headed / --shot out.png
```

25 checks: canvas mounts and paints real pixels, **both dog portraits actually return 200**
(a silent fallback to the vector head would otherwise pass unnoticed), scroll advances the
clock, beats reveal, breach fires *and* clears, hover readout, fence slider, all four
swatches, timeline scrub converges on the target minute, breed switch, CTA confirm state,
no dead nav anchors, FAQ ≥ 8 and expands, no horizontal overflow at 390×844, mobile burger,
**text-vs-stage overlap on both desktop and phone**, **the map has actually receded by the
spec section** (canvas transparent, HUD hidden), rAF survives resize, zero console errors.

## Assets

Both portraits were generated for this project, so the licence is ours:

```text
model: z_image (Higgsfield), 1:1
Flat vector sticker illustration of a cute Shiba Inu head, front view, Japanese flat
illustration style like irasutoya: thick rounded shapes, completely flat fills, absolutely
no gradients and no shading, clean dark brown outline, warm tan-orange fur (#D99B52),
cream muzzle and cheek patches (#FDF6EA), two small cream eyebrow dots, upright triangular
ears with soft pink inner ear, simple black dot eyes with a tiny white highlight, small
dark nose, soft pink blush cheeks, calm friendly expression, head only, centered,
symmetrical, flat cream background (#FBF3E6), earth-tone palette, no text, no watermark
```

The corgi prompt is the same with the breed swapped (`white blaze stripe down the
forehead, white muzzle, large upright rounded ears`). The model returns a seated full body
at 2048²; both files are cropped to the head and resized to 512² (`magick … -crop … -resize
512x512`). The cream background is kept deliberately — the badge behind the pin is the same
cream, so no cut-out is needed.

Swapping in different art means dropping two 512² squares into `assets/` under the same
names, or repointing `DOG_TEXTURES` in `track-data.js`.
