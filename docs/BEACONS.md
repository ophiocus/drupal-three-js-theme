# Concept beacons — data-polled gravity attractors

**Status:** design (2026-05-30, v2 — paradigm shift)
**Relates to:** `docs/INTERPRETATION_ENGINE.md` · `docs/TOOLBOX_AND_STAGE.md` ·
`web/modules/custom/world_signature/` · `src/world/runtime/atmospheres/inner-mind/`

> The corpus has gravity. It already gathers around things — taxonomy
> terms, author themes, named concepts that recur across nodes. **A
> beacon is the act of making that gathering visible** — a marker
> placed where the corpus's own gravity is strongest. The editor
> doesn't *author* beacons; the data *reveals* them. The editor
> curates which revelations to surface.

---

## 1. The paradigm shift

The interpretation engine shipped two ways to mint meaning, both
top-down:

| Frame | Origin | What the editor does |
|---|---|---|
| **MDS-3D** | corpus geometry only | nothing (no editorial input) |
| **Anchored axes** | editor authors pole prose | mints meaning along named directions |

Both flow from human intent to data. The editor *names* the
meaning; the corpus accepts it.

**Beacons invert that flow.** The corpus is polled — every
descriptor sampled for its alignment with candidate concepts
(taxonomy terms, author themes, recurring entities, the
interpretation's own poles, frequent n-grams). For each candidate
where alignment is meaningfully concentrated, a beacon is *minted
from the data* — not declared by the editor.

| Beacon property | Derived from |
|---|---|
| **embedding** | mean of aligned descriptors' embeddings |
| **position** (3D) | mean of aligned descriptors' world positions |
| **mass** | count of aligned descriptors |
| **radius** | spread (stdev) of aligned descriptors' embeddings |
| **color** | deterministic from the source candidate's slug |

The editor's role becomes **curation, not authorship**:
- **Promote** a discovered beacon (surface it visually)
- **Suppress** a discovered beacon (data found it, editor decides
  it shouldn't surface)
- **Rename** for clarity (the auto-derived label is the source
  candidate's slug; editorial polish goes on top)
- **Override** position or mass for visual reasons (an editor can
  pull a beacon slightly out of its computed centroid if two
  beacons would otherwise collide)
- **Author** new beacons (the original top-down mode survives, as
  a manual override for concepts the polling didn't find)

This is the shift: **the corpus speaks first, the editor refines**.

---

## 2. What it produces — emergent gathering

The visible result is the gathering itself. Two articles that both
align strongly with the "fermentation" beacon end up *near it*, and
therefore *near each other*. A third article weakly aligned with
"fermentation" and strongly with "cooperative economics" sits in
the gravitational well between those two beacons. A piece of
content with no strong alignment to anything floats unattached at
its anchored-axes base position.

The 3D layout is no longer a flat spread across named directions.
It is **a map of where the corpus naturally clusters**, with each
cluster's identity (the beacon) inscribed *at* the cluster — not
imposed *on* it.

The corpus reveals its own gravity. The editor curates which
gravities to make visible.

---

## 3. The polling pipeline

For each embed pass (`drush world:embed` or the in-canvas
re-embed button), a new **Pass 6 — beacon discovery** runs over
the freshly embedded corpus.

### 3.1 Candidate sources

A candidate is anything the corpus *could* gather around. The
v1 sources, in order of editorial reliability:

1. **Taxonomy terms** (the `topics` vocabulary — the existing
   sectors). Highest editorial intent: someone tagged these. Each
   term is a candidate.
2. **Author writing themes** (the `field_user_themes` value on
   each User entity — added by `world_seed`). Each unique theme
   string across all authors is a candidate.
3. **Interpretation poles** (the `pole_a` / `pole_b` prose of the
   active atmosphere's anchored axes). Each pole is a candidate.
   Polled poles produce beacons orthogonal to the axes they came
   from — the axis tells you direction, the beacon tells you
   destination.
4. **Frequent named entities / n-grams** *(deferred — needs
   light NER)*. The top-K most frequent recurring multi-word
   phrases across descriptor bodies.

Sources are pluggable: a `BeaconCandidateSource` interface,
discovered via a service tag, lets a property add its own
(e.g. atlas_coffee could plug a "varietal" source that pulls
candidates from a custom Coffee Varietal taxonomy).

### 3.2 Presence vs relevance — the two polling modes

For each candidate, the polling pass measures alignment with each
descriptor. Two modes, picked per source:

- **Presence** (binary or count): does the descriptor *reference*
  this concept? Used for taxonomy terms and author themes — the
  reference is explicit, so the measurement is exact.
- **Relevance** (continuous): how *similar* is the descriptor's
  embedding to a representation of this concept? Used for
  interpretation poles and n-grams — the embedding does the work.
  Computed as `cos(descriptor.embedding, concept_embedding)`,
  then thresholded (default 0.35 for the dev TF-IDF; tunable per
  source).

Both produce an **aligned set** of descriptor ids for each
candidate. Polling fails — no beacon is minted — when the aligned
set has fewer than `MIN_ALIGNED` members (default 3). Editorial
truth: a "concept" that fits two nodes isn't a concept yet, it's a
coincidence.

### 3.3 Derived beacon properties

Given an aligned set `A` for candidate `c`:

- **embedding** = mean of {descriptor.embedding for d in A}
  (un-normalised — the magnitude carries weight information).
- **position** = mean of {descriptor.worldPos for d in A}, when
  worldPos exists (semantic layout). When not (taxonomy layout),
  position is `null` and the client computes it from the same
  formula at render time using the entities' projected positions.
- **mass** = |A| (count of aligned descriptors), normalised on
  read to `mass / max_mass_in_atmosphere`. So masses range 0–1
  with the most-aligned concept at 1.0.
- **radius** = stdev of pairwise cosine distances among A's
  embeddings, scaled to world units. Tight clusters get a small
  influence radius; diffuse clusters get a wide one. The gather
  is *literally* shaped by how coherent the data is.
- **color** = deterministic hash(slug) → HSL hue, with saturation
  scaled by mass and lightness fixed at 60%. Higher-mass beacons
  are more saturated, more visually present. Lower-mass beacons
  are pastel and quiet.

The data drives the visual; the visual reflects the data.

---

## 4. Visuality and effector scope — what the data shows

This is the section the paradigm shift turns on. Both visual and
gravitational properties scale with the polled outcome:

| Beacon property | Effect on visuality | Effect on effector scope |
|---|---|---|
| **mass** (count of aligned descriptors) | sphere size ∝ √mass · base; glow intensity ∝ mass | pull weight `mᵢ` in the softmax ∝ mass — heavier concepts pull harder |
| **radius** (spread of alignment) | influence wireframe (editor toggle) at this radius | gravity falloff distance — wider radius = pull reaches farther |
| **alignment entropy** (uniformity vs sharpness) | (none — too abstract for the eye) | high entropy → low effective pull (the beacon is "shared"); low entropy → high effective pull (the beacon owns its cluster) |
| **source kind** | color hue band — taxonomy in one octave, author themes in another, poles in a third | (none) |

Concretely:

- A taxonomy term that 38 entities reference: large bright sphere
  with strong gravitational pull and a wide influence radius.
- An author theme present on 6 articles: medium-mass beacon,
  smaller and quieter, with a tighter influence radius.
- A pole-derived beacon with high relevance to 22 entities:
  visually distinct (different color band), strong pull, medium
  radius.
- A candidate that polls only 3 entities: minimal beacon,
  faint pastel, barely pulls — or, depending on threshold,
  doesn't render at all.

**The corpus's structure becomes visible as a constellation**.
Bright dense beacons mark the concepts the data is built around.
Faint sparse beacons mark the concepts that are barely there. The
visual layout *is* the data's self-portrait.

---

## 5. Mongo storage

A new **`beacons` collection** in the same database as
`descriptors`. Document shape (v2, with the data-polled fields):

```jsonc
{
  "_id":           "atmosphere:inner-mind:beacon:antigua",
  "atmosphere":    "inner-mind",
  "slug":          "antigua",
  "label":         "Antigua, Guatemala",  // editor-overrideable
  "kind":          "discovered",          // "discovered" | "authored"
  "source":        "taxonomy:topics",     // candidate-source identifier
  "source_id":     "4",                   // tid / theme string / pole id

  // computed by Pass 6 — read-only from the editor
  "embedding":     [0.123, ...],
  "position":      { "x": 12.3, "y": 0, "z": -45.7 },  // null when no worldPos available
  "mass_count":    38,                    // raw aligned-set size
  "mass":          0.61,                  // normalized 0..1 within atmosphere
  "radius":        42.5,                  // world units, derived from alignment spread
  "entropy":       0.21,                  // 0..1, low = sharp cluster, high = diffuse
  "aligned_ids":   ["node:article:12", "node:article:47", ...],

  // editorial overlay — null when the editor hasn't touched
  "label_override":    null,
  "color_override":    null,
  "mass_override":     null,
  "position_override": null,
  "suppressed":        false,             // hide from rendering
  "promoted":          false,             // future use — pin to render even when below threshold

  // freshness
  "modelVersion":  "local-tfidf-fh256-v1",
  "embeddedAt":    1780...,
  "polledAt":      1780...
}
```

Field discipline:
- The `*_override` fields are editorial overlays. The base values
  (`label`, `mass`, `position`, plus a default color derived from
  the slug hash) are recomputed every Pass 6. Overrides survive
  re-polling.
- `suppressed` is the editor saying "the polling found this but
  it shouldn't surface." The beacon is kept on disk so a future
  re-polling doesn't re-discover and re-promote it.
- `kind: "authored"` beacons skip Pass 6's recomputation entirely
  — their embedding comes from editor prose (as in the original
  design), and their mass/radius are editor-set. They coexist
  with discovered beacons in the same collection, distinguished
  by `kind`.

Why a separate collection (vs sub-doc of descriptors): different
lifecycle, different index needs, different write path. The
`beacons` collection wants a vector index on `embedding`, a
filter index on `(atmosphere, suppressed)`, and a text index on
`(label, label_override)` for the editor search affordance.

---

## 6. The math — same gravity, computed inputs

The gravitational projection is unchanged from the v1 design.
Each entity has an embedding `e ∈ ℝᵈ` and a base 3D position `p₀`
(MDS-3D or anchored). Each beacon has embedding `bᵢ`, position
`qᵢ`, effective mass `mᵢ = mass_override ?? mass`.

**Affinity** (softmax over cosine, weighted by mass):

```
αᵢ(e) = exp(τ · cos(e, bᵢ) · mᵢ) / Σⱼ exp(τ · cos(e, bⱼ) · mⱼ)
```

**Position** (blend base + beacon centroid):

```
p(e) = (1 − λ) · p₀(e) + λ · Σᵢ αᵢ(e) · qᵢ
```

`λ` (pull strength) and `τ` (sharpness) remain global per
atmosphere. Suppressed beacons drop out of both sums. O(n·d·k)
per projection.

What changed in v2 isn't the math — it's where the inputs come
from. `bᵢ`, `qᵢ`, and `mᵢ` are now *polled* from the corpus by
default; editor overrides apply on top.

---

## 7. Code seams

| Concern | Today | v2 (data-polled beacons) change |
|---|---|---|
| **Storage** | `descriptors` collection | + `beacons` collection (new) |
| **Embed pass** | EmbedRunner has Passes 1–4 (corpus embed + anchor axis vectors) | + Pass 5: candidate enumeration. + Pass 6: per-candidate alignment, beacon mint/update |
| **Candidate sources** | none | a `BeaconCandidateSource` interface; built-in implementations for taxonomy, author themes, interpretation poles |
| **Snapshot** | `world.interpretation`, `world.interpretationAxes` | + `world.beacons` (active atmosphere's beacons, post-override, post-suppression) |
| **Cache invariants** | `config:world_signature.{palette,interpretation,stage}` + `world_signature:embed` | + `world_signature:beacons` tag, busted by Pass 6 and by editor curate actions |
| **Client projection** | `projectMds3D`, `projectAnchored` | + `projectGravitational(embeddings, basePositions, beacons, λ, τ)` |
| **Renderer** | crystals/orbs/rings + zodiac + fuzzy regions | + beacon meshes (size ∝ √mass, glow ∝ mass, color from source) |
| **Editor write path** | `/world/edit/{config,interpretation,stage}` | + `/world/edit/beacons/{slug}/{action}` — actions are `override`, `suppress`, `unsuppress`, `delete` |

`WorldSearchClient` gains:

- `listBeacons(atmosphere)` — read the active atmosphere's
  beacons, server-side filtering on `suppressed: false`.
- `upsertBeacon(beacon)` — used by Pass 6 (discovered) and by the
  editor's `authored` writes.
- `mutateBeaconOverride(id, patch)` — editor curate action.
- `deleteBeacon(id)` — for authored beacons only; discovered
  beacons are suppressed, not deleted, so re-polling doesn't
  resurrect them.

---

## 8. Editor UX — curating, not authoring

A new **"Beacons"** section in the Stage panel. The list view
shows discovered beacons sorted by mass descending:

```
[●] Antigua, Guatemala        38 nodes  ████████░░  ▒
[●] Fermentation              22 nodes  █████░░░░░  ▒
[●] Sierra Madre              19 nodes  ████░░░░░░  ▒
[●] Cooperative economics     14 nodes  ███░░░░░░░
[●] Carbonic maceration       11 nodes  ██░░░░░░░░
[●] Cupping                    9 nodes  ██░░░░░░░░
...
```

Each row carries:
- The beacon's color swatch
- Label (editor can rename via `label_override`)
- Aligned-node count
- A mass bar
- An eye icon for suppress/unsuppress

Clicking a row opens its detail sub-panel:
- Source (taxonomy term name, author theme string, etc.) — read-only
- Aligned nodes (clickable list — selecting a node teleports the
  camera to it in the world)
- Label override (textbox)
- Color override (color picker)
- Mass override (slider, optional — defaults to "use polled
  mass")
- Position override (3D inputs, optional — defaults to "use
  polled centroid")
- Suppress toggle

Plus, above the list:
- **+ New authored beacon** (the manual-override mode, for
  concepts polling didn't find)
- **λ pull strength** (global, slider 0–1)
- **τ temperature** (global, slider 1–20)
- **Re-poll** button (forces an out-of-band Pass 6 without a full
  embed — useful when the editor's overrides should propagate
  without re-embedding)

**Staleness signals**:
- "Beacons polled N hours ago" — when content has been added
  since the last polling, surface a `polledAt < latestNodeChange`
  banner with a "Re-poll" affordance.
- When a beacon's `label_override` changes, no re-embed is
  needed (override is render-time only).
- When the beacon's source candidate disappears (e.g. an author
  removed a theme), the next Pass 6 will not re-mint it; the
  beacon's row in the panel will show "source removed — beacon
  preserved" and the editor can delete it explicitly.

---

## 9. Honest limits

- **TF-IDF still caps the ceiling.** The dev embedding provider
  finds presence (taxonomy / author themes) honestly, but its
  *relevance* polling — cos sim with embedding-of-prose — produces
  weak signals (per `INTERPRETATION_ENGINE.md` §3 honest limits).
  Discovered beacons from taxonomy/themes work well today;
  pole-derived and n-gram-derived beacons need a neural provider
  to be meaningful.
- **Discovery is not understanding.** Polling finds where the
  corpus gathers, not *why*. A beacon labeled "fermentation" that
  pulls 22 articles is real; whether "fermentation" is the
  editorially-honest label for that gathering is the editor's
  call. The eye on the row exists for exactly this — suppress
  what doesn't read.
- **Candidate sources compete.** A taxonomy term and an author
  theme can both produce beacons over near-identical aligned
  sets. The pipeline deduplicates by alignment-set overlap
  (default ≥0.75 Jaccard → merge; lower-mass beacon suppressed
  automatically and the editor is notified).
- **Position centroids drift across embed passes.** Re-polling
  recomputes positions; absent an override, a beacon moves as
  the corpus shifts. This is correct behavior — the visible
  cluster *did* shift — but it can disorient editors who expect
  beacons to stay put. Position overrides are the lock.

---

## 10. Implementation phases

Each phase independently shippable. Phases 1–2 prove the thesis;
phases 3–4 build the editor surface.

1. **Phase 1 — Mongo + Pass 5/6 + snapshot.** New `beacons`
   collection. Two candidate sources: taxonomy terms and author
   themes (the highest-signal pair under the dev TF-IDF). Pass 5
   enumerates candidates; Pass 6 polls + writes beacons. Snapshot
   ships `world.beacons` with the curated, non-suppressed set.
2. **Phase 2 — client projection + beacon visual.** `projectGravitational`
   slots between anchored-axes and final `worldPos`. Beacon
   meshes (glowing spheres with size ∝ √mass) render at the 3D
   positions. No editor surface yet — *the layout itself shows
   whether the polling found real structure*. If the corpus
   clusters visibly, Phase 3 ships.
3. **Phase 3 — editor curation panel.** Stage panel "Beacons"
   section: list, suppress/promote, label/color/mass/position
   overrides. `/world/edit/beacons/...` endpoints. Re-poll button
   and staleness signals.
4. **Phase 4 — pole sources + frequent n-grams.** Add the
   pole-derived candidate source (uses interpretation axes' poles).
   Add the n-gram candidate source (light NER + frequency
   ranking, bounded scope). These activate properly only with a
   neural embedding provider — until then they're TF-IDF
   curiosities.

Phase 1 is the leverage slice. Once `world.beacons` is in the
snapshot and `projectGravitational` is in the projector, the
*visible* hypothesis is testable: does the corpus produce
recognisable clusters around its own taxonomy? If so, the
data-polled paradigm is real and we ship the editor. If not, the
TF-IDF ceiling has been reached and the next step is the
neural-provider flip.

---

## 11. Open questions

- **O-B1 — overlap as commonality.** When two beacons of unrelated
  semantic kind (taxonomy term + author theme) pull substantially
  overlapping aligned sets, the *intersection* is where the
  emergent commonality lives. The fuzzy region spheres shipped in
  v3 already show this visually for taxonomy sectors; extending
  the same overlap-as-commonality rendering to beacon
  intersections would let editors see "articles tagged Antigua
  AND written by Diego Pavón" as a glowing intersection without
  any extra query work.
- **O-B2 — anti-beacons (negative mass).** A beacon with mass `<
  0` repels content. Used to push a recognised but unwanted
  cluster out of the visual centre. Math works without changes;
  UX needs a separate affordance.
- **O-B3 — beacon-to-beacon repulsion.** Two beacons whose
  polled centroids land near each other (the data clusters them
  similarly) will visually collide. A one-time auto-layout assist
  on Pass 6 can spread them along their first principal axis of
  difference. Different from per-frame force simulation, which is
  the wrong default.
- **O-B4 — Cross-atmosphere beacon families.** A beacon for
  "Antigua" exists in inner-mind. The forest atmosphere may want
  its own "Antigua" beacon with the same source candidate but
  different visual encoding. The current shape supports it
  (separate documents per atmosphere); the editor needs an
  affordance to clone-with-overrides across atmospheres.
- **O-B5 — Polling as a continuous process.** Today Pass 6 runs
  on demand (embed pass or re-poll button). A reasonable v2
  upgrade is a debounced background polling triggered by node
  create/update/delete hooks, so beacons stay current without
  explicit operator intent. The Mongo writes are cheap; the
  question is whether the visual recompute should happen live.
