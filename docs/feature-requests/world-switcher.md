# World switcher

**Status:** v1 (reload-based) SHIPPED · **v1.5 (live in-place) SHIPPED — leak-verified**
**Relates to:** ALPHA 3 / BETA 1 · `world` content type · `docs/MILESTONES.md`

> **v1.5 ship note (2026-05-24).** `SceneManager.switchAtmosphere(name?)`
> now performs a live, in-place flip — no reload. The load-bearing
> disposal refactor (a single world-layer `THREE.Group` seam) is in;
> `mount()` was split into `fetchSnapshot()` + `buildScene()`, both the
> first build and the rebuild share `buildScene()`. **Verified leak-free
> in a real browser:** inner-mind ⇄ forest round-trips return
> `renderer.info.memory.geometries` to its exact baseline (100), and
> `textures` to a bounded 27 (the +1 over the 26 baseline is the
> module-cached forest pollen sprite, allocated once and reused — it
> does not climb across further switches). Camera pose preserved across
> the flip. The authored flip is driven today by `drush world:switch`
> (already shipped); a no-drush client flip is a small follow-up (see
> "client `?atmosphere=` hint" below).

Flip the active atmosphere — forest ↔ inner-mind — "in a snap." The
`world` content type already exposes the selection (`field_world_atmosphere`),
so the server half is mostly wiring; the real work is the **renderer
teardown/rebuild** and a **second atmosphere to switch to**.

This doc is the consensus of a planning pass against the actual code,
with the refinements noted inline.

---

## Consensus approach

**v1:** `drush world:switch <atmosphere>` flips the active World node's
`field_world_atmosphere`; the renderer gains `SceneManager.switchAtmosphere()`
that re-fetches the snapshot, tears the scene down, and rebuilds with the
new atmosphere behind the loader — **camera pose preserved**. Gated by a
minimal **inner-mind stub** so the switch is demoable. Reload-based switch
is the documented fallback if disposal proves leaky.

**v2:** in-world HUD toggle (as a *client-side preview*, no server write)
+ an animated crossfade.

### The one insight that de-risks everything

The plan's biggest real work isn't the switch logic — it's that **almost
everything added to the scene today is added without a handle**: the sun
and fill lights, the ground plane, compass posts, sector pads, forest
scenery, and the pollen field all get `scene.add(...)`'d inline with
nothing holding them. You cannot tear down what you can't reference.

**Consensus refinement (beyond the raw plan):** introduce a single
**world-layer `THREE.Group`** that everything mount-time and atmosphere-time
attaches to. Teardown becomes "dispose the world-layer group's tree +
remove it," not "track and free N kinds of object." One seam, not a
checklist that rots. The `renderer`, `scene`, and `camera` live *outside*
that group and survive the switch.

---

## Server side

- **Single active World node, flip its field** (not N nodes toggled by
  `field_world_active`). Reuses `SnapshotPublisher::activeWorld()`'s
  existing selection; avoids "two active worlds" ambiguity. (N-nodes is a
  fine later variant for genuinely distinct worlds, not skins of one.)
- Add **`world:switch <atmosphere>`** to `WorldCommands.php`, mirroring
  `layoutMode()`'s validate-then-set shape: load the active World node, set
  `field_world_atmosphere` to `none|forest|inner-mind`, save. The node save
  auto-invalidates the `node_list:world` cache tag the snapshot already
  declares, so `/world/snapshot/full` serves the new atmosphere on next
  fetch.
- Extract the active-World lookup into a shared method so the command and
  the publisher don't duplicate it.
- **No change** to `loadPalette()` / `buildSnapshot()` — they already
  resolve `activeAtmosphere` + the palette overlay from the field.

## Client side — `SceneManager.switchAtmosphere(name)`

1. Pause the loop; show `LoaderOverlay`; stash `camera.position` +
   look target.
