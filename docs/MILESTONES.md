# Completeness milestones

The project's release thinking, in seven tiers. Each tier is a
coherent claim about what the theme can do; the version numbers
in `docs/v0.*/ROADMAP.md` are the build plans that ship the work
*inside* a tier.

Tiers are additive — every later tier presupposes every earlier
one. A tier is "done" when an editor / visitor / operator can
actually use the capability without holding a `drush` shell open
on the side.

| Tier | Claim | Status |
| --- | --- | --- |
| **MVP** | Full navigation and display of live site content. | ~ current, modulo mobile |
| **ALPHA 1** | World rules + models retrieved exclusively from Drupal content types. | **substantially advanced** — `world` content type holds world characteristics (publisher reads the active World node); A.2 endpoint, A.3 client cache + component, A.4 article/profile/event builders all shipped. Scenery hook-up + monuments (Track B) + admin affordances (A.5) + ingestion leech→card pipeline remain. |
| **ALPHA 2** | Asset ↔ content relations editable in Drupal admin. | not started |
| **ALPHA 3** | World rules editable per "skin" in Drupal admin. | not started — atmospheres are TS code today |
| **BETA 1** | Multiple skins (forest, inner mind, …) interchangeable per property. | **advanced** — a second skin (`inner-mind` stub) + a **live in-place switcher** (`switchAtmosphere`, leak-verified) + authored `drush world:switch` all ship. Remaining: the *real* inner-mind design pass (the stub is deliberately crude) + per-property binding + switch UX. |
| **BETA 2** | Large corpora handled via LLM-driven spatial retrofit. | **pipeline shipped** — embedding (local TF-IDF + remote neural seam) → MDS projection → semantic positions in the snapshot. `drush world:embed` + `world:relayout`. Remaining: real neural model in production, layout-stability under corpus growth (Procrustes), semantic search UI. |
| **RC1** | All stable: mobile, accessibility, perf, multi-tenant proven, deploy, tests. | not started |

---

## MVP — full navigation and display of live site content

**Claim.** A visitor can land on `/`, fly through sectors, click a
tree to read an article. URLs map to coordinates; the URL bar is
in sync with the camera; the document is rendered in situ. Live
Drupal content drives the world.

### What's in place

- Camera coupling — `vantage()` maps `/`, `/sector/X`, `/node/Y`
  to deterministic camera poses; `CameraController` damps toward
  them; settle writes the URL back.
- Click routing — `PointerNavigator` raycasts, classifies trigger
  pads / entity bodies / sector pads, routes to `CardController` /
  `CameraController`.
- FullView modal — `CardOverlay` with state machine
  (`hidden / loading / content / error`), skeleton loader,
  parallel-prefetch on far-clicks, fade-in content. Right half
  of the canvas stays navigable while reading (lateral camera shift).
- Builders — `ArticleBuilder`, `ProfileBuilder` (via metaphors),
  `EventBuilder`; `FallbackBuilder` for un-claimed bundles.
- Live cypher — RESTHeart gateway + Atlas; `SnapshotPublisher`
  emits a deterministic snapshot per request.
- Descriptors — 8-axis signature extraction (structural, temporal,
  relational, semantic) via plugin metaphors.
- WorldHud — sector labels at overview, entity labels at sector
  vantage with hover-revealed summaries.
- Biome blending — palette-driven per-sector tonal shifts based
  on inverse-square distance.

### What's missing for MVP completeness

- **Mobile / touch.** PointerNavigator is desktop pointer events
  only. Pinch-zoom, two-finger orbit, tap-vs-long-press unwired.
  The split-layout assumption (modal left, world right) doesn't
  work in portrait orientation. Without this, MVP excludes
  smartphone visitors entirely.

That's it for MVP. Everything else is later-tier work.

---

## ALPHA 1 — world rules + models exclusively from Drupal content types

**Claim.** No model lives in `dist/`. No rule lives in a YAML
config a developer has to import via drush. Everything that shapes
the world is a Drupal node (or term) the editor created.

### What's in place

- Asset content type (`asset`) with the right fields: `field_asset_slot`,
  `field_asset_atmospheres`, `field_asset_status`, `field_asset_curated_file`,
  polycount, pivot, curation notes.
