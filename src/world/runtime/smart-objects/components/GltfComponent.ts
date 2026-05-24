// GltfComponent — a loaded .glb scene attached to a SmartObject.
//
// Parallel to MeshComponent. Where MeshComponent wraps a primitive
// geometry + material, GltfComponent wraps an already-loaded THREE.Group
// (a fresh clone of an AssetCache entry). Builders that have a real
// asset use this; builders falling back to primitives use MeshComponent.
//
// The cloned scene is added as a child of the SmartObject group.
// Pivot semantics are pre-baked into the .glb during curation (per
// field_asset_curated_pivot — "base" for upright props sits with
// origin at bottom of mesh).

import * as THREE from "three";
import type { Component, SmartObject } from "../SmartObject.js";

export interface GltfComponentOptions {
  /** Loaded scene from AssetCache.acquire(). Owned by this component. */
  scene: THREE.Group;
  /** Scale multiplier — assets are authored at 1m=1unit but per-entity
   *  variation (FNV-1a hash) can dial this up/down. Defaults to 1. */
  scale?: number;
  /** Offset from the SmartObject's group origin. Defaults to (0,0,0). */
  offset?: { x: number; y: number; z: number };
  /** Per-asset pivot hint from the snapshot. "base" / "center" / "custom".
   *  Today only "base" is honoured; "center" applies a Y-shift to lift the
   *  mesh so the bounding-box centre aligns with the SmartObject origin.
   *  "custom" is deferred — curator's offset notes haven't been wired yet. */
  pivot?: "base" | "center" | "custom";
  /**
   * Tag the meshes so PointerNavigator can route clicks to the
   * SmartObject as a whole. Same isEntityBody + entityId tagging
   * MeshComponent does, applied recursively to every Mesh in the
   * scene so hits on any sub-mesh resolve back to the entity.
   */
  entityBody?: boolean;
}

export class GltfComponent implements Component {
  readonly root: THREE.Group;

  constructor(private readonly options: GltfComponentOptions) {
    this.root = options.scene;
    const scale = options.scale ?? 1;
    if (scale !== 1) {
      this.root.scale.setScalar(scale);
    }
    if (options.offset) {
      this.root.position.set(options.offset.x, options.offset.y, options.offset.z);
    }
    if (options.pivot === "center") {
      // Compute the bounding box on the un-scaled mesh, then offset
      // upward by half-height so the SmartObject's origin sits at the
      // mesh's vertical centre. "base" needs no offset — assets curated
      // with pivot=base have their origin at the bottom by design.
      const box = new THREE.Box3().setFromObject(this.root);
      const size = new THREE.Vector3();
      box.getSize(size);
      this.root.position.y += size.y * 0.5;
    }
  }

  onAttach(host: SmartObject): void {
    if (this.options.entityBody) {
      // Tag every Mesh under the scene so the raycaster sees them as
      // entity bodies. SmartObject sets userData.entityId on the
      // group; we add isEntityBody so PointerNavigator's classifier
      // routes it as a click target. Walk recursively because .glbs
      // usually have a multi-mesh hierarchy (canopy + trunk + leaves
      // etc.).
      this.root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.userData.isEntityBody = true;
          obj.userData.entityId = host.entityId;
        }
      });
    }
    host.add(this.root);
  }
}
