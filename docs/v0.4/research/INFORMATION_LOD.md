# Research: Information LOD — scope × scale

**Status:** research, not yet wired into the live world. Lives on
branch `research/information-lod`.

The user request that triggered this:

> When clicking on trees, show me full node. When clicking on
> sector, show me all titles of items. Home only shows names of
> regions. Understand the function of scope with scale and apply.
> Expect to rebuild with different solutions.

This is **Shneiderman's mantra** ("overview first, zoom and filter,
then details on demand") expressed as a 3D world. As the camera
scope tightens — overview → sector → detail — the information
density rises in step.

## Existing technique inventory

Before designing anything new, the techniques already in the codebase:

### 1. HTML-as-texture (in-scene)

Two implementations:

- **`HtmlInCanvasSurface`** — Chromium 147+ with the
  `#canvas-draw-element` flag enabled, uses native `drawElementImage()`.
  Sharper, faster, accessibility preserved.
- **`HtmlMeshSurface`** — universal fallback via the `html-to-image`
  bridge (lazy-loaded). Rasterised snapshot.

Both produce a `THREE.Mesh` ready for the scene. Factory in
`HtmlSurface.ts` capability-detects and returns the right one.

**Properties:** in-scene plane mesh, follows world transforms,
occludes by other geometry, scales with distance from camera.
**Used by:** `HtmlSurfaceComponent` attached to every entity — the
card-next-to-tree readable at detail vantage.

**Strengths:** atmospheric, "card lives in the world," no separate
UI layer to manage.

**Weaknesses:** limited interactivity (can't click links inside
the rendered HTML); expensive to re-render on changes; subject to
texture filtering / aliasing; readable only when the camera frames
it well.

### 2. DOM overlay (modal)

`class CardOverlay` lives inside `CardController.ts` (line 357).
Triggered by the `Bloomed → FullView` transition (pad-click while
bloomed; or hash `&v=full`).

**Shape:** fixed-position fullscreen `<div>` with backdrop-blur,
centered article panel, close button. `document.body.appendChild()`
on construction; `show()` / `hide()` toggles display.

**Properties:** screen-space, always crisp, fully interactive
(links, forms work). Engine **paused** while shown
(`renderer.setAnimationLoop(null)`) so battery + focus go to the
document.

**Strengths:** maximum information density; native HTML
accessibility; works in every browser.

**Weaknesses:** **modal** — takes over the screen, pauses the
world. Wrong shape for ambient/persistent UI like sector labels.

### 3. CardController state machine

The Hidden → Bloomed → FullView transitions per entity:

```
Hidden                 → Bloomed     pad click | hashchange #card=<id>
Bloomed                → Hidden      empty-space click | hash cleared
Bloomed                → FullView    pad click while bloomed | hash &v=full
FullView               → Bloomed     close button | hash without &v=full
FullView               → Hidden      close button + Esc | hash cleared
```

Single-bloom / single-fullview invariant. The FullView card is the
same entity as the previously-bloomed one.

**Currently:** only `bundle.article/profile/event` entities flow
through this. Sectors aren't part of the FSM.

### 4. PointerNavigator click router

Routes canvas pointer events to:

- `CardController` (trigger-pad clicks)
- `CameraController` (entity-body clicks → fly-to-detail;
  sector-pad clicks → fly-to-sector)
- "step out" navigation (empty-ground click)

**Click vs drag discrimination:** 3px movement, 200ms duration.
**Hover affordance:** emissive lift on the mesh under the pointer.

**Note:** sector-pad clicks already fly the camera to the sector
vantage — but no INFORMATION surfaces. Adding the titles list is
adding behavior to an existing routing path, not a new path.

## The scope × scale matrix

The mapping the user asked for, made explicit:

