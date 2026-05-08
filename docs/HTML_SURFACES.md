# HTML surfaces — Drupal-served HTML painted into the 3D world

> **Status:** locked 2026-05-08.
> **Scope:** the engine's primitive for *rendering Drupal-served HTML
> as a texture inside the WebGL scene*. Architectural commitment, not
> a Sprint 5 feature: this is one of the core engine differentiating
> factors. Sprint 5 ships the first implementation; the abstraction
> outlasts any single implementation.

## The thesis-level case

The Site-as-World thesis carved out two representations of every
URI: world for WebGL clients, document for crawlers and assistive
tech. THESIS *"The document, in situ"* added cards as the seam:
the document representation lives *on* the world's objects,
accessed by activation.

Until now, "in situ" was figurative — cards activated as a DOM
overlay, the engine paused, the world stepped aside while the
document was read. The card was *next to* the world, not in it.

**HTML surfaces collapse the figurative into the literal.** A
Drupal-rendered HTML fragment becomes a texture on a 3D quad.
Walking past an article's room, you see the article's title
*painted on the wall*. The bookmark trigger pad shows a card's
opening sentence right on its surface. The chatvatar's chat
bubble is a real DOM bubble rasterised onto a billboard.

The world stops being a *renderer that competes with HTML*. It
becomes *a renderer of HTML* — Drupal's HTML, with its
accessibility, internationalization, structured data, theming,
and editorial workflow intact, simply painted onto surfaces.

## Why this is differentiating

Most "3D websites" abandon DOM at the WebGL boundary. Either:

- **Chrome-and-canvas** — DOM header sits over a hero canvas; the
  WebGL world is a decorative backdrop. The DOM is the site; the
  3D is window-dressing.
- **Pure WebGL** — the entire site is rendered in canvas; text is
  drawn on canvas; accessibility is lost; SEO is lost; editorial
  tooling is lost; you build a custom CMS for canvas.

HTML surfaces are a third path:

- **DOM is the source of truth.** Drupal renders HTML. The same
  HTML that the SEO/a11y outlet serves becomes the texture. Edit
  in Drupal admin → snapshot publishes → world updates. No
  bespoke content authoring layer.
- **WebGL is the renderer.** The world's spatial logic, lighting,
  atmosphere, animation, depth — all the things WebGL is for —
  apply to the surfaces. An HTML panel sits in 3D space; light
  falls across it; fog dims it at distance.
- **Editorial workflow unchanged.** Editors keep working in
  Drupal's admin UI. They never touch three.js. The world updates
  because the cypher updates.
- **Theme follows Drupal.** Olivero's CSS, atlas_coffee's palette
  override, the property's typography — all of it renders into
  the surface. No second design system.

This is the move that justifies a Drupal+three.js stack rather
than a custom WebGL CMS.

## State of the art — 2026

Four approaches exist. They're not interchangeable; each makes
different trade-offs.

| Approach | Mechanism | Interactivity | Browser support | Performance | Verdict for us |
|---|---|---|---|---|---|
| **HTML-in-Canvas** (`drawElementImage()`) | Native browser API; the engine renders styled, accessible HTML straight into a 2D/WebGL/WebGPU context. No rasterization workaround. | Yes — DOM stays laid out, accessible, keyboard-navigable; a `paint` event fires on rendering changes. | **Chromium 147+ behind `chrome://flags/#canvas-draw-element`** as of the spec's launch (WICC). No polyfill exists. Stable rollout in 2026–2027 expected. | Excellent — browser does the rasterization; subpixel rendering, ligatures, RTL preserved. | **The strategic primitive.** Bet here. |
| **`HTMLMesh`** (three.js examples) | Uses html2canvas to rasterize DOM into a canvas, then `THREE.CanvasTexture` on a plane. | Faked via raycast + `InteractiveGroup`; scrolling and complex CSS unreliable. | Universal (any browser with WebGL2). | Moderate — html2canvas doesn't support all CSS perfectly; rasterization is a snapshot. | **Bridge while HIC stabilises.** |
| **`CSS3DRenderer`** (three.js examples) | Real DOM elements positioned via CSS 3D transforms. Not a texture — the DOM is over the WebGL canvas. | Yes — real DOM; clicks, scrolls, focus all native. | Universal. | Excellent for input; can't blend with WebGL (no z-buffer interaction with meshes; no shaders). | **Reserve for FullView and lobby.** |
| **html2canvas direct + `CanvasTexture`** | Manually capture DOM, paint into texture. | None (texture is a snapshot). | Universal. | Moderate; same CSS-support caveats as HTMLMesh. | **Underlying mechanism for HTMLMesh; rarely the direct API.** |

### The progressive-enhancement bet

We ship a single API on our side — `HtmlSurface`. Internally:

```
HtmlSurface.render(domSource):
  if (CanvasRenderingContext2D.prototype.drawElementImage) {
    // SOTA path — native, fast, accessible, future-proof
    return new HtmlInCanvasSurface(domSource);
  }
  // Bridge path — works today everywhere
  return new HtmlMeshSurface(domSource);
```