- Pack content type (`pack`) holding raw downloads + license + attribution.
- Asset / pack catalog seeded (15 packs, 17 assets) at `shortlisted` status.
- `world_signature.palette.yml` config — palette + atmosphere selection.
  *(Sits between "Drupal content type" and "Drupal config" — see
  the strict/generous reading below.)*

### What's missing

- **A.2** — snapshot endpoint emitting `assets[]`. Spec'd in
  `docs/v0.4/ROADMAP.md`; not built. Without this, asset content
  exists in Drupal but never reaches the renderer.
- **A.3** — client-side `AssetCache` + `GltfComponent`.
- **A.4** — builder hookups: `ArticleBuilder` etc. consult
  `ctx.tryLoadProp(slot)`, fall back to primitive when no asset.
- **B.1–B.4** — `monument` content type + Mission/Vision/Contact
  builders. Without these, framework pages aren't world-objects.

### A note on the strict/generous reading

If "exclusively from Drupal content types" is taken strictly,
the palette config also needs to be migrated to a node bundle
(`atmosphere` or `world_palette`). If "Drupal-managed" is taken
generously, `world_signature.palette.yml` qualifies — editors edit
it via `/admin/config/system/...` without touching disk. The
strict reading is ALPHA 3's territory (skins-as-data); ALPHA 1
should not block on it.

---

## ALPHA 2 — admin-editable asset ↔ content relations

**Claim.** An editor can sit at `/admin/...`, see which asset
fills which slot for which atmosphere, swap any of those bindings
with a click, and trust the world to update next render.

### What's in place

- Asset edit forms work — any editor can attach a `.glb`, set
  slot/atmospheres/status on a per-asset basis. The data shape
  supports the milestone.

### What's missing — A.5

- **`/admin/world/assets`** view grouped atmosphere → slot →
  asset, with the live one highlighted.
- **"Mark live"** action that auto-demotes siblings — preserves
  the "one live per (atmosphere, slot) cell" invariant without
  depending on editor hand-discipline.
- **Slot ↔ builder binding UI.** Today `atmospheres/forest/mappings.yml`
  hand-edits the bundle → slot mapping. For editor self-service
  this becomes either a config-entity or a per-binding content type
  with an admin form.
- **Per-node asset overrides** (optional, post-MVP). "This one
  article is a baobab, not the default oak." Adds a `field_asset_override`
  reference on the article bundle.

---

## ALPHA 3 — admin-editable world rules per "skin"

**Claim.** "Skin" = atmosphere (forest, inner mind, …). An editor
can clone an existing skin, tune its palette + biomes + scenery +
particle params + mappings in admin, and assign it to a property
or a specific scope. The TS code holds *behavior*; Drupal content
holds *rules*.

### The split

| Stays in TS code | Becomes Drupal content |
| --- | --- |
| Pollen physics, particle systems, custom geometry generators | Palette overlay (colors, fog, ambient, sun positions) |
| Builder algorithms (how to assemble a tree) | Biome list (per-sector tonal shifts) |
| Scenery scatter logic (where mushrooms go, deterministic seed) | Mappings (bundle → builder → slot) |
| The fact that pollen exists at all in `forest` | Scenery density / particle rate / particle lifetime |

The line is fuzzy by design. "What fern shape" might be data (the
glb is a Drupal asset); "how pollen falls" is code (physics). Pick
conservatively — over-abstracting the rules surface costs more
than it saves.

### What's missing

- **`atmosphere` (or `skin`) content type** with the fields above.
- **Atmosphere registry** that reads atmosphere nodes at snapshot
  time instead of importing `atmospheres/<name>/mappings.yml` files.
- **Admin clone / fork** affordance — "duplicate this atmosphere,
  rename, tune."
- **Property → atmosphere binding** — a property's homepage node
  carries a field selecting its active atmosphere.

---

## BETA 1 — multiple skins (forest, inner mind)

**Claim.** The theme proves the metaphor-pluggability claim by
shipping at least two visually + structurally distinct skins, and
running them interchangeably on the same install.

### What's in place

- Atmosphere registry, lazy-import, palette overrides — all the
  switching plumbing.
