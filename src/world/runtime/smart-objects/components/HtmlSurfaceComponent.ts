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
