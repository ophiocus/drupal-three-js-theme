// Pollen particle layer for the forest atmosphere.
//
// Per A5 from docs/v0.2/ROADMAP.md: drifting motes of light that
// catch the low golden sun. Sells "the air has weight." The
// `particles.motes` spec in docs/atmospheres/forest/mappings.yml
// is the design intent; this is the implementation.
//
// 80 particles, soft-circle alpha sprite, additive blending,
// per-frame sinusoidal drift around each particle's base
// position. Deterministic via hashed base positions but visually
// reads as random ambient motion.

import * as THREE from "three";
import type { CorpusSnapshot } from "../../../types.js";

const PARTICLE_COUNT = 80;
const SPAWN_Y_MIN = 5;
const SPAWN_Y_MAX = 25;
/** XZ scatter as a fraction of world radius (kept inside the visible band). */
const SPAWN_RADIUS_FRACTION = 0.9;
const POINT_SIZE_WORLD = 0.6;
const MOTE_COLOR = 0xf0e8c8;   // warm pollen — matches forest CHARTER

let cachedSprite: THREE.CanvasTexture | null = null;

function moteSprite(): THREE.CanvasTexture {
  if (cachedSprite) return cachedSprite;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    cachedSprite = new THREE.CanvasTexture(canvas);
    return cachedSprite;
  }
  const r = size / 2;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, "rgba(255, 255, 255, 1)");
  grad.addColorStop(0.4, "rgba(255, 255, 255, 0.65)");
  grad.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  cachedSprite = new THREE.CanvasTexture(canvas);
  cachedSprite.colorSpace = THREE.SRGBColorSpace;
  return cachedSprite;
}

export class PollenField {
  readonly points: THREE.Points;
  private readonly basePositions: Float32Array;

  constructor(snapshot: CorpusSnapshot) {
    const spread = snapshot.world.radius * SPAWN_RADIUS_FRACTION;
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    this.basePositions = new Float32Array(PARTICLE_COUNT * 3);
    // Uniform-disc-ish XZ scatter + bounded Y. Deterministic-
    // looking but seeded from Math.random() — particle positions
    // don't need to round-trip across reloads since they're
    // purely decorative.
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * spread; // sqrt → uniform area
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const y = SPAWN_Y_MIN + Math.random() * (SPAWN_Y_MAX - SPAWN_Y_MIN);
      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      this.basePositions[i * 3 + 0] = x;
      this.basePositions[i * 3 + 1] = y;
      this.basePositions[i * 3 + 2] = z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: MOTE_COLOR,
      size: POINT_SIZE_WORLD,
      map: moteSprite(),
      transparent: true,
      alphaTest: 0.01,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    // Render order: after the sector pads (renderOrder = -1)
    // but before/during regular meshes. Default 0 is fine; the
    // alphaTest+additive blending handles ordering.
    this.points.name = "PollenField";
  }

  /**
   * Per-frame sinusoidal drift around each base position. Three
   * independent phases per particle so the field doesn't pulse
   * coherently. `elapsed` is seconds since session start.
   */
  update(elapsed: number): void {
    const attr = this.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const phase = i * 0.13;
      const base = i * 3;
      arr[base + 0] = this.basePositions[base + 0]
        + Math.sin(elapsed * 0.40 + phase) * 1.5;
      arr[base + 1] = this.basePositions[base + 1]
        + Math.sin(elapsed * 0.25 + phase * 1.7) * 0.6;
      arr[base + 2] = this.basePositions[base + 2]
        + Math.cos(elapsed * 0.40 + phase * 0.9) * 1.5;
    }
    attr.needsUpdate = true;
  }
}
