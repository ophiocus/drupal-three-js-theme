# v0.4 — "The forest becomes real and gains landmarks"

## Thesis for this release

v0.1 → v0.2 → v0.3 built the *abstraction*: SmartObjects, Atmospheres,
the cypher pipeline, the asset-catalog content model. v0.4 turns
that abstraction into a recognizably *populated* world:

1. **Real assets replace primitives** wherever the catalog has a
   curated `.glb`. Trees become Quaternius stylized trees. Scenery
   becomes KayKit mushrooms and ferns. The world stops looking like
   a Blockout test scene and starts looking like a place.
2. **Framework pages become monuments** — Mission, Vision, Contact
   each get a recognizable world-scale silhouette. The URI-is-a-
   coordinate thesis holds at `/mission`, `/vision`, `/contact`,
   not just at `/node/<id>`.

The two strands are independent (different files, different bundles)
but they ship together because either alone leaves the world feeling
half-finished: a forest with real trees but no landmarks is just
content; a world with landmarks but blockout geometry is still a
prototype.

## Tracks

### Track A — The real .glb pipeline

The infrastructure that lets a curated asset on a Drupal node turn
into a loaded mesh in the browser.

#### A.1 — Asset acquisition pass

For every pack in the Drupal catalog (`/admin/content?type=pack`):

- **Auto-pullable** (Quaternius, OpenGameArt, some itch.io): `curl`
  the raw download, store under `public://assets/packs/`, attach to
  `field_pack_raw_file` on the pack node. Status moves from
  `shortlisted` toward `acquired` on the asset children that point
  at this pack.
- **Manual-only** (Sketchfab JS-gated, BlenderKit paid): produce
  a one-pager with the page URLs so a human can click through.

Output: every CC0 / CC-BY pack we can legally fetch lives on its
node as a real attached file. License notes update where
WebFetch can verify the asset page.

#### A.2 — `/world/snapshot/assets` endpoint

The load-bearing remainder. Without this, the asset catalog content
exists in Drupal but never reaches the renderer — A.3's
`GltfComponent`/`AssetCache` has no payload to consume, A.4's
builder hook-ups have no slot lookup, and "real trees" stays a
future tense.

##### A.2.0 — Transport decision: embed vs sidecar

Two viable shapes. We commit to **(a) embed**:

- **(a) Embed `assets[]` inside `/world/snapshot/full`** —
  one HTTP roundtrip, atomically consistent with `entities` and
  `sectors`, builders read `snapshot.assets` from the same payload
  they already consume. This is the default the renderer sees.
- **(b) Sidecar `/world/snapshot/assets`** — kept as a thin
  diagnostic route returning *only* the `assets[]` block. Editors
  curl it to verify which asset is `live` per slot; ops uses it as
  a smoke probe independent of the entity corpus. Same data,
  different surface. Cheap to maintain because both routes call the
  same builder.

The name "A.2 — `/world/snapshot/assets` endpoint" is retained for
continuity, but the contract the renderer relies on is the
**embedded `assets[]` key in `/world/snapshot/full`**.

##### A.2.1 — Source data (Drupal side)

The asset endpoint reads:

| Field | Shape | Used for |
| --- | --- | --- |
| `node.bundle == 'asset'` | filter | only asset nodes |
| `field_asset_status` → term `live` | filter | only published, wired assets |
| `field_asset_curated_file` (file) | required, non-null | URL + provenance |
| `field_asset_slot` (taxonomy_term `asset_slots`) | required | machine-name `slot` key |
| `field_asset_atmospheres` (list_string, multi) | array | atmosphere eligibility |
| `field_asset_curated_polycount` (int) | optional | `polycount` (renderer LOD hint) |
| `field_asset_curated_pivot` (enum: base/center/custom) | optional, default `base` | `pivot` |
| `field_asset_pack` → `node:pack` | optional reference | pack context |
| pack `field_pack_license` → term | from pack | `license` (term name) |
| pack `field_pack_attribution` (string) | from pack | `attribution` |
| pack `field_pack_source_url` (uri) | from pack | `sourceUrl` for credit links |
| pack title | from pack | `packTitle` |
| pack nid | from pack | `packId` |

The slot taxonomy term's **machine name** (lower-kebab) is the
canonical join key with `atmospheres/forest/mappings.yml`. Use the
term's `name` field directly — slot names are authored as machine
strings (e.g., `oak-stylized`, `standing-stone`), not human labels.

##### A.2.2 — JSON shape (refined)

