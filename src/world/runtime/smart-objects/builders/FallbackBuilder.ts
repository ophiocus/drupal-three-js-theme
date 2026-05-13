// FallbackBuilder — the safety net.
//
// Matches every descriptor (its matches() always returns true).
// Produces a SmartObject that looks like the v0.0.1-alpha
// placeholder: a bundle-tinted cube + a small trigger pad in
// front + an HTML surface floating above.
//
// Used directly when no more-specific builder claims a
// descriptor, and as the error-recovery target when a
// more-specific builder throws (see SmartObjectRegistry.build).
//
// The cube here is a fixed 12-unit cube — no signature mapping.
// ArticleBuilder is what introduces word-count→side modulation;
// the fallback stays plain so failures are visually distinct
// from the "real" article geometry.

import * as THREE from "three";
import type { Entity } from "../../../types.js";
import { SmartObject } from "../SmartObject.js";
import type { BuilderContext, SmartObjectBuilder } from "../Builder.js";
import { MeshComponent } from "../components/MeshComponent.js";
import { TriggerPadComponent } from "../components/TriggerPadComponent.js";
import { HtmlSurfaceComponent } from "../components/HtmlSurfaceComponent.js";

const FALLBACK_CUBE_SIDE = 12;

export class FallbackBuilder implements SmartObjectBuilder {
  readonly name = "fallback";

  matches(_descriptor: Entity): boolean {
    return true;
  }

  async build(descriptor: Entity, ctx: BuilderContext): Promise<SmartObject> {
    const obj = new SmartObject(descriptor.id, this.name);
    obj.position.copy(ctx.worldPosition);

    // Bundle-tinted cube. The fallback uses the bundle color hint
    // so even unrecognized bundles get differentiated visually.
    const bundleColor = ctx.palette.bundleColors[descriptor.bundle]
      ?? ctx.palette.bundleColors.default
      ?? "#808080";
    const geometry = new THREE.BoxGeometry(
      FALLBACK_CUBE_SIDE, FALLBACK_CUBE_SIDE, FALLBACK_CUBE_SIDE,
    );
    const material = new THREE.MeshStandardMaterial({
      color: bundleColor,
      roughness: 0.65,
      metalness: 0.08,
    });
    obj.attach(new MeshComponent({
      geometry, material,
      offset: { x: 0, y: FALLBACK_CUBE_SIDE / 2, z: 0 },
      entityBody: true,
    }));

    obj.attach(new TriggerPadComponent({
      color: bundleColor,
      offset: { x: 0, y: 0.1, z: 7 },
    }));

    // HTML surface, when acquirable. Failure to fetch is logged
    // by the SurfaceCache; we degrade to "just the cube" gracefully.
    try {
      const dashIdx = descriptor.id.indexOf("-");
      if (dashIdx > 0) {
        const entityType = descriptor.id.slice(0, dashIdx);
        const numericId = descriptor.id.slice(dashIdx + 1);
        const url = `/world/card/${entityType}/${numericId}/default`;
        const surface = await ctx.surfaceCache.acquire({
          url,
          widthPx: 600,
          heightPx: 400,
          widthWorld: 18,
          heightWorld: 12,
          transparent: true,
        });
        // Position the surface outward from origin so the
        // overview camera reads a readable angle.
        const wp = ctx.worldPosition;
        const distFromOrigin = Math.sqrt(wp.x * wp.x + wp.z * wp.z) || 1;
        const outX = (wp.x / distFromOrigin) * 12;
        const outZ = (wp.z / distFromOrigin) * 12;
        obj.attach(new HtmlSurfaceComponent({
          surface,
          offset: { x: outX, y: 14, z: outZ },
          // Face the world origin from the offset position
          // (interpreted relative to host group, so the lookAt
          // target is the negative of the offset direction).
          lookAt: { x: -wp.x, y: 14, z: -wp.z },
        }));
      }
    } catch (err) {
      console.warn(`[world] HtmlSurface failed for ${descriptor.id}:`, err);
    }

    return obj;
  }
}
