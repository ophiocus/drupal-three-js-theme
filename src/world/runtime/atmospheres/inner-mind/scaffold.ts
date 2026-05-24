// inner-mind — shared builder scaffolding.
//
// The acid-trip skin: abstract procedural geometry (no real assets
// yet — refine via the asset catalog later) in vivid hue-from-hash
// colours. Each builder gets the same card-lifecycle scaffold
// (trigger pad + HTML surface) so reading works identically to the
// forest skin; only the geometry + palette differ.

import * as THREE from "three";
import type { Entity } from "../../../types.js";
import type { BuilderContext } from "../../smart-objects/Builder.js";
import type { SmartObject } from "../../smart-objects/SmartObject.js";
import { TriggerPadComponent } from "../../smart-objects/components/TriggerPadComponent.js";
import { HtmlSurfaceComponent, cardPlacement } from "../../smart-objects/components/HtmlSurfaceComponent.js";
import { FLOOR_LAYERS } from "../../floor-layers.js";

/**
 * Vivid acid colour derived deterministically from an entity seed.
 * Full saturation, tunable lightness — the psychedelic register.
 */
export function acidColor(seed: number, lightness = 0.55): THREE.Color {
  const hue = (seed % 1000) / 1000;
  return new THREE.Color().setHSL(hue, 1.0, lightness);
}

/**
 * An acid-trip standard material — saturated, self-lit, faceted.
 * emissive carries the same hue so the form glows in the dark trip.
 */
export function acidMaterial(seed: number, flat = true): THREE.MeshStandardMaterial {
  const base = acidColor(seed, 0.55);
  return new THREE.MeshStandardMaterial({
    color: base,
    emissive: acidColor(seed, 0.35),
    emissiveIntensity: 0.6,
    roughness: 0.3,
    metalness: 0.1,
    flatShading: flat,
  });
}

/**
 * Trigger pad + HTML card surface — identical lifecycle to the
 * forest builders, so Bloom/FullView/reading all work unchanged.
 * Geometry is the only thing that differs between skins.
 */
export async function attachCardScaffold(
  obj: SmartObject,
  ctx: BuilderContext,
  descriptor: Entity,
  padColor: THREE.ColorRepresentation,
  padZ: number,
): Promise<void> {
  obj.attach(new TriggerPadComponent({
    color: padColor,
    offset: { x: 0, y: FLOOR_LAYERS.trigger_pad, z: padZ },
    radius: 2.4,
  }));

  try {
    const dashIdx = descriptor.id.indexOf("-");
    if (dashIdx > 0) {
      const entityType = descriptor.id.slice(0, dashIdx);
      const numericId = descriptor.id.slice(dashIdx + 1);
      const surface = await ctx.surfaceCache.acquire({
        url: `/world/card/${entityType}/${numericId}/default`,
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
    console.warn(`[atmosphere:inner-mind] HtmlSurface failed for ${descriptor.id}:`, err);
  }
}
