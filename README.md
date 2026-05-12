# drupal-threejs-theme

A custom Drupal 11 theme built around [three.js](https://threejs.org/) as
the primary rendering surface. Sibling project to
[`webrunners`](../web_server) (the SSDnodes-hosted Drupal 11 + Drupal
Commerce platform); intentionally lives outside that repo because it has
its own toolchain (Node/Vite/three.js + Drupal theme PHP/Twig) and its
own release cadence.

## What it is

A Drupal theme — not a Drupal module, not a headless decoupled site.
Twig templates render the page shell; three.js takes over the main
content area (or the full viewport, theme-config-dependent) and renders
the experience. Drupal still owns content, routing, auth, blocks,
menus, Commerce, GTM — three.js is the presentation layer.

## Why a separate repo

- Different toolchain: `npm`/Vite/three.js asset pipeline vs. composer/PHP.
- Different lifecycle: theme iterations are visual/experimental and
  shouldn't churn the platform repo's history.
- Reusability: once stable, the theme is `composer require`-able by any
  property under `webrunners` (or by sites outside that platform).
- Licensing/ownership: may end up MIT-licensed and shared, while the
  platform repo stays private to client work.

## Status — `v0.0.1-alpha`

ALPHA shipped 2026-05-11. The thesis claim that *the world contains
the document* is mechanically real: the same Drupal-rendered HTML
that serves SEO and accessibility also paints the world's 3D
surfaces. 20-entity corpus (atlas_coffee subject), 5 regions /
sectors, 5 spatial biomes. URLs round-trip into the world's state.

**[docs/WALKTHROUGH.md](docs/WALKTHROUGH.md)** — a 4-minute
reproducible script for a first-time visit. Start there.

Architectural commitments:

- **[THESIS.md](THESIS.md)** — *Site as World*: the philosophical
  thesis. A site is a place; URIs are coordinates; geography is a
  function of the corpus.
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — normative
  architecture. Two-side spine (PHP cypher + JS renderer), descriptor
  contract, the rule that **every 3D theme under this thesis MUST
  require the `world_signature` module**.
- **[docs/PROTOCOL.md](docs/PROTOCOL.md)** — development protocol,
  decision log, DDEV-only working principle.
- **[docs/HTML_SURFACES.md](docs/HTML_SURFACES.md)** — the engine
  differentiator: Drupal HTML painted as 3D textures via
  capability-detected HIC (Chromium 147+) or html-to-image bridge.
- **[docs/SUBJECT.md](docs/SUBJECT.md)** — atlas_coffee subject lock.
- **[docs/EDITORIAL.md](docs/EDITORIAL.md)** — eight-axis editorial
  richness model.

What's in the ALPHA:

- PHP cypher (`world_signature`): entity hooks → AdvancedQueue →
  signature extraction → descriptor upsert to RESTHeart gateway →
  snapshot endpoint. 14 PHP unit tests green.
- TypeScript renderer (`src/world/`): pure `vantage()` with seven
  invariants, `entityPosition()` deterministic placement, scene
  manager, HTML-surface abstraction (HIC + html-to-image, capability
  detected), surface cache (LRU + snapshot-version), card runtime
  state machine (Hidden→Bloomed→FullView), DOM overlay, engine
  pause on FullView, URL hash coupling, spatial biome blend. 18 JS
  unit tests green.
- Olivero child theme — canvas + descriptor outlet, world bundle
  loaded as ES module.
- 20-entity atlas_coffee fixture corpus across 5 regions.

What v0.1 unlocks (in rough order):

1. Move BiomeMixer's hardcoded biome list into
   `world_signature.palette` config so editors tune their world
   without touching code.
2. SmartObject base class — per-bundle metaphor geometry replacing
   the cube-as-stand-in. Profile and event bundles become real.
3. Continuous facing while bloomed (currently faces camera at bloom
   moment only).
4. Camera → URL hash sync (the other half of the coordinate-system
   commutation; currently URL→world commutes but world→URL only
   partially).
5. DOM-overlay component tests via jsdom (CardController, CardOverlay,
   BiomeMixer currently rely on manual walkthrough verification).
6. Investigate why `world_signature_entity_delete` doesn't always
   clean RESTHeart; retire `scaffold/purge-orphans.php` once fixed.

## Relationship to webrunners

The theme will be installed into one or more property repos under
[`webrunners`](../web_server) via `composer require`. The platform
itself doesn't need to know anything about three.js — the theme is
self-contained, drops into `web/themes/contrib/<theme>/`, and is
selected via `drush config:set system.theme default <theme>`.

If a property opts in, its Dockerfile's composer install will pull the
theme; the rest of the deploy pipeline (image build → push to GHCR →
SSH deploy on the VPS) is unchanged.

## Open questions

- **Accessibility.** A three.js-only experience is hostile to screen
  readers; the theme will need a parallel DOM render path or a
  prefers-reduced-motion-style escape hatch.
- **SEO.** Crawlers don't run WebGL. Either server-side rendered
  fallback content (Drupal's normal HTML render) needs to be present
  in the markup, or the theme is opt-in for properties that don't
  care about organic search.
- **Mobile.** WebGL on low-end mobile is a perf and battery concern.
  Define a tier-down rendering mode early, not as an afterthought.
- **Drupal Commerce surface.** Cart/checkout flows are highly
  conventional; running them through three.js is novel but probably
  bad UX. Likely answer: chrome (header, cart drawer, checkout)
  stays in DOM/Twig; only marketing/landing/product-detail surfaces
  go three.js.
