# Walkthrough — `v0.1.1`

A reproducible script for a first-time visitor to the world.
Follow it top to bottom; timings are real. Total time: about
6 minutes including all the gestures.

## Before you start

```bash
cd ~/tecnocratica/projects/drupal-three-js-theme
ddev start
ddev exec npm run build
ddev drush updb -y                              # ensure config is current
ddev drush scr scaffold/seed-atlas-coffee.php   # idempotent
ddev drush world:publish
ddev drush scr scaffold/purge-orphans.php       # belt-and-suspenders
```

Open `https://drupal-three-js-theme.ddev.site/` in Chrome with
DevTools docked (Console + Network tabs visible). Hard-refresh
(`Ctrl+Shift+R`) so nothing comes from the browser cache.

## 0:00 — first paint

You should see:

- **A pastel green-blue overview** of the world. Light green
  ground plane, four grey compass posts at N/S/E/W.
- **Twenty bundle-tinted cubes** distributed across five sectors
  arranged as a pentagon at radius ~100 from origin. Each cube
  has a small **green disc** (the trigger pad) in front of it.
- **Five larger sector centroid discs** on the ground — one at
  each sector's centroid, lighter green than the entity pads.
- **Twenty floating quads** above each cube, painted with the
  title and metadata of the article they represent.
- **Camera held at the overview vantage** — for the first 3
  seconds. Then a **gentle idle drift** begins, a slow
  sinusoidal sway around the overview position; biomes shift
  subtly as the camera nudges around.

Watch the Console for:

```
[world] canvas: <w>x<h>, camera at (...), palette: #d0dce6
[world] mounted: 20 entities across 5 sectors, html-surface path: html-to-image (bridge)
```

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

That's v0.1.1. The five-coordinate stack commutes in both
directions. Every layer round-trips.

## Known sharp edges still standing

1. **`profile` and `event` bundles** are absent — all 20 entities
   are `article`. The bundle-color hint exists in the palette but
   only `article` is currently in use. Per-bundle metaphor
   geometry (SmartObject base class) is the v0.1.2 target.
2. **The entity_delete hook doesn't always clean RESTHeart.**
   Worked around with `scaffold/purge-orphans.php`. Real fix
   tracked.
3. **No tests for the runtime DOM components** beyond CameraController
   (CardController, CardOverlay, PointerNavigator, BiomeMixer). They
   depend on a real DOM/canvas; `jsdom`-based test coverage
   continues on the v0.1.x list.
4. **Camera at overview drifts indefinitely** if the user never
   interacts. Should we add a "pause on tab inactive"? Tracked
   for follow-up; not blocking ALPHA.

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
