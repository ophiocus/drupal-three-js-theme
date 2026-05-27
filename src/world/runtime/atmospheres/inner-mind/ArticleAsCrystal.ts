// inner-mind: article → thought-crystal.
//
// An icosahedron whose size tracks word count (same log signal as
// the forest tree height), in a vivid hue-from-hash acid colour.
// Abstract procedural — a real `thought-crystal` .glb can slot in
// later via ctx.tryLoadProp without changing this contract.

import * as THREE from "../../../../toolbox/three.js";
import type { Entity } from "../../../types.js";
import { hashString } from "../../../layout.js";
import { SmartObject } from "../../smart-objects/SmartObject.js";
import type { BuilderContext, SmartObjectBuilder } from "../../smart-objects/Builder.js";
import { MeshComponent } from "../../smart-objects/components/MeshComponent.js";
import { acidMaterial, attachCardScaffold } from "./scaffold.js";

function crystalRadius(wordCount: number): number {
  // log10(words) → radius; matches the forest's "bigger = longer" read.
  return THREE.MathUtils.mapLinear(Math.log10(Math.max(wordCount, 1)), 0, 4, 3, 9);
}

export class ArticleAsCrystal implements SmartObjectBuilder {
  readonly name = "inner-mind:article-as-crystal";

  matches(descriptor: Entity): boolean {
    return descriptor.bundle === "article";
  }

  async build(descriptor: Entity, ctx: BuilderContext): Promise<SmartObject> {
    const obj = new SmartObject(descriptor.id, this.name);
    obj.position.copy(ctx.worldPosition);

    const seed = hashString(descriptor.id);
    const radius = crystalRadius(descriptor.signature.structural.wordCount);

    // Detail 1 icosahedron — faceted, hovering so the form floats.
    const geo = new THREE.IcosahedronGeometry(radius, 1);
    const mat = acidMaterial(seed);
    obj.attach(new MeshComponent({
      geometry: geo,
      material: mat,
      offset: { x: 0, y: radius + 2, z: 0 },
      entityBody: true,
    }));

    // A wireframe shell one size up — the "aura" of the thought.
    const shellGeo = new THREE.IcosahedronGeometry(radius * 1.35, 1);
    const shellMat = new THREE.MeshBasicMaterial({
      color: acidMaterial(seed + 7).color,
      wireframe: true,
      transparent: true,
      opacity: 0.35,
    });
    obj.attach(new MeshComponent({
      geometry: shellGeo,
      material: shellMat,
      offset: { x: 0, y: radius + 2, z: 0 },
      entityBody: true,
    }));

    await attachCardScaffold(obj, ctx, descriptor, mat.color, radius + 3);
    return obj;
  }
}
