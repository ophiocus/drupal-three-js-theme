# Changelog

All notable changes to this project are recorded here. The format
loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased] — v0.1 in progress

### Added (v0.1 — CameraController)

- **`src/world/runtime/CameraController.ts`** — closes the world→URL
  arrow of the coordinate-system commutative diagram. Owns per-frame
  camera motion: damps position + look-target toward the current
  Vantage (read from the URL), detects when motion has settled,
  writes the URL inverse via `history.replaceState`. Continuously
  re-orients any bloomed surface mesh toward the camera (subsumed
  from CardController's bloom-once behavior). Listens for
  `hashchange`/`popstate`/`keydown` (Escape returns to overview;
  Tab/number-keys stubbed for follow-up).
- **`docs/v0.1/CAMERA_CONTROLLER.md`** — full spec including
  rationale, interface, algorithm, input bindings, URL state model,
  test list, integration notes, risk/open questions.
- **`Vantage.uri` field** — every vantage now knows its URL inverse,
  so settled vantages can deterministically write their address.
  Existing 11 vantage tests still pass.
- **`test/camera-controller.test.ts`** — 10 invariants under jsdom:
  initial seeding, monotonic damp, convergence, settle gate,
  no-rewrite on stable target, mid-flight target reset, bloomed-mesh
  continuous facing, mesh decoupling on null, dispose cleanup.
  Required jsdom devDep (~25 KB); per-file env directive keeps
  other tests in fast node env.
- **`SceneManager`** changes: drops the ALPHA orbit (50-line block).
  Camera now seeded from URL via CameraController, moves only via
  damped vantage targets. Loop becomes a `dt` router: camera updates,
  biome updates, render.
- **`CardController`** changes: adds `onBloomedMesh` callback option;
  fires on bloom (mesh) and on collapse / fullView (null). The
  per-bloom lookAt becomes initial-only; continuous facing moves
  to CameraController.

### Known v0.1 gap (tracked for v0.1.1)

- **Drupal routes for `/sector/<termId>` and `/node/<id>`** as world
  coordinate URLs. Currently only `/node/<id>` works (Drupal's
  default node canonical); `/sector/<id>` 404s on direct load. The
  CameraController writes these URLs to the bar via
  `history.replaceState`, but full reload doesn't survive. v0.1.1
  adds `WorldController::sector()` and binds the route in
  `world_signature.routing.yml`.
- **Idle drift / "world feels alive" demonstration.** Removing the
  orbit means a freshly-loaded page is static until the user
  navigates. v0.1.1 adds a slow drift around the current vantage
  target when no input has arrived for >3 seconds.

## [Unreleased] — pre-v0.0.1 ALPHA

### Established (philosophy & architecture)

- **Site as World thesis** committed (`THESIS.md`). A site is not a
  collection of pages; it is a *place* whose geography is the
  editorial team's attention given physical form. URIs are
  coordinates; the world and the document are two valid
  representations of the same resource.
- **`world_signature` module as the metaphor cypher**
  (`docs/ARCHITECTURE.md`). The single source of truth for the
  dimensional re-orientation of content into 3D elements. **Required
  by every 3D theme under this thesis.** Listens to entity events;
  emits descriptors; depends on `world_embeddings`; has the snapshot
  publisher as an internal service.
- **Three-module PHP spine + JS renderer.** `world_embeddings` →
  `world_signature` → snapshot publisher, and the renderer reads
  snapshots. Search consumes embeddings directly, not through the
  cypher.
- **Two-side renderer/cypher coupling** via the descriptor JSON.
  Either side can be replaced as long as the descriptor contract
  holds.
- **Cards as the document representation, in situ.** The world
  contains the document, accessed by activation. Three runtime
  states: `Hidden` (zero cost), `Bloomed` (preview surfaced by a
  trigger pad, user- or event-driven), `FullView` (DOM overlay;
  three.js engine paused).
- **Trigger pads** as per-content-type interactive surfaces on each
  world object. Skinned per bundle; activated by click + hover
  preview, or by world events (schedule, proximity, search match,
  world-event-bus).
- **Engine pause during full-view reading**
  (`renderer.setAnimationLoop(null)`). The world stops to honor the
  document. Battery, focus, and computational quiet all win.
- **Search-driven blooming.** Open language search publishes bloom
  events to matching cards across the corpus; the world becomes a
  search interface.
- **URL coupling for cards.** `#card=<id>` for ephemeral bloom
  state; `/v/<viewMode>` for deep-linkable full-view state.
- **Language model: English core.** All content's source language
  is English; translations added for completeness; default property
  language set after the English core is in place. Per-property:
  `monpetitcafe` = English-core / Spanish-default.
- **Embedding epic** locked across E1–E7. First-class capability
  from day one, dual-purpose (within-sector geometry + open
  language search), with model-version tracking for staleness.
  Vector storage: MongoDB. Indexing: async via `advancedqueue`.
  Search: hybrid (BM25 + vector rerank). Reindex: cron + lazy
  on-retrieval.
- **DDEV-only working principle.** All code operations (npm,
  composer, phpunit, vitest, drush) run inside DDEV. No bare-host
  fallback path.

### Added (code)

- **JS spine** (`src/world/`): pure-TS `vantage(url, snapshot)`,
  layout math (`entityPosition`, deterministic within-sector
  offsets, FNV-1a hash for seeded determinism), URL parser,
  type definitions for the descriptor contract.
- **Vitest suite** with seven invariant tests for URI-as-coordinate
  (determinism, sector containment, sector adjacency, section
  vantage faces sector, borderland, front-page coverage,
  distinguishability). 11 cases, all green.

### Migrated

- **WSL home**: project moved from `I:\drupal-threejs-theme`
  (Windows) to `/home/csant/tecnocratica/projects/drupal-three-js-theme`
  (WSL2 Ubuntu) on 2026-05-05. Git history intact (4 commits at
  migration time). Git identity now resolves to `csantanad@gmail.com`
  via a path-conditional `includeIf` rule on
  `gitdir:~/tecnocratica/projects/`.
- Windows path retired with a marker `README.md` pointing to the
  WSL home and warning about WSL availability. The Windows
  directory is empty save for the marker.

### Documentation

- `THESIS.md` — philosophical thesis. Site as World. Adds *The
  document, in situ* — cards, three states, search-driven blooming.
- `docs/ARCHITECTURE.md` — normative architecture. Three-module PHP
  spine, descriptor schema with cards + model-version, cards
  three-state lifecycle, language model.
- `docs/PROTOCOL.md` — DDEV-only environment, test split, decision
  log expanded with 1–5, E1–E7, C1–C13. Added §4a (external
  version notes — Atlas-recommended PHP driver pins) and §4b
  (development MCP tooling — MongoDB MCP server, user-level config,
  read-only-by-policy).
- `CHANGELOG.md` — this file.
- `docs/EDITORIAL.md` — editor-facing guide to the eight axes of
  content richness; per-content-type recipes; pre-publish
  checklist. Lands before any editor sees the model.
- `docs/MANIFESTO.md` + `world_signature.manifesto` config — the
  world's master registry of *every kind of thing the world
  contains* and *every kind of property a thing can expose*.
  Eight component types (color_slot, texture_slot, animation_slot,
  hitbox, physics, sound_slot, light_emitter, trigger_event) and
  five item types (`world.global` implemented; `sector.region`,
  `trigger_pad.bookmark`, `chatvatar.barista` planned;
  `metaphor.node.article` partially implemented). Read-only
  service `world_signature.manifesto` exposes `getItemTypes()`,
  `componentsOf()`, `itemTypesWithComponentType()` etc. Forward-
  compat by design: properties can author config against
  `status: planned` types today; runtimes catch up later without
  invalidating data. The palette landing in `8a6c203` is now
  framed as one instance of this pattern.
- `docs/HTML_SURFACES.md` + manifesto v2 — **Drupal-served HTML
  painted into the 3D world as a texture**, declared as a core
  engine differentiating primitive. Strategic forward bet on
  HTML-in-Canvas (`drawElementImage()`, Chromium 147+ behind the
  `#canvas-draw-element` flag, 2026 WICC spec) with three.js
  HTMLMesh as the universal-browser bridge. Single API on our
  side; capability-detected switch underneath; properties get
  faster/sharper rendering for free as HIC reaches stable.
  Manifesto bumped v1→v2: new component type `html_surface`,
  new item type `surface.html_panel` (status: planned). The
  thesis claim "the world contains the document" becomes
  mechanically true — same DOM serves the SEO/a11y outlet AND
  paints the world's surfaces. Implementation lands in Sprint 5
  (stages 5a–5e in HTML_SURFACES.md §"Implementation plan").
- `docs/SUBJECT.md` — **`atlas_coffee` locked as the sandbox
  property** (2026-05-08). Atmospheric Latin American coffee
  culture, tuned for the medium-curious reader (discovery of the
  *medium*, not of coffee). Editorial brief: 3 bundles
  (article/profile/event), 2 vocabularies (region × method),
  20–25 entity target for ALPHA fixtures. Visual vocabulary
  recorded (palette, sector light shifts, trigger-pad shape, sound).
  Sprint 4 onward: aesthetic decisions referenced against this
  brief. Property-specific; future properties get their own
  SUBJECT.md.

### Added (Sprint 6a — atlas_coffee fixtures)

- **`scaffold/seed-atlas-coffee.php`** — idempotent fixture seeder.
  Replaces the trout sentinel with 20 articles across 5 Latin
  American coffee regions: Antigua (Guatemala), Cauca (Colombia),
  Boquete (Panamá), Sierra Madre (México), Tarrazú (Costa Rica).
  Four entities per region by design — gives biomes density to
  blend against, makes overview-height views feel populated.
- **Editorial voice locked to the SUBJECT brief.** Content is
  *atmospheric* (medium-curious reader, not coffee enthusiast):
  technique primers, producer profiles, harvest reports,
  cooperative economics. Body length is 100–250 words per entity
  so the FullView panel reads as a complete short article, not a
  stub.
- **Lean shape: all 20 entities are bundle=`article`.** Bundles
  for `profile` and `event` were planned but the bundle-color
  hint was always a stand-in for the deferred metaphor-specific
  geometry; for ALPHA, region (taxonomy → sector) carries all
  the navigation weight.
- **`scaffold/inspect-corpus.php` + `inspect-snapshot.py`** —
  development aids for verifying fixture state and snapshot shape.
- **`scaffold/purge-orphans.php`** — sweeps RESTHeart for
  descriptors whose Drupal entity no longer exists. Sprint 6
  ran into one (the old trout descriptor); the script formalizes
  the cleanup so future fixture iterations don't accumulate
  ghosts. Future scar: the `world_signature_entity_delete` hook
  should make this unnecessary; investigate before v0.1.

### Added (Sprint 6b — region biomes)

- **`src/world/runtime/BiomeMixer.ts`** — spatial (not temporal)
  biome blending. Each sector contributes a tonal overlay
  (background, fog color/density, ambient color/intensity)
  weighted by inverse-square distance from the camera's XZ.
  As the orbit cycles past the 5 sector centroids (at radius
  ~100 from origin), the scene shifts tone. Five biomes hardcoded
  for ALPHA:
  - Antigua — warm grey-green, golden ambient, slight haze (volcanic)
  - Cauca — bright clear, cool fog, neutral ambient (Andean)
  - Boquete — cool blue-grey, dimmer ambient (cloud forest)
  - Sierra Madre — warm earth tones, dusty haze (Chiapas)
  - Tarrazú — saturated greens, light fog, soft ambient (Costa Rica)
  
  Inverse-*square* (not linear) so closer sectors dominate sharply
  — bare 1/d gave too uniform a blend at the orbit radius.
- **`SceneManager`** wires the mixer into the animation loop;
  per-frame work is O(sectors) and cheap. The orbit cycles past
  all 5 sectors every ~90 seconds, demonstrating each biome.
- v0.1 will move the hardcoded biome list into
  `world_signature.palette` config so editors tune their world
  without touching code. For ALPHA, hardcoded keeps the surface
  small.

### Added (Sprint 5e — card runtime state machine)

- **`src/world/runtime/CardController.ts`** — formal Hidden →
  Bloomed → FullView state machine. Subsumes the old TriggerSystem
  (raycaster + pad management); the bloom/collapse logic now lives
  inside the state machine. Transitions:
  - `Hidden → Bloomed`   pad click · hashchange `#card=<id>`
  - `Bloomed → Hidden`   empty-space click · hash cleared · Esc
  - `Bloomed → FullView` pad click while bloomed · hash `…&v=full`
  - `FullView → Bloomed` close button · hash without `&v=full`
  - `FullView → Hidden`  Esc from FullView
  
  Single-bloom / single-fullview invariants enforced. Empty-space
  click during exploration collapses anything bloomed. Engine
  pause (`renderer.setAnimationLoop(null)` via SceneManager.setMode)
  triggers on FullView entry per ARCHITECTURE §4.3.
- **`CardOverlay`** (private inner class) — the FullView DOM panel.
  Fixed-position fullscreen scrim with backdrop-blur; centered
  white article container with a × close button. Fetches the
  `full` view-mode from `/world/card/<type>/<id>/full` (the same
  cypher endpoint that serves the bloomed `default` view-mode,
  but a fuller render). Inline styles are deliberate — the
  overlay must work without theme CSS load order assumptions.
- **URL coupling, client-side**:
  - Bloomed:   `#card=<entityId>`
  - FullView:  `#card=<entityId>&v=full`
  - Empty:     no hash; world fully Hidden.
  
  `history.replaceState()` is used so browser-back doesn't accumulate
  history per-bloom (per-FullView could move to `pushState` later).
  External `hashchange` is honored — pasting a hashed URL drops the
  user directly into the matching state.
- **`SceneManager`** drops the `TriggerSystem` field, holds a
  `cardController` instead, and passes `setMode` as a callback so
  the state machine can pause the engine without a back-reference.
- **TriggerSystem.ts deleted** — its function is fully absorbed.

### Added (Sprint 5d — surface cache)

- **`src/world/runtime/SurfaceCache.ts`** — LRU + snapshot-version
  cache wrapping `createHtmlSurface()`. Dual invalidation:
  capacity (default 32 surfaces, evicts LRU with `dispose()` to
  reclaim GPU memory) and snapshot version (cypher republishes →
  cache flushes atomically). Concurrent acquires for the same URL
  share one fetch (stampede control).
- **`SceneManager`** now holds a `SurfaceCache`, calls
  `setSnapshotVersion(raw.version)` on every mount, and the
  per-entity `attachHtmlSurface()` flow goes through `acquire()`.
  Same code path will serve Sprint 5e's FullView fetches without
  duplicating work — the same entity's `default` and `full`
  view-modes become two distinct cache entries.
- **`test/surface-cache.test.ts`** — 7 tests locking the
  semantics: cache hit, concurrent-de-dup, distinct URLs,
  LRU eviction with disposal, snapshot-version flush,
  first-set-no-flush, idempotent same-version. `createHtmlSurface`
  is mocked at the module boundary; tests run without DOM.

### Added (Sprint 5c — trigger pads, click-to-bloom)

- **`src/world/runtime/TriggerSystem.ts`** — per-entity activation
  surfaces and the raycaster that resolves canvas pointer events.
  Each entity owns a `CardRecord { pad, surface, homePosition,
  homeScale, bloomed }`. Click the pad → bloom the surface (push
  toward camera, scale ×1.8, face the camera). Click empty space
  → collapse the bloomed card. Single-bloom invariant: only one
  card surfaced at a time. Pointer events listened on the canvas
  with `pointerdown`; NDC mapping uses `getBoundingClientRect()`
  so the system works under any canvas sizing strategy.
- **`SceneManager.attachHtmlSurface()`** now also creates a
  bundle-tinted disc pad on the ground (8 world-units in front of
  the cube) and registers a `CardRecord` with the TriggerSystem.
  Hover affordances and tweened bloom motion are deferred to 5d/5e.
- This is the first interactive moment in the world — the user
  clicks a pad, the article surfaces. Foundation for the
  Hidden→Bloomed→FullView state machine in 5e.

### Added (Sprint 5a + 5b — HTML surfaces, painted)

- **`src/world/runtime/HtmlSurface.ts`** — abstract `HtmlSurface`
  base, `createHtmlSurface()` factory with runtime capability
  detection (`hasHtmlInCanvas()` checks
  `'drawElementImage' in CanvasRenderingContext2D.prototype`),
  shared `makeSurfaceMesh()` (PlaneGeometry + MeshBasicMaterial)
  and `wrapHtmlFragment()` (minimal HTML envelope so Drupal-served
  fragments serialize cleanly under html-to-image). Single API
  the property side ever sees.
- **`src/world/runtime/HtmlInCanvasSurface.ts`** — SOTA path,
  Chromium 147+ behind `#canvas-draw-element`. Uses native
  `ctx.drawElementImage(container)` against an offscreen
  positioned-fixed container (`left:-10000px`). Dynamic-imported
  by the factory only when the capability is present, so
  non-supporting browsers never download it.
- **`src/world/runtime/HtmlMeshSurface.ts`** — universal-browser
  bridge via `html-to-image`'s `toCanvas()` (SVG-foreignObject
  rasterisation). Lazy-loaded; `html-to-image` is never pulled in
  on the HIC path. Same offscreen-container pattern; same
  CanvasTexture output.
