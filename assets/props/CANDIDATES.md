# `CANDIDATES.md` — the prop shortlist

Curated 2026-05-16 by Claude during v0.3.x. Each prop slot lists
3–6 candidates with source, license, format, size estimate, and a
one-line fit note. Approve a candidate by moving it to its own
subfolder per `README.md`'s acquisition protocol.

License legend:
- **CC0** — public domain, drop in, note source.
- **CC-BY** — allowed with attribution.
- **CC-BY-NC** — **forbidden** (commercial use blocked).
- **CC-BY-SA** — avoid (share-alike infects the bundle).
- **Standard** (Sketchfab) — case-by-case, paid asset.
- **?** — license unverified at curation time; verify before
  acquisition.

---

## Slot: `standing-stone` (for `EventAsTotem`)

**Aesthetic intent:** Mesoamerican stela or megalithic marker —
flat slab or squat stone, faceted edges, clear "marker that
something happened here" reading. Ties to atlas_coffee's Latin
American coffee subject. Should NOT read as a smooth tapered
column (v0.3.0 primitive's failure mode).

**Approximate dimensions wanted:** 2–4 m tall, 0.6–1.5 m wide,
clearly wider at base than top OR clearly rectangular slab.

| # | Source | License | Notes |
| --- | --- | --- | --- |
| S1 | [Sketchfab tag: **menhir**](https://sketchfab.com/tags/menhir) | mixed (per-asset) | Best hunting ground for individual megaliths. Filter by "Downloadable" + CC0 to narrow. Several photogrammetry scans of real menhirs available; high-poly but decimate-friendly. |
| S2 | [Sketchfab tag: **dolmen**](https://sketchfab.com/tags/dolmen) | mixed (per-asset) | Stacked-stone variant. If we want a clearly architectural marker (slab on uprights), this is the right shape language. |
| S3 | [Sketchfab tag: **mayan-culture**](https://sketchfab.com/tags/mayan-culture) | mixed (per-asset) | Mesoamerican stela, glyphs, and pyramid models. Subject-fit is perfect; license check is per-asset. |
| S4 | [Sketchfab — *Stylized Mystical Stone*](https://sketchfab.com/3d-models/stylized-mystical-stone-low-poly-free-89c8b43df46942d7b171702e45751e33) | ? (free download, verify CC0) | Single mystical stone with baked normals. Promising if the license clears — would need scaling to "marker" size rather than the cinematic prop it's authored as. |
| S5 | [Sketchfab — *Stylized low-poly stone*](https://sketchfab.com/3d-models/stylized-low-poly-stone-c7de83088a904a1a8b7420b00d395dec) | ? (free download, verify CC0) | Generic stone — too rounded for a stela reading, but useful as scenery filler in the same pull. |
| S6 | **Custom (Blender, in-house)** | CC0 | Honest option: a 30-minute hand-modeled stela slab with the right proportions and a single material slot would beat any of the above for art-direction control. Park as a fallback if the Sketchfab pulls disappoint. |

**Recommendation:** Start by browsing **S3** (mayan-culture tag)
for stela that download as .glb under CC0 or CC-BY. If nothing
fits, fall back to **S1** (menhir tag) for a more generic
standing-stone reading. **S6** (in-house model) is the always-on
escape hatch — and per `docs/atmospheres/forest/CHARTER.md` the
in-house option preserves the most art-direction control.

---

## Slot: `sapling-figure` (for `ProfileAsSpirit`)

**Aesthetic intent:** Stylized humanoid figure — readable as a
person, not necessarily detailed. Slightly smaller than article
trees (~2.5–5.5 m). Could lean realistic-stylized (KayKit
adventurer) or abstract (a wooden silhouette, a sapling that
suggests a person). For a "spirit in the forest" reading the
abstract option is more atmospheric, but it costs custom work.

**Approximate dimensions wanted:** 2.5–5.5 m tall, biped, optional
T-pose or relaxed-stand. Rigging not required for v0.3.x but a
clean rig opens future animation work.

| # | Source | License | Notes |
| --- | --- | --- | --- |
| P1 | [**KayKit — Character Pack: Adventurers**](https://kaylousberg.itch.io/kaykit-adventurers) | CC0 | Three rigged stylized low-poly humanoids in .GLB. Production-quality, exceptional fit for "stylized but readable." Probably overkill for a profile silhouette but the bar it sets is real. |
| P2 | [**KayKit — Forest Nature Pack**](https://kaylousberg.itch.io/kaykit-forest) | CC0 | Includes nature props *plus* characters; double duty. Worth grabbing for scenery alone, and may include suitable humanoid silhouettes. |
| P3 | [poly.pizza — People & Characters](https://poly.pizza/explore/People-and-Characters) | mostly CC0 | Aggregator. Quaternius, KayKit, and others all surface here with consistent CC0 labelling. Good for browsing many silhouettes at a glance. |
| P4 | [itch.io — *Adventure Character Pack* (standout7)](https://standout7.itch.io/adventure-character-pack) | CC0 | Three fully rigged stylized low-poly heroes in GLB. Direct alternative to KayKit if a different art-direction is wanted. |
| P5 | [OpenGameArt — *CC0 ASSETS 3D LOW POLY*](https://opengameart.org/content/cc0-assets-3d-low-poly) | CC0 | Older, scrappier, but reliably free. Worth searching if the stylized aesthetic doesn't fit and a more abstract figure is wanted. |
| P6 | [BlenderKit — *Stylized Character (Lowpoly)*](https://www.blenderkit.com/asset-gallery-detail/51c999aa-b0d9-4bbd-a121-1ed7a08da945/) | ? (BlenderKit subscription) | Production-grade fantasy hero. License likely paid; included as the "what would polished look like" reference, not a recommendation. |

**Recommendation:** Start with **P1** (KayKit Adventurers) for the
fully-realised humanoid; pair with **P2** (KayKit Forest) for the
scenery work below. KayKit's aesthetic — stylized low-poly with
restrained palette — is an unusually clean fit for the forest
atmosphere's CHARTER (deep-forest dusk, calm readability).

---

## Slot: `oak-stylized` (for `ArticleAsTree`)

**Aesthetic intent:** Stylized tree, animal-crossing readable.
Variant species (multiple trees in one pack) so a sector populated
with 11 articles doesn't look like a clone forest. Height varies
per article word-count; the geometry needs to scale cleanly
without exposing UV stretching.

**Approximate dimensions wanted:** Base size ~5 m tall, scalable
2–7× by the builder. Multiple species ideal.

| # | Source | License | Notes |
| --- | --- | --- | --- |
| T1 | [**Quaternius — Stylized Tree Pack**](https://quaternius.com/packs/stylizedtree.html) | CC0 | Animal Crossing–style stylized trees. Multiple species in one pack. The canonical answer for this slot. .FBX/.OBJ/.Blend; convert to .glb via Blender export. |
| T2 | [**Quaternius — 150+ LowPoly Nature Models**](https://quaternius.itch.io/150-lowpoly-nature-models) | CC0 | Mega-pack: trees + plants + rocks + props. Probably overlapping with the Ultimate Stylized Nature Pack but the older 150+ pack has classics worth keeping. |
| T3 | [**Quaternius — Ultimate Stylized Nature Pack**](https://poly.pizza/bundle/Ultimate-Stylized-Nature-Pack-zyIyYd9yGr) | CC0 | 60+ nature assets, FBX + GLB, normal-mapped textures. Single best value of the three Quaternius packs for our needs — covers trees AND scenery in one bundle. |
| T4 | [Quaternius — Textured LowPoly Trees](https://quaternius.itch.io/textured-lowpoly-trees) | CC0 | 45 tree models, more variety than the stylized pack alone. Use as overflow if T1's species count feels limited. |
| T5 | [OpenGameArt — *Low Poly Nature Pack 1*](https://opengameart.org/content/low-poly-nature-pack-1) | mixed (verify) | Alternative aesthetic — slightly more "indie game" than Quaternius's polish. Useful if a less-uniform forest is wanted. |

**Recommendation:** **T3** (Ultimate Stylized Nature Pack)
covers the most ground in one pull — trees AND scenery props AND
already .glb. Likely the single highest-value acquisition in this
whole catalog.

---

## Slot: `forest-scenery` (mushroom / fern / stone — for `scenery.ts`)

**Aesthetic intent:** Decorative ground props clustered near
sector centroids. Currently primitives (red cone mushroom, thin
green cone fern, squashed icosahedron stone). Real assets would
upgrade scenery from "OK" to "lived-in."

**Per-sector density target:** ~6 mushrooms + 4 ferns + 3 stones
(already implemented in `scenery.ts`; the asset swap is geometry-only).

| # | Source | License | Notes |
| --- | --- | --- | --- |
| F1 | [**KayKit — Forest Nature Pack**](https://kaylousberg.itch.io/kaykit-forest) | CC0 | 100+ models: mushrooms, ferns, rocks, fallen logs, flowers. The single best fit for `scenery.ts`'s slots in one pull. .GLB included. |
| F2 | [**Eclair Assets — Nature Kit GLB Pack (329 models)**](https://eclair-assets.itch.io/nature-kit-glb-pack-329-free-cc0-3d-models) | CC0 | 329 nature models, GLB-ready. Massive variety; the "if KayKit isn't quite right, this almost certainly is" backup. |
| F3 | [**Quaternius — Ultimate Stylized Nature Pack**](https://poly.pizza/bundle/Ultimate-Stylized-Nature-Pack-zyIyYd9yGr) | CC0 | Same recommendation as T3 above — overlaps with this slot. If you acquire it for trees you've got most scenery covered too. |
| F4 | [OpenGameArt — *CC0 Nature*](https://opengameart.org/content/cc0-nature) | CC0 | Older but reliable. Worth checking for specific items KayKit might lack (broad-leaf tropical plants in particular — cloud-forest specific). |
| F5 | [Sketchfab — *Low Poly Forest Pack (RenderHaven)*](https://sketchfab.com/3d-models/low-poly-forest-pack-free-3d-models-b17884c5fa7942fb97b48e1fb7d81ba5) | ? (verify) | Trees + logs + mushrooms + rocks bundle. License check needed. |
| F6 | [Sketchfab — *Free Low Poly Forest (purepoly)*](https://sketchfab.com/3d-models/free-low-poly-forest-6dc8c85121234cb59dbd53a673fa2b8f) | ? (verify) | Whole-forest pack; could provide silhouette anchors for the sector environment. |

**Recommendation:** **F1** (KayKit Forest Nature Pack) is the
clear winner — production-quality CC0 in the exact aesthetic the
atmosphere wants. **F2** (Eclair) is the variety backstop.

---

## Approval workflow

When you're ready to pull a candidate:

1. Move it from this file's table to a `[x] ACQUIRED` row.
2. Create `assets/props/<slot>/` with the .glb, `LICENSE.txt`,
   `SOURCE.md` (URL + author + date pulled + version).
3. Update the atmosphere's `mappings.yml` so
   `geometry_source: 'glb:<slot>/<slot>.glb'` resolves; the
   builder's primitive path remains as `geometry_fallback`.
4. Rebuild (`npm run build`) and reload the site.

The primitive is never deleted — it stays as the pre-asset
fallback forever. New atmospheres without their own assets get
the same primitive treatment by default; only the forest
atmosphere (where the pack lands) sees real glb.

---

## Quick-glance summary

If you want to pull the single highest-impact bundle right now,
the answer is unambiguous:

> **[Quaternius — Ultimate Stylized Nature Pack](https://poly.pizza/bundle/Ultimate-Stylized-Nature-Pack-zyIyYd9yGr) + [KayKit — Forest Nature Pack](https://kaylousberg.itch.io/kaykit-forest)**
>
> Two CC0 packs. Between them they cover trees, scenery (mushrooms,
> ferns, stones), and likely a usable humanoid silhouette. Standing
> stones still want a separate pull (Sketchfab mayan-culture or an
> in-house Blender model). Total estimated download: ~50–100 MB
> source; ~5–20 MB after asset selection + LOD pass.

The standing-stone slot is the only one where the answer isn't
obvious — that's the slot most likely to want either a custom
Blender model (for tight art direction) or a specific Sketchfab
hand-pick (for cultural specificity). The rest of the prop slots
are covered by the two recommended packs.
