// MeshComponent — a static THREE.Mesh attached to a SmartObject.
//
// The most common component: every visible entity gets one.
// Wraps geometry + material + a positional offset relative to
// the SmartObject's group origin.
//
// Owns the geometry and material — SmartObject.dispose() walks
// the tree and frees them; nothing else should call dispose on
// these objects.

import * as THREE from "three";
import type { Component, SmartObject } from "../SmartObject.js";

export interface MeshComponentOptions {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Offset from the SmartObject's group origin. Defaults to (0,0,0). */
  offset?: { x: number; y: number; z: number };
  /**
   * Tag the mesh so PointerNavigator can route clicks to it. When
   * `entityBody` is true, the mesh is the click target for "navigate
   * to this entity's detail vantage." Decorative meshes leave it
   * unset and clicks fall through.
   */
  entityBody?: boolean;
}

export class MeshComponent implements Component {
  readonly mesh: THREE.Mesh;

  constructor(private readonly options: MeshComponentOptions) {
    this.mesh = new THREE.Mesh(options.geometry, options.material);
    if (options.offset) {
      this.mesh.position.set(options.offset.x, options.offset.y, options.offset.z);
    }
  }

  onAttach(host: SmartObject): void {
    if (this.options.entityBody) {
      this.mesh.userData.isEntityBody = true;
      this.mesh.userData.entityId = host.entityId;
    }
    host.add(this.mesh);
  }
}