- **`SceneManager.placeEntities()` now async**; for each entity
  placed in the scene, calls `attachHtmlSurface()` which fetches
  `/world/card/<entityType>/<id>/default` (Drupal's render of the
  default view-mode), paints it onto a 18×12 world-unit quad,
  and positions it floating just above and outward from the
  entity's cube, oriented to face world-origin so the orbit
  catches a readable angle. Failures are caught and logged —
  a missing surface degrades gracefully to "just the cube." All
  surface fetches in parallel via `Promise.allSettled()`.
- **`html-to-image@^1.11.13`** added to `dependencies`.
- Built bundle now produces three artefacts: `world.bundle.js`
  (main), `HtmlInCanvasSurface-*.js` (SOTA chunk, lazy),
  `HtmlMeshSurface-*.js` (bridge chunk, lazy). The thesis claim
  "the world contains the document" is now mechanically visible —
  the same Drupal HTML that powers the SEO outlet paints the
  world's surfaces.

### Development tooling

- **MongoDB MCP server registered at user level.** Each engineer
  configures `~/.claude.json` with `mongodb-mcp-server@latest` in
  read-only mode, scoped to a per-engineer `mcp_readonly` Atlas
  user. Gives Claude Code agents a direct, side-effect-free window
  into the cluster for verifying writes and inspecting vector
  indexes during development. Not a production tool. See
  `docs/PROTOCOL.md` §4b for setup.

