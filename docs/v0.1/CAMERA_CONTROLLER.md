# v0.1 — CameraController

Closes the world→URL arrow of the coordinate-system commutative
diagram. After this lands, every layer in the five-coordinate
stack (editorial / descriptor / 3D / URI / screen) round-trips in
both directions, not just one.

## Goal

A single runtime module that:

1. Reads the active **target Vantage** from the URL.
2. Smoothly transitions the camera toward that target each frame.
3. Updates the URL when the user *settles* into a new vantage.
4. Continuously re-orients any bloomed surface toward the camera.

Replaces the ALPHA orbit code in `SceneManager.startLoop()`.
Subsumes the bloomed-surface facing-once behavior from
`CardController.applyBloom()`. Becomes the single owner of
per-frame camera motion + bloomed-mesh orientation.

## Why

Sprint 5 made the URL→world arrow commute: typing
`#card=node-12&v=full` boots into FullView; clicking a pad
updates the hash. The reverse direction (world→URL) is half-built
— only state syncs to the hash, not camera position. The orbit
camera moves continuously with no record of *where in the world*
the user is.

Without world→URL sync:
- Browser back/forward doesn't replay vantage history.
- "Copy current view as link" is impossible.
- Bookmarking a vantage doesn't work.
- The thesis claim (URIs ARE coordinates) is half-true: URLs are
  *addresses* but the camera doesn't *report its address*.

The CameraController closes this gap.

## Non-goals for v0.1

- Continuous (non-discrete) URL coordinates. URLs encode named
  vantages only; we never write `/camera/37.2,89.1,-12.5`.
- Mobile / touch / VR input. PC-only this round. Solved jointly
  with WebXR in a later phase.
- Cinematic / scripted camera moves. Target-and-damp is the model;
  fixed-duration tweens are not yet a project capability.
- Free-form orbit (à la `OrbitControls`). Editorial primacy means
  geography is set by the URL grid; free orbit breaks that.

## Architecture

### File: `src/world/runtime/CameraController.ts`

Owns per-frame motion. Constructor takes the camera + a callback
pair for URL↔Vantage translation. Public surface:

```ts
interface CameraControllerOptions {
  camera: THREE.PerspectiveCamera;
  /** Read the desired vantage from current URL state. */
  getTargetVantageFromUrl: () => Vantage;
  /** Push a vantage into the URL (history.replaceState). */
  setUrlFromVantage: (v: Vantage) => void;
  /** Optional damping stiffness (default 4). */
  lambda?: number;
  /** Optional settle threshold in seconds (default 0.6). */
  settleSeconds?: number;
}

class CameraController {
  constructor(options: CameraControllerOptions);

  /** Call each frame from the animation loop. */
  update(dt: number): void;

  /** Currently-bloomed surface, if any. Set by CardController. */
  setBloomedMesh(mesh: THREE.Object3D | null): void;

  /** Force a target vantage change without going through URL. */
  setTarget(v: Vantage): void;

  /** Tear down event listeners. */
  dispose(): void;
}
```

### Module shape (file dependencies)

```
SceneManager
  ├─ camera, scene, lights
  ├─ owns CameraController     ← new
  ├─ owns CardController
  ├─ owns BiomeMixer
  └─ owns SurfaceCache

CameraController
  ├─ reads camera transform
  ├─ writes camera.position, camera.lookAt (via internal lookTarget)
  ├─ reads URL (getTargetVantageFromUrl callback)
  ├─ writes URL (setUrlFromVantage callback)
  └─ writes bloomed mesh quaternion (continuous facing)

CardController
  ├─ writes URL hash for card state (#card=...&v=full)
  ├─ on bloom: tells CameraController what mesh to keep-facing
  └─ on collapse: tells CameraController to forget it
```

The CardController and CameraController split URL hash responsibilities:
- CardController owns the `card` and `v` hash params (card state).
- CameraController owns the path part (`/sector/<n>`, `/node/<n>`, `/`).
- Both use `history.replaceState`; both honor `hashchange` +
  `popstate`. They don't write to each other's slots.

## Algorithm

### Per-frame update