```json
{
  "version": "v1",
  "generatedAt": 1747000000,
  "world": { "...": "..." },
  "sectors": { "...": "..." },
  "entities": { "...": "..." },
  "assets": [
    {
      "nid": 142,
      "slot": "oak-stylized",
      "atmospheres": ["forest"],
      "curatedFileUrl": "/sites/default/files/assets/curated/2026-05/oak-01.glb",
      "curatedFileSize": 184320,
      "polycount": 3200,
      "pivot": "base",
      "pack": {
        "nid": 7,
        "title": "Quaternius Stylized Tree Pack",
        "license": "CC0",
        "attribution": "",
        "sourceUrl": "https://quaternius.com/packs/stylizedtrees.html"
      }
    }
  ]
}
```

Renderer-facing contract (locked):

- `assets` is **always** an array (never null). Empty array means
  "no live assets" — renderer falls back to primitives across all
  slots, exactly the v0.3 behavior.
- `slot` is a string. Builders look it up via
  `ctx.tryLoadProp(slot)` in A.3.
- `atmospheres` is `string[]`; the renderer intersects this against
  the active atmosphere name. Empty = "universal" (rare; default
  treatment is omit from lookup).
- `curatedFileUrl` is an **absolute path** (`/sites/default/files/...`),
  not a full URL, so the renderer's existing relative-fetch
  pattern works under both bare-host and reverse-proxy deploys.
- `pack` is optional. Omitted when the asset has no `field_asset_pack`
  reference or the pack was deleted between snapshot and serve.

##### A.2.3 — Edge cases (defensive emission)

| Situation | Behavior |
| --- | --- |
| Asset status `live` but `field_asset_curated_file` empty | Log warning via `\Drupal::logger('world_signature')`. Omit from payload. The renderer must never receive `curatedFileUrl: null`. |
| Multiple assets `live` for the same (atmosphere, slot) cell | Sort by `nid` ascending, emit the lowest. Log a `notice` listing the duplicates so the editor sees it in the watchdog. A.5's "Mark live" action prevents this at the editorial layer; the publisher is defensive against hand-edited DBs. |
| Asset has `field_asset_atmospheres == []` | Emit with `atmospheres: []`. Renderer treats as "no atmosphere match" — i.e., never selected. Editor sees the asset is wired but inert until they tick at least one atmosphere. |
| Pack reference points at a deleted/unpublished pack | Emit asset without the `pack` key. Don't 500 the snapshot. |
| Curated file entity exists but the file on disk is gone | Emit with `curatedFileUrl` as Drupal reports it; the renderer's `AssetCache` handles the load error with a primitive fallback. Don't pre-stat in the publisher (avoid filesystem hits on the hot path). |
| Slot term deleted between asset creation and snapshot | Omit asset; warn. An asset without a slot can't be joined to mappings. |

##### A.2.4 — Caching + invalidation

Use `CacheableJsonResponse` and attach `CacheableMetadata` so cache
tags propagate. Tag set:

- `node_list:asset` — any asset add/edit/delete invalidates
- `node_list:pack` — pack metadata changes invalidate
- `taxonomy_term_list:asset_status` — adding new status values invalidates
- `taxonomy_term_list:asset_slots` — adding new slots invalidates
- Per-emitted-asset `node:<nid>` — individual asset edit invalidates
- Per-emitted-pack `node:<nid>` — pack edit invalidates
- `config:world_signature.palette` — atmosphere overlay shifts invalidate

`max-age`: same 60 seconds as `/world/snapshot/full` already uses.
The renderer fetches once per page load; editors hard-refresh after
flipping `live`.

##### A.2.5 — Implementation (reviewable sub-commits)

1. **`AssetSnapshotBuilder` service** — new file
   `src/Service/AssetSnapshotBuilder.php`. Pure data; takes
   `EntityTypeManagerInterface` + `LoggerChannelFactoryInterface`,
   returns `array{assets: array, cacheTags: array}`. Includes the
   defensive logic in A.2.3.

2. **`SnapshotPublisher` integration** — `buildSnapshot()` calls
   the new builder, merges its `assets[]` into the response. The
   cache-tag list propagates up. One test fixture
   (`test/Unit/AssetSnapshotBuilderTest.php`) covers: happy path,
   empty file, duplicate-live, missing pack.

3. **`WorldController::assetsSnapshot()` + route** — sidecar at
   `/world/snapshot/assets`. Calls
   `AssetSnapshotBuilder::build()` directly (no `entities`/`sectors`
   walk). Returns `{ version, generatedAt, assets }`. Same cache
   tags. Used as a diagnostic curl probe and by A.5's admin view.

