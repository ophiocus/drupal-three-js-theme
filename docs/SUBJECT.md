# `atlas_coffee` — the subject

> **Status:** locked 2026-05-08.
> **Scope:** the editorial property the sandbox is calibrated for, the
> visual vocabulary the renderer is tuned for, the reader profile every
> Sprint 4+ aesthetic decision is made against.

## The decision

- **Property name:** `atlas_coffee` — *Atlas* (the vector search) × *atlas of coffee* (the geographic survey). Latin-American flavour throughout.
- **Topic:** Latin American coffee culture — origins, methods, regions, growers, recipes.
- **Mode** (per the grammar in `docs/EDITORIAL.md`): **atmospheric** — the world is coffee's natural habitat, warm and recognisable.
- **Reader:** a person curious about the *medium* of 3D web. Coffee is the *familiar host*, not the prize.
- **Reader-experience target:** **discovery — of the medium**. The reward isn't a coffee fact; it's the feeling of moving through a world that thinks of itself as a place.

## Three implications

1. **Editorial tone is warm and narrative, not encyclopaedic.** A grower's story, not a cupping protocol. The casual coffee drinker is the implied reader, not the connoisseur.
2. **The reward for moving through the world is feeling the medium, not learning a fact.** Sprint 5 spends real effort on transitions — sector lighting shifts, atmospheric crossfades, the render loop must *feel good* between objects, not just at them.
3. **The first 30 seconds matter disproportionately.** The reader is judging the medium, not the content. ALPHA needs a coherent first-arrival vista even though the full lobby + chatvatar layer waits for v0.0.3.

## Editorial brief — calibrating the corpus

For ALPHA fixtures (Sprint 6 populates these):

| Bundle | Count | Tone |
|---|---|---|
| **Article** *(origin / story / method)* | 8–12 | Narrative, accessible. ~300–600 words. One image, one story, one piece of useful coffee knowledge. |
| **Profile** *(grower / roaster / barista)* | 3–4 | Short bio (~150 words), portrait, links to their coffees. |
| **Event** *(harvest / cupping / festival)* | 2–3 | Date, place, short description, tied to a region. |

Taxonomies:

| Vocabulary | Role | Initial terms |
|---|---|---|
| `region` | Sectors of the world (cardinal placement) | `andes`, `antioquia`, `sierra-nevada`, `caribbean-coast`, `amazonas` |
| `method` | Cross-cutting facet | `washed`, `natural`, `honey`, `anaerobic`, `espresso`, `pour-over`, `cold-brew` |

Total ~20–25 entities. Calibrated against the eight axes (`docs/EDITORIAL.md`):

| Axis | Hit by |
|---|---|
| Cardinality | 20–25 entities, distributed unevenly across 5 regions |
| Diversity | 3 content bundles |
| Structure | Mixed paragraph types per article — text, image, pull-quote, callout |
| Connectivity | Cross-references: by-this-grower, in-this-region, related-method |
| Tagging | Dual-vocabulary (`region` × `method`); a few borderland entities |
| Temporality | Harvest dates spread across 2–3 years; some "evergreen" content untouched, some recent |
| Authorship | 3–4 profiles, each authoring a cluster |
| Form | Image required; one entity with audio (a cupping recording); one with geo coords |

## Visual vocabulary

Atmospheric coffee, tuned for the medium-curious reader:

| Element | Treatment |
|---|---|
| **Palette** | Warm earth — umbers, terracottas, mossy greens. Soft golden-hour default. Wooden surfaces, brass, ceramics, occasional matte black. |
| **Sectors (regions)** | Each region has distinct light + ambient. *Andes:* cool, misty. *Antioquia:* sunny rolling hills. *Sierra Nevada:* stark, dawn-coloured. *Caribbean coast:* humid, bright. *Amazonas:* deep green, afternoon shade. **Walking between regions is a noticeable shift — the discovery moment.** |
| **Trigger pads** | Small ceramic cups or bean clusters. Subtle glow on hover. The activation gesture should feel like *unfolding*, not opening a modal. |
| **FullView card** | DOM overlay. Entry/exit animation matters — page-flip feel, not popup feel. The reader should notice the gesture itself. |
| **Sound** | Optional, quiet, regional. Distant grinders, faint café conversation, occasional bird, market murmur in one sector. Mute toggle visible. |
| **First arrival** | A courtyard / porch overlooking the regions. **The world is the orientation; no menus, no tutorial.** |

## Out of scope for ALPHA

- Drupal Commerce surfaces — no "buy this bag" stalls; BETA territory.
- Multi-property federation — one property only.
- Connoisseur-grade depth — no Q-grader notes, no flavour wheel, no advanced cupping protocol.
- Multilingual — English-core per decision E7; Spanish translation in BETA.
- Search-driven blooming UI — the search service plumbing lands in Sprint 4; blooming in v0.0.2.
- Chatvatars — v0.0.3.
- Real coffee photography — placeholder / stock imagery is fine for ALPHA.

## Naming — property vs. theme

These are deliberately distinct:

| Name | What it refers to |
|---|---|
| `drupal-three-js-theme` | This **repo** — the theme + cypher; reusable across many properties. |
| `world_signature` | The **module** providing the cypher — bundled with the theme. |
| `drupal_threejs` *(Sprint 4)* | The **theme** — Olivero child; generic; theme-shaped; not coffee-specific. |
| **`atlas_coffee`** | This **property** — the editorial subject of the sandbox. Drupal site name; eventually the production deploy's compose-stack name. |

The theme can ship the same code to other properties later; only Atlas Coffee's content + visual config make the world coffee-shaped. Future properties get their own `SUBJECT.md`.

## Where this lives in the docs ecosystem

- `THESIS.md` — what the world *is* (philosophy, platform-agnostic).
- `docs/ARCHITECTURE.md` — how it's *built* (mechanic, platform-agnostic).
- `docs/EDITORIAL.md` — what an *editor* must understand (the eight axes, content-shape-agnostic).
- `docs/SUBJECT.md` — *this file* — what *this* property is, what its world looks like, what's calibrated for.

THESIS, ARCHITECTURE, and EDITORIAL travel with the theme to any property. SUBJECT is property-specific; future properties replace this file with their own.
