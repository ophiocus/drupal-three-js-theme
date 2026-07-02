# Feature Map

A living, domain-organised inventory of every feature *considered* for
this project — shipped, in progress, planned, deferred, and beyond-1.0.
This is the "what makes it complete" checklist; `docs/MILESTONES.md` is
the tier framing, `docs/BOUNDARY.md` is the theme-vs-external-service
line, `docs/SHIP.md` is the nodes→world runbook, and
`docs/v0.*/ROADMAP.md` are the per-release build plans. Keep this
current as work lands.

**Status legend:** ✅ shipped · ◐ partial · ○ planned · ⏸ deferred · ☾ beyond-1.0

---

## A. Spatial model & navigation (the spine)

| Feature | Status |
| --- | --- |
| URI → coordinate mapping (`/`, `/sector/X`, `/node/Y` → vantage) | ✅ |
| Camera fly-to with damping + settle-detection writing URL back | ✅ |
| Drag-orbit (polar-constrained) | ✅ |
| Pinch-zoom (mobile) + wheel-zoom (desktop) | ✅ |
| Idle drift ("the world breathes" when untouched) | ✅ |
| Keyboard nav (Esc / Tab / number keys) | ✅ |
| Tab-visibility + focus pause (battery) | ✅ |
| Deep-linkable sector/node URLs | ✅ |
| `/tag/X`, `/search?q=` as coordinates | ○ |

## B. Content as world objects (the metaphor)

| Feature | Status |
| --- | --- |
| Article → tree (height = word count) | ✅ |
| Profile → spirit figure (height = connectivity) | ✅ |
| Event → totem on moss ring | ✅ |
| Fallback builder for unknown bundles | ✅ |
| Per-entity deterministic silhouette variation | ✅ |
| Monuments: Mission / Vision / Contact as landmarks (Track B) | ○ |
| TemporalUrgencyComponent (events glow toward their date) | ⏸ |

## C. Reading experience

| Feature | Status |
| --- | --- |
| FullView modal rendering live Drupal HTML (card view-mode) | ✅ |
| Left-anchored modal + lateral camera shift (desktop) | ✅ |
| Top-anchored modal + vertical shift (mobile) | ✅ |
| Right/bottom half stays live & navigable while reading | ✅ |
| State machine + skeleton loader + content fade | ✅ |
| Parallel prefetch on far-click (no jerk) | ✅ |
| Bloomed preview (3D card beside entity) | ✅ |
| WorldHud: region labels → entity-title spray → hover summary | ✅ |

## D. Asset pipeline (real `.glb` models)

| Feature | Status |
| --- | --- |
| `pack` + `asset` content types (license, slot, lifecycle, curated file) | ✅ |
| `/world/snapshot/assets` endpoint + embedded `assets[]` | ✅ |
| `AssetCache` + `GltfComponent` (client load + clone) | ✅ |
| Builder asset-first / primitive-fallback (article/profile/event) | ✅ |
| `drush world:assets-status` | ✅ |
| Scenery hookup (mushrooms / ferns / scatter) | ◐ |
| Acquisition automation — **Asset ingestion** (leech URL → decompress → extract → asset card); see `docs/feature-requests/asset-ingestion.md` | ◐ provider layer shipped (adapters: PolyHaven/ambientCG/ToxSam/PolyPizza/Direct + License gate); leech→card pipeline pending |
| Copyright/licence gate (`Ingest\License`, per-asset, blocks unsafe `live`) | ✅ |
| `field_asset_raw_file` (raw vs human-curated split) | ✅ |
| Turntable preview field + teaser **autoplay-on-hover** (`field_asset_turntable` **mp4**, core Video formatter, `asset_hover` JS) | ✅ |
| glTF transform + turntable **rendering** — `asset_workshop/` headless toolkit (separate from module): `transform` (gltf-transform optimize+recenter) + `turntable` (Chromium+model-viewer → **mp4**). Both verified. | ✅ external |
| Animation catalogue / playback (`GltfInspector`, AnimationComponent) | ○ proposed |
| Admin "Mark live" UI + `/admin/world/assets` (A.5) | ◐ stub route landed (Arc 1, `b7e2aca`); coverage matrix + bulk ops in Arc 2 |

