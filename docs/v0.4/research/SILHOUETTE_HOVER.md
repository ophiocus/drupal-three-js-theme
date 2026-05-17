# Research: silhouette hover

**Status:** research, not yet implemented. Sister doc to
`INFORMATION_LOD.md`.

The user request that triggered this:

> In three.js, research for highlighting a "silhouette" so that on
> hover is not so overwhelming on the regions.

The current hover affordance in `PointerNavigator`
(`HOVER_EMISSIVE_GAIN = 2.8`) lifts the *entire mesh's* emissive
channel, making the whole tree / spirit / totem glow brighter. At
overview altitude with many entities in frame, this reads as a
"the whole region just lit up" effect — too loud, too contextual,
washes out the atmosphere.

A silhouette/outline-only hover is the right shape: **edges
emphasised, surface left alone**. The mesh stays at its
atmospheric brightness; only its boundary lights up.

Five techniques in three.js fit the requirement. Each makes
different trade-offs around crispness, performance, postprocessing
dependencies, and how well it composites with the existing
material setup.

## Technique 1 — `OutlinePass` (postprocessing)

**What.** Three.js's `examples/jsm/postprocessing/OutlinePass` is
the canonical "Sketchfab-style" outline. Renders selected objects
to a separate buffer, edge-detects, composites a glow over the
main render.

**Pros.**
- Industry-standard look — pixel-perfect outlines, optional glow,
  multi-color support.
- One `OutlinePass.selectedObjects = [mesh]` line per hover
  change; the rest is config.
- Animatable outline strength / color for visual polish.

**Cons.**
- Requires the full `EffectComposer` postprocessing pipeline.
  Currently the renderer calls `this.renderer.render(scene, camera)`
  directly. Adding EffectComposer touches every frame.
- Extra ~30 KB of code (composer + render pass + outline pass).
- Postprocessing in WebGL has known issues with antialiasing —
  needs an explicit FXAA or SMAA pass paired with it.
- All effects route through the composer once present; debugging
  rendering issues becomes "is it the scene or the composer?"

**Verdict.** Quality bar is highest. Cost is also highest.
Architecturally right for a renderer that wants postprocessing
generally; overkill if hover-outline is the only effect.

## Technique 2 — Back-face hull (inverted-mesh trick)

**What.** Classic toon-shader / Borderlands-style outline. For
each hovered object, render its geometry a second time with:
- material reversed (`THREE.BackSide`)
- vertex scale up by a small factor (1.03–1.08)
- flat unlit color (the outline color)
- depth-tested but not depth-written

The back-faces poke out behind the front-faces along the
silhouette → solid crisp outline. No postprocessing needed.

**Pros.**
- No postprocessing pipeline — pure scene-graph addition.
- Cheap: O(hovered-mesh-triangles) per frame, exactly as expensive
  as drawing the mesh once more.
- Always-readable thickness (the scale factor controls it
  predictably).
- Plays well with existing fog, ambient, fragment shaders.

**Cons.**
- Doesn't work cleanly on meshes with sharp creases or holes —
  inverted normals at concave geometry can produce visible
  artefacts. Our entities (trees, spirits, totems) are mostly
  convex, so this is fine.
- One extra draw call per hovered object. Negligible at our
  one-at-a-time hover model.
- Vertex-shader extrusion via scale doesn't account for non-uniform
  geometry → some outlines are uneven. Mitigation: extrude along
  vertex normals in a vertex shader instead of pure scale. ~6
  lines of `onBeforeCompile` hook.

**Verdict.** Best fit for our current renderer. Crisp outline, no
new pipeline, ~30 LOC of implementation. The mainstream answer for
"toon outline" in non-postprocessing pipelines.

## Technique 3 — Fresnel rim lighting

**What.** Per-pixel emissive boost driven by `1 - dot(N, V)` —
the angle between surface normal and view vector. Edges of the
mesh (where the normal is perpendicular to the camera) get
brightest; surface centres stay dark.

**Pros.**
- Pure shader modification — zero extra draw calls.
- Softer, more atmospheric than a hard outline. Looks like a
  glow caught on the silhouette rather than a stamped border.
- Trivially animatable (pulse the rim strength).
- Works on every standard material via `onBeforeCompile` injection.

**Cons.**
- "Outline" isn't crisp — it's a gradient from edge to interior,
  ~10-20% of the silhouette depth. For "you can click this," that
  may not read clearly enough at small entity sizes (the spirits
  are 2.5–5.5 units tall; a soft rim might just look like extra
  ambient light).
- Doesn't survive in fog — Fresnel intensity is unrelated to
  scene fog, so at fogged distances the rim glow looks
  disconnected from the mesh.

**Verdict.** Beautiful when it works (close range, clear air).
Wrong for our forest atmosphere with its fog-from-the-near-plane.
Worth keeping in the toolkit as a possible **detail-vantage hover
treatment** specifically, where fog isn't an issue.

## Technique 4 — `EdgesGeometry` + `LineSegments`

**What.** Three.js's built-in `EdgesGeometry` extracts hard edges
(angle threshold, default 1°) from a geometry. Render the edges
as line segments with a brighter material.

**Pros.**
- One line: `new THREE.LineSegments(new THREE.EdgesGeometry(geo), mat)`.
- Doesn't depend on any custom shader.
- Works for hard-edged geometry (cubes, cylinders, cones).

**Cons.**
- WebGL line width is hardcoded to 1px in most browsers (the
  `linewidth` material property is ignored in WebGL2 for desktop
  renderers). Lines stay hairlines — barely visible at distance.
