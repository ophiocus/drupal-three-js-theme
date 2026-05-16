# Forest atmosphere

**Tagline:** the world is a living forest at the hour just before dusk.

A first-pilot atmosphere. Trees as articles, woodland spirits as
profiles, clearings with standing stones as events. Light filters
in shafts; the canopy moves; small things rustle and the air
holds.

## Mood

- calm
- watchful
- saturated (deep greens, warm ambers, low blue-violet shadows)
- old (everything looks like it has been here longer than the visitor)
- patient (no urgency in the camera, no urgency in the lighting)

## Palette overrides

Extends `world_signature.palette` with the following adjustments
(stage-2 mapping will resolve which biome inherits which overrides
once the cypher publishes a forest-aware snapshot):

| Field | Default ALPHA | Forest override |
|---|---|---|
| `background` | `#d0dce6` (pale blue) | `#1d2a1f` (deep forest dusk) |
| `fog.color` | `#c8d8e0` | `#2a3a30` (mist among trunks) |
| `fog.near` / `far` | `80` / `500` | `40` / `380` (closer fog — canopy depth) |
| `ambient.color` | `#e8efe9` | `#c8d2a0` (golden-green) |
| `ambient.intensity` | `0.85` | `0.55` (forest filters light) |
| `sun.color` | `#fffae0` | `#ffe2a0` (low golden) |
| `sun.position` | `[80, 120, 60]` | `[120, 80, 40]` (lower angle — dusk) |
| `ground.color` | `#c4dec4` | `#3a4a2a` (leaf litter brown-green) |
| `bundleColors.article` | `#8eb887` | `#5a7a3a` (oak-leaf green) |
| `bundleColors.profile` | `#92aabe` | `#7a5a3a` (warm sapling bark) |
| `bundleColors.event` | `#d8d098` | `#8a6a40` (standing-stone bronze) |

The biome overlays (Antigua, Cauca, Boquete, Sierra Madre,
Tarrazú from the atlas_coffee corpus) continue to blend on top
of these baselines — Antigua's golden warmth still pushes the
ambient toward `#f0e8c8`; Boquete's cool blue-grey still
shifts fog toward `#b8c4cc`. The forest atmosphere just shifts
the *starting place* for those blends.

## Key visual motifs

- **Trees of varied species.** Not topiary; rough canopy
  variation. Different word-counts yield different trees (small
  brush → saplings; long-form essays → mature oaks). Trunks are
  visibly woody; canopies are clumped, not perfectly conical.
- **Forest floor** with leaf litter and exposed roots near the
  larger trunks. The ground plane is no longer a flat color —
  it carries texture.
- **Drifting motes** of pollen / firefly hints. Subtle particle
  layer at mid-height. Reads as "the air has weight."
- **Distant fog band** at horizon. The world is not infinite —
  there's a treeline you can't see past. Reinforces "you are
  somewhere specific" rather than "you are in a void."
- **Mushrooms, ferns, stones** as decorative ground clutter
  near sector centroids. Sparse — every clutter element is
  noticed individually.
- **No sky.** A canopy ceiling. The user looking up sees layered
  leaves, not stars. This is the strongest "forest, not field"
  cue.

## Audio motifs (deferred to v0.2+)

Recorded as intent so future audio work has direction:

- **Birdsong** — sparse, distance-attenuated. Different species
  in different biomes. Antigua: brown jay. Boquete: resplendent
  quetzal. Cauca: Andean cock-of-the-rock.
- **Wind in canopy** — base ambient layer. Loops at ~30s with
  slight pitch variation. Intensity tied to camera height
  (higher = more wind).
- **Distant water** — barely audible. Reinforces "old, lived-in
  place."
- **Footstep proxy** — when the user navigates via Tab/numkeys,
  a soft leaf-rustle plays. Establishes that navigation IS
  movement, even though the camera teleports rather than walks.

## Inspiration references

(Editorial freeform — replace with actual links once curated.)

- *Hayao Miyazaki* — Princess Mononoke's forest scenes:
  saturation + texture density + reverent quietness.
- *Annihilation (2018, Alex Garland)* — the alien forest's
  refractive light; less the horror, more the *otherness* of
  a familiar form.
- *Studio Ghibli's My Neighbor Totoro* — the camphor tree's
  scale; the *bigness* of a single tree as a presence.
- *Real-world Bosque de Niebla* (Mexican cloud forest, Veracruz)
  — moss thickness, low fog, sound texture.
- *Caspar David Friedrich's forest paintings* — composition,
  the way trunks frame distance, low warm light from beyond.

## Editorial alignment with the atlas_coffee subject

The atlas_coffee subject (`docs/SUBJECT.md`) is atmospheric Latin
American coffee culture — coffee grows in *forest-adjacent*
agroforestry systems across all five regions in the corpus. The
forest atmosphere is editorially apt for coffee content: the
viewer is, metaphorically, walking through a coffee farm's
shade canopy. Each article is a tree the viewer encounters; each
producer profile is a presence among the trees.

This is not a contractual binding. Other atmospheres (outer
space, inner mind) remain valid for atlas_coffee — they'd just
recast the same content into a different metaphor. Forest is
the natural-first pilot because the metaphor is closest to the
subject's source-of-truth.

## Status

| Stage | Status |
|---|---|
| 1 Charter | **editorial review approved 2026-05-14 (Carlos) — A1 closed** |
| 2 Mapping | drafted in `mappings.yml`; editorial review approved 2026-05-14 (Carlos) — A1 closed |
| 3 Inventory | generated in `assets-needed.yml` |
| 4 Acquisition | `asset-log.yml` template ready; MCPs pending; entries `status: pending` |
| 5 Processing | deferred until stage 4 completes |
| 6 Integration | `ArticleAsTree` + scenery + pollen shipped (v0.2.1); ProfileAsSpirit / EventAsTotem held per Q2 |