4. **Drush command `world:assets-status`** — wraps the builder,
   prints a table grouped by atmosphere → slot → asset, marking the
   one that wins for each cell. Resurrects the verify-catalog
   pattern from scaffold/ and makes it a first-class Drush
   command. Useful in CI ("is the catalog actually wired?").

5. **`docs/ARCHITECTURE.md §5 snapshot shape update`** — bumps the
   documented shape to include `assets[]`. The renderer's
   `adaptSnapshot` (A.3) starts reading `snapshot.assets` once this
   ships; until A.3 lands, the renderer silently ignores the new
   key.

##### A.2.6 — Definition of done

- [ ] `GET /world/snapshot/full` includes `assets: []` even on a
      catalog with zero live assets (always-array invariant).
- [ ] Marking one asset `live` via the Drupal edit form and
      reloading the page makes that asset appear in the payload
      within 60s (the snapshot's max-age).
- [ ] `GET /world/snapshot/assets` returns the same `assets[]`
      block in isolation.
- [ ] `drush world:assets-status` prints a per-atmosphere /
      per-slot table identifying the live asset for each cell.
- [ ] The defensive cases in A.2.3 are unit-tested.
- [ ] Two-live-for-same-cell logs a `notice` to the watchdog and
      emits the deterministic winner.
- [ ] Cache tag invalidation verified: edit an asset, the next
      snapshot fetch reflects it within the max-age window.

##### A.2.7 — Open questions parked for A.3+

- **Pivot offset shape** — `pivot: "custom"` is an enum value but
  doesn't carry the offset vector. A.3 will need to read
  `field_asset_curation_notes` or a new dedicated offset field. For
  v0.4 we emit `pivot: "custom"` and let the curator document the
  offset; A.3's `GltfComponent` falls back to `base` until the
  field exists.
- **LOD variants** — Quaternius packs ship a single mesh per
  species, but KayKit and others sometimes ship LOD0/LOD1/LOD2.
  v0.4 emits one `curatedFileUrl`; v0.5 may extend to
  `lod: [{distance, url}, ...]`.
- **Material overrides** — atmosphere-driven color tints on neutral
  meshes (the "moss on stela" question). Not in the asset payload;
  belongs to atmospheres/mappings.yml.

Read filter (legacy one-liner, retained for grep): `bundle=asset`
+ `field_asset_status.name=live` + `field_asset_curated_file` non-null.

#### A.3 — `GltfComponent` + `AssetCache` (client)

Client side. New `src/world/runtime/AssetCache.ts`:

- Singleton, parallel to `SurfaceCache`.
- `acquire(url)` → loads once via three.js `GLTFLoader`, caches the
  parsed scene, returns a clone via `SkeletonUtils.clone()` per call.
- Disposes cleanly on world tear-down.

New `src/world/runtime/smart-objects/components/GltfComponent.ts`:

- Parallel to `MeshComponent`.
- Constructor takes `{ scene: THREE.Group, scale: number, offset?: Vec3 }`.
- Adds the cloned scene as a child of the SmartObject.

New `ctx.tryLoadProp(slot)` helper on `BuilderContext`:

- Looks up the slot in the snapshot's `assets[]`.
- If a live asset exists for the active atmosphere + slot,
  returns the cached scene; otherwise returns `null`.

#### A.4 — Builder hook-ups

Each existing Builder grows an asset-first / primitive-fallback path:

- `ArticleAsTree` — if `tryLoadProp("oak-stylized")` returns a scene,
  attach via `GltfComponent` instead of the cylinder+cone primitive.
  Multiple-species packs: use the existing FNV-1a hash to pick a
  child mesh deterministically per article.
- `ProfileAsSpirit` — `tryLoadProp("sapling-figure")` for the
  humanoid; primitive bipedal-stack stays as fallback.
- `EventAsTotem` — `tryLoadProp("standing-stone")` for the totem
  geometry; the moss-ring decal stays as-is. **The phallic-pillar
  problem auto-resolves the moment a real stela .glb lands.**
- `scenery.ts` — `tryLoadProp("forest-scenery-mushroom")` etc. for
  the decorative scatter; primitive cones stay as fallback.

#### A.5 — Asset Editor UI affordances

Lightweight Drupal-side polish:

- A view at `/admin/world/assets` showing each slot grouped by
  atmosphere, with the live asset highlighted. One-click to switch
  which asset is `live` for a given slot.
- A "Mark live" action on the asset edit form that automatically
  moves any sibling assets (same slot, same atmosphere) to `curated`
  so only one asset is `live` per cell at a time.

### Track B — Framework pages as monuments

The pages every site has — homepage, mission, vision, contact —
mapped to world objects rather than HTML pages.

#### B.1 — `monument` content type

A new bundle alongside article / profile / event.

- `body` — the prose (mission text, vision text, etc.)
- `field_monument_role` — enum: `mission` | `vision` | `contact`
- `field_world_signature` — same as other world entities (read by
  the renderer for any subtle per-monument tuning)

Notably absent: `field_world_sector`. Monuments aren't sectored —
they get a world-axis position derived from their role.

#### B.2 — Three Builders in the forest atmosphere

- `MissionAsStela` — tall carved monolith at world origin (0, 0, 0).
  ~25-30 units, weathered limestone, moss base, optional carved
  relief texture. Visible from every overview. Click → mission
  prose card.
- `VisionAsGreatTree` — over-scaled ArticleAsTree (height 4× normal),
  placed at the world's far edge (~world.radius from center,
  cardinal-north direction). Visible silhouette from any sector;
  reaching it is part of the experience.