| Scope (vantage) | Camera height | Info density | What's shown | Technique |
| --- | --- | --- | --- | --- |
| **Overview** (home) | ~200 units | LOW | 5 region names | DOM overlay (screen-space labels at projected sector centroids) |
| **Sector** | ~30 units | MED | 4–10 entity titles within the sector | DOM overlay (floating labels above each entity), optionally + an in-world card with the titles list |
| **Detail** | ~14 units | HIGH | Card summary next to the tree | HTML-as-texture (existing HtmlSurface — already wired) |
| **Detail + pad-click** | (engine paused) | MAX | Full article body | DOM modal (existing CardOverlay — already wired) |

The pattern: **screen-space DOM at the low-density end** (HUD-style
labels), **in-scene HTML-as-texture at the medium-density middle**
(cards in the world), **DOM modal at the high-density extreme**
(full reading).

This is not a single technique; it's three techniques chosen by
zoom-level. Each gets the scope right that suits it best.

## Gaps to fill

### Gap 1 — A non-modal DOM overlay manager

`CardOverlay` is modal — it takes over the screen and pauses the
engine. We need a sibling: a **persistent, non-modal, screen-space
overlay** that hosts labels positioned by world-space coordinates.

Working name: **`WorldHud`**.

It manages a stack of `HudLabel` elements. Each label binds to:

- a world-space `Vector3` (the anchor)
- a string of text (the displayed content)
- optional click handler

Per frame (or on camera change), it projects each label's anchor
to screen coordinates via `camera.project()` and positions the
`<div>` accordingly. Hides labels behind the camera or beyond a
distance threshold.

### Gap 2 — Sector-click → titles list

`PointerNavigator` already routes sector-pad clicks to
`CameraController.flyToSector`. We need an additional behavior:
**simultaneously surface the sector's entity titles**.

Two implementation options:

- **(A) Persistent HUD labels above each entity** — the same
  `WorldHud` from Gap 1, but populated dynamically when at sector
  vantage. Each label is screen-space-positioned over its entity.
  Hides when the camera leaves the sector.
- **(B) A floating in-world card listing titles** — an
  `HtmlSurface` at the sector centroid that renders a list of
  titles. Reuses the existing HTML-as-texture path.

**Tradeoff:** (A) is crisper and lets each title link to its
entity; (B) feels more atmospheric and matches the existing card
visual language but is harder to interact with.

The two are not mutually exclusive — (A) could be the
always-on view and (B) could be a separate "show me a printed
index" gesture.

### Gap 3 — Region labels at overview

Direct application of `WorldHud`. Five `HudLabel` instances bound
to the five sector centroids. Visible only at overview (camera
above height threshold). Click on label → fly to that sector.

This is the smallest prototype that exercises `WorldHud` end-to-end.

### Gap 4 — Tree-click → full node (refinement)

The existing flow is two clicks (pad → Bloomed → pad → FullView).
The user's wording suggests they want **one click to FullView**
when clicking a tree directly (as opposed to clicking the pad
beside the tree).

Two implementations:

- **(A) Reroute** — clicking the entity body fast-paths to FullView
  instead of the camera-fly-to-detail.
- **(B) Layer** — clicking the entity body keeps the camera fly-to
  AND triggers FullView on arrival. The fly-in feels intentional;
  the FullView reads when you've arrived.

(B) is the more cinematic answer. The user lands at the detail
vantage and the full content unfolds — the world brings them
inside the document.

## Per-activity prescription

| Activity | What to add | Technique | Estimated LOC |
| --- | --- | --- | --- |
| **A — Home shows region names** | WorldHud + 5 region labels visible at overview | DOM overlay (screen-space) | ~150 LOC for WorldHud + ~30 LOC wiring |
| **B — Sector click shows titles** | PointerNavigator hooks into WorldHud to populate per-entity labels on sector entry | DOM overlay (screen-space, anchored to world positions) | ~80 LOC for the integration |
| **C — Tree click shows full node** | Refine the click-on-entity-body handler to either fast-path to FullView or chain with the existing fly | DOM modal (existing CardOverlay) | ~30 LOC tweak |

