# The interpretation engine

**Status:** anchored projector activated (2026-05-30); see
`docs/CHANGELOG.md` for the v3 + activation shipping log
**Relates to:** `docs/MILESTONES.md` BETA 2 · `docs/BEACONS.md`
(data-polled gravity attractors, the discrete-point complement to
the directional axes designed here) · `docs/TOOLBOX_AND_STAGE.md`
(editor surface) · `world` content type · atmospheres ·
`web/.../src/Embedding/` · `src/world/runtime/atmospheres/inner-mind/`

> Implementation status (May 2026): MDS-3D projector + anchored
> projector both shipped. EmbedRunner Pass 4 embeds atmosphere pole
> prose and persists per-atmosphere axis vectors (`world_signature.
> interpretation_axes` state); SnapshotPublisher ships them under
> `world.interpretationAxes`; `inner-mind/projection.ts` carries both
> `projectMds3D` and `projectAnchored`; computeLayout branches on
> whether axes are present. The honest TF-IDF caveat (§3) still
> applies — flipping `WORLD_EMBED_URL` to a neural provider is what
> activates authored meaning in the cup, not in code.

> One sentence: **embeddings are a shared geometry of similarity; each world
> imposes a *frame* on that geometry to mint its own meaning.** The embedding
> is the invariant; a world is a lens.

---

## 1. The thesis — substrate vs. frame

An embedding encodes one thing: *these two items are alike*, as distance. It is
**frame-free** — it has no up, no named axes, no notion of which cluster is
"grief." So:

- **Extractable** (geometry over similarity): neighborhoods, clusters,
  density, outliers, directions, paths, between-ness.
- **Not extractable**: meaning the model never captured, and *any frame at all*.
  Raw MDS "axis 1" means only "direction of maximum spread."

Therefore embeddings **cannot reinterpret anything by themselves.** Meaning is
**minted** when an interpretation imposes a frame on the geometry:

```
shared embedding substrate  ×  per-world interpretation profile  =  a minted world
```

Open-ended by construction: the *frame* is where authorial intent enters, and
frames are unlimited. This is why the same corpus can be a forest floor and an
orbiting star-system of the mind without re-authoring a single node.

**Architectural consequence:** the interpretation profile is a property of the
**`world`** (content type / atmosphere). "Each world has its own interpretation
of the embedding data" is a first-class principle, not a slogan.

---

## 2. The interpretation profile (the "conditions to mint meaning")

A declarative per-world spec. Strawman shape:

```yaml
interpretation:
  dimensionality: 3            # 2 = ground plane, 3 = volume
  frame:                       # how axes are DERIVED — where meaning is minted
    mode: anchors              # mds | anchors | hybrid
    axes:                      # each axis = a named semantic pole-pair
      - { name: "recollection↔anticipation",
          pole_a: "memory, the past, what was",
          pole_b: "expectation, the future, what comes" }
      - { name: "self↔world",
          pole_a: "the inner self, identity, private feeling",
          pole_b: "the outer world, other people, society" }
      - { name: "order↔dissolution",
          pole_a: "structure, clarity, coherence, reason",
          pole_b: "chaos, dissolution, dream, the unconscious" }
  regions:
    model: fuzzy-spheres       # taxonomy | kmeans | density | fuzzy-spheres
    overlap: commonality       # spheres intersect where members share ground
    threshold: 0.62            # cosine cutoff for "common"
  camera: free-orbit           # ground-vantage | free-orbit
  mapping: { region: sphere-membrane, item: crystal }
```

- **forest** = `{ dim:2, frame:mds, regions:taxonomy, camera:ground-vantage }`
  — the current world.
- **inner-mind** = the spec above.

Same embeddings, different profile, different cosmos.

---

## 3. Minting meaning: anchored axes

Blind MDS gives *spread*, not *meaning*. To mint legible meaning:

1. Choose concept **poles** — just text. This is the designer's frame.
2. Embed each pole with the **same model** that embedded the content.
3. Axis direction = `normalize(embed(pole_a) − embed(pole_b))`.
4. Orthogonalize the axis set (Gram–Schmidt) so correlated poles don't collapse
   into one direction.
5. An item's coordinate on an axis = `dot(itemEmbedding, axisDirection)`.

Now **position means what you chose**: an article high on "recollection,"
pulled toward "world," low on "order." Swap the poles → the identical corpus
re-forms into a different cosmology. Deterministic (fixed poles → fixed
coordinates), so the "URI is a coordinate" invariant survives.

