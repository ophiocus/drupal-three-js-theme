# Asset ingestion

**Status:** proposed
**Relates to:** ALPHA 1 / Track A.1 (asset acquisition pass) ·
`docs/FEATURE_MAP.md` §D "Acquisition automation" ·
`docs/MILESTONES.md`

## Summary

Point the module at an online asset file URL. It **leeches** the file,
**decompresses** it according to its source format, **extracts** the
mesh binary the renderer can use, and **creates the asset card** —
the `asset` content node, wired to its `pack`, with the binary
attached and metadata filled in. *Find and import only* — no mesh
transformation in this iteration (normalisation, re-pivot, rescale,
decimation are a future headless-Blender stage).

This automates the manual click-through that A.1 currently is:
today an editor downloads a pack by hand, unzips it, finds the `.glb`,
uploads it, and creates the asset node field-by-field. This feature
collapses that to one action against a URL.

## Motivation

A.1 is documented as *partial*: ingestion scaffolding exists
(`scaffold/attach-pack-file.php`, `print-pack-checklist.php`) and the
catalog is seeded, but every actual file lands by hand. The slow part
isn't curation (that's deliberately human) — it's the mechanical
fetch-unzip-find-upload-create loop. That loop is automatable for any
**direct, leechable URL**.

Note the distinction from the earlier "automated WebFetch is
infeasible" finding: that was about *scraping JS-gated catalog pages*
(Sketchfab, BlenderKit). This feature does not scrape — it leeches a
**direct asset/archive URL** the human has already located. Gated
sources stay manual; everything with a real download link automates.

## Scope

### In scope (this iteration — "find and import")

1. Accept a direct URL to an asset file or archive.
2. Download it (server-side, Guzzle), with safety limits.
3. Detect the container format from extension + magic bytes.
4. Decompress archives (`.zip`, `.tar.gz`, …) and walk their contents.
5. Identify renderer-usable binaries (`.glb`, `.gltf`(+`.bin`)).
6. Persist the raw download against a `pack` node.
7. Create one `asset` node per extracted mesh, linked to the pack,
   with available metadata populated and status set.

### Explicitly out of scope (deferred)

- **Any mesh transformation** — re-pivot, rescale to 1m=1unit,
  single-material merge, polycount decimation, `.fbx`/`.obj`/`.blend`
  → `.glb` conversion. These need a headless mesh toolchain
  (Blender `--background --python`, or `gltf-transform`) and are a
  separate future stage. Until then, only formats already usable by
  the renderer (`.glb`/`.gltf`) are extracted; other formats are
  retained raw on the pack but produce no asset card.
- **Scraping gated pages** (Sketchfab JS gate, BlenderKit paywall) —
  remains a manual click-through producing a direct URL to feed here.
