// inner-mind: the surrounding zodiac.
//
// BETA 1 design pass. The navigable centre reads as a single star
// system — sectors as planets, entities as their moons. This seeds the
// UNREACHABLE outer orbit (a ring well beyond where the camera can fly,
// but inside the fog far-plane) with twelve surreal structures: an
// alternate zodiac wheel encircling the system. The whole ring orbits
// the centre very slowly; each structure self-spins on a tilt. Purely
// atmospheric — not entities, never hit-tested.
//
// Deterministic via FNV-1a hash of "zodiac:<i>" so the wheel is stable
// across reloads/rebuilds. Emissive materials so the forms glow through
// the inner-mind fog (radius × 1.4 ≈ 280 against fog far 460 → a hazy,
// dream-distant ring). Attaches to the disposable world-layer root; the
// inner-mind env returns dispose() for the switcher teardown.

import * as THREE from "three";
import type { CorpusSnapshot } from "../../../types.js";
import { hashString } from "../../../layout.js";

const COUNT = 12;            // a zodiac
const RING_FACTOR = 1.4;     // ring radius as a multiple of world.radius
const HEIGHT_MIN = 55;
const HEIGHT_MAX = 185;
const SCALE_MIN = 40;
const SCALE_MAX = 78;
const ORBIT_SPEED = 0.012;   // rad/s — full wheel revolution ≈ 8.7 min

interface Spinner {
  node: THREE.Object3D;
  spinSpeed: number;
}

export class SurrealZodiac {
  readonly group: THREE.Group;
  private readonly spinners: Spinner[] = [];

  constructor(snapshot: CorpusSnapshot) {
    this.group = new THREE.Group();
    this.group.name = "SurrealZodiac";
    const ringR = snapshot.world.radius * RING_FACTOR;

    for (let i = 0; i < COUNT; i++) {
      const h = hashString(`zodiac:${i}`);
      const angle = (i / COUNT) * Math.PI * 2;
      // Hue marches around the wheel with a touch of per-sign jitter.
      const hue = (i / COUNT + ((h & 0xff) / 0xff) * 0.04) % 1;
      const color = new THREE.Color().setHSL(hue, 1.0, 0.55);
      const height = HEIGHT_MIN + (((h >>> 8) & 0xff) / 0xff) * (HEIGHT_MAX - HEIGHT_MIN);
      const scale = SCALE_MIN + (((h >>> 16) & 0xff) / 0xff) * (SCALE_MAX - SCALE_MIN);
      const archetype = ((h >>> 4) & 0xff) % 6;

      const node = this.buildArchetype(archetype, color, h);
      node.scale.setScalar(scale);
      node.position.set(Math.cos(angle) * ringR, height, Math.sin(angle) * ringR);
      // Fixed tilt for a less rigid wheel; self-spin happens on local Y.
      node.rotation.x = (((h >>> 24) & 0xff) / 0xff - 0.5) * 0.9;
      node.rotation.z = (((h >>> 12) & 0xff) / 0xff - 0.5) * 0.6;
      this.group.add(node);
      this.spinners.push({
        node,
        spinSpeed: 0.04 + (((h >>> 20) & 0x0f) / 0x0f) * 0.14,
      });
    }
  }

  /** Slow orbit of the whole wheel + gentle per-structure self-spin. */
  update(elapsed: number): void {
    this.group.rotation.y = elapsed * ORBIT_SPEED;
    for (const s of this.spinners) {
      s.node.rotation.y = elapsed * s.spinSpeed;
    }
  }

