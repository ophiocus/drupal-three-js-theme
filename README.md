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

Greenfield. No code yet. Next steps (TBD, in rough order):

1. Decide the integration shape: full-viewport canvas with Drupal
   chrome overlaid, vs. embedded canvases inside otherwise-normal Drupal
   pages, vs. per-region (Twig hooks pick which regions get a
   three.js render target).
2. Pick a starter scaffold for the theme PHP/YAML side
   (`drupal/theme_generator` or hand-rolled from a contrib base like
   `stable9` / `olivero`).
3. Decide asset pipeline — Vite is the obvious 2026 choice; produces
   the bundle that Drupal's `*.libraries.yml` references.
4. Prototype: a single Drupal page that renders a three.js scene,
   reads node fields, and does something visually non-trivial with them
   (e.g., a node's `field_image` becomes a texture on a mesh).
5. Performance budget: target Lighthouse scores comparable to a flat
   Drupal theme on first paint; defer the WebGL layer until idle.

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
