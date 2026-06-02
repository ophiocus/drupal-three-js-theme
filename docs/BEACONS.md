# Concept beacons (gravity attractors)

**Status:** design (2026-05-30)
**Relates to:** `docs/INTERPRETATION_ENGINE.md` · `docs/TOOLBOX_AND_STAGE.md` ·
`web/modules/custom/world_signature/` · `src/world/runtime/atmospheres/inner-mind/`

> Anchor axes mint meaning along *directions* — pole_a vs. pole_b.
> Beacons mint meaning at *points* — discrete concepts that pull
> content toward them. Anchors give the world a coordinate frame;
> beacons give it places where things gather.

---

## 1. The thesis — directions and destinations

The interpretation engine (`docs/INTERPRETATION_ENGINE.md`) shipped
two ways to project a corpus into 3D:

| Frame | What it is | What it produces |
|---|---|---|
| **MDS-3D** | the always-works fallback — eigendecomposition of pairwise distances | a cloud whose axes mean only "directions of spread" |
| **Anchored axes** | pole prose embedded, axis = normalize(emb_a − emb_b), Gram–Schmidt orthogonalised | a cloud whose axes mean what the editor named them |

Both produce *axes* — a linear coordinate frame. Both spread content
to fill the available volume because the projection is purely
geometric. They tell you *which direction* a piece of content sits
relative to the named axes, but they don't tell you *what it's
gathering around*.

**Concept beacons fix the gathering.** A beacon is a discrete point
in semantic space, authored by an editor and placed (or
auto-placed) in 3D. Content drifts toward beacons it semantically
resembles. Two pieces of content that both resemble the same beacon
end up *near each other*, near the beacon. That neighborhood is the
emergent quality — it's the visible shape of "these items belong
to the same conceptual territory."

Stacked over the anchored-axes frame, beacons answer the question
the axes can't: **not what the axis is named, but what lives along
it.**

---

## 2. The shape — Mongo as first-class storage

Anchor axes live in Drupal config (the prose) + Drupal State (the
computed vectors). Beacons don't fit that shape: they have prose
*and* a 3D position *and* a color *and* a mass — far more
editor-tunable than a 1D axis pole pair. The right home is Mongo
alongside the descriptors.

A new **`beacons` collection** in the same database as `descriptors`:

```jsonc
{
  "_id":          "atmosphere:inner-mind:beacon:memory",
  "atmosphere":   "inner-mind",         // filter key
  "slug":         "memory",             // human handle
  "name":         "Memory & Loss",      // editor-facing label
  "prose":        "memory, loss, what is gone, the receding past, the weight of years",
  "color":        "#ff66cc",            // tint for the in-world beacon mesh
  "position":     { "x": 0, "y": 45, "z": -90 },  // 3D placement override (null = auto)
  "mass":         1.0,                  // gravitational weight (higher = stronger pull)
  "radius":       45.0,                 // influence radius (units)
  "embedding":    [0.123, ...],         // updated by the embed pass
  "modelVersion": "local-tfidf-fh256-v1",
  "embeddedAt":   1780...
}
```

Why a separate collection, not a sub-document of `descriptors`:

- **Different lifecycle.** Descriptors are content-derived (Drupal
  nodes → DescriptorBuilder → upsert). Beacons are editorial,
  authored in the Stage panel.
- **Different index needs.** The descriptors collection wants a
  vector index for `nearest()`; the beacons collection wants the
  same, but the filter dimensions are different (atmosphere only,
  not bundle / sector).
- **Different write path.** EmbedRunner already orchestrates
  descriptor embedding; it gains a Pass 6 (after the axis Pass 4)
  to embed beacon prose, but the *editor* writes beacons via a new
  PATCH endpoint that the embed pass never touches.

The MongoDB pattern is honest: **content lives in one collection,
the editorial overlay (beacons, future asset attractors, future
forces) lives in siblings.** A future "anti-beacon" (repels
content) is the same shape with a negative mass; a future "drift
field" is a sibling collection with vectors-on-a-grid.

---

## 3. The math — gravitational projection

Each entity has an embedding `e ∈ ℝᵈ` and (from MDS-3D or anchors)
a base 3D position `p₀ ∈ ℝ³`. Each beacon has an embedding `bᵢ ∈ ℝᵈ`,
a 3D position `qᵢ ∈ ℝ³`, and a mass `mᵢ ≥ 0`.

**Affinity** (how much entity *e* feels beacon *bᵢ*):