  /** Free GPU resources — called on atmosphere teardown. Unique geometry
   *  + material per mesh (no sharing) so this single traversal disposes
   *  each exactly once. */
  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
  }

  // ─── Materials ─────────────────────────────────────────────────────────────

  /** A fresh emissive material per call (never shared — keeps dispose
   *  one-to-one). `wire` makes a translucent wireframe shell. */
  private mat(color: THREE.Color, wire: boolean): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: color.clone(),
      emissive: color.clone().multiplyScalar(0.55),
      emissiveIntensity: 1,
      roughness: 0.45,
      metalness: 0.15,
      flatShading: true,
      wireframe: wire,
      transparent: wire,
      opacity: wire ? 0.45 : 1,
      depthWrite: !wire,
    });
  }

  private shifted(color: THREE.Color, dh: number): THREE.Color {
    const hsl = { h: 0, s: 0, l: 0 };
    color.getHSL(hsl);
    return new THREE.Color().setHSL((hsl.h + dh + 1) % 1, hsl.s, hsl.l);
  }

  // ─── Archetypes (built at ~unit size; scaled by the caller) ─────────────────

  private buildArchetype(kind: number, color: THREE.Color, h: number): THREE.Group {
    switch (kind) {
      case 0: return this.torusKnot(color);
      case 1: return this.spikedOrb(color);
      case 2: return this.twistTotem(color, h);
      case 3: return this.armillary(color);
      case 4: return this.crystalShell(color);
      default: return this.obeliskHalo(color);
    }
  }

  /** A twisted knot ring. */
  private torusKnot(color: THREE.Color): THREE.Group {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.TorusKnotGeometry(1, 0.3, 120, 16, 2, 3), this.mat(color, false)));
    g.add(new THREE.Mesh(new THREE.TorusKnotGeometry(1.08, 0.32, 64, 10, 2, 3), this.mat(this.shifted(color, 0.08), true)));
    return g;
  }

  /** Sea-urchin / star — an icosa core radiating spikes. */
  private spikedOrb(color: THREE.Color): THREE.Group {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 1), this.mat(color, false)));
    const dirs: Array<[number, number, number]> = [
      [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
      [0.7, 0.7, 0], [-0.7, -0.7, 0], [0, 0.7, 0.7], [0, -0.7, -0.7],
    ];
    const up = new THREE.Vector3(0, 1, 0);
    for (const d of dirs) {
      const v = new THREE.Vector3(d[0], d[1], d[2]).normalize();
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.95, 6), this.mat(color, false));
      spike.position.copy(v.clone().multiplyScalar(1.05));
      spike.quaternion.setFromUnitVectors(up, v);
      g.add(spike);
    }
    return g;
  }

  /** A twisting totem of stacked, rotated slabs. */
  private twistTotem(color: THREE.Color, h: number): THREE.Group {
    const g = new THREE.Group();
    const layers = 5;
    for (let k = 0; k < layers; k++) {
      const w = 1.1 - k * 0.13;
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.4, w),
        this.mat(this.shifted(color, k * 0.03), false),
      );
      slab.position.y = -1 + k * 0.5;
      slab.rotation.y = k * (0.5 + ((h >>> k) & 0x3) * 0.15);
      g.add(slab);
    }
    return g;
  }

  /** An armillary — three tilted rings nested like a gyroscope. */
  private armillary(color: THREE.Color): THREE.Group {
    const g = new THREE.Group();
    const orientations: Array<[number, number, number]> = [
      [Math.PI / 2, 0, 0],
      [0, 0, Math.PI / 2],
      [Math.PI / 3, Math.PI / 4, 0],
    ];
    orientations.forEach((rot, k) => {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1 - k * 0.16, 0.05, 12, 80),
        this.mat(this.shifted(color, k * 0.06), false),
      );
      ring.rotation.set(rot[0], rot[1], rot[2]);
      g.add(ring);
    });
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), this.mat(this.shifted(color, 0.5), false)));
    return g;
  }

  /** The inner-mind crystal motif, scaled up: a flat-shaded core in a
   *  larger wireframe shell. */
  private crystalShell(color: THREE.Color): THREE.Group {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 0), this.mat(color, false)));
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1.2, 1), this.mat(this.shifted(color, 0.1), true)));
    return g;
  }

  /** A tapered monolith crowned by a halo ring. */
  private obeliskHalo(color: THREE.Color): THREE.Group {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.ConeGeometry(0.4, 2.2, 4), this.mat(color, false));
    g.add(shaft);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.07, 10, 48), this.mat(this.shifted(color, 0.5), false));
    halo.position.y = 1.25;
    halo.rotation.x = Math.PI / 2;
    g.add(halo);
    return g;
  }
}