```ts
update(dt: number): void {
  // 1. Damp position toward target vantage's position.
  for (const axis of ['x', 'y', 'z']) {
    camera.position[axis] = MathUtils.damp(
      camera.position[axis], targetVantage.position[axis], lambda, dt
    );
  }

  // 2. Damp the look-target toward the vantage's lookAt.
  const alpha = 1 - Math.exp(-lambda * dt);
  lookTarget.lerp(targetVantage.lookAt, alpha);
  camera.lookAt(lookTarget);

  // 3. Continuous facing for the bloomed mesh, if any.
  bloomedMesh?.lookAt(camera.position);

  // 4. Settle detection — see below.
  this.updateSettleState(dt);
}
```

### Settle detection

```ts
private lastPos = new Vector3();
private settleTimer = 0;
private lastReportedVantage: Vantage | null = null;

const SETTLE_THRESHOLD_VELOCITY = 0.5;  // world-units per second

updateSettleState(dt: number): void {
  const dist = camera.position.distanceTo(this.lastPos);
  const velocity = dist / dt;
  this.lastPos.copy(camera.position);

  if (velocity < SETTLE_THRESHOLD_VELOCITY) {
    this.settleTimer += dt;
    if (this.settleTimer >= settleSeconds
        && this.targetVantage !== this.lastReportedVantage) {
      this.setUrlFromVantage(this.targetVantage);
      this.lastReportedVantage = this.targetVantage;
    }
  } else {
    this.settleTimer = 0;
  }
}
```

The settle gate prevents URL thrashing during a transition. URL
writes happen only after motion has been below threshold for
`settleSeconds` continuous seconds, AND only if the vantage has
actually changed since the last URL write.

### Vantage change handling

```ts
private onHashChange = (): void => {
  this.targetVantage = this.options.getTargetVantageFromUrl();
  // settleTimer reset implicitly by motion velocity rising.
};
```

The mid-flight target change is the cheap case: `targetVantage`
is just a pointer swap; the damp loop catches up on next frame.

## Input bindings (PC-only)

| Input | Effect | URL? |
|---|---|---|
| `pointerdown` on canvas | Hit-test for pads (CardController) | Hash only |
| `Escape` | Target = overview vantage (`/`) | Path |
| `Tab` / `Shift+Tab` | Target = next/prev entity vantage | Path |
| `1`–`9` | Target = sector N vantage | Path |
| Wheel | Optional dolly (deferred; not v0.1) | — |
| Right-click drag | Optional micro-orbit (deferred; not v0.1) | — |

Keyboard listener is attached to `window`, gated on
`document.activeElement` being neither `<input>` nor `<textarea>`
nor `contenteditable`. This way the future FullView search box
doesn't lose typing to vantage hotkeys.

## URL state model

The URL has two independent slots:

- **Path** — the spatial vantage. Examples: `/`, `/sector/2`,
  `/node/9`. Read by `vantage(uri, corpus)`.
- **Hash** — the card lifecycle state. Examples: `#card=node-9`,
  `#card=node-9&v=full`. Read by CardController.

Both slots independently round-trip. Bookmarking
`/node/9#card=node-9&v=full` and re-opening gives:
- camera at node-9's close-up vantage
- node-9's card in FullView state

## Tests

`test/camera-controller.test.ts` — invariant locking, vitest.

| # | Test | Invariant |
|---|---|---|
| 1 | Initial state matches URL | Constructor seeds from `getTargetVantageFromUrl` |
| 2 | `update(dt)` moves position toward target | One step of damp is monotonic toward target |
| 3 | `update(dt)` is frame-rate independent | Same trajectory regardless of dt schedule |
| 4 | Settle fires only after threshold | URL write only after `settleSeconds` of low velocity |
| 5 | Settle doesn't fire if target hasn't changed | URL not rewritten on every settle event |
| 6 | Target change resets settle | New target → new settle window |
| 7 | `setBloomedMesh(mesh)` re-orients each frame | `mesh.quaternion` faces camera after `update()` |
| 8 | `setBloomedMesh(null)` stops re-orienting | Mesh quaternion stable after null-set |
| 9 | `dispose()` removes window listeners | No-op `hashchange` after dispose |

