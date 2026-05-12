# Walkthrough — `v0.0.1-alpha`

A reproducible script for a first-time visitor to the world.
Follow it top to bottom; the timings are real (no waiting for
loading spinners). Total time to the bottom: about 4 minutes.

## Before you start

```bash
cd ~/tecnocratica/projects/drupal-three-js-theme
ddev start
ddev exec npm run build
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
- **Twenty floating quads** above-and-behind each cube, each
  painted with the title and metadata of its article.
- **Camera orbiting slowly** at about 6°/sec.

Watch the Console for two lines:

```
[world] canvas: <w>x<h>, camera at (...), palette: #d0dce6
[world] mounted: 20 entities across 5 sectors, html-surface path: html-to-image (bridge)
```

If you don't see the surfaces (just cubes), check Network for
`/world/card/node/*/default` requests — they should return 200
with HTML content. If you see *"HtmlSurface failed"* warnings,
html-to-image choked on a fragment; report.

## 0:15 — the orbit is the biome demo

Just watch for ~30 seconds. The orbit cycles past each sector
centroid once every ~90 seconds. As it does, the **background
tint, fog color, and ambient warmth shift** — Antigua's golden
volcanic warmth blending into Cauca's clear Andean cool, into
Boquete's cloud-forest blue-grey, into Sierra Madre's dusty
earth, into Tarrazú's saturated green.

The blend is *spatial, not temporal*: each sector contributes
inverse-square-of-distance weight. There's no state machine, no
timer — biome is a function of position, no different from
gravity in a physics engine.

## 1:30 — pick a card and bloom it

Click a **green disc on the ground** (any of them — they're the
trigger pads). The article's quad should:

- Scale up by ~1.8×
- Push toward the camera
- Re-orient to face the camera

The URL bar updates to:

```
https://drupal-three-js-theme.ddev.site/#card=node-<n>
```

This is the **Bloomed state**. The engine keeps running; the
orbit continues. You're in *preview*.

## 2:00 — go deep, enter FullView

Click **the same pad again**. The world goes still and a
full-screen overlay slides in with backdrop blur. The article
shows briefly as *"Loading..."*, then the full body text
appears in a centered white panel.

URL becomes:

```
https://drupal-three-js-theme.ddev.site/#card=node-<n>&v=full
```

In Performance tab, record for 2 seconds. The main thread should
be **near-idle** — no `requestAnimationFrame` ticks. This is the
engine pause from `ARCHITECTURE §4.3`: the world stops to honor
the document.

Read a paragraph. The article is the genuine content the cypher
served via `/world/card/node/<n>/full`. Same Drupal entity, same
view-mode, painted into the document via the overlay rather than
onto a quad.

## 2:30 — leave gracefully

Three ways out, each different:

- **× button** (top-right of the white panel) — closes the
  overlay, returns to Bloomed. Orbit resumes.
- **Click the dark backdrop** — same: returns to Bloomed.
- **Esc key** — collapses straight to Hidden, skipping Bloomed.
  URL clears entirely.

Try each. URL updates accordingly each time.

## 3:00 — deep link

Copy this URL:

```
https://drupal-three-js-theme.ddev.site/#card=node-12&v=full
```

Open it in a new tab. The site should boot directly into
FullView for *Boquete Geisha Cup 2026: final scoring announced*.
No intermediate state. The URL was the address; the world
honored it.

Try this one too:

```
https://drupal-three-js-theme.ddev.site/#card=node-3
```

Boots into Bloomed state for *Doña Rosa Méndez — three
generations on the slopes of Acatenango*.

This is the URI-as-coordinate claim made mechanical. Type any
URL → the world arrives there. Paste any URL → the world arrives
there. The five layers (editorial / descriptor / 3D / URI /
screen) form a commutative diagram; you've just walked across
two of its longest arrows.

## 4:00 — what you've verified

- ✓ 20-entity corpus across 5 sectors (Sprint 6a)
- ✓ Five region biomes blend spatially as the camera orbits (Sprint 6b)
- ✓ HTML surfaces paint live Drupal-rendered articles on 3D quads
  (Sprint 5a+5b)
- ✓ Trigger pads bloom cards in 3D space (Sprint 5c)
- ✓ Bloomed cards re-bloom into a DOM overlay with full content
  (Sprint 5e)
- ✓ Engine pauses on FullView entry; resumes on exit (Sprint 5e)
- ✓ URL hash captures both spatial and lifecycle state (Sprint 5e)
- ✓ Deep links round-trip into the matching state (Sprint 5e)
- ✓ Surface fetches share a cache; LRU eviction on overflow
  (Sprint 5d)

That's the ALPHA. Everything below the hood is in place. v0.1
moves the biome palette to config, adds proper SmartObject
metaphor geometry, opens the descriptor schema to editor
extension, and starts wiring Sprint 5's deferred items
(continuous facing while bloomed, camera→URL update, hover
affordances, smooth bloom tweens).

## Known sharp edges for ALPHA

1. **Bloomed surface faces the camera at bloom time only.**
   As the orbit continues, the surface keeps its initial
   orientation. v0.1 makes facing continuous.
2. **Camera position doesn't update the URL.** The URL→world
   direction commutes; the world→URL direction is half-built
   (only the card state machine syncs the hash, not the
   camera).
3. **Biome palette is hardcoded** in `BiomeMixer.ts`. Editors
   can't tune their world without code. v0.1 moves it to
   `world_signature.palette` config.
4. **`profile` and `event` bundles** are absent — all 20
   entities are `article`. The bundle-color hint exists in
   the palette but only `article` is currently in use. The
   bundle distinction was a stand-in for per-bundle metaphor
   geometry, which is deferred.
5. **The entity_delete hook doesn't always clean RESTHeart.**
   Worked around with `scaffold/purge-orphans.php`. Real fix
   tracked for v0.1.
6. **No tests for the runtime DOM components** (CardController,
   CardOverlay, BiomeMixer). They depend on a real DOM/canvas;
   `jsdom`-based testing is on the v0.1 list.

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

Times out at about 90 seconds on a warm DDEV.
