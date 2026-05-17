// SilhouetteHover — back-face hull outline for hover affordance.
//
// Replaces the v0.1.x emissive-multiply hover (HOVER_EMISSIVE_GAIN
// = 2.8 lifting the entire mesh's emissive channel — "the whole
// region lit up" effect at overview altitude). Instead, render
// the hovered mesh AGAIN with:
//   - the same geometry
//   - BackSide material (renders polygons whose front-normal faces
//     away from the camera — the far hemisphere of the mesh)
//   - scaled up uniformly by OUTLINE_SCALE (1.05)
//   - flat unlit MeshBasicMaterial in a warm-white color
//   - depthWrite off (let the original mesh control depth)
//   - renderOrder one below the original (drawn first; original
//     overpaints inside its silhouette; outline only peeks out
//     where the scaled-up mesh extends past the original)
//
// Result: a clean 2-3px ring around the hovered entity's
// silhouette. The mesh interior stays at atmospheric brightness;
// only the boundary lights up. Fog-respecting (the outline fogs
// alongside the front mesh). No postprocessing pipeline.
//
// Per docs/v0.4/research/SILHOUETTE_HOVER.md — back-face hull
// chosen over OutlinePass (no EffectComposer dependency), Fresnel
// rim (incompatible with forest fog), EdgesGeometry (hairline
// line-width limit), and stencil two-pass (more setup).

import * as THREE from "three";

/** Uniform scale applied to the outline mesh. 1.05 = 5% larger;
 *  readable at every camera distance we use without becoming
 *  cartoon-thick at close vantages. */
const OUTLINE_SCALE = 1.05;

/** Outline color. Warm white reads well over the forest dusk
 *  palette without competing with the warm-amber event totems. */
const OUTLINE_COLOR = 0xfff0c8;

/** SilhouetteHover manages a single active outline at a time.
 *  Mirrors the single-hover invariant the PointerNavigator already
 *  enforces — only one mesh hovered, one outline visible. */
export class SilhouetteHover {
  private currentTarget: THREE.Mesh | null = null;
  private outlineMesh: THREE.Mesh | null = null;
  private outlineMat: THREE.MeshBasicMaterial | null = null;

  /**
   * Show the outline on `target`, or clear if null.
   * Idempotent — calling set(target) when already showing
   * target is a no-op.
   */
  set(target: THREE.Mesh | null): void {
    if (target === this.currentTarget) return;
    this.clear();
    if (!target) return;
    if (!target.parent) return;  // detached mesh — can't sibling-attach
    if (!target.geometry) return;

    const mat = new THREE.MeshBasicMaterial({
      color: OUTLINE_COLOR,
      side: THREE.BackSide,
      depthWrite: false,
      // No transparency — the back-face hull doesn't blend; it just
      // peeks out at the silhouette. Transparent would invite
      // sorting issues with the surrounding scene geometry.
      transparent: false,
      // Fog-respecting; matches the front mesh's fog falloff.
      fog: true,
    });

    // Share the target's geometry — no per-hover allocation, no GPU
    // upload. Three.js handles re-use across meshes safely.
    const outline = new THREE.Mesh(target.geometry, mat);
    outline.scale.copy(target.scale).multiplyScalar(OUTLINE_SCALE);
    outline.position.copy(target.position);
    outline.quaternion.copy(target.quaternion);
    // Render the outline BEFORE the target. The target overpaints
    // inside its silhouette; the outline ring is the residue
    // outside.
    outline.renderOrder = (target.renderOrder || 0) - 1;

    // Make the outline invisible to raycasts — clicks and hovers
    // should resolve to the original mesh, never to this auxiliary
    // geometry. Overriding raycast to no-op is the canonical
    // three.js way to opt a mesh out of intersection.
    outline.raycast = () => undefined;

    target.parent.add(outline);
    this.outlineMesh = outline;
    this.outlineMat = mat;
    this.currentTarget = target;
  }

  /** Tear down the outline. Safe to call repeatedly. */
  clear(): void {
    if (this.outlineMesh) {
      this.outlineMesh.parent?.remove(this.outlineMesh);
      this.outlineMat?.dispose();
      this.outlineMesh = null;
      this.outlineMat = null;
    }
    this.currentTarget = null;
  }

  /** Free resources. Same effect as clear() — exposed under the
   *  name disposal-aware code expects. */
  dispose(): void {
    this.clear();
  }

  /** The currently-hovered mesh, or null. Useful for tests / diagnostics. */
  get target(): THREE.Mesh | null {
    return this.currentTarget;
  }
}