**MDS finds emergent structure; anchors impose authored structure.** A world
may use either, or both (`hybrid`: anchored where defined, MDS for the rest).

### Honest limits
- Anchors only surface meaning the embedding actually captured.
- **The dev `LocalTfIdfEmbeddingProvider` makes anchors weak** — a 3-word pole
  shares few literal tokens with documents, so anchored axes are near-lexical.
  Anchors *shine* with a neural provider (`RemoteEmbeddingProvider`,
  `WORLD_EMBED_*`). The POC therefore ships **MDS-3D as the always-works frame**
  and anchors as the meaning layer that activates with a real model.
- Minted meaning is *suggestive*, not *proof* — a legible arrangement, not a
  truth claim.

---

## 4. Where the work runs (boundary-compliant)

`docs/BOUNDARY.md`: model **inference** is external; the theme **uses** results.
Projection (MDS / dot-products onto axes) is cheap linear algebra, not
inference — fine at the renderer. So:

- **Server** (model lives here): computes content embeddings (already does);
  for an `anchors` profile, embeds the pole phrases and ships the **axis
  direction vectors** in the snapshot. Includes the per-entity embedding vector
  in the snapshot for small corpora (24 entities × N floats is cheap; large
  corpora keep the server-side projection path).
- **Client / atmosphere** (the interpretation): reads embeddings + shipped
  axes, runs the projection its profile dictates, builds regions + camera.
  *The atmosphere module IS the interpretation profile, in code* (POC); the
  declarative profile on the `world` node is the later generalization.

Snapshot additions:
```
world.interpretation = { dimensionality, frame:{mode, axes:[{name}]}, regions, camera }
world.interpretationAxes = [ float[]… ]   // anchor directions, when mode=anchors
entities[id].embedding = float[]          // un-stripped for small corpora
```

---

## 5. Code seams

| Piece | Today | Change |
|---|---|---|
| Embeddings | `EmbeddingManager`, `signature.semantic.embedding` | reused; **stop stripping** in `SnapshotPublisher::buildSnapshot`; embed poles for anchor axes |
| Projection | `SemanticLayoutProjector` (PHP, **2D**, top-2 eigenvectors) | stays for the server 2D path; client gains an `InterpretationProjector` (anchors + MDS-3D) |
| Position | `worldPos {x,z}`, `entityPosition` forces `y=0` | `worldPos {x,y,z}`; `entityPosition` honors `y` (P1 plumbing) |
| Layout owner | `SceneManager.placeEntities` calls `entityPosition` | atmosphere may export `computeLayout(snapshot) → Map<id,Vec3>`; SceneManager consults it first |
| Regions | 2D taxonomy pads | inner-mind: **fuzzy spheres** (3D centroid + spread radius; overlap on commonality) |
| Camera | ground vantages + drag-orbit | per-atmosphere camera strategy; inner-mind = **free-orbit** |

The surreal **zodiac** (`atmospheres/inner-mind/zodiac.ts`) becomes the "fixed
stars" — the unreachable frame around a now-genuinely-3D inner system.

---

## 6. The inner-mind 3D POC — build order

Each slice gated behind the inner-mind profile so **forest is untouched**.

1. **Doc** (this file).
2. **Server data** — un-strip embeddings; ship `world.interpretation` +
   `world.interpretationAxes` for inner-mind.
3. **Client seam** — `computeLayout` hook + 3D `worldPos` plumbing.
4. **Projector** — anchored (with MDS-3D fallback) → 3D positions.
5. **Regions** — fuzzy overlapping spheres.
6. **Camera** — free-orbit; then verify leak-free across switches + commit.

Verification mirrors the switcher: `renderer.info.memory` returns to baseline
across forest⇄inner-mind round-trips; positions deterministic across reloads.

---

## 7. Open questions

- **O-I1 — declarative profile vs. code.** POC hardcodes the inner-mind profile
  in TS. Promote to a field on the `world` node (so non-coders mint
  interpretations) once the shape settles.
- **O-I2 — anchor authoring UX.** Poles are prose today. A future admin lets an
  editor write the poles and preview the re-projection.
- **O-I3 — large corpora.** Shipping raw embeddings doesn't scale; beyond ~a few
  hundred entities, project server-side (as the 2D path does) and ship only
  coordinates + region summaries.
- **O-I4 — neural model in prod.** Anchored axes need it to be meaningful; the
  POC proves the mechanism, a real `WORLD_EMBED_*` model proves the *meaning*.