```
αᵢ(e) = softmax_τ(cos(e, bᵢ) · mᵢ)
      = exp(τ · cos(e, bᵢ) · mᵢ) / Σⱼ exp(τ · cos(e, bⱼ) · mⱼ)
```

`τ` is a temperature: low τ blends, high τ winner-takes-all.

**Projected position** (gravitational pull, blended with the base
projection):

```
p(e) = (1 − λ) · p₀(e) + λ · Σᵢ αᵢ(e) · qᵢ
```

`λ ∈ [0, 1]` is the pull strength — at 0 beacons are decorative,
at 1 the layout is *purely* beacon-driven (anchored axes contribute
nothing). Typical demo value: `λ ≈ 0.6`, `τ ≈ 8`.

Properties:
- Two entities that resemble the same beacon end up *near it*,
  hence near each other. **This is the emergent quality.**
- An entity that resembles two beacons equally lands *between*
  them. The "gravitational well" is the visible commonality.
- Beacons with mass `0` are inert (useful for previews).
- The base projection `p₀` is preserved as a fallback when an
  entity doesn't strongly resemble any beacon (`αᵢ ≈ 1/n`
  uniform → the centroid of beacon positions, blended with `p₀`).

**O(n·d·k)** for `n` entities, `d` dim, `k` beacons. Same order as
the anchored projector. Cheap.

---

## 4. Code seams