- **A second skin** — `inner-mind` (`src/world/runtime/atmospheres/
  inner-mind/`): procedural thought-crystals / psyche-orbs / ripple-rings
  in acid hues over a hue-cycling background + multicoloured motes. A
  deliberate STUB (crude on purpose) that proves the *machinery*, not the
  final metaphor.
- **Live in-place switching** — `SceneManager.switchAtmosphere()` tears
  down + rebuilds against a fresh snapshot with the camera preserved,
  verified leak-free via `renderer.info.memory` (one disposable
  world-layer group seam). `docs/feature-requests/world-switcher.md`.
- **Authored switch** — `drush world:switch <none|forest|inner-mind>`
  flips the active World node's `field_world_atmosphere`.

### What's missing

- **Design pass for `inner-mind`**. The shipped one is a stub. Are nodes
  neurons? thoughts orbiting a self? memories rising from below? Each
  implies different builders + scenery + navigation semantics. This is
  the design work that turns the stub into a real BETA 1 metaphor.
- **Per-property atmosphere binding** — today the active atmosphere is one
  global field on the active World node; a property-scoped binding makes
  two installs wear two skins.
- **Atmosphere-switch UX** — the in-world HUD preview toggle
  (`AtmosphereSwitcher`, client-only, no node write) ships, backed by the
  read-only `?atmosphere=` snapshot hint. Remaining polish: an animated
  crossfade (fade to palette bg → rebuild → fade in) and per-atmosphere
  audio. This is the v2 tail in the world-switcher doc.

---

## BETA 2 — LLM spatial retrofit for large corpora

**Claim.** The theme scales beyond hand-curated corpora. Instead
of editors carefully placing entities in sectors, the system reads
the content and *infers* spatial placement from semantic similarity.
Search becomes "fly to where this idea lives."

### Two distinct workstreams

**a) Embedding-driven layout** (replaces "spread evenly on a circle"):

- ✅ **Embedding generation** — `EmbeddingManager` + providers.
  `LocalTfIdfEmbeddingProvider` (dev/demo, dependency-free,
  deterministic) fills `signature.semantic.embedding`;
  `RemoteEmbeddingProvider` is the production neural seam (Voyage/
  OpenAI-compatible, `WORLD_EMBED_*` env). `drush world:embed`.
- ✅ **Layout algorithm** — `SemanticLayoutProjector` (classical MDS,
  deterministic). Replaces `entityPosition()`'s hash scatter via an
  explicit `worldPos` in the snapshot. `drush world:relayout`.
- ✅ **Layout stability (v1)** — positions frozen in state; the world
  only moves on a deliberate `world:relayout`. ⏳ **Procrustes
  alignment** so re-layout after corpus growth doesn't flip/rotate
  the whole map is the remaining refinement.
- ⏳ **Smooth transitions** — a new article animating into its place
  without nudging neighbors. Not started.

**b) Semantic navigation:** ⏳ all not started.

- Query embedding → nearest-N entities → camera fly-through.
- Search UI: search bar, results as world coordinates, "fly there" buttons.
- LLM-augmented descriptors — ask an LLM "what kind of node is this?"
  as an additional axis.

### Why this is its own tier

Embedding-driven layout is research-grade — embedding spaces don't
trivially map to 2D without distortion, and a wandering layout
breaks the "URI is a coordinate" claim's determinism. The shipped
v1 resolves the determinism tension by **freezing positions in
state** (recompute only on explicit `world:relayout`) rather than
re-projecting per snapshot. The local TF-IDF provider proves the
whole pipeline without external dependencies; swapping in a real
neural model is one env var. What remains (Procrustes stability,
animated transitions, semantic search) is refinement on a working
spine, not greenfield.

---

## RC1 — all stable

**Claim.** Production-ready. Multi-tenant. Mobile-first.
Accessible. Well-tested. Documented enough that a new property
can adopt the theme without reading the BATTLE_SCARS file.

### What's missing

- **Mobile/touch parity** — carried over from MVP; the gesture
  set on mobile equals desktop (orbit, tap, zoom, navigate).
- **Accessibility** — ARIA on HUD labels, focus indicators, full
  keyboard navigation, screen-reader fallback DOM tree of the corpus,
  `prefers-reduced-motion` honoring.