A property's renderer code is identical regardless of browser. As
HIC reaches stable Chromium, Firefox, Safari (likely 2027–2028
based on similar specs' track records), our properties get
sharper, faster, more accessible HTML rendering *for free*. The
day a stable user upgrades their browser, their world's surfaces
become better — no redeploy, no migration.

This is genuinely strategic: we're betting on the platform's
evolution, not against it. Most engines are betting *against* the
platform (custom WebGL text rendering, custom DOM diffing, custom
everything). We're betting *with* it.

## The architectural primitive

Two manifesto entries (`docs/MANIFESTO.md`):

### Component type — `html_surface`

A new entry under `component_types:`. Items declare it when they
expose any region of their geometry as an HTML-textured surface.

```yaml
html_surface:
  label: 'HTML surface'
  description: 'A 2D HTML fragment painted onto a 3D quad as a texture.'
  value_schema:
    type: mapping
    keys:
      content_ref: 'string — URL of an HTML endpoint, typically /world/card/<entity>/<id>/<viewMode>'
      width_px: integer
      height_px: integer
      transparent_background: boolean
      refresh: 'enum: on-mount | on-snapshot-change | manual | live'
      max_pixel_ratio: float
      a11y_role: 'enum: decorative | document — does this surface duplicate content the SEO outlet already serves? Default decorative; document if the outlet is suppressed.'
```

`refresh` semantics:

| Value | Behaviour |
|---|---|
| `on-mount` | Fetched + rasterised once when the SmartObject mounts; never re-renders. Good for static decorative surfaces. |
| `on-snapshot-change` | Re-fetches when the corpus snapshot version changes. Default for content-bearing surfaces. |
| `manual` | App-driven; SmartObject calls `surface.refresh()` when it wants. |
| `live` | (HIC only) reacts to the `paint` event; effectively a live mirror of the DOM source. Reserved; expensive. |

### Item type — `surface.html_panel`

A standalone textured-plane primitive. Useful when the world
wants an HTML surface that isn't part of a richer item.

```yaml
- id: 'surface.html_panel'
  label: 'HTML panel'
  description: 'Standalone textured plane painting Drupal HTML into the 3D scene. Atomic primitive; composable.'
  instance_cardinality: per-instance
  config_object: 'world_signature.surface.html_panel.{instanceId}'
  components:
    - { type: html_surface, name: content }
    - { type: hitbox, name: activation }
    - { type: animation_slot, name: appear }
    - { type: animation_slot, name: dismiss }
    - { type: light_emitter, name: rim }
  status: planned
```

Existing item types — `metaphor.node.article`, `trigger_pad.bookmark`,
`chatvatar.barista` — gain optional `html_surface` slots later, when
their rendering plans concretise. The manifesto entries are
already permissive (item types declare slots; not declaring
`html_surface` is fine; the renderer falls back to flat-colour
materials for items that don't).

## The pipeline

Where HTML surfaces sit in the existing architecture:

```
   Drupal entity                          Cypher writes descriptor →
   editor save           →                Atlas via RESTHeart gateway
        │                                              │
        ▼                                              ▼
   render via Twig                          Snapshot publisher reads
   to HTML (Olivero +                       descriptor + manifesto +
   property's CSS)                          per-item config
        │                                              │
        ▼                                              ▼
   /world/card/<e>/<id>/<vm>          ─→  Snapshot's html_surface entries
   (REST resource, Sprint 4a)              carry content_ref pointing back
                                           at /world/card/...
                                                       │
                                                       ▼
                                            Renderer's HtmlSurface
                                            primitive fetches HTML,
                                            rasterises (HIC or HTMLMesh),
                                            applies as texture on quad
                                                       │
                                                       ▼
                                            world contains the document
```

Two sources of truth:

- **The HTML itself** — Drupal's render pipeline, served at
  `/world/card/<entity>/<id>/<viewMode>` (Sprint 4a's REST resource).
- **The surface placement and dimensions** — manifesto-declared,
  per-item config. The world doesn't decide *what* the HTML says;
  it decides *where the surface lives in 3D space*.

## Cache and invalidation

| Trigger | What happens |
|---|---|
| Editor saves an entity | Cypher queue worker → descriptor updated → snapshot publishes a new version → renderer detects version change → `on-snapshot-change` surfaces refresh |
| Property publishes a config change | Same — snapshot version bumps |
| Browser tab regains focus after long idle | `on-snapshot-change` surfaces poll for snapshot-version delta; refresh if changed |
| `live` surfaces (HIC only) | Native `paint` event → re-rasterise immediately |

LRU cache of rasterised textures keyed on `(content_ref,
content_hash, render_size)`. Hits = no re-fetch, no re-rasterise.
Eviction policy: bounded by texture-memory budget the renderer
declares per session.

## Accessibility — the load-bearing claim

The SEO/a11y outlet (`<div class="world__seo-outlet" hidden>`) in
`page.html.twig` carries the **canonical** document representation
for screen readers and crawlers. Every HTML surface in the world
is by default `a11y_role: decorative` — the surface is a *visual
duplicate* of content the outlet already serves.

Concretely: a screen reader user encounters the article's title
and body via the SEO outlet (positioned offscreen in the DOM).
Their experience is exactly Olivero's normal HTML render; they
neither see nor are bothered by the WebGL world. The textured
surface is `aria-hidden` decorative paint.

When `a11y_role: document` is set on a surface, the SEO outlet for
that entity is suppressed and the surface itself becomes the
canonical render. Reserved for future cases where a surface is
the only document representation; default is decorative.

The HIC API preserves accessibility natively (the source DOM stays
DOM-tree-traversable). The HTMLMesh fallback does not (rasterized
canvas is opaque to assistive tech). This is the strongest reason
to keep the SEO outlet pattern as the document substrate, with
surfaces as decoration: HTMLMesh-era surfaces add nothing to a11y;
HIC-era surfaces gain it but the outlet is still cheap to keep.

## Implementation plan — Sprint 5

| Stage | Deliverable | Risk |
|---|---|---|
| **5a — bridge** | `src/world/runtime/HtmlSurface.ts` — abstract class with two concrete impls: `HtmlInCanvasSurface` (capability-detected) and `HtmlMeshSurface` (universal fallback). Detection via `'drawElementImage' in CanvasRenderingContext2D.prototype`. | Low — both impls have well-understood APIs |
| **5b — first painted surface** | Pick one ALPHA entity (the trout article); render its `default` view-mode HTML on a face of its placeholder cube. End-to-end proof: editor save → snapshot → texture. | Medium — html2canvas + Olivero CSS is the unknown variable |
| **5c — trigger pads with HTML preview** | Each entity's trigger pad surfaces its card's `teaser` view mode as the pad's face texture. Hovering reveals the title; clicking opens FullView (existing DOM overlay path). | Low — extension of 5b |
| **5d — refresh + cache** | LRU texture cache with snapshot-version invalidation. Pre-render-on-snapshot-change vs lazy-on-first-view trade-off resolved per-property in config. | Medium — performance tuning |
| **5e — atlas_coffee polish** | Per-bundle texture treatments (article = parchment-ish; profile = portrait card; event = ticket-stub feel). Driven by per-bundle `html_surface` config. | Low; pure aesthetic |

Sprint 5 also delivers card runtime (Hidden→Bloomed→FullView), trigger
pads' geometry, and DOM-overlay FullView (already planned). HTML
surfaces are the new addition that elevates the Bloomed state from
"placeholder pad" to "actual content visible in-world."

## Why we're committing here

Three reasons this rises to "core engine differentiating factor":

1. **It's the single biggest decoupling between our stack and a
   custom-WebGL CMS.** Anyone building a 3D-first content
   experience without DOM-as-texture is forking content authoring
   away from the web platform. We don't.

2. **It's a forward-bet on the platform.** HIC is the spec; the
   browser is doing the work. As HIC reaches stable, our
   properties get faster and sharper for free. We're aligned with
   where the web is going, not against it.

3. **It honours the thesis.** "The world contains the document"
   was a literal claim in THESIS. HTML surfaces make it
   mechanically true. The DOM that crawlers index is the same
   DOM that paints the world's walls.

Editors don't change. Drupal doesn't change. The cypher doesn't
change. The renderer gains one primitive. The world contains
HTML.

## Where this lives

| Concern | File |
|---|---|
| This document — canonical | `docs/HTML_SURFACES.md` |
| Manifesto component + item type | `web/modules/custom/world_signature/config/install/world_signature.manifesto.yml` |
| Schema for new manifesto entries + per-instance config | `web/modules/custom/world_signature/config/schema/world_signature.schema.yml` |
| Architectural cross-link | `docs/ARCHITECTURE.md` (companion-docs header) |
| Implementation primitive (Sprint 5) | `src/world/runtime/HtmlSurface.ts` (new) |
| Runtime SmartObject extension (Sprint 5) | `src/world/runtime/SmartObject.ts` will declare optional surfaces |

## Sources

- [HTML-in-Canvas project page](https://html-in-canvas.dev/) — the
  WICC specification + demos. Chromium 147+, flag-gated, no
  polyfill.
- [three.js HTMLMesh docs](https://threejs.org/docs/pages/HTMLMesh.html)
  — the bridge implementation we use until HIC reaches stable.
- [three.js CSS3DRenderer](https://threejs.org/docs/index.html#examples/en/renderers/CSS3DRenderer)
  — reserved for FullView and lobby; not the same primitive.
- [three.js CanvasTexture docs](https://threejs.org/docs/pages/CanvasTexture.html)
  — underlying mechanism for HTMLMesh.
