// inner-mind: client-side MDS-3D projection.
//
// A 3D port of the server's SemanticLayoutProjector (which is 2D). This
// is the interpretation-engine POC's "always-works" frame
// (docs/INTERPRETATION_ENGINE.md §3): emergent structure straight from
// the embedding geometry, no anchors needed — works with any embedding
// model, including the dev TF-IDF one. Anchored axes (authored meaning)
// layer on later and need a neural model to be meaningful.
//
// Pipeline (identical to the server's, +1 eigenvector):
//   embeddings → cosine distance² matrix D²
//   → double-centred Gram B = -½ J D² J
//   → top-3 eigenvectors (power iteration + deflation)
//   → coords = eigenvector · √eigenvalue   (axes 1,2 → x,z; axis 3 → y)
//   → recentre + scale to fit a target radius
//
// Deterministic: fixed power-iteration seed, fixed iteration count.
// Same embeddings → same cloud, every run (preserves URI-is-a-coordinate).

import type { Vec3 } from "../../../types.js";

const POWER_ITERATIONS = 128;

/**
 * Project L2-normalized embeddings to a 3D cloud whose farthest point
 * sits ~`targetRadius` from its centroid, centred on the origin.
 */
export function projectMds3D(
  embeddings: Map<string, number[]>,
  targetRadius: number,
): Map<string, Vec3> {
  const ids = [...embeddings.keys()];
  const n = ids.length;
  const out = new Map<string, Vec3>();
  if (n === 0) return out;
  if (n === 1) {
    out.set(ids[0]!, { x: 0, y: 0, z: 0 });
    return out;
  }
  const vecs = ids.map((id) => embeddings.get(id)!);

  // 1. Squared cosine-distance matrix.
  const dsq: number[][] = [];
  for (let i = 0; i < n; i++) dsq.push(new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sim = dot(vecs[i]!, vecs[j]!);
      const d = Math.max(0, 1 - sim);
      const d2 = d * d;
      dsq[i]![j] = d2;
      dsq[j]![i] = d2;
    }
  }

  // 2. Double centering → Gram matrix B = -½ (D² - rowMean - colMean + grand).
  const rowMean = new Array<number>(n).fill(0);
  let grand = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += dsq[i]![j]!;
    rowMean[i] = s / n;
    grand += s;
  }
  grand /= n * n;
  const b: number[][] = [];
  for (let i = 0; i < n; i++) {
    b.push(new Array<number>(n).fill(0));
    for (let j = 0; j < n; j++) {
      b[i]![j] = -0.5 * (dsq[i]![j]! - rowMean[i]! - rowMean[j]! + grand);
    }
  }

  // 3. Top-3 eigenvectors (power iteration + Hotelling deflation).
  const [v1, l1] = dominantEigen(b, n, []);
  const [v2, l2] = dominantEigen(b, n, [v1]);
  const [v3, l3] = dominantEigen(b, n, [v1, v2]);
  const s1 = Math.sqrt(Math.max(l1, 0));
  const s2 = Math.sqrt(Math.max(l2, 0));
  const s3 = Math.sqrt(Math.max(l3, 0));

  // Axes 1,2 (most variance) spread horizontally x/z — so a top-down
  // glance still reads like the 2D map; axis 3 (least) lifts into height.
  const coords: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    coords.push({ x: v1[i]! * s1, y: v3[i]! * s3, z: v2[i]! * s2 });
  }

  // 4. Recentre on centroid + scale so the farthest point ~targetRadius.
  let cx = 0, cy = 0, cz = 0;
  for (const c of coords) {
    cx += c.x; cy += c.y; cz += c.z;
  }
  cx /= n; cy /= n; cz /= n;
  let maxR = 0;
  for (const c of coords) {
    const dx = c.x - cx, dy = c.y - cy, dz = c.z - cz;
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (r > maxR) maxR = r;
  }
  const scale = maxR > 1e-9 ? targetRadius / maxR : 1;
  for (let i = 0; i < n; i++) {
    const c = coords[i]!;
    out.set(ids[i]!, {
      x: (c.x - cx) * scale,
      y: (c.y - cy) * scale,
      z: (c.z - cz) * scale,
    });
  }
  return out;
}

/**
 * Dominant eigenvector/value of a symmetric matrix via power iteration.
 * `deflate` holds previously-found (unit) eigenvectors to project out
 * each step (so this returns the next eigenvector down).
 */
function dominantEigen(
  m: number[][],
  n: number,
  deflate: number[][],
): [number[], number] {
  // Deterministic non-uniform seed (avoid starting orthogonal to the
  // dominant eigenvector on centred matrices).
  let v = new Array<number>(n);
  for (let i = 0; i < n; i++) v[i] = Math.sin(i + 1);
  v = unit(v);

  let eigenvalue = 0;
  for (let iter = 0; iter < POWER_ITERATIONS; iter++) {
    for (const d of deflate) v = orthogonalize(v, d);
    const w = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      const row = m[i]!;
      let s = 0;
      for (let j = 0; j < n; j++) s += row[j]! * v[j]!;
      w[i] = s;
    }
    let wv = w;
    for (const d of deflate) wv = orthogonalize(wv, d);
    const nrm = norm(wv);
    if (nrm < 1e-12) return [v, 0];
    for (let i = 0; i < n; i++) wv[i] = wv[i]! / nrm;
    v = wv;
    eigenvalue = nrm;
  }
  void eigenvalue;

  // Rayleigh quotient → signed eigenvalue (sign matters for clamping).
  const mv = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += m[i]![j]! * v[j]!;
    mv[i] = s;
  }
  return [v, dot(v, mv)];
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) s += a[i]! * b[i]!;
  return s;
}

function norm(v: number[]): number {
  return Math.sqrt(dot(v, v));
}

function unit(v: number[]): number[] {
  const m = norm(v);
  if (m < 1e-12) return v;
  return v.map((x) => x / m);
}

/** Remove the component of v along unit basis, returning the remainder. */
function orthogonalize(v: number[], basis: number[]): number[] {
  const proj = dot(v, basis);
  return v.map((x, i) => x - proj * basis[i]!);
}