Mocked: `getTargetVantageFromUrl` and `setUrlFromVantage` are
plain functions; tests inject test doubles. Camera + scene are
real three.js objects (jsdom not required — three.js doesn't
need a DOM for Vector3 math).

## Integration changes

### `SceneManager.ts`

Remove the orbit loop. Replace with:

```ts
constructor / mount:
  // After CardController and BiomeMixer:
  this.cameraController = new CameraController({
    camera: this.camera,
    getTargetVantageFromUrl: () => vantage(window.location.pathname, this.snapshot),
    setUrlFromVantage: (v) => history.replaceState(null, '', v.uri),
  });

startLoop():
  let lastTime = 0;
  this.renderer.setAnimationLoop((time) => {
    const dt = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;
    this.cameraController?.update(dt);
    this.biomeMixer?.update({
      x: this.camera.position.x,
      z: this.camera.position.z,
    });
    this.renderer.render(this.scene, this.camera);
  });
```

The orbit loop, the start-time tracker, the angle math —
removed. Camera position becomes a *response* to the URL +
input, no longer a function of `t`.

### `CardController.ts`

Two thin changes:

1. In `applyBloom(record)`: after setting initial scale/position,
   call `this.cameraController.setBloomedMesh(record.surface.mesh)`.
2. In `applyHidden(record)` and `applyFullView(record)`: call
   `this.cameraController.setBloomedMesh(null)`.

The `record.surface.mesh.lookAt(this.options.camera.position)` line
in `applyBloom` becomes unnecessary; the CameraController handles
it per-frame.

CardController gains a constructor option for `cameraController`
reference. SceneManager wires it.

### Vantage type

The `Vantage` type in `src/world/types.ts` currently has
`position` and `lookAt` as Vec3. The CameraController needs them
as `THREE.Vector3` for the math; conversion is one line at the
boundary. Add a `uri` field to round-trip (the URL inverse of
the vantage):

```ts
interface Vantage {
  uri: string;            // ← new: the URL this vantage represents
  position: Vec3;
  lookAt: Vec3;
}
```

Existing `vantage(uri, snapshot)` returns the new shape; the
inverse mapping is trivial (just `vantage.uri`).

## Risk + open questions

- **Damp lambda tuning.** `lambda = 4` gives ~250ms to 90%
  convergence — feels "smooth but responsive." Subjective. Knob
  exposed as constructor option; default tuned during integration.
- **Settle threshold tuning.** `settleSeconds = 0.6` is one full
  exhalation; long enough that mid-transition pauses don't trip
  a URL write. Verify under real interaction.
- **Tab/Shift+Tab semantic.** "Next entity vantage" — ordered by
  what? Sector first, then entity-id-within-sector? Defer to
  whatever order `Object.values(snapshot.entities)` gives for v0.1;
  refine in v0.2 once we have real navigation patterns.
- **Number keys.** `1` → sector with `termId=2` (first sector after
  the deleted fishing term)? Or rank order by display order? For
  ALPHA's 5 sectors, `1`-`5` map to sectors sorted by `termId`
  ascending. Document in the key map.
- **`vantage()` for the homepage.** Currently returns an overview
  vantage at world height. The CameraController will start there
  on a fresh load.

## Out-of-scope follow-ons

- **Hover affordances on pads** — visual hint without state change.
  Belongs in CardController or a new HoverSystem.
- **Smooth bloom motion** — currently snap-to-bloom (instant scale
  and position). Could land in CardController via its own tween;
  not in CameraController's lane.
- **Camera shake / impact effects** — additive over the controller's
  position output. Not for v0.1.

## Size estimate

- `CameraController.ts`: ~120 LOC including comments
- `camera-controller.test.ts`: ~150 LOC
- `Vantage` interface field: +1 LOC
- `vantage()` to populate `uri`: ~5 LOC
- `SceneManager` changes: -30 LOC (orbit) + ~15 LOC (wiring) = net -15
- `CardController` changes: ~10 LOC

Total: ~280 LOC added, ~30 LOC removed, ~9 tests added.
