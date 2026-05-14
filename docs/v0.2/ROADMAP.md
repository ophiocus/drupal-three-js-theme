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

### P1 — Wire CHARTER palette overrides into the live world

**Observed:** the sandbox loads with the pastel ALPHA palette
still active (`#d0dce6` background, `#c4dec4` ground). The
CHARTER specified deep forest dusk (`#1d2a1f` background,
`#3a4a2a` ground, low warm golden sun). The atmosphere file
documents the override but nothing reads it.

**Root cause:** atmospheres currently can declare visual
intent in their CHARTER but have no mechanism to push palette
changes into the `world_signature.palette` config. The
CHARTER's "Palette overrides" table is informational only.

**Fix:** introduce per-atmosphere palette overlays that the
SnapshotPublisher merges onto the base palette when an
atmosphere is active. Two design forks (need decision):

- **(a) Atmosphere ships its own palette YAML.** A new file
  `web/modules/custom/world_signature/config/install/world_signature.atmosphere.forest.yml`
  carries the forest palette. SnapshotPublisher merges
  `palette` ← `atmosphere.<name>` ← base. Clean separation;
  more files.
- **(b) Atmosphere overrides live inside `mappings.yml`.**
  Add a `palette_overrides:` block at the top of the
  per-atmosphere mappings file. The renderer reads it
  alongside the bundle mappings. Fewer files; the YAML
  becomes the single source of truth per atmosphere.

Recommendation: **(b)** — keeps the atmosphere's editorial
intent (CHARTER) and machine-readable consequences
(mappings.yml) co-located in `docs/atmospheres/<name>/`. The
SnapshotPublisher needs a tiny YAML parser pass on mount; the
overrides flow into `world.palette` already-merged.

**Files:** `docs/atmospheres/forest/mappings.yml` (add
`palette_overrides`), `SnapshotPublisher.php`, possibly a new
service to read the YAML at runtime (or move the YAML into
Drupal config — see open question Q1).

**Size:** medium (~100 LOC + schema work if it lands in config).

**Priority:** **P1.** Highest single visual-impact fix.
Without it, the atmosphere reads as "trees on a meadow,"
not "forest at dusk."

---

### P2 — Reconcile tree vs sector-pad scale

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

### P3 — Remove (or re-skin) compass posts in atmosphere mode

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

### P4 — HTML surface visibility at detail vantages

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

### P5 — Tree silhouette variation

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

### A4 — Decorative scenery primitives

`mappings.yml` describes mushroom clusters, ferns, mossy
stones around sector centroids. Pure cosmetic but
high-density-of-detail per scene → "world feels lived-in."

Approach: a `placeScenery()` method on SceneManager that, when
an atmosphere is active, reads the atmosphere's clutter spec
and procedurally scatters primitives near sector centroids.
Determinism via FNV-1a hash of sector termId + index.

**Size:** medium (~120 LOC).

**Priority:** ambient feel improvement; do after P1–P5.

### A5 — Pollen particle layer

`mappings.yml` describes drifting motes. three.js `Points` +
sprite texture. Pure cosmetic; sells "the air has weight."

**Size:** medium (~80 LOC).

**Priority:** lowest-cost-per-impact ambient touch; do after
A4.

---

## v0.2.1 — Order of build, suggested

Assuming we tackle them sequentially (vs in parallel branches):

1. **P3** (remove compass posts) — 10 LOC, immediate atmospheric
   coherence win
2. **P1** (palette overrides) — biggest visual lift; everything
   downstream looks better against the right palette
3. **P4** (HTML surface visibility) — functional fix; navigation
   integrity
4. **P2** (tree-vs-pad scale) — second-biggest visual lift; reads
   better against the now-correct palette
5. **P5** (tree silhouette variation) — polish; trees recognizable
   without it but better with
6. **A3** (Profile + Event builders, primitive) — opens v0.2.2's
   doors
7. **A4** (decorative scenery) — ambient density
8. **A5** (particles) — final touch

Rough total: ~600 LOC, ~3 working days end-to-end if no
surprises.

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

**Q1.** Atmosphere palette: per-atmosphere YAML files OR
inside `mappings.yml`? Recommended **inside mappings.yml**
(single editorial source per atmosphere) but the schema work
is slightly different — needs decision before P1 starts.

**Q2.** Profile/Event fixtures: should we extend the
atlas_coffee seeder to create those bundles now (A3 option b),
or wait until the editorial subject brief organically demands
them? Currently all entities are articles because that's what
Drupal Standard ships; adding bundles is real work in the
fixture path.

**Q3.** Compass posts: remove entirely (P3.a) or save as a
v0.2.2 "atmosphere-replacement" task (P3.b)? Removal is one
boolean now; replacement is "design four navigation markers
per atmosphere," which is bigger.