- **Performance** — bundle split beyond atmospheres, `.ktx2` /
  basis texture compression in the asset pipeline, lazy-load
  Drupal CSS only when modal opens, cache budget for `AssetCache`.
- **Drupal admin coexistence** — suppress world canvas on `/admin/*`,
  contextual links work, in-place editing compatibility, toolbar
  offset honored by lateral shift math.
- **Multi-tenant proof** — Atlas via RESTHeart across two
  properties end-to-end. One client = unproven architecture.
- **Theme install recipe** — `composer require ...` + `drush en
  world_signature` + `drush world:scaffold` style one-shot, so
  adopting the theme isn't "copy the project repo."
- **Production deploy verified** — `dist/world.bundle.js` artifact
  through SSDnodes/Traefik/GHCR end-to-end.
- **API versioning** — `/world/snapshot/full v1 → v2` migration
  story documented.
- **Test coverage on high-risk seams** — DescriptorBuilder,
  SnapshotPublisher, BiomeMixer, vantage(), descriptor extraction
  plugins.
- **Graceful failure** — RESTHeart down, Atlas timeout, .glb 404:
  none of these should leave the user staring at a stuck loader.

---

## Backburner — beyond RC1

Items deliberately set aside as post-1.0 ambitions. Documented so
they're not forgotten but also not on the critical path. Each is
a meaningful architectural shift, not a polish item.

- **Socket-based multi-user.** Visitors see each other in the
  world. Presence (where your camera is), shared navigation, maybe
  pointer trails. Requires a websocket back-end, presence service,
  conflict resolution for "two users hovering the same entity."
  Likely candidate stack: Y.js or Liveblocks for presence; custom
  socket service for camera streaming.

- **Dynamic allocation of assets for large worlds.** Today every
  SmartObject is built at mount. A corpus of 5,000 articles =
  5,000 trees, all instanced, all hit-tested. Doesn't scale.
  Needs view-frustum + distance-band asset loading: trees outside
  the current vantage's relevance horizon never instantiate; they
  spawn as the camera approaches and despawn as it recedes. Pairs
  naturally with embedding-driven layout (BETA 2) — entities that
  cluster semantically can share a single LOD instance.

- **Level of detail (LOD).** Today every tree is rendered at full
  poly count regardless of distance. A 3,200-poly tree 200 units
  away costs the same as one 5 units away. Needs:
  - Per-asset LOD chain (`lod: [{distance, url}, ...]` in the
    snapshot — open question from A.2).
  - Imposter / billboard at the farthest band.
  - Crossfade between LOD levels.

- **Game engine core.** Eventually the runtime accretes enough
  shared infrastructure (input handling, scene graph, asset
  pipeline, animation, state machines, multi-user, LOD) that it
  starts looking like its own thing — a domain-specific game
  engine for "documents as world objects." Extracting a clean
  `world-engine` library separable from the Drupal-specific
  binding becomes attractive. Probably driven by the second
  Drupal-adjacent stack that wants to use the same primitives
  (whenever that arrives) rather than speculatively up-front.

---

## How to read this doc against the per-version roadmaps

- `docs/MILESTONES.md` (this file) is **release-agnostic**. It
  describes capabilities and gates.
- `docs/v0.4/ROADMAP.md` etc. are **per-version build plans**.
  They sequence the work inside a milestone with concrete tasks,
  commits, and DoD checklists.

The mapping is approximate:

| Version | Milestones it advances |
| --- | --- |
| v0.1 | MVP foundation (camera, navigation, fullview) |
| v0.2 | MVP polish (atmospheres, biomes, surfaces) |
| v0.3 | MVP polish (profiles, events, smart-objects) |
| v0.4 | MVP completion (mobile pending) + ALPHA 1 (Track A.2-A.5 + Track B) |
| v0.5 | ALPHA 1 finalisation + ALPHA 2 (admin affordances) + Chatvatar (LLM dialogue) |
| v0.6+ | ALPHA 3 (skins as data) |
| v0.7+ | BETA 1 (second skin) |
| v0.8+ | BETA 2 (LLM spatial retrofit) |
| v1.0 | RC1 (stability + productisation) |

This is an estimate, not a contract. Versions tend to grow scope
as their thesis sharpens.
