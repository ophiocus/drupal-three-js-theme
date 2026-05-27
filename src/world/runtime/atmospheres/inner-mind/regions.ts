// inner-mind: fuzzy cluster spheres ("overlap on commonality").
//
// docs/INTERPRETATION_ENGINE.md §2: regions in a 3D world are not the
// flat sector pads of the forest — they're translucent spheres centred
// on each cluster's 3D centroid, radius from member spread. Entities
// tagged with multiple sectors contribute to multiple clusters, which
// pulls the clusters' centroids toward each other and inflates both
// radii → the spheres overlap exactly where the commonality lives.
// Additive blending makes the intersection brighter, so overlap reads
// as a visible glow.
//
// Replaces the inner-mind's ground sector pads (which SceneManager now
// skips for 3D atmosphere layouts). Attaches to the disposable
// world-layer root; the env returns dispose() for the switcher teardown.

import * as THREE from "../../../../toolbox/three.js";
import type { CorpusSnapshot, Vec3 } from "../../../types.js";

const RADIUS_PADDING = 18;     // breathing room beyond the farthest member
const MIN_RADIUS = 25;         // small clusters still read as regions
const OPACITY = 0.14;          // soft enough to see what's behind, dense enough to overlap-glow
const TILT_RANGE = 0.7;        // radians of fixed tilt for visual interest
const SPIN_SPEED = 0.06;       // rad/s — gentle differential rotation

interface Spinner {
  mesh: THREE.Mesh;
  speed: number;
  tiltX: number;
  tiltZ: number;
}

export class FuzzyRegions {
  readonly group: THREE.Group;
  private readonly spinners: Spinner[] = [];

  constructor(snapshot: CorpusSnapshot, layout: Map<string, Vec3>) {
    this.group = new THREE.Group();
    this.group.name = "FuzzyRegions";

    // Group entities by EVERY taxonomy term (multi-tagged → multiple
    // clusters). This is what surfaces "commonality" as visible overlap.
    const memberPos = new Map<string, THREE.Vector3[]>();
    for (const entity of Object.values(snapshot.entities)) {
      const pos = layout.get(entity.id);
      if (!pos) continue;
      const v = new THREE.Vector3(pos.x, pos.y, pos.z);
      for (const term of entity.taxonomyTerms) {
        let arr = memberPos.get(term);
        if (!arr) {
          arr = [];
          memberPos.set(term, arr);
        }
        arr.push(v);
      }
    }

    // Stable ordering by termId so hues are deterministic.
    const sectorIds = Object.keys(snapshot.sectors).sort();
    sectorIds.forEach((termId, i) => {
      const members = memberPos.get(termId);
      if (!members || members.length === 0) return;

      // Centroid + radius from member spread.
      const c = new THREE.Vector3();
      for (const m of members) c.add(m);
      c.multiplyScalar(1 / members.length);
      let maxR = 0;
      for (const m of members) {
        const d = m.distanceTo(c);
        if (d > maxR) maxR = d;
      }
      const radius = Math.max(MIN_RADIUS, maxR + RADIUS_PADDING);

      // Hue from index. Offset so it doesn't align with the zodiac's
      // hue march; sectors read as their own colour family.
      const hue = (i / Math.max(sectorIds.length, 1) + 0.15) % 1;
      const color = new THREE.Color().setHSL(hue, 0.7, 0.5);

      const geo = new THREE.SphereGeometry(radius, 24, 16);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: OPACITY,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(c);
      const tiltX = (((i * 73) % 100) / 100 - 0.5) * TILT_RANGE;
      const tiltZ = (((i * 41) % 100) / 100 - 0.5) * TILT_RANGE;
      mesh.rotation.x = tiltX;
      mesh.rotation.z = tiltZ;
      this.group.add(mesh);

      this.spinners.push({
        mesh,
        speed: SPIN_SPEED * (1 + (i % 3) * 0.2),
        tiltX,
        tiltZ,
      });
    });
  }

  /** Gentle differential rotation per region, with fixed tilts. */
  update(elapsed: number): void {
    for (const s of this.spinners) {
      s.mesh.rotation.y = elapsed * s.speed;
      s.mesh.rotation.x = s.tiltX;
      s.mesh.rotation.z = s.tiltZ;
    }
  }

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
}
