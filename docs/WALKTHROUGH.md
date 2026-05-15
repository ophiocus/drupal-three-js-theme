# Walkthrough — `v0.2.1`

A reproducible script for a first-time visitor to the world.
Follow it top to bottom; timings are real. Total time: about
6 minutes including all the gestures.

## Before you start

```bash
cd ~/tecnocratica/projects/drupal-three-js-theme
ddev start
ddev exec npm run build
ddev drush scr scaffold/seed-atlas-coffee.php   # idempotent
ddev drush world:publish
ddev drush scr scaffold/purge-orphans.php       # belt-and-suspenders
```

Note: as of v0.2.x, `hook_update_N` is no longer used — module
config lands on a fresh `drush en world_signature` directly from
`config/install/`. No `drush updb` needed.

Open `https://drupal-three-js-theme.ddev.site/` in Chrome with
DevTools docked (Console + Network tabs visible). Hard-refresh
(`Ctrl+Shift+R`) so nothing comes from the browser cache. After
each rebuild, hard-refresh once so the new `?v=…` cache-buster
takes effect.

## 0:00 — first paint

You should see (the forest atmosphere is active by default):

- **Deep forest-dusk overview**. Dark olive ground (`#3a4a2a`),
  warm golden-green ambient at low intensity (forest filters
  the light). Distant fog at the horizon — the world has edges
  that fade rather than ending.
- **Twenty trees** scattered across five sectors arranged as a
  pentagon at radius ~100 from origin. Each tree is a cylinder
  trunk + cone canopy; heights vary by article word count
  (range [8, 35] world units). Bark colors region-tinted
  (Antigua warm-dark, Cauca mid-bark, Boquete moss-darkened,
  etc.). Per-tree silhouette variation: canopy radius and
  height jitter ±15–20%, leaning slightly off-axis; tall
  trees often have a second smaller canopy stacked above
  (deterministic from entity id, stable across reloads).
- **Five soft clearings** at sector centroids — radial-gradient
  alpha pads that fade into the ground rather than reading as
  poker chips. Lighter olive than the surrounding ground.
- **Mushrooms, ferns, and stones** scattered near each sector
  centroid — primitive geometry placeholders for real Stage 4
  glb assets. Mushrooms are muted brick-red cones; ferns
  thinner green cones; stones squashed icosahedrons. ~13 items
  per sector, deterministic placement.
- **Drifting motes of pollen** — 80 warm-amber particles
  catching the low golden sun, additive-blended, slowly
  sinusoidally drifting at y=5–25. Sells "the air has weight."
- **Small trigger pads** in front of each tree — the article's
  bloom click target.
- **Twenty floating quads** offset outward from each tree at
  y≈8, painted with the title and metadata of the article they
  represent.
- **Camera held at the overview vantage** for the first 3
  seconds. Then a **gentle idle drift** begins around the
  overview position.

Watch the Console for:

```
[world] canvas: <w>x<h>, camera at (...), palette: #1d2a1f
[world] mounted: 20 entities across 5 sectors, html-surface path: html-to-image (bridge)
```

(`palette: #1d2a1f` confirms the forest atmosphere's deep-dusk
overlay merged onto the base palette.)

## 0:15 — hover and discover

Move the mouse over the scene without clicking. As the pointer
crosses a clickable mesh, it should:

- **Light up** with a subtle emissive lift (entity cubes brighten;
  trigger pads + sector pads glow a little more).
- **Change cursor to `pointer`** so the user knows the click
  target is registered.

The decorative meshes (ground plane, compass posts) don't light
up — clicks fall through them. The hover affordance is your
"what would happen if I clicked here" preview.

## 0:30 — macro navigation by click

Three click targets in the world, three different behaviors:

### Click a sector centroid pad (the larger ground disc)

The camera dampens toward that sector's vantage. URL becomes
`/sector/<termId>`. The biome blend shifts — Antigua's golden
volcanic warmth, or Boquete's cool blue-grey, or whichever
sector you landed on.

### Click an entity cube

The camera flies to a close-up vantage near that entity. URL
becomes `/node/<id>`. You're now looking at one article from
its detail vantage.

### Click a small trigger pad (the disc by an entity)

