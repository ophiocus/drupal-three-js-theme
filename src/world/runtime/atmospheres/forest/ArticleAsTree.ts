// ArticleAsTree — forest atmosphere's Builder for bundle=article.
//
// Renders each article as a stylized tree: cylinder trunk +
// stacked cone canopy. Word count drives total height (same
// log scale as the default ArticleBuilder's cube side — the
// "universal" signature mapping from v0.1.2b carries through;
// only the geometry changes).
//
// PRIMITIVE-ONLY for the v0.2.0 pilot. Real glb assets
// (oak-stylized.glb per docs/atmospheres/forest/assets-needed.yml)
// arrive when the world-building technical layer runs Stage 4
// of the atmosphere pipeline. The Builder is structured so the
// primitive path is interchangeable with a glb-load path; only
// the geometry construction differs.
//
// Per docs/ATMOSPHERES.md §"Pending-asset handling": this stays
// atmosphere-coherent — a forest's primitive fallback is still
// tree-shaped, not a cube.

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

/** Forest atmosphere bark palette by atlas_coffee region. */
const FOREST_BARK_PALETTE: Record<string, string> = {
  // termId → color. The fixture seeder creates terms tid=2..6 for
  // Antigua / Cauca / Boquete / Sierra Madre / Tarrazú; map by
  // termId rather than slug since the descriptor carries termIds.
  "2": "#3a2820",   // Antigua — volcanic dark soil tones
  "3": "#5a4230",   // Cauca — Andean mid-bark
  "4": "#4a3a30",   // Boquete — cloud-forest moss-darkened
  "5": "#6a4820",   // Sierra Madre — warmer dust-bark
  "6": "#3e3018",   // Tarrazú — deep saturated bark
};
const FOREST_BARK_DEFAULT = "#4a3828";

/** Foliage base color for the forest atmosphere. */
const FOREST_FOLIAGE_COLOR = "#5a7a3a";

/**
 * Forest-atmosphere tree height function. Bumped from the
 * default ArticleBuilder's cube range so the silhouette
 * dominates the sector pads instead of garnishing them
 * (P2 from docs/v0.2/ROADMAP.md).
 *
 * Anchors (log10(wordCount), totalHeight):
 *   1 word     →  8 units
 *   100 words  → 21.5
 *   10,000     → 35 units
 *
 * Trees now overlap the canopy band of neighbouring trees in
 * the same sector — the forest feels like a forest, not a
 * spaced-out garden.
 */
function forestTreeHeight(wordCount: number): number {
  return THREE.MathUtils.mapLinear(
    Math.log10(Math.max(wordCount, 1)),
    0, 4,
    8, 35,
  );
}

export class ArticleAsTree implements SmartObjectBuilder {
  readonly name = "forest:article-as-tree";

  matches(descriptor: Entity): boolean {
    return descriptor.bundle === "article";
  }

