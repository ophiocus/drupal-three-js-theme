// uv-test-texture — the "prototype blockout" skin.
//
// When no atmosphere is active (active_atmosphere: "none"), the
// default SmartObject builders render with this: a procedural
// UV-checker texture on a neutral material. UE5-meta aesthetic —
// deliberately placeholder, never mistaken for finished art, and
// readable enough that UV stretching/orientation shows at a glance.
//
// "Color slots are transparent" — the meta material's base color
// is pure white, so it contributes no tint; the UV-test texture
// shows true. The bundle-color tinting the v0.1.x builders did is
// gone in meta mode. Atmospheres re-introduce real materials;
// "none" is honest blockout.
//
// Texture + material are lazily built and cached — identical
// across every meta-skinned mesh, so build once. Lazy so importing
// this module costs nothing until the first meta build (keeps
// node-env unit tests that import builders from touching the DOM).

import * as THREE from "three";

/**
 * Draw a UV-test checker: two neutral grays, a faint diagonal
 * orientation gradient (so +U / +V are unambiguous), white grid
 * lines, and a "0,0" corner marker.
 */
function drawUvTest(size: number, cells: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const cell = size / cells;

  // Checker — two neutral grays, UE5-meta tone.
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? "#3a3a3a" : "#6a6a6a";
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }

  // Orientation gradient — red origin corner fading to green
  // opposite, so the texture is never rotationally ambiguous.
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, "rgba(255, 80, 80, 0.0)");
  grad.addColorStop(1, "rgba(80, 255, 120, 0.22)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Grid lines.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= cells; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cell + 0.5, 0);
    ctx.lineTo(i * cell + 0.5, size);
    ctx.moveTo(0, i * cell + 0.5);
    ctx.lineTo(size, i * cell + 0.5);
    ctx.stroke();
  }

  // Origin marker.
  ctx.fillStyle = "#ffffff";
  ctx.font = `${Math.round(cell * 0.42)}px monospace`;
  ctx.textBaseline = "top";
  ctx.fillText("0,0", 5, 4);

  return canvas;
}

let cachedTexture: THREE.CanvasTexture | null = null;

/**
 * The shared UV-test texture. Built on first call, cached
 * thereafter. RepeatWrapping so builders can tile it onto larger
 * faces without re-generating.
 */
export function uvTestTexture(): THREE.CanvasTexture {
  if (!cachedTexture) {
    const tex = new THREE.CanvasTexture(drawUvTest(512, 8));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    cachedTexture = tex;
  }
  return cachedTexture;
}

/**
 * A fresh meta material — UV-test map, pure-white base color
 * (the "transparent color slot": no tint, texture shows true),
 * neutral roughness. NOT cached: each mesh owns its material so
 * SmartObject.dispose()'s traversal can free it without
 * affecting siblings (per SMART_OBJECTS.md open question Q1's
 * "clone materials" recommendation).
 */
export function metaMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: uvTestTexture(),
    color: 0xffffff,
    roughness: 0.8,
    metalness: 0.0,
  });
}

/** Neutral meta tone for trigger pads in blockout mode. */
export const META_PAD_COLOR = "#808080";
