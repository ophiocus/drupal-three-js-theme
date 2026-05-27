// SOTA: render Drupal-served HTML directly into a 2D canvas via
// the native drawElementImage() API (HTML-in-Canvas spec, Chromium
// 147+ behind chrome://flags/#canvas-draw-element).
//
// No html2canvas, no rasterisation library — the browser does the
// work. Subpixel rendering, ligatures, RTL, accessibility tree all
// preserved. As HIC reaches stable across browsers, properties
// transparently upgrade.

import * as THREE from "../../toolbox/three.js";
import {
  HtmlSurface,
  HtmlSurfaceOptions,
  makeSurfaceMesh,
  wrapHtmlFragment,
} from "./HtmlSurface.js";

// Augment the 2D context type with the experimental method. As of
// 2026-05 this isn't in @types/web; the augmentation is local.
interface DrawElementImageContext extends CanvasRenderingContext2D {
  drawElementImage(element: Element, dx?: number, dy?: number): void;
}

export class HtmlInCanvasSurface extends HtmlSurface {
  readonly mesh: THREE.Mesh;
  private readonly canvas: HTMLCanvasElement;
  private texture: THREE.CanvasTexture | null = null;

  constructor(private readonly options: HtmlSurfaceOptions) {
    super();
    this.canvas = document.createElement("canvas");
    this.canvas.width = options.widthPx;
    this.canvas.height = options.heightPx;
    this.mesh = makeSurfaceMesh(options);
  }

  async refresh(): Promise<void> {
    const fragment = await fetchFragment(this.options.url);

    // The DOM source must be in the document for drawElementImage
    // to compute layout and styles. Hide offscreen.
    const container = document.createElement("div");
    container.style.cssText = [
      "position:fixed",
      "left:-10000px",
      "top:0",
      `width:${this.options.widthPx}px`,
      `height:${this.options.heightPx}px`,
      "overflow:hidden",
      "pointer-events:none",
    ].join(";");
    container.innerHTML = wrapHtmlFragment(fragment, this.options.transparent ?? true);
    document.body.appendChild(container);

    try {
      const ctx = this.canvas.getContext("2d") as DrawElementImageContext | null;
      if (!ctx || typeof ctx.drawElementImage !== "function") {
        throw new Error("drawElementImage unavailable; HtmlInCanvasSurface should not have been instantiated.");
      }
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.drawElementImage(container);
      this.applyTexture();
    } finally {
      document.body.removeChild(container);
    }
  }

  dispose(): void {
    this.texture?.dispose();
    const mat = this.mesh.material as THREE.Material;
    mat.dispose();
    this.mesh.geometry.dispose();
  }

  private applyTexture(): void {
    if (this.texture) {
      this.texture.dispose();
    }
    const tex = new THREE.CanvasTexture(this.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.texture = tex;

    const mat = this.mesh.material as THREE.MeshBasicMaterial;
    mat.map = tex;
    mat.needsUpdate = true;
  }
}

async function fetchFragment(url: string): Promise<string> {
  const r = await fetch(url, { headers: { Accept: "text/html" } });
  if (!r.ok) {
    throw new Error(`HtmlInCanvasSurface fetch ${url} failed: HTTP ${r.status}`);
  }
  return r.text();
}