This is the **bloom interaction** (existing from v0.0.1-alpha,
not navigation):
- The article's floating quad scales up ~1.8× and pushes toward
  the camera. URL gets `#card=node-<id>` appended.
- Continuously re-orients to face the camera (v0.1 fix — used
  to only face at bloom-time).

Click the pad **again** while bloomed → DOM overlay opens with
the full article text. URL gets `&v=full`. Engine pauses
(verify in Performance tab — no `requestAnimationFrame` ticks).

### Click empty ground

- At `/` (overview): collapses any bloomed/FullView card to Hidden
  state (Q3 from the locomotion proposal).
- At `/sector/<id>`: navigates back to overview (`/`).
- At `/node/<id>`: navigates to that node's primary sector.

The semantics are deliberately layered — *click empty = step out*.

## 1:30 — micro browsing by drag

Press-and-hold mouse button **on empty ground**, then drag.

- The camera **orbits around the current vantage's lookAt point**.
- Horizontal drag rotates azimuth (yaw); vertical drag tilts polar
  (pitch), clamped to a sensible band so you can never flip the
  camera overhead or burrow it below the floor (Q2 from the
  locomotion proposal).
- The drag **sticks on release** — your new angle persists. There's
  no snap-back. Only a URL change will re-anchor the camera.

This is *ephemeral* navigation: the URL doesn't change while
dragging. Settle detection is suppressed during interaction
(the `userInteracting` flag).

## 2:00 — keyboard navigation

| Key | Action |
|---|---|
| `Tab` | Cycle to next entity within current sector (or corpus-wide at overview) |
| `Shift+Tab` | Cycle to previous entity |
| `1`–`5` | Jump to sector N (`termId`-ascending order — same as the biome palette) |
| `6`–`9` | No-op (only 5 sectors in the atlas_coffee corpus) |
| `Escape` | Return to overview (`/`) |
| `Esc` (while card bloomed/FullView) | Collapse card state |
| Browser back/forward | Replay vantage history |

The keyboard nav is gated on focus — if you're typing in an
input field, hotkeys don't fire.

## 2:30 — engine pause on FullView

With a card in Bloomed state (`#card=node-<n>`), click the trigger
pad **a second time**. DOM overlay opens. In Performance tab,
record for 2 seconds. Main thread is **near-idle**.

This is the engine pause from `ARCHITECTURE §4.3`: the world
stops to honor the document. Battery, focus, and computational
quiet all benefit.

Three ways out of FullView:

- **× button** (top-right) → back to Bloomed; engine resumes.
- **Click the dark backdrop** → back to Bloomed.
- **Esc** → straight to Hidden, skip Bloomed.

URL updates correctly at each transition.

## 3:00 — deep link round-trip

Open these URLs in fresh tabs:

| URL | What you should see |
|---|---|
| `/` | Overview vantage; idle drift after 3s |
| `/sector/2` | Antigua's sector vantage (high above Antigua) |
| `/node/5` | Close-up vantage on the Carbonic Maceration article |
| `/node/12#card=node-12` | Boquete Geisha Cup, bloomed |
| `/node/12#card=node-12&v=full` | Boquete Geisha Cup, FullView, engine paused |

Every one survives a full reload (v0.1.1 cypher routes). The
URL is the address; the world honors it.

## 4:00 — what you've verified

- ✓ 20-entity corpus across 5 sectors (Sprint 6a)
- ✓ Five region biomes blend spatially as the camera moves (Sprint 6b)
- ✓ Biome palette read from `world_signature.palette.biomes` config (v0.1)
- ✓ HTML surfaces paint live Drupal-rendered articles on 3D quads
  (Sprint 5a+5b)
- ✓ Trigger pads bloom cards in 3D space (Sprint 5c)
- ✓ Bloomed cards re-bloom into a DOM overlay with full content
  (Sprint 5e)
