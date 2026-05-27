// ProfileAsSpirit — forest atmosphere's Builder for bundle=profile.
//
// Renders each profile as a quiet bipedal presence — two cylinder
// legs, a cylinder torso, a sphere head. Sapling-scale, not
// tree-scale: a profile should read as *a person in the forest*,
// not a forest creature. Per docs/atmospheres/forest/mappings.yml
// (bundle.profile), the silhouette is essential — bipedal stack,
// shorter than the shortest article tree.
//
// Height is driven by signature.relational.inDegree (the "how
// connected is this person?" axis from mappings.yml). Highly-cited
// producers stand taller. Cap at 5.5 units so the tallest profile
// stays shorter than a small article tree (forestTreeHeight floor
// is 8).
//
// PRIMITIVE-ONLY for v0.3.0. Real glb assets (sapling-figure.glb
// per docs/atmospheres/forest/assets-needed.yml) arrive when the
// world-building technical layer runs Stage 4. The primitive path
// stays atmosphere-coherent — a forest's profile fallback is
// person-shaped, not a cube.

import * as THREE from "../../../../toolbox/three.js";
import type { Entity } from "../../../types.js";
import { hashString } from "../../../layout.js";
import { SmartObject } from "../../smart-objects/SmartObject.js";
import type {
  BuilderContext,
  SmartObjectBuilder,
} from "../../smart-objects/Builder.js";
import { MeshComponent } from "../../smart-objects/components/MeshComponent.js";
import { GltfComponent } from "../../smart-objects/components/GltfComponent.js";
import { TriggerPadComponent } from "../../smart-objects/components/TriggerPadComponent.js";
import { HtmlSurfaceComponent, cardPlacement } from "../../smart-objects/components/HtmlSurfaceComponent.js";
import { FLOOR_LAYERS } from "../../floor-layers.js";

/** Slot the profile builder consults. Matches mappings.yml. */
const PROFILE_ASSET_SLOT = "sapling-figure";

/** Bark / clothing palette by atlas_coffee region. Same termIds as
 *  ArticleAsTree's FOREST_BARK_PALETTE; the profile's clothing
 *  reads as bark-on-skin so the figure feels of-the-forest. */
const FOREST_BARK_PALETTE: Record<string, string> = {
  "2": "#3a2820",   // Antigua
  "3": "#5a4230",   // Cauca
  "4": "#4a3a30",   // Boquete
  "5": "#6a4820",   // Sierra Madre
  "6": "#3e3018",   // Tarrazú
};
const FOREST_BARK_DEFAULT = "#4a3828";

/** Head / skin tone — warm, slightly translucent-feeling cream. */
const FOREST_SKIN_COLOR = "#cfa886";

/**
 * Spirit height function. Per mappings.yml:
 *   inDegree = 1   →  2.5 units
 *   inDegree = 50  →  5.5 units
 * Log10 clamp keeps the curve readable even when the corpus has
 * one outlier connected to everything.
 */
function spiritHeight(inDegree: number): number {
  return THREE.MathUtils.mapLinear(
    Math.log10(Math.max(inDegree, 1)),
    0,
    Math.log10(50),
    2.5,
    5.5,
  );
}

export class ProfileAsSpirit implements SmartObjectBuilder {
  readonly name = "forest:profile-as-spirit";

  matches(descriptor: Entity): boolean {
    return descriptor.bundle === "profile";
  }