- `ContactAsHearth` — fire ring + log benches + curling smoke
  particle field (reuses pollen plumbing), placed near the world's
  near-edge. Card surfaces the Drupal `contact_form` submission UI.

#### B.3 — Position derivation

Special-cased in `SnapshotPublisher`:

```php
match ($entity->get('field_monument_role')->value) {
  'mission' => ['x' => 0,   'z' => 0,                   'sectorTermId' => null],
  'vision'  => ['x' => 0,   'z' => -worldRadius * 0.95, 'sectorTermId' => null],
  'contact' => ['x' => 0,   'z' =>  worldRadius * 0.55, 'sectorTermId' => null],
}
```

Renderer treats null-sector entities as "world-axis monuments" —
no sector pad, no in-sector clustering.

#### B.4 — Camera + navigation

- Drupal main menu (`mission` / `vision` / `contact` paths) routes
  through the existing PointerNavigator pattern: clicking a menu
  link fires a camera fly-to instead of a page load.
- The "homepage" stays the overview vantage at `/`. No new monument;
  the world *is* the homepage. Optional one-time welcome card on
  first visit, dismissable, never shown again.

## Things explicitly NOT in v0.4

- **Chatvatar (LLM dialogue layer)** — deferred to v0.5. Needs its
  own design conversation; speech-bubble + audio + state machine
  is a release-scale undertaking.
- **TemporalUrgencyComponent** — deferred to v0.5. Per-frame emissive
  modulation for events as their date approaches/passes; sketched
  in `docs/atmospheres/forest/mappings.yml` but not the
  load-bearing fix v0.4 needs.
- **Sierra Madre fixture extension** — small, can land in any
  v0.4-point release.
- **Per-property atmosphere switching** — the palette overrides
  for property X vs property Y. Currently atlas_coffee specific;
  generalising is v0.5+.
- **Search / embeddings** — the cypher schema reserves
  `signature.semantic.embedding`. v0.5 fills it.

## Order of execution (this is the build plan)

| # | Subtask | Dep | Reviewable as |
| --- | --- | --- | --- |
| 1 | v0.4/ROADMAP.md (this doc) | — | docs commit |
| 2 | Asset acquisition pass (A.1) | — | scaffold/fetch-packs.php + pack node updates |
| 3 | /world/snapshot/assets endpoint (A.2) | — | server commit |
| 4 | GltfComponent + AssetCache (A.3) | 3 | client commit |
| 5 | Builder hook-ups (A.4) | 4 | one commit per slot, four slots |
| 6 | monument content type + 3 builders (B) | — (parallel to A) | one or two commits |

Tracks A and B are independent. B can land in parallel with any
A subtask. The recommended sequence runs A.1–A.4 first so the
v0.4 release demos with real trees, then B drops the landmarks
on top.

---

## Status mid-v0.4 (updated 2026-05-17)

The roadmap above is the original build plan. Substantial polish
and exploration work landed in parallel as the user surfaced
issues. Current state:

### Track A — Real .glb pipeline

