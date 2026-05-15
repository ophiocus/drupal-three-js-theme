# v0.2.x roadmap

Where we are after v0.2.0 (commit `1b0b14e`):

- Atmospheres pipeline shipped (`docs/ATMOSPHERES.md`)
- Forest pilot: Charter, Mapping, Inventory, Asset Log
  templates all in place
- `ArticleAsTree` builder renders all 20 articles as cylinder+cone
  primitives with word-count-modulated height and per-region
  bark tinting
- Configuration plumbing for `active_atmosphere` end-to-end
  (Drupal config → snapshot → renderer lazy-load)

Where we're going: **v0.2.1 is a visual-fidelity pass on the
forest atmosphere.** v0.2.0 proved the pipeline; v0.2.1 makes
the result *look like* the forest the CHARTER promised. v0.2.2+
extends to additional bundles (Profile, Event) and additional
atmospheres (outer space, inner mind) once v0.2.1 confirms the
single-atmosphere visual is right.

Observed during 2026-05-13 sandbox review (load of `/node/12`):
the pipeline works, the aesthetic doesn't yet match the
CHARTER's promise. The items below are the gap.

## v0.2.1 — Forest atmosphere visual fidelity

Priority ordering: **P1** highest-impact / lowest-effort first;
**P5** lowest-impact / nice-to-have last. Sized as "small"
(<50 LOC), "medium" (50–150), or "large" (150+). Dependencies
called out where they exist.

### P1 — Wire CHARTER palette overrides into the live world ✅ DONE (2026-05-14, commit 8364613)

**Observed:** the sandbox loaded with the pastel ALPHA palette
still active. The CHARTER specified deep forest dusk but the
atmosphere file documented the override and nothing read it.

**Resolution — Q1 decided: option (f), not the originally-listed
(a) or (b).** Neither original fork won. Through the Q1
discussion a fourth option emerged and was chosen:

- **(f) Nested `atmosphere_overrides` inside the existing
  `world_signature.palette` config.** One config entity, one
  schema, one file. `atmosphere_overrides` is a sequence keyed
  by atmosphere name; each value is a partial palette overlay.
  `SnapshotPublisher.loadPalette()` merges in three ordered
  steps: fallback ← config ← active atmosphere's overlay, then
  snake→camel + strip config-only keys.

Why (f) over (a)/(b):
- **Per-property override comes free** — a property tunes the
  forest palette via standard `config_sync`. Option (b)
  (YAML in `docs/`) lost this.
- **Schema validation at write time** — typo'd hex colors fail
  loudly. Option (b) was runtime-only.
- **Lowest maintenance** — one schema, one file. Option (a)'s
  per-atmosphere config entities accumulate.

The editorial-colocation cost (CHARTER prose in `docs/`, live
values in `config/install/`) is mitigated by a discipline note
in the palette yml: change a value here, update the CHARTER's
table in the same commit.

**Shipped:**
- `world_signature.schema.yml` — `atmosphere_overrides` sequence.
- `world_signature.palette.yml` — `atmosphere_overrides.forest`
  with the CHARTER's deep-dusk values.
- `SnapshotPublisher::loadPalette()` — the three-step merge.
- Verified on a fresh install: snapshot carries
  `background: #1d2a1f`, `atmosphere_overrides` absent (stripped).

**Note:** the original P1 estimate mentioned `hook_update` —
removed. Pre-release config changes don't get hooks
(`docs/PROTOCOL.md` §6b). Edit `config/install/`, re-install.

---

### P2 — Reconcile tree vs sector-pad scale ✅ DONE (2026-05-14)

Implemented both halves of the recommendation. Forest trees use
a dedicated `forestTreeHeight()` function with range [8, 35]
(was [5.6, 28] via the cube-edge multiplier). Sector pads now
have a procedural radial-gradient `alphaMap` (`sector-pad-texture.ts`):
85%-opaque core fading to 0 at the edge, `transparent: true`,
`depthWrite: false`. Reads as a softly-lit clearing in the
forest floor, not a poker chip.