2. **Teardown** (the world-layer group makes this small):
   - dispose every `SmartObject` (its `dispose()` frees geometry/materials),
     `smartObjects.clear()`.
   - truncate `atmosphereUpdaters`.
   - remove + dispose the world-layer group (lights, ground, posts, pads,
     scenery, pollen — once they're all parented to it).
   - clear the WorldHud labels (sector + entity + **compass** — compass
     labels are currently not cleared; add their array).
   - `surfaceCache.setSnapshotVersion(v)` + `assetCache.setSnapshotVersion(v)`
     to invalidate (atmosphere-tagged assets differ).
   - null + rebuild `biomeMixer`, `cameraController`, `pointerNavigator`,
     `cardController` (they hold scene/snapshot refs).
3. Re-fetch `/world/snapshot/full` with `cache: "no-store"`.
4. **Rebuild:** extract the post-fetch body of `mountAfterSnapshot` into a
   private `buildScene()` that both `mount()` and `switchAtmosphere()` call.
5. Restore camera pose; resume the loop; hide the loader.

**Atmosphere env contract change:** `setupXEnvironment` should return a
disposable root (the world-layer subgroup) + its updater list, instead of
adding loose meshes to `scene`. `PollenField` gains a `dispose()`.

## Inner-mind stub (build now)

Required to demo the switch and already named in the enum + palette config.
Mirror `forest/index.ts`, deliberately crude:
- `registerInnerMindAtmosphere` — 3 trivial builders (article = monolith,
  profile = orb, event = ring).
- `setupInnerMindEnvironment` — distinct palette via
  `atmosphere_overrides['inner-mind']` in `world_signature.palette.yml` +
  one simple particle/updater.
- `case "inner-mind"` branch in `SceneManager.registerAtmosphere()`.

This is a **stub**, not the real BETA 1 inner-mind metaphor.

## Trigger surfaces — authored vs preview (consensus refinement)

Distinguish two switches the raw plan blurred:

- **Authored switch** (persists, global): `drush world:switch` (v1) and a
  Drupal admin action (later). Writes the World node; everyone sees it.
- **Preview switch** (ephemeral, client-only): the v2 in-world HUD button.
  It should call `switchAtmosphere(name)` with a *local atmosphere override*
  and **not** write the node — no auth, no POST route, no SSRF surface.
  (It still re-fetches the snapshot for the server-computed palette overlay;
  moving overlay computation client-side is a separate, larger choice.)

This kills the "tiny authenticated POST route" the raw plan floated — a
preview that mutates global state for everyone is the wrong default.

## Phasing

- **v1 (snap):** world-layer disposal refactor · `world:switch` ·
  `switchAtmosphere()` live teardown/rebuild · inner-mind stub · palette
  overlay · loader-covered hard cut · camera preserved. Fallback: reload.
- **v2 (polish):** ✅ HUD preview toggle (`AtmosphereSwitcher`) · ⏳ animated
  crossfade (fade scene to palette background → rebuild → fade in; **not** a
  geometry morph — that's fantasy) · ⏳ per-atmosphere audio.

## Risks

- **Disposal completeness was THE risk — now MITIGATED + VERIFIED.**
  `renderer.info.memory.geometries` returns to its exact baseline (100)
  across repeated switches and inner-mind ⇄ forest round-trips; `textures`
  is bounded at 27 (one-time pollen-sprite cache, no climb). The
  world-layer-group seam is the mitigation; without it, this leaks. Re-run
  the check after adding live `.glb` assets (AssetCache is flushed on
  teardown, so those should also return to baseline).
- **Camera/URL:** preserve `camera.position`; `CameraController` re-seeds
  from the URL, so a stale vantage is harmless.
- **Stale cache:** `switchAtmosphere` fetch must be `no-store`; node-save
  invalidation handles the server tag.
- **Loop re-entry:** `switchAtmosphere` is a method on the live instance,
  not a re-boot — the `canvas.dataset.worldBooted` guard is unaffected.

## Step-by-step (build order)

1. ✅ **Disposal refactor** — single world-layer `THREE.Group`; lights,
   ground, posts, pads, scenery, particles reparented onto it; `PollenField`
   gained `dispose()`; `setupForest/InnerMindEnvironment` attach into the
   root and return a Points disposer; compass labels held in `compassLabels`.
   Teardown is three buckets: SmartObjects (`dispose()` +
   `removeFromParent()`), the world-layer Mesh-walk (geo+mat), and the
   atmosphere Points disposers. (SmartObjects stay on `scene`, not the
   group, so the Mesh-walk never double-frees them — keeps
   `renderer.info.memory` honest.)
2. ✅ **`buildScene()` extraction** from `mountAfterSnapshot` (now
   `fetchSnapshot()` + `buildScene()`; mount + switch share the latter).
3. ✅ **`switchAtmosphere(name?)`** — pause loop · stash camera pos ·
   teardown · re-fetch (`cache:no-store`) · `buildScene` · restore pos ·
   resume loop. Logs post-switch `renderer.info.memory` for the leak check.
4. ✅ **inner-mind stub** atmosphere + palette overlay + `registerAtmosphere`
   case.
5. ✅ **`world:switch`** drush command + shared active-World lookup.
6. ✅ **Verified** in-browser: `world:switch forest` then
   `worldScene.switchAtmosphere()` flips in place; geometries return to
   baseline (100) across inner-mind ⇄ forest round-trips; textures bounded
   at 27; camera preserved.
7. ✅ **(v2) HUD preview button** — `AtmosphereSwitcher` (bottom-center
   pill: Forest / Inner mind) calls `switchAtmosphere(name)`, previewing
   via the read-only `?atmosphere=` hint. Re-entrancy-guarded
   (`switching` flag + `setBusy`), highlights the active skin, and is
   chrome that survives switches (created once in `mount`, never torn
   down). ⏳ Animated crossfade still pending.

### Client `?atmosphere=` hint — SHIPPED (no-drush client flip)

`switchAtmosphere(name)` appends `?atmosphere=<name>` to the re-fetch, and
`WorldController::snapshot()` now honours it **read-only**: a GET
`?atmosphere=<none|forest|inner-mind>` overrides the active World node's
atmosphere for that one response (validated against the known set; anything
else ignored), with **no node write**. `SnapshotPublisher::buildSnapshot()`
takes the override and threads it into `loadPalette()`; the response carries
a `url.query_args:atmosphere` cache context so skins don't bleed across
cached entries. SSRF-free — it's a GET that only selects which palette
overlay is computed.

Effect: `worldScene.switchAtmosphere('forest')` flips the skin live with no
`drush` and no global mutation — the preview-switch primitive the v2 HUD
button needs. Verified: curl `?atmosphere=forest` → forest palette while the
node stays inner-mind; in-browser flip forest ⇄ inner-mind with no drush.
The authored, persistent flip remains `drush world:switch`.

## Open decisions

- **O1 — palette overlay location. RESOLVED (re-fetch with `?atmosphere=`).**
  The server still computes the overlay; the client previews a skin by
  re-fetching `/world/snapshot/full?atmosphere=<name>` (read-only, no node
  write). Cheap at ALPHA corpus sizes and keeps overlay logic server-side;
  moving overlay computation client-side stays a non-goal.
- **O2 — reload vs live for the true v1 ship.** Default to live
  (camera-preserving) *only if* step 1's memory check is clean; otherwise
  ship reload-based and treat live as v1.5.

### Files
- `src/world/runtime/SceneManager.ts` — world-layer group, `buildScene`,
  `switchAtmosphere`, light/compass handles.
- `src/world/runtime/atmospheres/forest/index.ts` + `pollen.ts` +
  `scenery.ts` — disposable env contract.
- `src/world/runtime/atmospheres/inner-mind/` — new stub.
- `web/modules/custom/world_signature/src/Drush/Commands/WorldCommands.php`
  — `world:switch`.
- `web/modules/custom/world_signature/src/Service/SnapshotPublisher.php`
  — share `activeWorld()`.
- `web/modules/custom/world_signature/config/install/world_signature.palette.yml`
  — `atmosphere_overrides.inner-mind`.