## E. Layout intelligence

| Feature | Status |
| --- | --- |
| Taxonomy layout (sector ring + hash scatter) | ✅ |
| Biome blending (per-sector tonal shift) | ✅ |
| Semantic layout: embed → MDS → position (BETA 2) | ✅ |
| Embedding *processing* — **external service** (`WORLD_EMBED_*` → `RemoteEmbeddingProvider`); local TF-IDF is **dev-only fallback** (see `docs/BOUNDARY.md`) | ✅ (boundary corrected) |
| Emergent sector centroids; frozen-in-state stability | ✅ |
| `drush world:embed` / `world:relayout` / `world:layout-mode` | ✅ |
| Procrustes alignment (stable re-layout under corpus growth) | ○ |
| Animated layout transitions | ○ |
| Fibonacci-sphere fallback when no embeddings present (inner-mind) | ✅ (`bf138bd`) |
| SignatureWriter embedding preservation on re-extract | ✅ (`9fe7f80`) |

## F. Editorial / admin control

| Feature | Status |
| --- | --- |
| **`world` content type** — world characteristics (vantage geometry, sector radii, atmosphere) declared as editable content; `SnapshotPublisher` reads the active World node, constants as fallback | ✅ |
| Palette / atmosphere config-as-code (World node's atmosphere overrides it) | ✅ |
| Signature extraction pipeline (8-axis, queue-driven) | ✅ |
| `/admin/world` landing + 4 role-targeted tabs (Scenes / Content / Assets / Rules) | ◐ landing + Content tab shipped (Arc 1, `b7e2aca`); Scenes/Assets/Rules are stubs |
| Content tab: freshness banner + one-button batched embed refresh + auto-stale tracking | ✅ (Arc 1, `b7e2aca`) |
| First-run onboarding wizard at `/admin/world/onboarding` (scene picker + demo corpus install + welcome overlay) | ✅ (Arc 1.5, `6fdf1dd`) |
| Bundled demo corpus (5 topics / 12 articles / 6 profiles / 4 events) + `DemoContentInstaller` service | ✅ (Arc 1.5, `6fdf1dd`) |
| Admin edits asset↔content relations + slot bindings (ALPHA 2) | ○ stub route landed (Arc 2 will fill it) |
| World rules editable per skin in admin (ALPHA 3 — "skins as data") | ○ stub route landed (Arc 2 will fill it) |

## G. Atmospheres / skins

| Feature | Status |
| --- | --- |
| Forest atmosphere (builders, scenery, pollen, palette) | ✅ |
| Lazy-import atmosphere registry | ✅ |
| **N-theme scalable registry** (`AtmosphereModule` interface + central catalog; adding a new theme = one directory + one line) | ✅ (`a1c211d`) |
| **World switcher** (forest ↔ inner-mind) — live in-place teardown/rebuild, leak-verified, single-URL bundle | ✅ |
| **inner-mind atmosphere** — procedural crystal/orb/ring + surreal zodiac (12 emissive archetypes in outer orbit) + hue-cycle env + MDS-3D layout + Fibonacci-sphere fallback when no embeddings | ✅ |
| Per-prop intro/outro tweens with 7 deterministic variants (scale-cubic / scale-back / scale-elastic / drop-in / rise-in / spin-in / snap-in) | ✅ (`e11561b`) |
| 30 % dual-scene overlap during atmosphere/language switches | ✅ (`e6ecaf3`) |
| Envelope tween (scene.background + fog) replaces the DOM crossfade cover | ✅ (`240b4e3`) |
| Pill spinner on clicked atmosphere pill during preload | ✅ (`e6ecaf3`) |
| Per-atmosphere procedural soundscape (Web Audio) — module-owned via registry | ✅ |
| Per-property atmosphere switching | ⏸ |

## H. Conversational layer

| Feature | Status |
| --- | --- |
| Chatvatar (LLM dialogue) — speech UI + audio + state machine | ⏸ (v0.5) |
| LLM-augmented descriptors ("what kind of node is this?") | ○ |

## I. Search & discovery

| Feature | Status |
| --- | --- |
| Query embedding → nearest-N → camera fly-through | ○ |
| Search UI (bar, results as coordinates, "fly there") | ○ |

## J. Platform / productization (RC1)

| Feature | Status |
| --- | --- |
| RESTHeart → Atlas gateway (single tenant, write + search only — runtime read path is Drupal-native) | ✅ (Atlas cut off the runtime read path, `0d59538`) |
| Multi-tenant proven across ≥2 properties | ○ |
| Theme install recipe (`composer require` + first-run wizard + demo corpus + welcome overlay) | ✅ (Arc 1.5, `6fdf1dd`) |
| Module owns the renderer bundle (theme-independent JS delivery) | ✅ (Arc 1, `b7e2aca`) |
| Production deploy of `dist/` bundle through CI verified | ○ |
| Versioned snapshot API (v1→v2 migration story) | ○ |
| Graceful failure (gateway down, Atlas timeout, .glb 404) — runtime survives Atlas outage now that reads are Drupal-native | ✅ (`0d59538`, documented as BATTLE_SCARS A7) |

## K. Quality bars (cross-cutting, RC1)

| Feature | Status |
| --- | --- |
| Desktop interaction | ✅ |
| Mobile touch parity | ◐ (code shipped, pending live verification) |
| Accessibility (ARIA, focus, screen-reader fallback, reduced-motion) | ○ |
| Performance (bundle split, `.ktx2` textures, LOD budget) | ○ |
| Drupal admin coexistence (suppress canvas on `/admin/*`) | ○ |
| Test coverage on high-risk seams | ◐ (signature + semantic layout tested) |

## L. Backburner — beyond v1.0 ☾

- Socket-based **multi-user** (presence, shared navigation, pointer trails).
- **Dynamic asset allocation** for large worlds (frustum / distance-band
  spawn–despawn; pairs with embedding clustering).
- **Level of detail** (per-asset LOD chains, imposters, crossfade).
- Extracting a generic **"game engine core"** library separable from the
  Drupal binding.

---

## Completeness by tier (synthesis)

| Tier | Claim | State (June 2026) |
| --- | --- | --- |
| **MVP** | Navigate + read live content | ✅ (mobile pending verification) |
| **ALPHA 1** | World models from Drupal content types | ◐ pipeline shipped; monuments + scenery + admin UI remain |
| **ALPHA 2** | Edit asset↔content relations in admin | ◐ stub route landed; coverage matrix + bulk ops in Arc 2 |
| **ALPHA 3** | Author whole skins as data, not code | ◐ client-side registry shipped; admin surface pending Arc 2 |
| **BETA 1** | Two interchangeable metaphors | ✅ forest + inner-mind interchangeable via live in-place switcher; per-property binding + inner-mind visual depth remain |
| **BETA 2** | Meaning determines geography | ◐ pipeline shipped + operator-visible via Content tab; stability (Procrustes) + search UI remain |
| **RC1** | Production-grade across all quality bars | ◐ install recipe + operator UI delivered ahead of schedule; mobile / accessibility / multi-tenant / API versioning / test coverage still open |

**One-line read (June 2026):** the engine and its three hardest
ideas — document-in-situ navigation, meaning-as-geography, and
theme-agnostic scene pluggability — are all load-bearing. Between
here and 1.0: editorial self-service in admin (Arcs 2 + 3), the
productization quality bars (RC1), and chatvatar as the one big
deferred *capability* (not polish). The Day-0 third-party install
already works cleanly (`composer require` → wizard → populated
world → welcome overlay).