### Architecture pivot — RESTHeart gateway (2026-05-07)

- **Atlas App Services was sunset on 2025-09-30.** Custom HTTPS
  Endpoints and Functions are gone. The original Sprint 3b-2 plan
  to bridge Drupal → Atlas Function → cluster is dead.
- **Replaced by RESTHeart as a self-hosted data gateway.** Drupal
  speaks Guzzle/HTTPS to RESTHeart; RESTHeart routes per-tenant
  to the correct Atlas cluster.
- **Multi-tenant from day one.** *One Atlas cluster per client /
  per theme deployment.* RESTHeart is the routing and auth
  surface; Drupal never holds a MongoDB connection string.
- **Productization-ready.** When the cypher becomes a service
  offering, RESTHeart is the API surface clients address; their
  cluster is invisible behind a tenant slug.
- **Operational simplicity for Drupal stays intact.** No
  `ext-mongodb` in DDEV web image; no PECL build; no Sury PHP-repo
  GPG fight. The fallback recipe (PHP driver direct) is preserved
  in PROTOCOL §4a as a second option.
- **Decision-log entries** updated: PROTOCOL E2 amended, new E2a
  added explicitly recording the access path. ARCHITECTURE gains
  §9 *Data gateway — RESTHeart, multi-tenant by design.*

## [Pre-history]

- 2026-04-27 — Repo greenfielded with README sketching the project's
  intent.
- 2026-05-03 — Philosophical thesis committed; project becomes
  active. (`7d6b967`)
- 2026-05-04 — URI-as-coordinate mechanic with invariant tests; 11
  cases green; `npm test` passes; tsc clean. (`228c9da`)
- 2026-05-05 — Architecture & protocol docs lock the project's
  normative shape; `world_signature` named as the required cypher
  for any 3D theme. (`5c0326e`)
- 2026-05-05 — Migrated to WSL; Windows path retired with a
  pointer-to-WSL marker README; git includeIf added for
  `~/tecnocratica/projects/`.
