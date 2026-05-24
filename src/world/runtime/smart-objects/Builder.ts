// Builder.ts — the SmartObjectBuilder interface + the registry
// that dispatches descriptors to the right builder.
//
// A Builder reads a descriptor (entity + signature + cards) and
// emits a SmartObject — group + components. The Registry holds
// the active builder list and picks the first one whose
// matches() returns true, falling back to a built-in
// FallbackBuilder if nothing matches.
//
// See SMART_OBJECTS.md for the full design.

import * as THREE from "three";
import type { AssetDescriptor, CorpusSnapshot, Entity } from "../../types.js";
import type { SurfaceCache } from "../SurfaceCache.js";
import type { SmartObject } from "./SmartObject.js";

/**
 * Result of a successful tryLoadProp() call — a fresh asset clone
 * plus the descriptor metadata builders need to honour pivot +
 * polycount budget. The clone is owned by the calling builder
 * once returned; AssetCache won't reuse this specific instance.
 */
export interface LoadedProp {
  scene: THREE.Group;
  descriptor: AssetDescriptor;
}

/**
 * Palette shape the Builders read for materials, biome hooks,
 * and bundle-color decisions. Mirrors the snapshot's
 * world.palette structure.
 */
export interface BuilderPalette {
  background: string;
  sectorPad: { color: string };
  compassPost: { color: string };
  bundleColors: Record<string, string>;
}

export interface BuilderContext {
  snapshot: CorpusSnapshot;
  palette: BuilderPalette;
  surfaceCache: SurfaceCache;
  /**
   * Resolve an asset URL relative to the theme's assets dir.
   * Returns an absolute URL the browser can fetch. Defaults to
   * /themes/custom/drupal_threejs/assets/<path> via the caller's
   * configuration; never hardcoded inside builders.
   */
  assetUrl: (path: string) => string;
  /**
   * The world-space position this entity belongs at. Derived from
   * `entityPosition()` upstream; passed in so builders don't need
   * to recompute or take the entityPosition function as a dep.
   */
  worldPosition: THREE.Vector3;
  /**
   * The active atmosphere's name ("forest", "inner-mind", "none").
   * Builders intersect this against an asset's `atmospheres[]` to
   * decide whether the asset applies to the current world.
   */
  activeAtmosphere: string;
  /**
   * Try to load a live .glb asset for the given slot. Returns the
   * loaded prop + its descriptor when an asset matches the active
   * atmosphere AND the editor has marked it live; returns null when
   * no asset is wired, the asset is not eligible for the active
   * atmosphere, or loading fails. Builders use this as the
   * default-asset-fallback-primitive switch:
   *
   *   const prop = await ctx.tryLoadProp("oak-stylized");
   *   if (prop) {
   *     so.attach(new GltfComponent({
   *       scene: prop.scene,
   *       pivot: prop.descriptor.pivot,
   *       entityBody: true,
   *     }));
   *   } else {
   *     so.attach(new MeshComponent({ geometry: cone, material, entityBody: true }));
   *   }
   */
  tryLoadProp: (slot: string) => Promise<LoadedProp | null>;
}

export interface SmartObjectBuilder {
  /** Human-readable identifier; surfaces in logs and `SmartObject.builderName`. */
  readonly name: string;
  /**
   * Decides whether this builder applies to a given descriptor.
   * First match wins in the registry. Return false to defer to
   * the next builder.
   */
  matches(descriptor: Entity): boolean;
  /**
   * Build the SmartObject. Async because asset loads (HtmlSurface
   * fetches, .glb decodes) happen here. The returned object is
   * positioned at ctx.worldPosition; the caller adds it to the
   * scene.
   */
  build(descriptor: Entity, ctx: BuilderContext): Promise<SmartObject>;
}

export class SmartObjectRegistry {
  private readonly builders: SmartObjectBuilder[] = [];
  private readonly fallback: SmartObjectBuilder;

  /**
   * Construct with the fallback builder. The fallback runs when
   * no registered builder matches a descriptor — guarantees every
   * entity renders even if its bundle isn't recognized yet.
   */
  constructor(fallback: SmartObjectBuilder) {
    this.fallback = fallback;
  }

  /**
   * Register a builder. Builders are tried in registration order;
   * the first to return true from matches() wins. Order builders
   * from most specific to most general.
   */
  register(builder: SmartObjectBuilder): void {
    this.builders.push(builder);
  }

  /**
   * Build the SmartObject for a descriptor. Async. Errors in the
   * specific builder fall through to the fallback rather than
   * propagating — a broken builder shouldn't leave a hole in the
   * world.
   */
  async build(descriptor: Entity, ctx: BuilderContext): Promise<SmartObject> {
    const builder = this.builders.find((b) => b.matches(descriptor)) ?? this.fallback;
    try {
      return await builder.build(descriptor, ctx);
    } catch (err) {
      console.warn(
        `[world] Builder "${builder.name}" failed for ${descriptor.id}; falling back. Cause:`,
        err,
      );
      return this.fallback.build(descriptor, ctx);
    }
  }
}
