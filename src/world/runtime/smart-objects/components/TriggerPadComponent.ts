// TriggerPadComponent — the small ground disc next to an entity
// that activates its card lifecycle on click.
//
// Replaces the standalone CardController.makePad() helper that
// shipped in v0.0.1-alpha. The pad mesh carries `isTriggerPad`
// userData so PointerNavigator routes clicks via
// CardController.activatePad(entityId).
//
// One per SmartObject that should be card-activatable.
// Decorative SmartObjects (ground, posts) won't have one.

import * as THREE from "../../../../toolbox/three.js";
import type { Component, SmartObject } from "../SmartObject.js";

export interface TriggerPadComponentOptions {
  color: THREE.ColorRepresentation;
  /** Offset from the SmartObject's group origin. */
  offset?: { x: number; y: number; z: number };
  /** Disc radius. Default 2.4 (matches v0.0.1-alpha appearance). */
  radius?: number;
}

export class TriggerPadComponent implements Component {
  readonly pad: THREE.Mesh;

  constructor(private readonly options: TriggerPadComponentOptions) {
    const radius = options.radius ?? 2.4;
    const geo = new THREE.CircleGeometry(radius, 32);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: options.color,
      roughness: 0.7,
      metalness: 0.1,
      emissive: new THREE.Color(options.color).multiplyScalar(0.15),
    });
    this.pad = new THREE.Mesh(geo, mat);
    if (options.offset) {
      this.pad.position.set(options.offset.x, options.offset.y, options.offset.z);
    }
  }

  onAttach(host: SmartObject): void {
    this.pad.userData.isTriggerPad = true;
    this.pad.userData.entityId = host.entityId;
    host.add(this.pad);
  }
}
