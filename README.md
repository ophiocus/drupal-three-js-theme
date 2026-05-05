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

## Status

Past greenfield. The project's philosophy and architectural commitments
are now documented:

- **[THESIS.md](THESIS.md)** — *Site as World*: the philosophical
  thesis. A site is a place; URIs are coordinates; geography is a
  function of the corpus.
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — normative
  architecture. Establishes the two-side spine (PHP cypher + JS
  renderer), the descriptor contract, and the rule that **every 3D
  theme under this thesis MUST require the `world_signature` module.**
- **[docs/PROTOCOL.md](docs/PROTOCOL.md)** — development and
  prototyping protocol. Repo shape, test split, decision log, sandbox
  workflow.

What exists in code:

- The renderer-side spine (`src/world/`): pure-TS `vantage(url, snapshot)`
  with seven invariant tests (`test/vantage.test.ts`, all green).

What's next, in rough order:

1. Scaffold the `world_signature` module — the metaphor cypher.
   `Signature` value object, `EntityFactsReader` interface, pure
   `SignatureExtractor::extract()`, unit tests covering the seven PHP
   invariants.
2. Wire entity hooks + `drupal/advancedqueue` worker; kernel-test the
   pipeline end to end.
3. Snapshot publisher (drush command) emitting the corpus JSON the
   renderer already knows how to consume.
4. Olivero child theme skeleton (`theme/`) with `page.html.twig`
   override that emits the canvas + descriptor outlet.
5. Turbo wiring + scene reconciler on the renderer side.

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
