// Forest scenery — decorative primitives scattered near sector
// centroids. Mushrooms, ferns, mossy stones (per docs/atmospheres/
// forest/mappings.yml's scenery.ambient_clutter section).
//
// Per A4 from docs/v0.2/ROADMAP.md: pure cosmetic but high-density-
// of-detail per scene → "world feels lived-in." Real assets arrive
// when the world-building technical layer runs Stage 4
// (Acquisition); these are stand-in primitives.
//
// Placement is deterministic via FNV-1a hash of
// "<sectorTermId>:<asset>:<index>", so reloads land scenery in
// the same spots. Trees use their own hash space (entity id),
// so collisions are rare and visually harmless at this density.

import * as THREE from "../../../../toolbox/three.js";
import type { CorpusSnapshot, Sector } from "../../../types.js";
import { hashString } from "../../../layout.js";
import { FLOOR_LAYERS } from "../../floor-layers.js";

/** Per-sector density caps — see mappings.yml. */
const DENSITY = {
  mushroom: 6,
  fern: 4,
  stone: 3,
} as const;

/** Scatter radius as a fraction of the sector pad's radius. */
const SCATTER = {
  mushroom: 0.4,
  fern: 0.5,
  stone: 0.6,
} as const;

const COLORS = {
  // Mushroom cap — muted reddish-brown; reads against the
  // forest floor without being a candy-bright dot.
  mushroom: 0xa04830,
  fern: 0x4a6a3a,
  stone: 0x6a6a5a,
} as const;

/**
 * Place forest scenery into the scene. Called from
 * registerForestAtmosphere() during SceneManager.mount().
 *
 * Mesh count is bounded: 5 sectors × (6+4+3) = 65 scatter items
 * at most. Cheap to render.
 */
export function placeForestScenery(
  parent: THREE.Object3D,
  snapshot: CorpusSnapshot,
): void {
  // Each sector's pad has a 25%-of-world-radius footprint
  // (SceneManager.placeEntities's CircleGeometry). Scatter
  // scenery within that footprint.
  const sectorPadRadius = snapshot.world.radius * 0.25;
  for (const sector of Object.values(snapshot.sectors)) {
    scatterMushrooms(parent, sector, sectorPadRadius);
    scatterFerns(parent, sector, sectorPadRadius);
    scatterStones(parent, sector, sectorPadRadius);
  }
}

// ─── Mesh factories ────────────────────────────────────────────────────────

function makeMushroom(): THREE.Mesh {
  // Small cone — stylised cap; the stem is invisible at this
  // primitive fidelity. Real asset (mushroom-cluster-stylized.glb)
  // gets the full silhouette.
  const geo = new THREE.ConeGeometry(0.6, 1.2, 8, 1);
  const mat = new THREE.MeshStandardMaterial({
    color: COLORS.mushroom,
    roughness: 0.8,
    metalness: 0,
    flatShading: true,
  });
  return new THREE.Mesh(geo, mat);
}

function makeFern(): THREE.Mesh {
  // Tall thin cone — fern frond silhouette.
  const geo = new THREE.ConeGeometry(0.35, 1.6, 6, 1);
  const mat = new THREE.MeshStandardMaterial({
    color: COLORS.fern,
    roughness: 0.7,
    metalness: 0,
    flatShading: true,
  });
  return new THREE.Mesh(geo, mat);
}

function makeStone(): THREE.Mesh {
  // Squashed icosahedron — moss-rock.
  const geo = new THREE.IcosahedronGeometry(0.7, 0);
  // Squash vertically so it reads as a rock, not a ball.
  geo.scale(1, 0.55, 1);
  const mat = new THREE.MeshStandardMaterial({
    color: COLORS.stone,
    roughness: 0.95,
    metalness: 0,
    flatShading: true,
  });
  return new THREE.Mesh(geo, mat);
}

// ─── Scatter logic ─────────────────────────────────────────────────────────

function scatterMushrooms(parent: THREE.Object3D, sector: Sector, padR: number) {
  scatter(parent, sector, padR, DENSITY.mushroom, SCATTER.mushroom, "mushroom", makeMushroom);
}
function scatterFerns(parent: THREE.Object3D, sector: Sector, padR: number) {
  scatter(parent, sector, padR, DENSITY.fern, SCATTER.fern, "fern", makeFern);
}
function scatterStones(parent: THREE.Object3D, sector: Sector, padR: number) {
  scatter(parent, sector, padR, DENSITY.stone, SCATTER.stone, "stone", makeStone);
}

function scatter(
  parent: THREE.Object3D,
  sector: Sector,
  padR: number,
  count: number,
  spreadFraction: number,
  asset: string,
  factory: () => THREE.Mesh,
): void {
  const spread = padR * spreadFraction;
  for (let i = 0; i < count; i++) {
    // Two 16-bit fields per item: angle and radius. A third
    // 8-bit field gives the size jitter.
    const h = hashString(`${sector.termId}:${asset}:${i}`);
    const angle = ((h & 0xffff) / 0xffff) * Math.PI * 2;
    const r = (((h >>> 16) & 0xffff) / 0xffff) * spread;
    const sizeJitter = 0.7 + (((h >>> 4) & 0xff) / 0xff) * 0.6; // 0.7–1.3
    const mesh = factory();
    mesh.position.set(
      sector.centroid.x + Math.cos(angle) * r,
      FLOOR_LAYERS.ground_decal + (mesh.geometry.boundingBox?.max.y ?? 0.5) * 0.5 * sizeJitter,
      sector.centroid.z + Math.sin(angle) * r,
    );
    // Mushrooms/ferns sit BELOW their center (their geometry
    // origin is at the cone center); lift so the base touches
    // the ground.
    mesh.position.y = FLOOR_LAYERS.ground_decal + getBaseLift(asset) * sizeJitter;
    mesh.scale.setScalar(sizeJitter);
    // Random Y rotation for stones — they're not rotationally
    // symmetric so this is visible. Cones are symmetric; rotation
    // costs nothing extra to apply uniformly.
    mesh.rotation.y = ((h >>> 12) & 0xff) / 0xff * Math.PI * 2;
    parent.add(mesh);
  }
}

/** Geometry-center-to-base lift so the primitive sits ON the floor. */
function getBaseLift(asset: string): number {
  switch (asset) {
    case "mushroom": return 0.6;  // half of 1.2 height
    case "fern":     return 0.8;  // half of 1.6 height
    case "stone":    return 0.2;  // half of squashed sphere height
    default:         return 0.5;
  }
}
