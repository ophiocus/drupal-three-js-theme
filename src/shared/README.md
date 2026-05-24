# src/shared — cross-project source of truth

Dependency-free, framework-agnostic pieces shared across the three.js +
Vite sibling projects. **This directory is canonical: edit here,
sync FROM here, never fork divergent copies.** When you improve a
shared piece, improve it here and re-sync the consumers.

## Components

### `LoaderOverlay.ts`
A pure-DOM loading gate: fixed overlay, CSS pulsing-dot spinner,
message line, count-based progress, fade in/out. Zero dependencies.
Push API: `setMessage()`, `setProgress(done, total)`, `hide()`,
`dispose()`. Options: `title`, `message`, `backgroundColor`, `color`,
`fadeMs`, `namespace` (CSS/keyframe namespace so instances/apps don't
collide).

**Consumers**
- `drupal-three-js-theme` (this repo, TS) — imported by
  `src/world/runtime/SceneManager.ts` with `namespace: "world-loader"`.
- `VirtuaBooth` (sibling, vanilla JS) — see recipe below.

## Consuming in a sibling (e.g. VirtuaBooth — JS three.js + Vite)

1. **Copy the file in.** Vite transpiles `.ts` transparently, so the
   zero-friction path is to drop `LoaderOverlay.ts` into the sibling
   (e.g. `js/src/LoaderOverlay.ts`) and import it directly. If the
   project insists on pure JS for its eslint/jsdoc toolchain, strip the
   type annotations — there is no other TS-specific surface.

2. **Wire it into the model load.** For a GLTFLoader-based showroom the
   loader's progress maps to real download bytes:

   ```js
   import { LoaderOverlay } from "./src/LoaderOverlay.js";

   const loader = new LoaderOverlay({
     title: "VirtuaBooth",
     message: "loading configurator",
     namespace: "vb-loader",
     // backgroundColor / color: match the showroom palette
   });

   new GLTFLoader().load(
     "/models/raspberry-pi-5.glb",
     (gltf) => { scene.add(gltf.scene); loader.hide(); },
     (xhr) => loader.setProgress(xhr.loaded, xhr.total), // byte progress
     (err) => { console.error(err); loader.dispose(); },
   );
   ```

3. **Theme it** via the constructor options to the host palette.

## Why "source of truth here for now"

These pieces are generic enough to one day live in their own published
package. Until that's justified, this directory is the single
authority and siblings copy from it. The rule that keeps it honest:
**any fix lands here first**, then re-syncs outward — same discipline
as the skeleton-retrofit protocol, scoped to shared snippets.
