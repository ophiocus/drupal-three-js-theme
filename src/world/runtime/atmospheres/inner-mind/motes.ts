// inner-mind: acid motes — drifting multicoloured points, additive
// blended so they bloom against the dark trip. The inner-mind
// analogue of the forest's pollen, but vivid + per-point hued.

import * as THREE from "three";
import type { CorpusSnapshot } from "../../../types.js";

const COUNT = 140;

export class AcidMotes {
  readonly points: THREE.Points;
  private readonly basePositions: Float32Array;
  private readonly phases: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;

  constructor(snapshot: CorpusSnapshot) {
    const spread = snapshot.world.radius * 0.9;
    this.basePositions = new Float32Array(COUNT * 3);
    this.phases = new Float32Array(COUNT);
    const colors = new Float32Array(COUNT * 3);
    const c = new THREE.Color();

    for (let i = 0; i < COUNT; i++) {
      this.basePositions[i * 3] = (Math.random() - 0.5) * 2 * spread;
      this.basePositions[i * 3 + 1] = 4 + Math.random() * 60;
      this.basePositions[i * 3 + 2] = (Math.random() - 0.5) * 2 * spread;
      this.phases[i] = Math.random() * Math.PI * 2;
      c.setHSL(Math.random(), 1.0, 0.6);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.basePositions.slice(), 3));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.material = new THREE.PointsMaterial({
      size: 1.4,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.renderOrder = 2;
  }

  /** Per-frame: sinusoidal drift around each mote's base position. */
  update(elapsed: number): void {
    const pos = this.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < COUNT; i++) {
      const ph = this.phases[i]!;
      arr[i * 3] = this.basePositions[i * 3]! + Math.sin(elapsed * 0.4 + ph) * 4;
      arr[i * 3 + 1] = this.basePositions[i * 3 + 1]! + Math.sin(elapsed * 0.3 + ph * 1.7) * 3;
      arr[i * 3 + 2] = this.basePositions[i * 3 + 2]! + Math.cos(elapsed * 0.35 + ph) * 4;
    }
    pos.needsUpdate = true;
  }

  /** Free GPU resources. Called on atmosphere teardown (v1.5 switcher). */
  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
