// FallbackBuilder — the safety net + the UE5-meta blockout.
//
// Matches every descriptor (its matches() always returns true).
// Used directly when no more-specific builder claims a descriptor
// (no atmosphere active, or a bundle the active atmosphere doesn't
// claim), and as the error-recovery target when a more-specific
// builder throws (see SmartObjectRegistry.build).
//
// v0.2.x: the fallback is now a deliberate UE5-style blockout —
// a fixed 12-unit cube wearing the UV-test texture, neutral
// material, no bundle tint ("transparent color slot"). It reads
// as "this is placeholder, configure me" rather than "this is
// finished." When the world has no atmosphere, every entity is
// honest graybox.

import * as THREE from "three";
import type { Entity } from "../../../types.js";
import { SmartObject } from "../SmartObject.js";
import type { BuilderContext, SmartObjectBuilder } from "../Builder.js";
import { MeshComponent } from "../components/MeshComponent.js";
import { TriggerPadComponent } from "../components/TriggerPadComponent.js";
import { HtmlSurfaceComponent, cardPlacement } from "../components/HtmlSurfaceComponent.js";
import { metaMaterial, META_PAD_COLOR } from "../../uv-test-texture.js";
import { FLOOR_LAYERS } from "../../floor-layers.js";

const FALLBACK_CUBE_SIDE = 12;

export class FallbackBuilder implements SmartObjectBuilder {
  readonly name = "fallback";

  matches(_descriptor: Entity): boolean {
    return true;
  }

  async build(descriptor: Entity, ctx: BuilderContext): Promise<SmartObject> {
    const obj = new SmartObject(descriptor.id, this.name);
    obj.position.copy(ctx.worldPosition);

    // UE5-meta cube — UV-test texture, neutral material, no bundle
    // tint. The "transparent color slot" lives in metaMaterial():
    // base color is white, the texture shows true. Unrecognized
    // bundles all read identically — graybox is graybox.
    const geometry = new THREE.BoxGeometry(
      FALLBACK_CUBE_SIDE, FALLBACK_CUBE_SIDE, FALLBACK_CUBE_SIDE,
    );
    obj.attach(new MeshComponent({
      geometry,
      material: metaMaterial(),
      offset: { x: 0, y: FALLBACK_CUBE_SIDE / 2, z: 0 },
      entityBody: true,
    }));

    obj.attach(new TriggerPadComponent({
      color: META_PAD_COLOR,
      offset: { x: 0, y: FLOOR_LAYERS.trigger_pad, z: 7 },
    }));

    // HTML surface — shared cardPlacement (v0.2.1-P4) so the
    // detail vantage frames it consistently regardless of which
    // builder produced the SmartObject. Failure to fetch degrades
    // to "just the cube" — the SurfaceCache logs the error.
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
        const { offset, lookAt } = cardPlacement(ctx.worldPosition);
        obj.attach(new HtmlSurfaceComponent({ surface, offset, lookAt }));
      }
    } catch (err) {
      console.warn(`[world] HtmlSurface failed for ${descriptor.id}:`, err);
    }

    return obj;
  }
}