- **Auto-curation / auto-mark-live** — curation stays a human task
  (per the standing principle "retain raw in any shape received,
  leave curated to be a human task"). Ingestion produces `acquired`
  assets; a human curates and promotes to `live`.

## Pipeline

```
URL ──▶ leech ──▶ decompress ──▶ extract ──▶ create card(s)
        (Guzzle)   (per source)   (.glb/.gltf)  (asset nodes + pack)
```

### 1. Leech

- `GET` the URL via Guzzle with: a hard **size cap** (e.g. 250 MB,
  configurable), a **timeout**, a **content-type sniff**, and a
  redirect limit.
- Stream to a temp file (don't buffer a 200 MB archive in memory).
- Capture provenance: final URL (post-redirect), content-type,
  byte size, fetch timestamp, ETag/Last-Modified if present.

### 2. Decompress (per source)

Dispatch on detected format:

| Container | Handling |
| --- | --- |
| `.glb` (direct) | No decompression; single binary, one asset. |
| `.gltf` + sidecar `.bin`/textures | Keep the set together; treat as one asset. |
| `.zip` | Extract; walk the tree for `.glb`/`.gltf`. |
| `.tar`, `.tar.gz`, `.tgz` | Extract; walk. |
| `.7z`, `.rar` | Out of scope v1 (needs extra deps); log + skip. |
| `.fbx`, `.obj`, `.blend` | Retained raw on pack; **no** asset card (needs the future transform stage). |

"Decompress according to source" = this dispatch table, extensible
per provider quirk (e.g. some packs nest meshes under
`Models/GLB/…`; the walker is recursive so layout doesn't matter).

### 3. Extract

- Recursively collect `.glb` files (and `.gltf` + their referenced
  buffers/images) from the decompressed tree.
- Skip obvious non-scene files (LICENSE, README, previews) — but
  retain them in the raw archive on the pack for provenance.
- De-dup by content hash so re-ingesting the same pack is idempotent.

### 4. Create card(s)

- **Pack node** — find-or-create by source URL. Attach the raw
  download to `field_pack_raw_file`; set `field_pack_source_url`,
  `field_pack_raw_format`, and (if the editor provided them or they
  can be inferred) license + attribution + author. License must
  not be guessed — if unknown, flag the pack for human completion.
- **Asset nodes** — one per extracted mesh:
  - `title` — derived from the filename (humanised), editor-overridable.
  - `field_asset_pack` — the pack node.
  - `field_asset_status` — `acquired` (downloaded, not yet curated).
  - `field_asset_slot` — from the ingest options if supplied, else
    left empty for the human to assign.
  - `field_asset_atmospheres` — from options if supplied, else empty.
  - `field_asset_raw_polycount` — counted from the glTF if cheap to
    parse; else left empty.
  - `field_asset_raw_file` — the extracted binary as received
    (untransformed). `field_asset_curated_file` stays empty until a
    human curates. (O1, resolved below.)

## Technical design (sketch)

- **`AssetIngestor` service** (`src/Service/AssetIngestor.php`) —
  orchestrates leech → decompress → extract → card. Pure of HTTP
  surface; takes `ClientInterface`, `FileSystemInterface`,
  `EntityTypeManagerInterface`, logger. Returns an `IngestResult`
  (pack nid, asset nids, skipped files, warnings).
- **Format handlers** — a small strategy set keyed by container
  type, so new archive/source quirks slot in without touching the
  orchestrator.
- **`drush world:ingest <url>`** — `[--slot=] [--pack=]
  [--atmosphere=] [--license=] [--dry-run]`. The primary v1 surface
  (matches the existing `world:*` command family). `--dry-run`
  reports what *would* be created without writing.
- **Admin form** (later, ALPHA 2 territory) — a "Ingest from URL"
  action on the pack/asset listing that calls the same service.

## Provider layer — SHIPPED

The source-resolution half (a reference → leechable assets + copyright
metadata) is built and live-verified. The leech → decompress →
extract → card pipeline that *consumes* it is the remaining work.

- **`Ingest\SourceAdapterInterface`** + **`SourceAdapterManager`** —
  tagged-service (`world_signature.source_adapter`), priority-ordered;
  the manager routes a reference to the first adapter that `supports()`
  it. Wired order: `polyhaven → ambientcg → toxsam → polypizza →
  direct`.
- **`Ingest\SourceAsset`** — value object carrying `downloadUrl`,
  `format`, `title`, `License`, `attribution`, `author`, `sourceUrl`,
  `packTitle`, `extraFiles` (glTF texture set), `polycount`,
  `previewUrl`. `isPublishable()` is the publish gate.
- **`Ingest\License`** — normalises free-text licences to canonical
  codes and answers `isCommercialSafe()` / `requiresAttribution()` /
  `forbidsDerivatives()` / `permitsLivePromotion()`. The gate:
  promotable only when KNOWN ∧ commercial-safe ∧ allows-derivatives;
  a CC-BY asset without a captured credit line is also blocked.
- **Adapters** (researched API contracts in `asset-ingestion-sources.md`):
  - `PolyHavenAdapter` — `/info/{slug}` + `/files/{slug}`; returns
    glTF + texture `extraFiles`; CC0; author attribution. *Live-verified.*
  - `AmbientCgAdapter` — `full_json?id=…&include=downloadData`; prefers
    `rawLink`; CC0. *Live-verified.*
  - `ToxSamRegistryAdapter` — `data/projects.json` (licence) +
    `data/assets/<project>.json` (`model_file_url`); CC0. *Live-verified.*
  - `PolyPizzaAdapter` — `/v1.1/model/{id}` with `x-auth-token`
    (`WORLD_POLYPIZZA_KEY`); per-model licence. *Field names need a
    live-key pass (@todo in code).*
  - `DirectUrlAdapter` — catch-all for any http(s) URL; licence
    `UNKNOWN` (human must confirm before live).

Tested: `IngestProviderTest` (12 cases — licence normalisation, the
publish gate, DirectUrl parsing, manager priority routing). Probes:
`scaffold/probe-source-adapters.php`, `scaffold/probe-ingest-resolve.php`.

## Security & safety

Downloading arbitrary URLs server-side is a real attack surface —
treat it as such:

- **SSRF guard** — reject internal/loopback/link-local hosts and
  non-http(s) schemes; resolve + re-check after redirects.
- **Size cap + streaming** — hard byte limit; stream to disk; abort
  on overflow. Defends against archive-of-death downloads.
- **Decompression-bomb guard** — cap total extracted size and entry
  count; cap per-entry path depth; reject absolute / `..` paths
  (zip-slip).
- **Content-type / magic-byte check** — don't trust the extension
  alone; verify the bytes before treating something as a `.glb`.
- **License capture, never license invention** — provenance is
  recorded; an unknown license blocks `live` promotion downstream
  (already enforced by the human-curation gate).
- **Permissioned** — the drush command and any future admin action
  require an appropriately privileged user; this is not anonymous.

## Future — middleware transformation

The deferred stage that makes this fully hands-off:

- **Headless Blender** (`blender --background --python normalize.py`)
  or **`gltf-transform`** as a normalisation step between *extract*
  and *create card*: re-pivot to base, rescale to 1m=1unit, merge to
  a single material slot, decimate to a polycount budget, convert
  `.fbx`/`.obj`/`.blend` → `.glb`. Output lands in
  `field_asset_curated_file` and the asset can move toward `curated`
  automatically — but a human still reviews and marks `live`.
- Likely runs as its own queue worker / sidecar container (Blender
  is heavy), not inline in the request.

## Acceptance criteria (v1)

- [ ] `drush world:ingest <direct-glb-url>` creates a pack (raw file
      attached) + one `acquired` asset linked to it.
- [ ] `drush world:ingest <zip-url>` extracts every `.glb` inside and
      creates one `acquired` asset per mesh, all linked to one pack.
- [ ] Re-running the same URL is idempotent (no duplicate assets).
- [ ] `--slot` / `--atmosphere` pre-populate those fields when given.
- [ ] `--dry-run` reports the plan without writing anything.
- [ ] Oversized downloads, zip-slip paths, and internal-host URLs are
      refused with a clear error.
- [ ] Non-`.glb`/`.gltf` formats are retained raw on the pack and
      reported as "needs transform", not silently dropped.

## Open questions

- **O1 — where does the extracted binary live on the asset? RESOLVED:
  new `field_asset_raw_file`.** Ingestion fills `field_asset_raw_file`
  (the mesh as received, untransformed); `field_asset_curated_file`
  stays the human-produced, world-ready `.glb`. Raw is never
  overwritten by curation — provenance preserved. Field shipped as
  config-as-code (`field.storage.node.field_asset_raw_file.yml` +
  `field.field.node.asset.field_asset_raw_file.yml`). The "create
  card" step above writes the extracted binary to this field.
- **O2 — pack granularity.** One pack per source URL, or per
  vendor? Per-URL is simplest and idempotent; revisit if the same
  vendor's many URLs should group.
- **O3 — `.gltf` + external buffers/textures.** Keep as a multi-file
  set, or require `.glb` (self-contained) for v1 and defer loose
  `.gltf`? Self-contained `.glb` is the clean v1 target.
