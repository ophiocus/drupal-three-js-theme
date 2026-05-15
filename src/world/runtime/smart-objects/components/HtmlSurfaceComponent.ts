// HtmlSurfaceComponent — wraps an HtmlSurface (the engine
// differentiator) as a SmartObject component.
//
// The actual rendering machinery (HtmlSurface, SurfaceCache, the
// HIC/html-to-image bridge) is unchanged — this just makes the
// surface mesh discoverable via SmartObject.findComponent() so
// CardController can read it on bloom.
//
// Async by nature: surface acquisition involves a network fetch
// + rasterization. The component is constructed with the fetch
// in flight; onAttach adds the surface mesh to the host.

import type { Component, SmartObject } from "../SmartObject.js";
import type { HtmlSurface } from "../../HtmlSurface.js";

/**
 * Card height — matches the lookAt-y in vantage.ts's detail case
 * so the detail camera frames the card consistently. Both ends of
 * the diagram (Drupal's WORLD_CONSTANTS closeUpHeight in the
 * cypher, this constant here in the renderer) need to land
 * roughly in the same band: camera at ~14, card at ~8, entity
 * base at ~0 — the camera looks slightly down at the card with
 * the entity below.
 */
export const CARD_Y = 8;

/** How far outward (toward the detail camera) the card sits. */
const CARD_OUTWARD = 8;

/**
 * Shared card-placement math for every builder. Returns the local
 * offset (within the SmartObject group) and the world-space
 * lookAt target so the card's front face points OUTWARD — toward
 * the detail-vantage camera, which always approaches along the
 * origin → entity ray.
 *
 * three.js's Object3D.lookAt orients -Z at the target; we want +Z
 * (the textured front) facing outward, so the lookAt target is
 * the entity's mirror across origin: a point far INWARD. The
 * mesh's -Z points inward → +Z points outward toward the camera.
 *
 * For entities at the origin (centroid 0,0), the outward direction
 * is undefined; default to +Z so the world doesn't crash.
 */
export function cardPlacement(worldPosition: { x: number; z: number }): {
  offset: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
} {
  const dist = Math.sqrt(
    worldPosition.x * worldPosition.x + worldPosition.z * worldPosition.z,
  );
  if (dist < 0.001) {
    return {
      offset: { x: 0, y: CARD_Y, z: CARD_OUTWARD },
      lookAt: { x: 0, y: CARD_Y, z: -CARD_OUTWARD },
    };
  }
  const outX = worldPosition.x / dist;
  const outZ = worldPosition.z / dist;
  return {
    offset: { x: outX * CARD_OUTWARD, y: CARD_Y, z: outZ * CARD_OUTWARD },
    lookAt: { x: -worldPosition.x, y: CARD_Y, z: -worldPosition.z },
  };
}

export interface HtmlSurfaceComponentOptions {
  /** Pre-acquired surface (the Builder did the await before constructing). */
  surface: HtmlSurface;
  /** Offset from the SmartObject's group origin. */
  offset?: { x: number; y: number; z: number };
  /**
   * Look-at target relative to the SmartObject's group origin.
   * The surface mesh is oriented toward this point at attach time;
   * CameraController takes over continuous facing on bloom.
   */
  lookAt?: { x: number; y: number; z: number };
}

export class HtmlSurfaceComponent implements Component {
  readonly surface: HtmlSurface;

  constructor(private readonly options: HtmlSurfaceComponentOptions) {
    this.surface = options.surface;
  }

  onAttach(host: SmartObject): void {
    const mesh = this.surface.mesh;
    if (this.options.offset) {
      mesh.position.set(
        this.options.offset.x, this.options.offset.y, this.options.offset.z,
      );
    }
    if (this.options.lookAt) {
      mesh.lookAt(
        this.options.lookAt.x, this.options.lookAt.y, this.options.lookAt.z,
      );
    }
    host.add(mesh);
  }

  /**
   * HtmlSurface owns its own dispose path (texture, material).
   * The surface might be shared via SurfaceCache, though — only
   * dispose if the cache says we're the last reference. For
   * v0.1.2 the cache is permissive (no refcount), so we don't
   * dispose here; the SurfaceCache handles cleanup on snapshot
   * version change.
   */
}
