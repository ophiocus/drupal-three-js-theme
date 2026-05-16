// EventAsTotem — forest atmosphere's Builder for bundle=event.
//
// Renders each event as a standing-stone totem at the center of a
// moss-circle ground decal. Per docs/atmospheres/forest/mappings.yml
// (bundle.event), events are "spots in the forest where SOMETHING
// is HAPPENING" — smaller than mature article trees but visually
// heavier, with strong contrast against the floor.
//
// Geometry: tapered cylinder pillar — wider at the base, slightly
// narrower at the top, like a basalt column. Bronze/warm-stone
// material with a subtle emissive tint so the totem reads as
// "lit from within" even in deep-forest gloom.
//
// Height is currently a small per-entity variation around 6 units
// (seeded by entity id). The mappings.yml signal —
// signature.temporal.eventDate driving pulse amplitude and emissive
// color (pre-event amber → post-event patina) — is deferred to
// v0.3.x because the per-frame TemporalUrgencyComponent doesn't
// yet exist. The Builder takes the warm-amber default for now;
// when the component lands the emissive becomes time-modulated.
//
// PRIMITIVE-ONLY for v0.3.0. Real glb assets (standing-stone.glb
// per docs/atmospheres/forest/assets-needed.yml) arrive when the
// world-building technical layer runs Stage 4.

import * as THREE from "three";
import type { Entity } from "../../../types.js";
import { hashString } from "../../../layout.js";
import { SmartObject } from "../../smart-objects/SmartObject.js";
import type {
  BuilderContext,
  SmartObjectBuilder,
} from "../../smart-objects/Builder.js";
import { MeshComponent } from "../../smart-objects/components/MeshComponent.js";
import { TriggerPadComponent } from "../../smart-objects/components/TriggerPadComponent.js";
import { HtmlSurfaceComponent, cardPlacement } from "../../smart-objects/components/HtmlSurfaceComponent.js";
import { FLOOR_LAYERS } from "../../floor-layers.js";

/** Stone tones — warm bronze with a hint of patina. */
const TOTEM_STONE_COLOR = "#6e5a3c";
const TOTEM_EMISSIVE_COLOR = "#a06030";   // warm amber, pre-event default

/** Moss circle around the totem's base. Slightly darker than the
 *  forest floor so the totem reads as a deliberate clearing. */
const MOSS_CIRCLE_COLOR = "#2c3a20";

/**
 * Totem height. Mappings.yml's signal — signature.temporal.eventDate
 * → pulse amplitude — is per-frame and deferred. At build time the
 * totem gets a small deterministic height variation so every event
 * doesn't look identical. Anchored around 6 units (mappings: "smaller
 * than mature article trees"), jittered ±15%.
 */
function totemHeight(seed: number): number {
  const r = (seed & 0xff) / 255 - 0.5;
  return 6.0 * (1 + r * 0.30);
}

export class EventAsTotem implements SmartObjectBuilder {
  readonly name = "forest:event-as-totem";

  matches(descriptor: Entity): boolean {
    return descriptor.bundle === "event";
  }

  async build(descriptor: Entity, ctx: BuilderContext): Promise<SmartObject> {
    const obj = new SmartObject(descriptor.id, this.name);
    obj.position.copy(ctx.worldPosition);

    const seed = hashString(descriptor.id);
    const totalHeight = totemHeight(seed);
    const baseRadius = totalHeight * 0.18;
    const topRadius = totalHeight * 0.13;   // ~28% taper, basalt-like

    // ── Moss ground decal — flat circle just above the trigger pad
    //    layer. Reads as "this is where the event is happening." ──
    const mossRadius = totalHeight * 0.85;
    const mossGeo = new THREE.CircleGeometry(mossRadius, 32);
    mossGeo.rotateX(-Math.PI / 2);
    const mossMat = new THREE.MeshStandardMaterial({
      color: MOSS_CIRCLE_COLOR,
      roughness: 0.95,
      metalness: 0,
      // Subtle emissive so the moss circle stays readable in deep
      // forest gloom without becoming a glow ring.
      emissive: new THREE.Color(MOSS_CIRCLE_COLOR).multiplyScalar(0.10),
    });
    obj.attach(new MeshComponent({
      geometry: mossGeo,
      material: mossMat,
      // Dedicated ground_decal layer — sits ABOVE the sector pad
      // (0.5) and BELOW the trigger pad (1.0). Using
      // trigger_pad * 0.5 here was a v0.3.0 bug — that math
      // landed at 0.5, coplanar with sector_pad → z-fighting
      // across the moss ring whenever an event sat over a sector
      // centroid. floor-layers.ts exists precisely for this case.
      offset: { x: 0, y: FLOOR_LAYERS.ground_decal, z: 0 },
      // Moss isn't the click target — the totem column is.
    }));

    // ── Totem column — tapered cylinder, slight Y rotation so each
    //    totem reads as individual. ──
    const r1 = ((seed >>>  8) & 0xff) / 255;       // yaw 0..1
    const totemYaw = r1 * Math.PI * 2;             // full circle

    const totemGeo = new THREE.CylinderGeometry(
      topRadius,
      baseRadius,
      totalHeight,
      8,        // radial segments — low-poly for the stylized look
      1,
    );
    const totemMat = new THREE.MeshStandardMaterial({
      color: TOTEM_STONE_COLOR,
      roughness: 0.70,
      metalness: 0.15,
      // Warm amber emissive — the "pre-event glow" baseline. When
      // TemporalUrgencyComponent lands in v0.3.x this becomes a
      // per-frame parameter; until then it's a static warm pulse
      // that distinguishes events from articles at a glance.
      emissive: new THREE.Color(TOTEM_EMISSIVE_COLOR),
      emissiveIntensity: 0.18,
    });
    const totem = new MeshComponent({
      geometry: totemGeo,
      material: totemMat,
      offset: { x: 0, y: totalHeight / 2, z: 0 },
      entityBody: true,
    });
    obj.attach(totem);
    totem.mesh.rotation.y = totemYaw;

    // ── Capstone — small flattened sphere on top, slightly brighter,
    //    reads as the "active focal point" of the totem. ──
    const capGeo = new THREE.SphereGeometry(topRadius * 0.95, 16, 10);
    capGeo.scale(1, 0.55, 1);    // flatten to a dome
    const capMat = new THREE.MeshStandardMaterial({
      color: TOTEM_STONE_COLOR,
      roughness: 0.55,
      metalness: 0.25,
      emissive: new THREE.Color(TOTEM_EMISSIVE_COLOR),
      emissiveIntensity: 0.28,
    });
    obj.attach(new MeshComponent({
      geometry: capGeo,
      material: capMat,
      offset: { x: 0, y: totalHeight + topRadius * 0.20, z: 0 },
      entityBody: true,
    }));

    // ── Trigger pad — event-tinted disc on the moss ring's edge. ──
    obj.attach(new TriggerPadComponent({
      color: ctx.palette.bundleColors.event ?? "#8a6a40",
      offset: {
        x: 0,
        y: FLOOR_LAYERS.trigger_pad,
        z: mossRadius * 0.75,
      },
      radius: 2.2,
    }));

    // ── HTML card surface — same shared cardPlacement helper as
    //    the other forest builders. ──
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
      console.warn(`[atmosphere:forest] HtmlSurface failed for ${descriptor.id}:`, err);
    }

    return obj;
  }
}
