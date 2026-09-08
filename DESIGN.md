# DESIGN.md — HALO One pet tracker

Design system for this page.

Register: **brand**. The design is the product. A landing page for a GPS collar whose whole
argument is "you can see where the dog went", so the map has to be persuasive before any
spec table is.

## Scene

A dog owner, at home on the sofa in the evening, scrolling on a warm-lit screen, half
worried and half curious about where the dog got to today. That sentence forces the theme:
**light, warm, paper**. A dark UI would read as surveillance software. The product is
reassurance, not a control room.

## Color

Strategy: **restrained on a warm ground**. Tinted neutrals carry the surface, one accent
does all the pointing, one support colour marks safety. No third hue anywhere.

| Token | Hex | OKLCH (approx) | Role |
|---|---|---|---|
| `--primary` | `#fbf3e6` | `oklch(96.5% 0.018 85)` | Paper ground. The map draws its own copy of this so canvas and DOM never seam. |
| `--secondary` | `#f0e0c8` | `oklch(91% 0.035 84)` | Sand. Raised surfaces, city blocks. |
| `--accent` | `#c86b3c` | `oklch(60% 0.13 47)` | Terracotta. Brand, walked track, breach alert, primary CTA. |
| `--success` | `#7e9b5b` | `oklch(63% 0.08 128)` | Olive. Safe zone, in-range state. |
| `--text` | `#3a2e25` | `oklch(29% 0.02 60)` | Deep cocoa. Never `#000`. |
| `--subtext` | `rgba(58,46,37,.7)` | same hue, 70% alpha | Body copy, labels. Alpha, not a second hex. |

Rules that matter:

- **The alert is the accent.** Breach state does not introduce red. The brand colour going
  loud *is* the alarm, which keeps the page at two hues under stress.
- **Safety is olive, not green-light green.** Saturated green would read as a system status
  LED and break the paper world.
- Map fills sit in a narrow band around the ground (`0xefe0c8`, `0xe8d5b7`, `0xdfc9a8`) so
  the terracotta track is the only high-contrast line on the surface.
- Collar swatches are product finishes (`#a8643a`, `#7e9b5b`, `#c8563c`, `#4a6b82`), not UI
  colours. They tint the dog badge ring and nothing else.

`track-data.js → PALETTE` holds the Pixi-side numbers. CSS custom properties hold the same
values for the DOM. Change both together or the layers drift apart.

## Type

- Display and body: Noto Sans TC, weight 400/700/900.
- Numerals, timestamps, coordinates, spec values, HUD: JetBrains Mono. Anything a person
  would compare across rows is monospace.
- Scale steps stay above a 1.25 ratio: `clamp(38px, 7.2vw, 92px)` hero, `clamp(28px, 4.4vw,
  54px)` section, `clamp(24px, 2.6vw, 34px)` beat card, 15px body, 11px mono labels with
  `letter-spacing: .28em`.
- Body copy capped near 46ch. Kickers are uppercase mono, letterspaced, accent coloured.

## Layout contracts

Two rules the page is built around. Both are enforced by smoke tests, so breaking them
fails the run rather than quietly shipping.

**1. Text never sits on the map.** `#map-stage` is an invisible fixed rect that owns the
only region the map may perform in. The camera centres the dog on that rect, not on the
viewport. Copy lives in the complement: a left rail (`--rail-w`) on desktop, a bottom sheet
under 900px. Move the rail and the camera follows, because `app.js` measures the element
instead of hard-coding an offset.

On mobile the sheet is measured from the live card. `--card-h` is the card, `--sheet-h` is
card plus alert. They are separate on purpose: with one variable the alert chases the height
it just caused.

**2. The map recedes once it has made its point.** `body[data-map]` is written from scroll
position, CSS does the rest.

| Phase | Sections | Canvas |
|---|---|---|
| `story` | hero, journey | 1 |
| `console` | tech + live controls | 0.58 |
| `statement` | manifesto | 0.22 |
| `ground` | specs, scenarios, trust, FAQ, CTA | 0 |

HUD and alert are map instruments, so they retire at `statement`. At `ground` the render
loop skips the map entirely.

## Surfaces and elevation

Three levels, no more:

1. **Ground** — the paper, or the map drawing paper.
2. **Sheet** — beat cards, console, tech cards. `rgba(253,246,234,.90–.96)`, 1px
   `rgba(58,46,37,.15)` border, radius 18–22px, shadow `0 18px 44px rgba(94,72,50,.12)`.
3. **Instrument** — HUD, alert strip, timeline. Hairline rules and pills, no shadow. These
   read as gauges, not content.

Cards are used where a card is genuinely the affordance (a beat of narrative, a control
group). Nested cards do not appear. The HUD is a bordered rule inside the rail, not a
fourth floating card.

## Motion

- Scroll writes targets only. All interpolation happens in one rAF, using
  `damp = 1 - exp(-rate · dt)`: `rate 6` for narrative, `rate 14` for direct manipulation
  (timeline drag), `rate 4.5` for camera pan and zoom. Fast scroll raises damping by
  `scrollVelocity · 10` so the camera never visibly lags a flick.
- Reveals: opacity plus 28px translate, 0.9s, ease. No bounce, no elastic, nothing springy.
  This is a page about calm.
- The dog pin breathes and blinks. That is the only idle animation on the page, and it is
  the emotional payload, so it stays even when everything else is still.
- `prefers-reduced-motion` freezes the pin, the fence dashes, the alert pulse and the
  reveals. Scroll-driven state stays, because the user is driving it.

## Pixi conventions

- One `PIXI.Application`, `autoStart: false`, driven by the page's own rAF via
  `app.ticker.update()`. Never a second clock.
- Two containers: `map-scene` (world, moves with the camera) and `ui-layer` (screen space).
  Anything that should stay put when the camera pans belongs in the second one.
- `Graphics` is treated like SVG, not like a canvas draw call. The map is drawn once. The
  track is redrawn only when the path index actually advances.
- Text HUD stays in the DOM. Canvas text is not selectable, not translatable, and not
  readable by a screen reader; the Pixi layer only draws the cursor bubble.
- DPR capped at 2, and at 1.5 on coarse pointers.

## Bans for this page

Beyond the shared ones (no gradient text, no side-stripe borders, no decorative glass, no
identical card grids):

- No dark mode. The scene sentence rules it out.
- No third hue. If something needs to stand out, it earns accent or it stays neutral.
- No floating panel over the map. If information needs to be on screen during the story, it
  goes in the rail or the sheet.
- No spec table inside the long chapter. Specs, FAQ and reviews live in the short tail.
- No emoji in UI copy.

## Where things live

`track-data.js` is the single source of truth: waypoints, palette, breed shape params, all
page copy. Layout contracts are in `index.html` (tokens plus breakpoints) and `app.js`
(measurement). Drawing conventions are in `map-scene.js`, `ui-layer.js` and
`dog-sprite.js`. The contracts above are verified by `smoke-test.mjs`.