- ✓ Engine pauses on FullView entry; resumes on exit (Sprint 5e)
- ✓ URL hash captures both spatial and lifecycle state (Sprint 5e)
- ✓ Camera → URL settles to vantage URI (v0.1 CameraController)
- ✓ Bloomed surface continuously faces camera (v0.1)
- ✓ Click sector pad → navigate (v0.1.1 PointerNavigator)
- ✓ Click entity cube → navigate (v0.1.1 PointerNavigator)
- ✓ Empty-space click → step out / clear cards (v0.1.1)
- ✓ Hover affordance with emissive lift + cursor pointer (v0.1.1)
- ✓ Drag-orbit around current vantage's lookAt, polar-clamped (v0.1.1)
- ✓ Idle drift after 3s of no input (v0.1.1)
- ✓ Tab/Shift+Tab cycle entities; 1–9 jump sectors (v0.1.1)
- ✓ `/sector/<termId>` deep-links survive reload (v0.1.1 cypher route)
- ✓ Deep links round-trip in both directions (Sprint 5e + v0.1)
- ✓ Atmosphere as a whole-world visual idiom (v0.2.0); forest
  pilot active by default
- ✓ Hook-free, config/install/-driven module — fresh
  `drush en world_signature` brings the full structure (v0.2.x)
- ✓ UE5-meta default atmosphere — UV-test texture, transparent
  color slots — when `active_atmosphere: 'none'` (v0.2.x)
- ✓ `atmosphere_overrides` palette overlays merged onto base
  by `SnapshotPublisher` (v0.2.1-P1)
- ✓ Detail vantage frames entity + card via `cardPlacement()`
  shared helper (v0.2.1-P4)
- ✓ `parseUrl` carries `entityType` separately from `entityId`;
  `/sector/<id>` recognised (v0.2.1-p4b)
- ✓ Library version cache-busts the bundle URL (v0.2.1-p4b)
- ✓ Floor layers prevent z-fighting between ground, sector pads,
  trigger pads (v0.2.1-p4c)
- ✓ Forest trees in [8, 35] range with per-tree silhouette
  variation (v0.2.1-P2 + P5)
- ✓ Soft clearing decals replace solid sector pads (v0.2.1-P2)
- ✓ Scenery clutter — mushrooms, ferns, mossy stones near
  each sector centroid (v0.2.1-A4)
- ✓ Drifting pollen motes — 80-particle layer with sinusoidal
  drift (v0.2.1-A5)

That's v0.2.1. The forest atmosphere is no longer "trees on a
meadow" — it's a world.

## Known sharp edges still standing

1. **`profile` and `event` bundles** absent in the corpus —
   all 20 entities are `article`. ProfileAsSpirit and
   EventAsTotem builders are documented (mappings.yml) but not
   yet implemented; held pending Q2's "extend fixtures or
   wait" decision.
2. **The entity_delete hook doesn't always clean RESTHeart.**
   Worked around with `scaffold/purge-orphans.php`. Real fix
   tracked for v0.3.
3. **No tests for the runtime DOM components** beyond
   CameraController (CardController, CardOverlay,
   PointerNavigator, BiomeMixer, LoaderOverlay,
   atmosphere environment). They depend on a real DOM/canvas;
   jsdom-based coverage continues on the v0.3 list.
4. **Camera at overview drifts indefinitely.** Should we
   pause-on-tab-inactive? Tracked for v0.3.
5. **Compass posts at cardinal directions** still visible
   (shelved per Q3). Revisit when atmosphere-replacement
   alternatives are designed.
6. **Real glb assets pending** — the forest atmosphere ships
   primitives waiting for Stage 4 acquisition via Sketchfab /
   Tripo / Blender MCPs (per docs/atmospheres/forest/asset-log.yml
   and docs/PROTOCOL.md §4c).
7. **Library cache-bust is manual** — bump `version:` in
   `drupal_threejs.libraries.yml` each release. v0.3 should
   automate via `library_info_alter` + content hash.

## Reproducing the world from scratch

```bash
# Wipe and start fresh.
ddev drush sql-drop -y
ddev drush si standard --account-name=admin --account-pass=admin -y
ddev drush en world_signature drupal_threejs -y
ddev drush theme:enable drupal_threejs && ddev drush config-set system.theme default drupal_threejs -y
ddev drush scr scaffold/seed-atlas-coffee.php
ddev drush world:publish
ddev drush scr scaffold/purge-orphans.php
ddev exec npm install && ddev exec npm run build
ddev launch
```

About 90 seconds on a warm DDEV.
