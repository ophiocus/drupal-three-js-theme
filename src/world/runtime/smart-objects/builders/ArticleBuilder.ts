// ArticleBuilder — first non-fallback builder.
//
// Matches `bundle === "article"`. Produces a SmartObject whose
// geometry is a cube — same shape as the fallback — but with
// its side length modulated by the entity's word count.
//
// "Universal manner" (D2 from the navigation proposal): the cube
// stays cubic. All three sides scale together by the same factor.
// No stretching into a slab; no aspect-ratio change. A long
// article is a bigger cube. The mapping is log-scale so a 1-word
// entity isn't a microcube and 10,000-word entity isn't a
// monolith — readable signal across the realistic range.
//
// Anchor points (log10(wordCount), side):
//   1 word     →  4 units
//   100 words  → 12 units (current fallback size)
//   10,000     → 20 units
//
// Pad and HTML surface offsets scale with the cube so they stay
// proportionally placed: pad just in front of the cube, surface
// just above its top.

import * as THREE from "three";
import type { Entity } from "../../../types.js";
import { SmartObject } from "../SmartObject.js";
import type { BuilderContext, SmartObjectBuilder } from "../Builder.js";
import { MeshComponent } from "../components/MeshComponent.js";
import { TriggerPadComponent } from "../components/TriggerPadComponent.js";
import { HtmlSurfaceComponent, cardPlacement } from "../components/HtmlSurfaceComponent.js";
import { metaMaterial, META_PAD_COLOR } from "../../uv-test-texture.js";

/**
 * Word count → cube side. Log scale; clamped to a readable range.
 * Exported so future builders (Profile, Event) can apply the same
 * function to whatever their "size proxy" measurement is.
 */
export function wordCountToSide(wordCount: number): number {
  return THREE.MathUtils.mapLinear(
    Math.log10(Math.max(wordCount, 1)),
    0, 4,   // log domain: 1 word to 10,000 words
    4, 20,  // side range, world units
  );
}

export class ArticleBuilder implements SmartObjectBuilder {
  readonly name = "article";

  matches(descriptor: Entity): boolean {
    return descriptor.bundle === "article";
  }

  async build(descriptor: Entity, ctx: BuilderContext): Promise<SmartObject> {
    const obj = new SmartObject(descriptor.id, this.name);
    obj.position.copy(ctx.worldPosition);

    // Universal size: wordCount → uniform cube side. Geometry
    // still carries the signature mapping; the *skin* is now
    // UE5-meta (UV-test texture, no bundle tint). This is the
    // default-atmosphere look — the cube's SIZE is meaningful,
    // its surface is honest blockout. Atmospheres re-skin via
    // their own builders (ArticleAsTree etc.).
    const wordCount = descriptor.signature.structural.wordCount;
    const side = wordCountToSide(wordCount);

    const geometry = new THREE.BoxGeometry(side, side, side);
    obj.attach(new MeshComponent({
      geometry,
      material: metaMaterial(),
      offset: { x: 0, y: side / 2, z: 0 },
      entityBody: true,
    }));

    // Pad scales with the cube: sits just in front of the cube's
    // front face. Pad radius also scales modestly with side so
    // bigger cubes don't dwarf their pad.
    obj.attach(new TriggerPadComponent({
      color: META_PAD_COLOR,
      offset: { x: 0, y: 0.1, z: side / 2 + 2 },
      radius: 2.4 * (0.7 + 0.3 * (side / 12)),
    }));

    // HTML surface — shared cardPlacement (v0.2.1-P4) so the
    // detail vantage frames it consistently. Card sits at a fixed
    // readable height + outward offset, regardless of cube size.
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
      console.warn(`[world] ArticleBuilder HtmlSurface failed for ${descriptor.id}:`, err);
    }

    return obj;
  }
}