## Expect-to-rebuild — alternative technique stacks

The brief explicitly said "expect to rebuild with different
solutions." Three alternative stacks the matrix supports:

### Alternative 1 — All DOM, no HTML-as-texture in the middle

Replace the in-scene HtmlSurface with a third DOM overlay
("BloomCard") that positions a screen-space card next to the
entity via projected coords. Eliminates the HTML-as-texture
performance cost. Loses the in-world atmospheric reading.

When this might win: if the texture rasterisation cost or aliasing
problems get bad enough that screen-space crispness matters more
than atmospheric integration.

### Alternative 2 — All HTML-as-texture, no DOM overlays

Replace WorldHud + CardOverlay with three.js Sprites and
HtmlSurface planes for everything. Pure in-canvas — no DOM layer
to manage. Loses interactivity (no real links / forms in card
content); much harder to make accessible.

When this might win: if you want the engine to render to a
non-DOM target (mobile webview, VR headset, video export) where
the DOM layer is awkward or absent.

### Alternative 3 — Hybrid via troika-three-text or BMFont

For labels specifically: use SDF-rendered text geometry instead
of DOM. Sharper than texture-rasterised HTML, faster than DOM
projection, but no interactivity (label as click target requires
manual raycast).

When this might win: huge label counts (hundreds of entities all
labeled), where the per-frame `camera.project()` cost in
JavaScript starts to matter.

## Recommended prototype sequence

1. **Build `WorldHud`** with one consumer (Activity A — region
   labels at overview). Verify the technique works end-to-end:
   screen-space DOM stays anchored to world positions, hides
   correctly when behind the camera, click handler fires. **This
   branch ships this prototype.**

2. **Extend `WorldHud` for Activity B** — sector-vantage entity
   titles. Same component, different content. Validates that
   `WorldHud` is the right abstraction for both the overview and
   sector cases.

3. **Refine the tree-click flow (Activity C)** — small tweak to
   `PointerNavigator` + `CardController`. Probably the cheapest of
   the three.

4. **Decision point**: after (1) + (2) ship, decide whether the
   DOM-overlay technique scales to additional uses (compass
   readouts, breadcrumbs, debug HUDs) or whether to start replacing
   it with Sprite-based or SDF text.

## What this branch ships

- This research doc (`docs/v0.4/research/INFORMATION_LOD.md`)
- A `WorldHud` implementation (`src/world/runtime/hud/WorldHud.ts`)
- Wired for **Activity A only** (region labels at overview)
- Verified by browser-side observation, not by full integration
  tests yet

What it does **not** ship: sector-click titles list, tree-click
fast-path, any of the alternative-stack rebuilds. Those are
follow-ons after the WorldHud abstraction is validated.

## Open questions left for discussion

1. Should region labels at overview also act as **clickable nav**
   (label tap → fly to sector)? Default: yes; they're cheap to
   wire and they answer the "how do I get into a sector without
   guessing which pad is which" question.
2. When the camera transitions between scopes, should labels
   **fade** (CSS transition) or **pop** (instant)? Fade reads
   better; pop is more performant. Default: fade.
3. **Z-fighting between DOM overlay and Drupal admin toolbar?**
   The admin toolbar at the top is itself a DOM element. The HUD
   needs to live BELOW the toolbar in z-index. CardOverlay uses
   `z-index: 1000` which sits below standard Drupal toolbar
   levels. Default: HUD uses `z-index: 100` (well below
   CardOverlay's 1000).
4. **Should the WorldHud know about scope?** Either: it's "dumb"
   (just renders the labels you give it; consumers manage which
   labels are active per camera scope) OR it accepts a scope-aware
   declaration (label N is visible at scope=overview only).
   Default: **dumb**. The scope-awareness lives where the consumer
   decides, not in the HUD.
