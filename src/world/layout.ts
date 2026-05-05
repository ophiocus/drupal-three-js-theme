// Pure layout math.
//
// Coordinates are deterministic functions of (entity_id, corpus_snapshot).
// No randomness, no time, no I/O. Same inputs, same outputs.

import type { CorpusSnapshot, Entity, Vec2, Vec3 } from "./types.js";

// FNV-1a 32-bit. Stable, dependency-free, deterministic across platforms.
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Uniformly distributed point inside a disc of given radius, derived
// deterministically from a seed string. The sqrt is what makes it
// uniform-by-area rather than concentrated near the center.
export function withinSectorOffset(seed: string, radius: number): Vec2 {
  const h1 = hashString(seed + ":angle");
  const h2 = hashString(seed + ":radius");
  const angle = (h1 / 0xffffffff) * Math.PI * 2;
  const r = Math.sqrt(h2 / 0xffffffff) * radius;
  return { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
}

// Where does this entity sit in the world?
//
// - Untagged entities sit in the void at world origin (a placeholder
//   choice; in practice the editor should always tag).
// - Single-tagged entities sit inside their sector, offset by a
//   deterministic-random within-sector vector seeded by their id.
// - Multi-tagged entities sit at the centroid of their sectors with a
//   reduced offset — the "borderland" claim: cross-tagging means
//   something in the world.
export function entityPosition(
  entity: Entity,
  snapshot: CorpusSnapshot,
): Vec3 {
  const terms = entity.taxonomyTerms;

  if (terms.length === 0) {
    return { x: 0, y: 0, z: 0 };
  }

  if (terms.length === 1) {
    const term = terms[0]!;
    const sector = snapshot.sectors[term];
    if (!sector) throw new Error(`Unknown sector: ${term}`);
    const offset = withinSectorOffset(entity.id, sector.radius);
    return {
      x: sector.centroid.x + offset.x,
      y: 0,
      z: sector.centroid.z + offset.z,
    };
  }

  // Multi-tagged: average the sector centroids, reduce the offset.
  let cx = 0;
  let cz = 0;
  let minRadius = Infinity;
  for (const t of terms) {
    const s = snapshot.sectors[t];
    if (!s) throw new Error(`Unknown sector: ${t}`);
    cx += s.centroid.x;
    cz += s.centroid.z;
    if (s.radius < minRadius) minRadius = s.radius;
  }
  cx /= terms.length;
  cz /= terms.length;
  const offset = withinSectorOffset(
    entity.id + ":" + terms.join("+"),
    minRadius * 0.3,
  );
  return { x: cx + offset.x, y: 0, z: cz + offset.z };
}

export function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function distance2D(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function normalize2D(v: Vec2): Vec2 {
  const m = Math.sqrt(v.x * v.x + v.z * v.z);
  if (m === 0) return { x: 0, z: 0 };
  return { x: v.x / m, z: v.z / m };
}
