// inner-mind: event → ripple-ring.
//
// A torus standing on the ground plane (an event is a "ripple in
// the mind"), vivid + emissive, with a small bright core at center.
// Abstract procedural; a `ripple-ring` .glb can replace it later.

import * as THREE from "three";
import type { Entity } from "../../../types.js";
import { hashString } from "../../../layout.js";
import { SmartObject } from "../../smart-objects/SmartObject.js";
import type { BuilderContext, SmartObjectBuilder } from "../../smart-objects/Builder.js";
import { MeshComponent } from "../../smart-objects/components/MeshComponent.js";
import { acidColor, acidMaterial, attachCardScaffold } from "./scaffold.js";

export class EventAsRing implements SmartObjectBuilder {
  readonly name = "inner-mind:event-as-ring";

  matches(descriptor: Entity): boolean {
    return descriptor.bundle === "event";
  }

  async build(descriptor: Entity, ctx: BuilderContext): Promise<SmartObject> {
    const obj = new SmartObject(descriptor.id, this.name);
    obj.position.copy(ctx.worldPosition);

    const seed = hashString(descriptor.id);
    const ringRadius = 5;
    const tube = 0.6;

    // Torus — stand it upright (rotate so it faces outward), hovering.
    const torusGeo = new THREE.TorusGeometry(ringRadius, tube, 12, 48);
    const torusMat = acidMaterial(seed, false);
    torusMat.emissiveIntensity = 0.9;
    const torus = new MeshComponent({
      geometry: torusGeo,
      material: torusMat,
      offset: { x: 0, y: ringRadius + 1, z: 0 },
      entityBody: true,
    });
    obj.attach(torus);
    torus.mesh.rotation.x = Math.PI / 2.4;

    // Bright core sphere at the ring's center — the event's "moment".
    const coreGeo = new THREE.SphereGeometry(1.1, 16, 12);
    const coreMat = new THREE.MeshStandardMaterial({
      color: acidColor(seed + 99, 0.7),
      emissive: acidColor(seed + 99, 0.5),
      emissiveIntensity: 1.2,
      roughness: 0.2,
    });
    obj.attach(new MeshComponent({
      geometry: coreGeo,
      material: coreMat,
      offset: { x: 0, y: ringRadius + 1, z: 0 },
      entityBody: true,
    }));

    await attachCardScaffold(obj, ctx, descriptor, torusMat.color, ringRadius + 1.5);
    return obj;
  }
}