Forest's palette overlay gains a lighter-olive `sectorPad.color`
(`#5a6a3a`) so the gradient resolves against the surrounding
ground (`#3a4a2a`) as a brightening rather than a contrast.

Original text preserved below for archaeology:

---


**Observed:** sector pads (diameter ≈ 100 units at
`world.radius * 0.25`) dominate the visual field. Trees
(max 20 units tall, scaling down to ~3) read as garnish on
top of the pads rather than *being* the world. The "geography
is editorial attention" thesis loses force when the geography
is a saucer floor and the entities are token markers.

**Fix options:**

- **(a) Shrink pad visual weight.** Lower the pad's color
  saturation, drop opacity to ~0.4, or reduce its radius
  from `world.radius * 0.25` to `world.radius * 0.15`.
- **(b) Grow trees.** Bump the `wordCountToSide` range from
  `[4, 20]` to `[8, 35]` for the forest atmosphere. Trees
  read at sector-pad scale.
- **(c) Hide pads entirely; let tree clustering be the only
  sector signal.** Most aggressive; loses the click-to-navigate
  affordance unless we keep the pad's click-target footprint
  while making it invisible.
- **(d) Replace pads with atmosphere-appropriate ground
  features.** A "forest clearing" decal (lighter green
  texture circle) rather than a solid disc.

Recommendation: **(b) + (d) layered.** Bigger trees so the
silhouette dominates, plus pads re-skinned as soft clearing
decals (lighter ground texture, no solid color). This honors
both the navigation affordance and the atmosphere's "trees ARE
the world" feel.

**Files:** `ArticleAsTree.ts` (size range override),
`SceneManager.placeEntities` (sector pad geometry +
atmosphere-aware skin).

**Size:** small (~40 LOC).

**Priority:** **P2.** Second-highest visual impact.

**Depends on:** P1 lands first so the new pads inherit the
forest palette.

---

### P3 — Remove (or re-skin) compass posts in atmosphere mode — SHELVED (Q3, 2026-05-14)

> **Shelved per Carlos.** Compass posts stay for now. Revisit
> once A4 (scenery layer) gives the forest enough density that
> the posts read as redundant. The analysis below is preserved
> for that revisit.

**Observed:** the four grey compass posts at (±60, 0) and
(0, ±60) are visible in every atmosphere. They were ALPHA
scaffolding flagged for removal "once the corpus reaches ~5
entities and feels populated." We're at 20.

**Fix:** atmosphere-aware decorative meshes. When an atmosphere
is active, the SceneManager either:

- **(a) Skips the compass posts entirely** (simple boolean
  in `placeEntities`)
- **(b) Lets the atmosphere replace them** with thematic
  alternatives (forest could put "marker trees" or "tall
  stones" at the cardinals)

Recommendation: **(a) for v0.2.1.** Atmosphere-replacement is
worth doing but requires designing the alternatives per
atmosphere. Removal is one boolean and gives the forest its
clean horizon back. Bring (b) back if the world feels
disoriented without compass markers.

**Files:** `SceneManager.placeEntities` compass post block.

**Size:** small (~10 LOC).

**Priority:** **P3.** Quick win; immediate atmospheric
coherence improvement.

---

### P4 — HTML surface visibility at detail vantages ✅ DONE (2026-05-14, commits 68572e6 + d020eaf + 18f2c5b)

Three coordinated fixes shipped together:

- **SnapshotPublisher WORLD_CONSTANTS:** `closeUpDistance` 8→32,
  `closeUpHeight` 2→14. The ALPHA cube-scale values framed the
  trunk base; tree-scale needs more room.
- **`vantage.ts` detail lookAt y → 8** (was the entity's foot at
  y=0). Camera now looks at the card band with the entity
  descending below.
- **`cardPlacement()` shared helper** in HtmlSurfaceComponent.ts.
  All three builders use it. Card at fixed `y=8`, outward by
  `CARD_OUTWARD=8`, faces outward via lookAt at the inward
  mirror of `worldPosition`.

Plus the p4b cluster: `parseUrl` rework (entityType+entityId
separated, `/sector/` recognised), boot() idempotency guard, and
the floor-layers z-fighting fix (p4c — separate roadmap item but
landed together).

Original text preserved below for archaeology:

---


**Observed:** at `/node/12`'s close-up vantage, the floating
HTML quad isn't visible. Either the surface is behind the
camera or the camera's lookAt is angled away.

**Root cause hypothesis:** `ArticleAsTree`'s surface offset
is `(outX, totalHeight + 4, outZ)` where `outX`/`outZ` are
proportional to the tree's distance from origin. At the
detail vantage, the camera stands "back from the object along
the vector from world origin to object" (per `vantage.ts`'s
detail-case logic). That puts the camera *between* world
origin and the entity, with the entity in front of the camera.
The surface is offset *away from origin* — putting it on the
far side of the entity, behind the camera's view direction.