  async build(descriptor: Entity, ctx: BuilderContext): Promise<SmartObject> {
    const obj = new SmartObject(descriptor.id, this.name);
    obj.position.copy(ctx.worldPosition);

    // v0.2.1-P2: forest trees use their own size function (range
    // [8, 35]) so they read at sector-pad scale, not garnish.
    const totalHeight = forestTreeHeight(descriptor.signature.structural.wordCount);
    const trunkHeight = totalHeight * 0.45;
    const trunkRadius = totalHeight * 0.06;
    const canopyHeightBase = totalHeight * 0.65;
    const canopyRadiusBase = totalHeight * 0.32;

    // v0.2.1-P5: deterministic per-tree silhouette variation.
    // Hash the entity id once; slice 8-bit channels for
    // independent jitters. Stable across reloads (FNV-1a is
    // pure), so the world's trees keep their identities.
    //
    // Cylinder + cone are rotationally symmetric around Y, so
    // a Y rotation would be visually invisible — the readable
    // variations are canopy radius, canopy height, slight XZ
    // offset (leaning canopy), and an optional second smaller
    // canopy stacked atop tall trees.
    const seed = hashString(descriptor.id);
    const r1 = (seed         & 0xff) / 255;         // canopy radius
    const r2 = ((seed >>>  8) & 0xff) / 255;        // canopy height
    const r3 = ((seed >>> 16) & 0xff) / 255 - 0.5;  // canopy X offset, ±0.5
    const r4 = ((seed >>> 24) & 0xff) / 255 - 0.5;  // canopy Z offset, ±0.5
    const upperCanopyBit = ((seed >>> 4) & 1) === 1;

    const canopyRadius = canopyRadiusBase * (1 + (r1 - 0.5) * 0.30); // ±15%
    const canopyHeight = canopyHeightBase * (1 + (r2 - 0.5) * 0.40); // ±20%
    const canopyXOff = r3 * canopyRadiusBase * 0.18;
    const canopyZOff = r4 * canopyRadiusBase * 0.18;
    // Upper canopy on ~50% of tall trees: a smaller cone stacked
    // above the main canopy. Breaks the rigid single-cone silhouette
    // for the trees that have room for it.
    const hasUpperCanopy = totalHeight > 18 && upperCanopyBit;

    const primarySector = descriptor.taxonomyTerms[0] ?? null;
    const barkHex = primarySector
      ? (FOREST_BARK_PALETTE[primarySector] ?? FOREST_BARK_DEFAULT)
      : FOREST_BARK_DEFAULT;

    // Trunk — cylinder, vertical. CylinderGeometry's height axis
    // is Y by default, which matches three.js's up convention.
    const trunkGeo = new THREE.CylinderGeometry(
      trunkRadius * 0.85,   // top radius slightly tapered
      trunkRadius,          // bottom radius
      trunkHeight,
      8,                    // radial segments — keep low-poly
      1,
    );
    const trunkMat = new THREE.MeshStandardMaterial({
      color: barkHex,
      roughness: 0.85,
      metalness: 0,
    });
    obj.attach(new MeshComponent({
      geometry: trunkGeo,
      material: trunkMat,
      // Trunk's local origin is at its center; lift it so the
      // bottom sits at y=0.
      offset: { x: 0, y: trunkHeight / 2, z: 0 },
      // The trunk is the click target — "navigate to this article."
      entityBody: true,
    }));

    // Canopy — a stacked cone. ConeGeometry's tip points along +Y.
    const canopyGeo = new THREE.ConeGeometry(
      canopyRadius,
      canopyHeight,
      8,                    // radial segments
      3,                    // height segments — let the silhouette breathe slightly
    );
    const canopyMat = new THREE.MeshStandardMaterial({
      color: FOREST_FOLIAGE_COLOR,
      roughness: 0.7,
      metalness: 0,
      // The flat-shaded look gives stylized facets without
      // needing custom normals.
      flatShading: true,
    });
    obj.attach(new MeshComponent({
      geometry: canopyGeo,
      material: canopyMat,
      // Sit the canopy on top of the trunk. Cone's center is
      // halfway up its height. v0.2.1-P5: XZ offset makes the
      // canopy lean off-axis from the trunk, breaking the
      // perfect-cone silhouette.
      offset: {
        x: canopyXOff,
        y: trunkHeight + canopyHeight / 2,
        z: canopyZOff,
      },
      // Canopy is also a click target (the cube's top face was
      // clickable in the default Builder; trees should be too).
      entityBody: true,
    }));

    // v0.2.1-P5: optional upper canopy for tall trees. Smaller
    // cone stacked at ~80% of the main canopy's top, leaning
    // in a slightly different direction (the offset signs flip
    // intentionally — gives the layered crown a natural twist).
    if (hasUpperCanopy) {
      const upperRadius = canopyRadius * 0.62;
      const upperHeight = canopyHeight * 0.55;
      const upperGeo = new THREE.ConeGeometry(upperRadius, upperHeight, 8, 2);
      const upperMat = new THREE.MeshStandardMaterial({
        color: FOREST_FOLIAGE_COLOR,
        roughness: 0.7,
        metalness: 0,
        flatShading: true,
      });
      obj.attach(new MeshComponent({
        geometry: upperGeo,
        material: upperMat,
        offset: {
          x: -canopyXOff * 0.6,
          y: trunkHeight + canopyHeight * 0.85 + upperHeight / 2,
          z: -canopyZOff * 0.6,
        },
        entityBody: true,
      }));
    }

    // Trigger pad — the bloom interaction. Same shape and
    // tinting logic as the default ArticleBuilder; scales with
    // the tree's footprint so it stays proportional.
    obj.attach(new TriggerPadComponent({
      color: ctx.palette.bundleColors.article ?? "#5a7a3a",
      offset: { x: 0, y: FLOOR_LAYERS.trigger_pad, z: trunkRadius + 3 },
      radius: 2.4 * (0.7 + 0.3 * (totalHeight / 14)),
    }));

    // HTML surface — shared cardPlacement (v0.2.1-P4) so the
    // detail vantage frames the card consistently regardless of
    // tree size. The trunk-and-canopy still scales with word
    // count; the card sits at a fixed readable height outward.
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