| Subtask | Status | Notes |
| --- | --- | --- |
| A.1 Asset acquisition pass | **partial** | Ingestion infra (`scaffold/attach-pack-file.php`, `print-pack-checklist.php`) + catalog seeded (15 packs / 17 assets, all `shortlisted`). Raw downloads remain a manual click-through; automated WebFetch was confirmed infeasible. |
| A.2 `/world/snapshot/assets` endpoint | **shipped** | `AssetSnapshotBuilder` service emits the payload per spec; embedded in `/world/snapshot/full` as `assets[]` and exposed standalone at `/world/snapshot/assets`. CacheableJsonResponse with per-asset+pack cache tags. Defensive: missing-file omit, duplicate-live dedupe, deleted-pack tolerance. Drush companion: `world:assets-status`. Verified end-to-end via `scaffold/wire-test-asset.php` round-trip. |
| A.3 GltfComponent + AssetCache (client) | **shipped** | `AssetCache.ts` (singleton, GLTFLoader, SkeletonUtils.clone, snapshot-version-bound flush). `GltfComponent.ts` (scaled .glb scene with pivot + recursive entityBody tagging). `tryLoadProp(slot)` closure on `BuilderContext` picks the right asset for the active atmosphere with deterministic tie-break. |
| A.4 Builder hook-ups | **partial** | `ArticleAsTree` / `ProfileAsSpirit` / `EventAsTotem` each call `tryLoadProp` at top of `build()` and attach `GltfComponent` if a prop returns, primitive fallback otherwise. Card-lifecycle scaffold extracted into per-builder `attachCardScaffold()` helpers. EventAsTotem's moss ring runs on both paths via `attachMossRing()`. **Scenery (`scenery.ts`) hookup still pending.** |
| A.5 Asset Editor UI affordances | **not started** | `/admin/world/assets` view + "Mark live" action. Until shipped: `scaffold/wire-test-asset.php` + `scaffold/unwire-test-asset.php` provide developer-facing wire/unwire. |

### Track B — Framework pages as monuments

| Subtask | Status | Notes |
| --- | --- | --- |
| B.1 `monument` content type | **not started** | |
| B.2 Three Builders | **not started** | MissionAsStela / VisionAsGreatTree / ContactAsHearth. |
| B.3 Position derivation | **not started** | World-axis positions; not sector-derived. |
| B.4 Camera + navigation | **not started** | Drupal menu wiring. |

### Information LOD work (out-of-scope on the original roadmap, landed anyway)

The user's "title visibility / hover gating / modal layout" thread
turned into a substantial UX layer. Reference doc:
`docs/v0.4/research/INFORMATION_LOD.md` + `SILHOUETTE_HOVER.md`.

| Item | Status | Commits |
| --- | --- | --- |
| Activity A: region labels at overview | **shipped** | `ab7ce48` + `d80a9b4` |
| Activity B: per-entity title spray at sector vantage | **shipped** | `1e65505` |
| Activity C: one-click to FullView, context-aware near/far | **shipped** | `1e65505` + `e7abf0b` + `9826915` |
| Hover redesign — in-shader Fresnel glow | **shipped** | `c7cb08e` |
| Hover summary subtitle on hovered entity label | **shipped** | `8674546` |
| Universal hover gate (same predicate as title visibility) | **shipped** | `c7cb08e` |
| FullView typography pass (serif ladder, 36px heading) | **shipped** | `b30a76a` |
| Event/profile body first-line callout | **shipped** | `b30a76a` |
| `card` view-mode (dedicated FullView-rendering view-mode) | **shipped** | `448ee44` |
| Modal left-align + lateral-camera-shift recentre | **shipped** | `ccf9a73` → `64c9fd8` |
| Compass-axis letters (N/S/E/W labels) | **shipped** | `5080c57` |
| Idle-reset on mouse-move | **shipped** | `e5a260f` |
| BATTLE_SCARS.md doc (indexed bug reference) | **shipped** | `c7caace` |

### What v0.4 still needs to call itself done

Track A.2–A.5 is the load-bearing remainder — without it, the
prop catalog content sits in Drupal but never reaches the
renderer. The monument track (B) is independent and can land
either before or after A's completion.

The polish layer has become its own implicit deliverable. If we
keep going on UX polish without progressing Track A, the v0.4
release is "the world reads beautifully but still uses primitives."
Recommended discipline going forward: A.2 next, then the rest of
A in order, with polish parking-lotted to v0.4.x patch releases.

## Definition of done (refined)

- Fresh install + atlas seeder + asset catalog seeder + acquisition
  pass = a world that renders Quaternius trees + KayKit scenery +
  Mission stela + Vision tree + Contact hearth, with primitive
  fallbacks for any unfilled slot.
- `drush world:publish` continues to run cleanly with the new
  monument bundle in the corpus.
- `drush scr scaffold/verify-catalog.php` reports the live asset
  per slot per atmosphere.
- The phallic-pillar v0.3.0-fix becomes irrelevant the moment
  a real `standing-stone.glb` lands at `field_asset_status=live`.