| Concern | Today | Beacons change |
|---|---|---|
| **Storage** | `descriptors` collection only | + `beacons` collection (new) |
| **Embed pass** | EmbedRunner Pass 4 (anchor poles) | + Pass 6: read beacons, embed prose, update `embedding` field in Mongo |
| **Snapshot** | ships `world.interpretation` + `world.interpretationAxes` | + `world.beacons` (active atmosphere's beacons) |
| **Cache invariant** | `config:world_signature.interpretation` + `world_signature:embed` | + `world_signature:beacons` tag, invalidated on beacon edit/embed |
| **Client projection** | `projectMds3D` / `projectAnchored` (axes-only) | + `projectGravitational(embeddings, basePositions, beacons, λ, τ)` |
| **Renderer** | crystals/orbs/rings + zodiac + fuzzy regions | + beacon meshes (glowing spheres or hovering glyphs at their 3D positions) |
| **Editor** | atmosphere, palette tints, anchor poles, zodiac placements | + beacons section (name, prose, color, position, mass) |
| **Write path** | `PATCH /world/edit/{config,interpretation,stage}` | + `PATCH /world/edit/beacons` (creates / updates / deletes beacons in Mongo via `WorldSearchClient`) |

The `WorldSearchClient` gains:
- `listBeacons(atmosphere): array` — read all beacons for an atmosphere
- `upsertBeacon(beacon): void` — write/replace a beacon doc
- `deleteBeacon(id): void`
- (already shipped) `nearest(vector, k, filter)` — usable to seed
  a beacon's initial position from the centroid of its nearest
  neighbours

---

## 5. Visual representation

Each beacon renders as a glowing point with optional label and
optional influence-radius wireframe:

- **Sphere** at `qᵢ`, radius proportional to `mass`, color from
  `color`. Material: additive blending, no lighting (it's a
  *signifier*, not an object).
- **Label** floating beside it (HUD-projected): the beacon's
  `name`.
- **Influence wireframe** (optional, editor-only): a translucent
  wireframe sphere at `radius` showing the beacon's reach. Off by
  default; toggled in the Stage panel's beacon section.
- **Pull lines** (optional): faint translucent lines from each
  entity to its strongest-affinity beacon, drawn only above a
  threshold αᵢ ≥ 0.5. Off by default; the visual is loud.

When the editor selects a beacon in the Stage panel, the in-world
mesh pulses gently (scale ±10%, 1.2 s period) so the editor knows
which one they're configuring.

---

## 6. Editor UX (Stage panel additions)

A new **"Beacons"** section appears in the Stage panel when
`world.beacons` is present (i.e. the active atmosphere has any).

For each beacon: a row with the beacon's color swatch, name, and
mass. Click a row to select; a sub-panel slides in with:

- **Name** (text input, ≤80 char)
- **Prose** (textarea, ≤500 char — the embedding source)
- **Color** (color picker)
- **Mass** (slider 0.0–3.0)
- **Radius** (slider 10.0–150.0)
- **Position** (X/Y/Z numeric inputs; or "auto-place from prose
  centroid" button — uses `WorldSearchClient::nearest(embed(prose))`
  to find the 5 closest entities and seed the position at their
  centroid)
- **Delete beacon** (with confirm)

Plus, above the list:
- **+ New beacon** (creates a stub at world origin with mass 1.0)
- **λ pull strength** (slider 0.0–1.0; global to the atmosphere)
- **τ temperature** (slider 1.0–20.0; global to the atmosphere)

Save patches go to `PATCH /world/edit/beacons` (per-beacon, partial)
or `PATCH /world/edit/beacon-globals` (λ, τ). Same `edit world
signature` permission as the rest of the editor surface.

**Staleness**: same pattern as interpretation poles. When a
beacon's `prose` changes, the next snapshot reads a
`prose_updated_at > embeddedAt` and the Stage panel surfaces an
amber "⚠ beacons need re-embed" banner. The existing Re-embed
button covers it.

---

## 7. Honest limits

- **Same neural-vs-TF-IDF caveat as anchor axes** (per
  INTERPRETATION_ENGINE.md §3 "Honest limits"). With the dev
  TF-IDF provider, a beacon's prose shares few literal tokens with
  most documents, so affinity scores cluster narrowly and the
  gravitational pull is muted. With a real neural model, the
  affinities spread and the emergent clusters become visible.
- **Beacons compete.** A corpus with many beacons of similar prose
  produces a confused layout — the gravitational pulls cancel.
  Editorial discipline: 3–7 beacons per atmosphere is the
  sweet spot. The Stage panel can show a warning when affinity
  entropy across beacons collapses (low entropy = beacons too
  redundant).
- **Position authoring is hard.** Editors are good at writing
  prose; they're less good at placing a beacon in 3D space by
  eye. The "auto-place from prose centroid" affordance is the
  primary path. Manual position is the override.
- **Performance**: O(n·d·k). At n=500, d=1024, k=10, that's 5M
  ops/frame *if* re-projected per frame. Don't re-project per
  frame — project once on snapshot ingest, then keep positions
  stable. Drag-in-3D editing of a beacon's position triggers a
  re-projection of the cloud; that's an editor-only event, not a
  hot path.

---

## 8. Implementation phases

Each phase independently shippable. Phase 1 lands the storage and
the math; phases 2-4 build editor + visual on top.

1. **Phase 1 — storage + projection.** `beacons` collection in
   Mongo. `WorldSearchClient::listBeacons / upsertBeacon /
   deleteBeacon`. EmbedRunner Pass 6 (beacon prose → embedding).
   Snapshot ships `world.beacons`. Client `projectGravitational`
   plugs into `inner-mind/index.ts` between the anchored
   projection and the final `worldPos` write. No visual yet — the
   emergent quality shows up purely in entity positions.
2. **Phase 2 — beacon visual.** Glowing spheres at the 3D
   positions. Optional label. Disposable like the rest of the
   atmosphere chrome.
3. **Phase 3 — editor surface.** Stage panel "Beacons" section.
   List + edit + delete + add. `PATCH /world/edit/beacons`.
   Auto-place from prose centroid via `nearest()`.
4. **Phase 4 — affordances.** Pull lines (toggle), influence
   wireframes (toggle), entropy warning, drag-in-3D position
   editing.

Phase 1 alone proves the thesis: spin up the collection, write 3–5
beacons by hand via drush, run the embed pass, reload the world.
If two articles about "fermentation" sit near each other in
the same neighborhood — and away from articles about "cooperative
economics" — the emergent quality is real and we ship the editor.

---

## 9. Open questions

- **O-B1 — auto-discovery of beacons.** Could beacons be
  *inferred* from the corpus rather than authored? K-means
  clustering of embeddings → name each cluster with the highest-
  TF cluster-keyword. Worth prototyping as a "suggest beacons"
  affordance, never as the primary path; the editorial intent of
  beacons is part of their value.
- **O-B2 — anti-beacons.** A beacon with mass `< 0` repels
  content. Useful when an editor wants to push a recognized but
  unwanted cluster (off-topic, deprecated, archived) away from
  the visual centre. Math works without changes; UX needs a
  separate affordance because "negative mass" reads weird in a
  slider.
- **O-B3 — beacon-to-beacon dynamics.** Should beacons influence
  each other's positions? The natural extension is a "constellation"
  layout where beacons mutually repel — preventing two beacons with
  similar prose from collapsing onto the same point. Probably yes,
  but as a one-time auto-layout assist, not a per-frame force.
- **O-B4 — atmosphere portability.** A beacon set is an editorial
  artifact. Exporting and importing them across worlds (or across
  property installs) is a reasonable v2 feature. The Mongo doc
  shape supports it natively — `mongoexport` produces the file,
  another property's editor imports.
