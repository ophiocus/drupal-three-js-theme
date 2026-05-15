// Sector-pad decal texture — soft radial gradient so the pad
// reads as a clearing (lighter patch of forest floor), not a
// poker chip.
//
// P2 from docs/v0.2/ROADMAP.md: the v0.2.0 pads were solid
// bundle-tinted discs that dominated the visual field —
// "geography is editorial attention" loses force when geography
// is a saucer floor. The alphaMap fades the pad's solid color
// from ~85% opacity at the centroid to 0% at the edge, so the
// pad bleeds into the surrounding ground rather than carving a
// hard boundary.
//
// Universal across atmospheres: the gradient shape is the same;
// each atmosphere just supplies its own `sectorPad.color` via
// palette overrides to tune what's visible. UE5-meta default
// gets a pale-green soft clearing; forest gets lighter-olive.

import * as THREE from "three";

let cached: THREE.CanvasTexture | null = null;

function drawDecal(size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const r = size / 2;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  // Solid-ish core, slow fade through mid-radius, fast fade at edge.
  grad.addColorStop(0, "rgba(255, 255, 255, 0.85)");
  grad.addColorStop(0.55, "rgba(255, 255, 255, 0.65)");
  grad.addColorStop(0.85, "rgba(255, 255, 255, 0.18)");
  grad.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

/**
 * The shared sector-pad alphaMap. Built lazily so module import
 * doesn't touch the DOM (keeps node-env unit tests happy).
 */
export function sectorPadDecal(): THREE.CanvasTexture {
  if (!cached) {
    const tex = new THREE.CanvasTexture(drawDecal(512));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    cached = tex;
  }
  return cached;
}
