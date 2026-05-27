// inner-mind: profile → psyche-orb.
//
// A glowing sphere (size by connectivity, same inDegree signal as
// the forest spirit's height) wrapped in a wireframe halo, floating.
// Abstract procedural; a `psyche-orb` .glb can replace it later.

import * as THREE from "../../../../toolbox/three.js";
import type { Entity } from "../../../types.js";
import { hashString } from "../../../layout.js";
import { SmartObject } from "../../smart-objects/SmartObject.js";
import type { BuilderContext, SmartObjectBuilder } from "../../smart-objects/Builder.js";
import { MeshComponent } from "../../smart-objects/components/MeshComponent.js";
import { acidColor, acidMaterial, attachCardScaffold } from "./scaffold.js";

function orbRadius(inDegree: number): number {
  return THREE.MathUtils.mapLinear(Math.log10(Math.max(inDegree, 1)), 0, Math.log10(50), 2.0, 4.5);
}

export class ProfileAsOrb implements SmartObjectBuilder {
  readonly name = "inner-mind:profile-as-orb";

  matches(descriptor: Entity): boolean {
    return descriptor.bundle === "profile";
  }

  async build(descriptor: Entity, ctx: BuilderContext): Promise<SmartObject> {
    const obj = new SmartObject(descriptor.id, this.name);
    obj.position.copy(ctx.worldPosition);

    const seed = hashString(descriptor.id);
    const r = orbRadius(descriptor.signature.relational.inDegree);
    const hover = r + 4;

    // Core orb — smooth, glowing.
    const orbGeo = new THREE.SphereGeometry(r, 24, 16);
    const orbMat = acidMaterial(seed, false);
    orbMat.flatShading = false;
    orbMat.emissiveIntensity = 0.8;
    obj.attach(new MeshComponent({
      geometry: orbGeo,
      material: orbMat,
      offset: { x: 0, y: hover, z: 0 },
      entityBody: true,
    }));

    // Halo — a wireframe icosahedron shell, complementary hue.
    const haloGeo = new THREE.IcosahedronGeometry(r * 1.6, 1);
    const haloMat = new THREE.MeshBasicMaterial({
      color: acidColor(seed + 333, 0.6),
      wireframe: true,
      transparent: true,
      opacity: 0.4,
    });
    obj.attach(new MeshComponent({
      geometry: haloGeo,
      material: haloMat,
      offset: { x: 0, y: hover, z: 0 },
      entityBody: true,
    }));

    await attachCardScaffold(obj, ctx, descriptor, orbMat.color, r + 2.4);
    return obj;
  }
}