- Doesn't draw "silhouette" — it draws *sharp edges*. A sphere has
  no sharp edges, so the spirit's head wouldn't have an edges
  outline. The trunk's cylinder edges would show but the canopy
  cone's curve-to-curve edges wouldn't.
- For meaningful line thickness, you need `Line2` /
  `LineMaterial` from `examples/jsm/lines/` — another module to
  pull in, and the lines render in screen-space, breaking depth
  ordering at the silhouette.

**Verdict.** Cheap, but doesn't deliver the silhouette read the
user wants. Wrong tool.

## Technique 5 — Stencil-buffer two-pass

**What.** Render the hovered mesh into the stencil buffer first
(mark its pixels). Then render a scaled-up version of the same
mesh with stencil-testing reversed (only draw where stencil is
0 — i.e., where the bigger mesh extends past the original). That
band is the outline.

**Pros.**
- Pixel-perfect crisp outlines, exact thickness control.
- Doesn't require a full postprocessing pipeline.

**Cons.**
- WebGL stencil buffer requires renderer setup
  (`renderer.context.STENCIL_TEST` etc.) — not enabled by default
  in three.js.
- Two extra draw calls per hovered object (stencil + outline draw)
  vs back-face hull's one.
- More moving parts to debug — stencil state is global, leaks
  between draws if not cleared.

**Verdict.** Higher-quality than back-face hull, but with more
setup. Worth it only if the back-face hull's normal-direction
artefacts become visible on real asset geometry.

## Comparison table

| Technique | Crispness | Cost | Pipeline req | Fits forest fog | LOC est |
| --- | --- | --- | --- | --- | --- |
| OutlinePass | excellent | high | EffectComposer | yes | ~50 + new dep |
| Back-face hull | good | low | none | yes | ~30 |
| Fresnel rim | soft | very low | none | **no** (fog conflict) | ~20 |
| EdgesGeometry | thin | very low | none | yes but invisible | ~10 |
| Stencil two-pass | excellent | medium | renderer setup | yes | ~50 |

## Recommendation: back-face hull

For v0.4, **back-face hull** is the right answer:

1. No postprocessing pipeline to introduce.
2. Crisp readable outline at every camera distance.
3. Fog-respecting (the hull mesh fogs alongside the front mesh).
4. ~30 LOC of straightforward three.js code.
5. Works on every entity geometry the forest atmosphere uses
   (cylinders, cones, spheres — all convex).

When postprocessing arrives for another reason
(`TemporalUrgencyComponent` for event totems, future bloom for
chatvatar dialogue, etc.), the conversation re-opens — `OutlinePass`
becomes the better answer once the composer is paying its rent.

### Implementation sketch

```ts
// src/world/runtime/hud/SilhouetteHover.ts

import * as THREE from "three";

const OUTLINE_SCALE = 1.04;      // 4% scale — readable at all distances
const OUTLINE_COLOR = 0xfff0c8;  // warm white; legible on forest dusk

export class SilhouetteHover {
  private currentMesh: THREE.Mesh | null = null;
  private outlineMesh: THREE.Mesh | null = null;

  set(target: THREE.Mesh | null): void {
    if (target === this.currentMesh) return;
    this.clear();
    if (!target) return;
    // Clone geometry (or share — back-face material can read same buffer).
    // Inverted-side material so back-faces draw in front of the silhouette.
    const mat = new THREE.MeshBasicMaterial({
      color: OUTLINE_COLOR,
      side: THREE.BackSide,
      depthWrite: false,
      transparent: true,
      opacity: 0.85,
    });
    const outline = new THREE.Mesh(target.geometry, mat);
    outline.scale.copy(target.scale).multiplyScalar(OUTLINE_SCALE);
    outline.position.copy(target.position);
    outline.quaternion.copy(target.quaternion);
    outline.renderOrder = target.renderOrder + 0.5;
    target.parent?.add(outline);  // attach as sibling
    this.outlineMesh = outline;
    this.currentMesh = target;
  }

  clear(): void {
    if (this.outlineMesh) {
      this.outlineMesh.parent?.remove(this.outlineMesh);
      (this.outlineMesh.material as THREE.Material).dispose();
      this.outlineMesh = null;
    }
    this.currentMesh = null;
  }
}
```

In `PointerNavigator.updateHover`, replace the emissive-multiply
logic with `silhouette.set(meshOrNull)`. Drop `HOVER_EMISSIVE_GAIN`
and the `_baseEmissive` userData stash entirely.

### Polish refinements (future)

- **Normal-direction extrusion** instead of uniform scale, when the
  uniform scale produces uneven outlines on tall narrow geometry.
  Implemented via `onBeforeCompile` hook on the outline material's
  vertex shader.
- **Pulsing or breathing** outline opacity for emphasis on
  important entities (event totems' temporal urgency, monument
  silhouettes).
- **Per-bundle outline color** — articles get green-tinted,
  profiles warm, events amber. Subtle reinforcement of the bundle
  identity at hover time.

## What the v0.4 commit will ship

- This research doc.
- An implementation of the back-face hull technique as
  `src/world/runtime/hud/SilhouetteHover.ts`.
- `PointerNavigator` switched from emissive-gain to silhouette set
  in `updateHover` / `clearHover`.
- `HOVER_EMISSIVE_GAIN` constant + `userData._baseEmissive` plumbing
  removed.

Verification needed in browser: hover at overview altitude reads
quieter; the region as a whole stays atmospheric; only the hovered
entity's silhouette emphasises.
