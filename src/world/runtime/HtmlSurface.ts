// HtmlSurface — Drupal-served HTML painted onto a 3D quad as a
// texture. The engine's core differentiator (see docs/HTML_SURFACES.md).
//
// Capability-detected at construction time:
//   - HtmlInCanvasSurface  — Chromium 147+ with the
//                            #canvas-draw-element flag; uses the
//                            native drawElementImage() API. Sharper,
//                            faster, accessibility preserved.
//   - HtmlMeshSurface      — universal-browser bridge via html-to-image
//                            (lazy-loaded; never imported on the HIC
//                            path). Rasterised snapshot.
//
// Both produce a THREE.Mesh ready for the scene; properties don't
// know which path is active.

import * as THREE from "three";

export interface HtmlSurfaceOptions {
  /** Endpoint serving the HTML fragment, e.g. /world/card/node/1/default. */
  url: string;
  /** Texture pixel dimensions — drives the underlying canvas size. */
  widthPx: number;
  heightPx: number;
  /** World-space dimensions of the resulting plane mesh. */
  widthWorld?: number;
  heightWorld?: number;
  /** Transparent background lets the scene's color show through. */
  transparent?: boolean;
}

export abstract class HtmlSurface {
  abstract readonly mesh: THREE.Mesh;
  /** Re-fetch + re-rasterise. Idempotent; safe to call repeatedly. */
  abstract refresh(): Promise<void>;
  /** Free GPU resources. Call when removing the surface from the scene. */
  abstract dispose(): void;
}

/**
 * Factory: pick the SOTA path if the browser supports it, fall back
 * to the bridge otherwise. Single API on the property's side.
 */
export async function createHtmlSurface(options: HtmlSurfaceOptions): Promise<HtmlSurface> {
  if (hasHtmlInCanvas()) {
    const { HtmlInCanvasSurface } = await import("./HtmlInCanvasSurface.js");
    return new HtmlInCanvasSurface(options);
  }
  const { HtmlMeshSurface } = await import("./HtmlMeshSurface.js");
  return new HtmlMeshSurface(options);
}

/**
 * Capability detection for the native HTML-in-Canvas API.
 * Chromium 147+ behind chrome://flags/#canvas-draw-element exposes
 * drawElementImage on the 2D rendering context. Other browsers
 * (and unflagged Chromium) get the html-to-image bridge.
 */
export function hasHtmlInCanvas(): boolean {
  if (typeof CanvasRenderingContext2D === "undefined") return false;
  return "drawElementImage" in CanvasRenderingContext2D.prototype;
}

/**
 * Shared helper used by both concrete surfaces: build the mesh
 * geometry + material. Texture is attached later by refresh().
 */
export function makeSurfaceMesh(options: HtmlSurfaceOptions): THREE.Mesh {
  const aspect = options.widthPx / options.heightPx;
  const heightWorld = options.heightWorld ?? 14;
  const widthWorld = options.widthWorld ?? heightWorld * aspect;
  const geometry = new THREE.PlaneGeometry(widthWorld, heightWorld);
  const material = new THREE.MeshBasicMaterial({
    transparent: options.transparent ?? true,
    side: THREE.DoubleSide,
    color: 0xffffff,
  });
  return new THREE.Mesh(geometry, material);
}

/**
 * Drupal-served HTML often arrives with a fragment-only structure
 * (just the entity render, no <html>/<head>/<body>). Wrap it with
 * a minimal frame so html-to-image's serializer is happy and the
 * styling defaults are predictable. Ignored by the HIC path.
 */
export function wrapHtmlFragment(fragment: string, transparent: boolean): string {
  const bg = transparent ? "transparent" : "white";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:16px;background:${bg};font-family:system-ui,-apple-system,sans-serif;color:#222;line-height:1.4;}
    h1,h2,h3{margin:0 0 8px;line-height:1.2;}
    p{margin:0 0 12px;}
    a{color:#0064b0;text-decoration:none;}
  </style></head><body>${fragment}</body></html>`;
}
