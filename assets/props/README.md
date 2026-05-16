# `assets/props/` — the prop curation library

This folder is where real `.glb` assets land before the renderer
loads them. Today it holds curation notes; tomorrow it holds the
.glb files themselves alongside their license docs and preview
renders.

The mental model: **the renderer asks for a prop by name; the
atmosphere's `mappings.yml` declares which prop fills each slot;
this folder is the inventory the mappings draw from.** A prop here
isn't bound to any single atmosphere — `oak-stylized.glb` could
serve the forest atmosphere today and a different atmosphere
tomorrow. The folder is *general*, the atmosphere is *specific*.

## What "curation" means here

Two stages, deliberately separate:

1. **Shortlisting** — a candidate appears in `CANDIDATES.md` with
   its source URL, license, polycount, file size, dimensions, and
   a one-line note on fit. No download yet. Anyone (you, me, a
   future collaborator) can review and approve.

2. **Acquisition** — once approved, the .glb file lands in a
   per-prop subfolder alongside a `LICENSE.txt` (verbatim from
   source), `SOURCE.md` (URL + author + date + version), and an
   optional `preview.png`. The prop is now usable. Atmospheres
   reference it by its folder name.

The stages are separate so that "shopping" doesn't drag in a 50
MB CC-BY-NC mesh by accident. The shortlist is reviewable, the
acquisition is intentional.

## Folder layout (once populated)

```
assets/props/
  README.md                    # this file
  CANDIDATES.md                # the shortlist, organized by prop slot
  standing-stone/
    standing-stone.glb         # the chosen asset
    LICENSE.txt                # verbatim license from source
    SOURCE.md                  # provenance: URL, author, date, version
    preview.png                # optional preview render
  sapling-figure/
    ...
  oak-stylized/
    ...
```

A prop subfolder exists only after acquisition; the catalog
contains many candidates per slot but only one (or two — A/B
testing) lands as the actual asset.

## License rules

| Tier | Action |
| --- | --- |
| CC0 / Public domain | Free use. Drop in. Note source in `SOURCE.md`. |
| CC-BY | Allowed. Attribution required in `SOURCE.md` AND in a runtime credits surface (a "World Credits" card the renderer eventually exposes). |
| CC-BY-SA | Avoid. Share-alike infects the whole bundle. |
| CC-BY-NC | **Not allowed.** Properties using this theme may be commercial; NC poisons that. |
| Sketchfab "Standard" / itch.io paid / commercial-marketplace | Case-by-case, requires explicit license purchase recorded in `SOURCE.md`. |

When in doubt, prefer CC0. The Quaternius / KayKit / Eclair Assets
catalogs covered below are uniformly CC0 and should be the default
hunting ground.

## How the renderer loads a prop

Builders ask `ctx.assetUrl('props/<slot>/<slot>.glb')` and the
helper resolves to `/themes/custom/drupal_threejs/assets/props/<slot>/<slot>.glb`
in the browser. The build step (Vite or a small `cp -r`) is
responsible for materializing `assets/props/` into the theme's
public assets dir; the source-of-truth lives here.

Until a prop's .glb lands, builders use their primitive fallback
(see `mappings.yml` `geometry_fallback`). The acquisition stage
is what flips a slot from primitive → real asset.

## How to add a new prop slot

1. The atmosphere's `mappings.yml` declares the slot
   (`geometry_source: 'glb:<name>.glb'`, plus
   `geometry_fallback: 'primitive:<shape>'`).
2. A `CANDIDATES.md` section appears here with 3–6 sourced
   candidates.
3. After review, one candidate is acquired into a subfolder.
4. The builder's primitive path stays in place forever as the
   pre-asset fallback — primitives never get deleted, only
   visually outclassed.

## See also

- `docs/ATMOSPHERES.md` — the six-stage pipeline; this folder is
  the deliverable of Stage 4 (Acquisition).
- `docs/atmospheres/<name>/mappings.yml` — declares which props
  each atmosphere needs.
- `docs/atmospheres/<name>/assets-needed.yml` — the older
  per-atmosphere asset checklist. As of v0.3.x this points at
  `assets/props/CANDIDATES.md` for the curation work; the
  per-atmosphere file remains the slot-to-prop binding table.