**Fix:** in `ArticleAsTree.attachHtmlSurface`, position the
surface on the camera's side of the entity rather than the
origin's far side. Either:

- **(a) Inward-facing offset** at detail vantage (depends on
  knowing the camera's expected position)
- **(b) Stack the surface vertically above the entity** rather
  than offset radially — works from every vantage

Recommendation: **(b)** — stack vertically. The current radial
offset was an overview-vantage assumption; vertical stacking
reads from any approach angle.

**Files:** `ArticleAsTree.ts` (and likely the default
`ArticleBuilder.ts` and `FallbackBuilder.ts` if they share the
bug, which they probably do — same offset math).

**Size:** small (~30 LOC; possibly needs verification across
all three Builders).

**Priority:** **P4.** Functional, not visual — the deep-link
into a detail vantage should reveal the article content. Without
this, navigation arrives at a place that doesn't deliver.

---

### P5 — Tree silhouette variation ✅ DONE (2026-05-14)

Deterministic per-tree variation seeded from FNV-1a hash of the
entity id. Four independent 8-bit channels off the same hash:
canopy radius jitter (±15%), canopy height jitter (±20%),
canopy XZ offset for leaning silhouettes, and a boolean for an
optional second smaller canopy stacked atop tall trees.

Rotation jitter dropped — cylinder + cone are rotationally
symmetric, so Y rotation is invisible on these shapes. The
readable variations are the dimensional jitters + the XZ
canopy offset.

Original text preserved below for archaeology:

---


**Observed:** all 20 trees are identical cone+cylinder
silhouettes at different sizes. The CHARTER said "rough canopy
variation; not topiary." What we have is *exactly* topiary —
perfectly conical Christmas trees.

**Fix options:**

- **(a) Procedural variation** — random per-entity (seeded
  from entityId for determinism): canopy radius jitter ±15%,
  canopy height jitter ±20%, slight Y-axis rotation, optional
  second smaller canopy stacked at 70% height to break the
  cone silhouette.
- **(b) Multiple cone stacks** for larger trees — a 14-unit
  tall tree gets 3 stacked cones (decreasing radius);
  smaller trees stay single-cone. Reads as "tree of varying
  complexity."
- **(c) Vertex-shader sway** — leans into canopy_sway from
  the mappings.yml. Adds a per-frame deformation that's both
  visual variation and aliveness signal.

Recommendation: **(a) + (b) for v0.2.1.** Both are
mostly-deterministic-from-entityId so the visual is reproducible
across loads. (c) waits for v0.2.2 — animation infrastructure
(IdleAnimationComponent etc.) doesn't yet exist for the forest.

**Files:** `ArticleAsTree.ts` (build-time variation) +
`layout.ts` (might extract a deterministic per-entity jitter
helper since other builders will want it).

**Size:** medium (~80 LOC).

**Priority:** **P5.** Quality-of-life; the trees are
recognizable trees without it. Visible polish, not a blocker.

---

## v0.2.1 — Adjacent items surfaced while planning

These weren't in the original critique but emerge when I look
at v0.2.0 systematically. Lower urgency than P1–P5 but on the
list.

### A1 — Editorial review of CHARTER + mappings

The Forest atmosphere docs are marked "editorial review
pending." Carlos's eyes should land on:

- `docs/atmospheres/forest/CHARTER.md` — mood, palette, motifs,
  inspiration; does it read true?
- `docs/atmospheres/forest/mappings.yml` — article=tree,
  profile=spirit, event=totem-in-clearing; right metaphors?
- The bark palette by region (`forest_bark_palette` in
  mappings.yml) — do the regional bark tones land?

Action: review pass; mark "editorial-approved 2026-XX-XX" or
edit and re-mark. Not blocking on code work; can happen any
time before v0.2.x's first non-Carlos viewer.

### A2 — Editorial-approved CHARTER → palette pipeline test

Once P1 is wired and A1 is approved, run a full
"edit CHARTER → re-publish → see change" cycle to verify the
editorial loop works end-to-end. An editor changing
`background: '#1d2a1f'` to `#2a3a30` should land in the
rendered world without code changes.

Action: walkthrough; add to `docs/WALKTHROUGH.md` as a new
section once verified.

### A3 — ProfileAsSpirit + EventAsTotem builders (primitive-stage)

`mappings.yml` describes both. `assets-needed.yml` has their
glb entries (`sapling-figure`, `standing-stone`). Neither has
a builder in code yet.

The corpus currently has no `bundle=profile` or `bundle=event`
entities — all 20 are `bundle=article` — so even if the
builders existed they'd not fire. Either:

- **(a) Build the builders now**, with primitive geometry,
  ready for when content arrives
- **(b) Seed a couple of profile/event entries** into the
  atlas_coffee fixture so the builders have something to
  render

Recommendation: **(a)** first (builders are cheap; the
abstraction's value is real even unrun), then **(b)** as a
small fixture extension (3 profiles + 3 events would be enough
to validate the visual).

**Size:** medium (~150 LOC for both builders + their
primitive geometries) + small (~50 LOC for the fixture
seeder extension).

### A4 — Decorative scenery primitives ✅ DONE (2026-05-14)

Forest atmosphere now ships `scenery.ts` — mushrooms (red cone),
ferns (thin green cone), stones (squashed icosahedron) scattered
near each sector centroid. Density per `mappings.yml`:
6 mushrooms, 4 ferns, 3 stones per sector. Deterministic
placement via FNV-1a hash of `${sectorTermId}:${asset}:${index}`.
Per-item size jitter 0.7–1.3×.

Plumbed via a new optional atmosphere export
`setupForestEnvironment(scene, snapshot, registerUpdater)`.
SceneManager calls it after entity placement. Future atmospheres
follow the same shape; absent export = no environment work,
no error.

Original text preserved below for archaeology:

---


`mappings.yml` describes mushroom clusters, ferns, mossy
stones around sector centroids. Pure cosmetic but
high-density-of-detail per scene → "world feels lived-in."

Approach: a `placeScenery()` method on SceneManager that, when
an atmosphere is active, reads the atmosphere's clutter spec
and procedurally scatters primitives near sector centroids.
Determinism via FNV-1a hash of sector termId + index.

**Size:** medium (~120 LOC).

**Priority:** ambient feel improvement; do after P1–P5.

### A5 — Pollen particle layer ✅ DONE (2026-05-14)

`pollen.ts` ships a 80-particle `THREE.Points` field with a
procedural soft-circle alpha sprite, additive blending, warm
amber color (`#f0e8c8`), drifting sinusoidally in three
independent phases per particle so the field doesn't pulse
coherently. Spawn band y=5–25, uniform-area XZ scatter in
90% of world radius.

Plumbed via a new generic per-frame updater hook —
`atmosphereUpdaters` on SceneManager. `setupForestEnvironment`
takes a `registerUpdater` callback; passes it a closure that
ticks the pollen field each frame. Sets the pattern for future
animated environment elements (sky shifts, audio cues).

Original text preserved below for archaeology:

---


`mappings.yml` describes drifting motes. three.js `Points` +
sprite texture. Pure cosmetic; sells "the air has weight."

**Size:** medium (~80 LOC).

**Priority:** lowest-cost-per-impact ambient touch; do after
A4.

---

## v0.2.1 — Order of build, suggested

Assuming we tackle them sequentially (vs in parallel branches).
Status as of 2026-05-14:

1. ~~**P3** (remove compass posts)~~ — **SHELVED** (Q3).
2. ✅ **P1** (palette overrides) — **DONE** (commit 8364613).
   Option f shipped; the forest dusk palette now reaches the
   renderer.
3. **P4** (HTML surface visibility) — functional fix; navigation
   integrity. ← next
4. **P2** (tree-vs-pad scale) — second-biggest visual lift; reads
   better against the now-correct palette
5. **P5** (tree silhouette variation) — polish; trees recognizable
   without it but better with
6. **A3** (Profile + Event builders, primitive) — opens v0.2.2's
   doors. Q2 held: builders only, no corpus seeding.
7. **A4** (decorative scenery) — ambient density. Also the trigger
   for revisiting shelved P3.
8. **A5** (particles) — final touch

Remaining after P1: ~450 LOC, ~2 working days.

## v0.2.x — config-scaffold consolidation (done 2026-05-14)

Out-of-band from the original v0.2.1 punch list, but landed in
the same window — Carlos's directive to remove all `hook_update_N`
and condense floating config into the module's `config/install/`:

- `world_signature.install` deleted (five update hooks, no
  `hook_install` — pure theater).
- `taxonomy.vocabulary.topics`, `field_world_signature` (storage
  + instance), and a new module-owned `field_world_sector`
  (storage + instance, replacing the Standard `field_tags`
  piggyback) shipped as `config/install/`.
- `scaffold/setup-sandbox.php` deleted — its site-building is
  now module config + the Standard profile.
- `active_atmosphere: forest` condensed from a floating
  `drush config:set` into the palette install yml.
- UE5-meta default builders: `uv-test-texture.ts` (procedural
  UV checker + neutral `metaMaterial()`), FallbackBuilder and
  the default ArticleBuilder reworked to render honest blockout
  when no atmosphere claims a bundle.
- `docs/PROTOCOL.md` §6b records the pre-release no-hooks rule.

Verified on a clean `drush si standard` → `drush en
world_signature`: the module *is* the scaffold now.

---

## v0.2.2 — Forward look (not committed scope)

What v0.2.1 unlocks that becomes the v0.2.2 conversation:

- **Stage 4 acquisition** for the forest. Sketchfab MCP +
  Tripo MCP wired; real glbs replacing the primitives one by
  one. Each upgrade is a separate small commit; the
  pending-asset handling pattern means no breaking change.
- **`IdleAnimationComponent`** for actual breathing / sway /
  pulse motion. Needed once we have skinned meshes.
- **Second atmosphere pilot** (outer space probably; high
  visual contrast with forest validates the abstraction holds).
- **`hover_affordance` per-atmosphere.** Forest could have
  leaves rustle on hover; space could have stations spin a
  notch. The HoverComponent gets atmosphere-overridable.

---

## Open questions

**Q1. — RESOLVED (2026-05-14).** Atmosphere palette location.
Neither original fork (per-atmosphere YAML / inside
`mappings.yml`) won. Option **(f)** — nested
`atmosphere_overrides` inside the existing `world_signature.palette`
config — was chosen for per-property-override-for-free, schema
validation, and lowest maintenance. Shipped in commit 8364613.
See P1 above for the full reasoning.

**Q2. — HELD (per Carlos, 2026-05-14).** Profile/Event fixtures:
extend the seeder to create those bundles now, or wait. Held;
A3 stays "build the builders, leave the corpus alone." The
builders are cheap and the abstraction's value is real even
unrun; seeding profile/event content waits for an explicit
editorial demand.

**Q3. — DECIDED (per Carlos, 2026-05-14): do not remove yet.**
Compass posts stay. P3 is shelved — neither removal (P3.a) nor
atmosphere-replacement (P3.b) happens in v0.2.1. Revisit when
the forest atmosphere's scenery layer (A4) gives the world
enough thematic density that the posts read as redundant
rather than load-bearing.