  async build(descriptor: Entity, ctx: BuilderContext): Promise<SmartObject> {
    const obj = new SmartObject(descriptor.id, this.name);
    obj.position.copy(ctx.worldPosition);

    const totalHeight = spiritHeight(descriptor.signature.relational.inDegree);

    // v0.4 / ALPHA 1: real .glb if a curated sapling-figure asset
    // is live in the active atmosphere; primitive bipedal stack is
    // the fallback. Asset is scaled so its bounding-box height
    // equals the in-degree-derived spirit height — preserves the
    // "more connected = taller" signal regardless of which figure
    // .glb is wired.
    const prop = await ctx.tryLoadProp(PROFILE_ASSET_SLOT);
    if (prop) {
      const box = new THREE.Box3().setFromObject(prop.scene);
      const size = new THREE.Vector3();
      box.getSize(size);
      const naturalHeight = Math.max(size.y, 0.01);
      const scale = totalHeight / naturalHeight;
      obj.attach(new GltfComponent({
        scene: prop.scene,
        scale,
        pivot: prop.descriptor.pivot,
        entityBody: true,
      }));
      // torsoRadiusJittered isn't meaningful for a .glb — pass a
      // proportional estimate matching the primitive's geometry so
      // the trigger pad sits at the same approximate distance.
      const padOffset = totalHeight * 0.10 + 2.4;
      await this.attachCardScaffold(obj, ctx, descriptor, totalHeight, padOffset);
      return obj;
    }

    // Anatomical proportions — broadly humanoid but stylized.
    //   legs   ~45% of total height
    //   torso  ~38% of total height
    //   head   ~12% of total height (sphere diameter)
    // Remaining ~5% is a small neck gap that reads as "shoulders."
    const legHeight = totalHeight * 0.45;
    const torsoHeight = totalHeight * 0.38;
    const headRadius = totalHeight * 0.06;   // sphere → diameter 0.12 * total
    const legRadius = totalHeight * 0.045;
    const torsoRadius = totalHeight * 0.10;
    const stanceHalfWidth = totalHeight * 0.055;  // legs apart by ±this

    // Deterministic silhouette variation. Same FNV-1a trick as
    // ArticleAsTree; different bit-slices drive different jitters.
    const seed = hashString(descriptor.id);
    const r1 = (seed         & 0xff) / 255 - 0.5;  // torso-yaw, ±0.5
    const r2 = ((seed >>>  8) & 0xff) / 255 - 0.5; // head-tilt, ±0.5
    const r3 = ((seed >>> 16) & 0xff) / 255;       // torso-radius jitter
    const torsoYaw = r1 * 0.40;        // ±~11°
    const headTilt = r2 * 0.18;        // ±~5°
    const torsoRadiusJittered = torsoRadius * (1 + (r3 - 0.5) * 0.20); // ±10%

    const primarySector = descriptor.taxonomyTerms[0] ?? null;
    const barkHex = primarySector
      ? (FOREST_BARK_PALETTE[primarySector] ?? FOREST_BARK_DEFAULT)
      : FOREST_BARK_DEFAULT;

    const barkMat = new THREE.MeshStandardMaterial({
      color: barkHex,
      roughness: 0.85,
      metalness: 0,
    });

    // ── Legs — two cylinders, slightly tapered, planted apart. ──
    const legGeoFactory = () => new THREE.CylinderGeometry(
      legRadius * 0.85,
      legRadius,
      legHeight,
      8,
      1,
    );
    for (const sign of [-1, 1] as const) {
      obj.attach(new MeshComponent({
        geometry: legGeoFactory(),
        material: barkMat,
        offset: {
          x: sign * stanceHalfWidth,
          y: legHeight / 2,
          z: 0,
        },
        entityBody: true,
      }));
    }

    // ── Torso — cylinder, slight yaw. Center at hips + half torso. ──
    const torsoGeo = new THREE.CylinderGeometry(
      torsoRadiusJittered * 0.78,   // narrower at the shoulders
      torsoRadiusJittered,          // wider at the hips
      torsoHeight,
      10,
      1,
    );
    const torso = new MeshComponent({
      geometry: torsoGeo,
      material: barkMat,
      offset: {
        x: 0,
        y: legHeight + torsoHeight / 2,
        z: 0,
      },
      entityBody: true,
    });
    // Apply the yaw on the mesh directly after attach — the
    // component owns the mesh.
    obj.attach(torso);
    torso.mesh.rotation.y = torsoYaw;

    // ── Head — sphere atop the torso, gentle tilt. ──
    const headGeo = new THREE.SphereGeometry(headRadius, 16, 12);
    const headMat = new THREE.MeshStandardMaterial({
      color: FOREST_SKIN_COLOR,
      roughness: 0.75,
      metalness: 0,
    });
    // Small neck gap (~5% of totalHeight) between torso top and
    // head center, so the silhouette reads as "person with neck"
    // rather than "bowling pin."
    const head = new MeshComponent({
      geometry: headGeo,
      material: headMat,
      offset: {
        x: 0,
        y: legHeight + torsoHeight + totalHeight * 0.025 + headRadius,
        z: 0,
      },
      entityBody: true,
    });
    obj.attach(head);
    head.mesh.rotation.z = headTilt;

    await this.attachCardScaffold(
      obj,
      ctx,
      descriptor,
      totalHeight,
      torsoRadiusJittered + 2.4,
    );
    return obj;
  }

  /**
   * Trigger pad + HTML surface — shared scaffold for asset and
   * primitive paths (mirrors ArticleAsTree.attachCardScaffold).
   *
   * padZ is the pad's Z offset from the entity origin; the asset
   * path passes a proportional estimate since a .glb doesn't expose
   * a "torso radius."
   */
  private async attachCardScaffold(
    obj: SmartObject,
    ctx: BuilderContext,
    descriptor: Entity,
    totalHeight: number,
    padZ: number,
  ): Promise<void> {
    obj.attach(new TriggerPadComponent({
      color: ctx.palette.bundleColors.profile ?? "#7a5a3a",
      offset: { x: 0, y: FLOOR_LAYERS.trigger_pad, z: padZ },
      // Smaller pad than article trees — profiles are intimate.
      radius: 2.0 * (0.7 + 0.3 * (totalHeight / 5.5)),
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
      console.warn(`[atmosphere:forest] HtmlSurface failed for ${descriptor.id}:`, err);
    }
  }
}
