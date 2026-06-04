// Bridge: render Drupal-served HTML to a CanvasTexture via
// html-to-image (SVG foreignObject under the hood). Universal
// browser support; only ever instantiated when the HIC path
// is unavailable.

import * as THREE from "../../toolbox/three.js";
import {
  HtmlSurface,
  HtmlSurfaceOptions,
  makeSurfaceMesh,
  wrapHtmlFragment,
} from "./HtmlSurface.js";

export class HtmlMeshSurface extends HtmlSurface {
  readonly mesh: THREE.Mesh;
  private texture: THREE.CanvasTexture | null = null;

  constructor(private readonly options: HtmlSurfaceOptions) {
    super();
    this.mesh = makeSurfaceMesh(options);
  }

  async refresh(): Promise<void> {
    const { toCanvas } = await import("html-to-image");

    const fragment = await fetchFragment(this.options.url);
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
      const canvas = await toCanvas(container, {
        width: this.options.widthPx,
        height: this.options.heightPx,
        backgroundColor: this.options.transparent ? undefined : "#ffffff",
        pixelRatio: 1,
        cacheBust: true,
      });
      this.applyTexture(canvas);
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

  private applyTexture(canvas: HTMLCanvasElement): void {
    if (this.texture) {
      this.texture.dispose();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.texture = tex;

    const mat = this.mesh.material as THREE.MeshBasicMaterial;
    mat.map = tex;
    mat.needsUpdate = true;
  }
}

async function fetchFragment(url: string): Promise<string> {
  const r = await fetch(withCurrentLang(url), { headers: { Accept: "text/html" } });
  if (!r.ok) {
    throw new Error(`HtmlMeshSurface fetch ${url} failed: HTTP ${r.status}`);
  }
  return r.text();
}

/** Append `?lang=` to a card-endpoint URL so the mesh surface paints
 *  the translated content. Mirrors the helper in CardController. */
function withCurrentLang(url: string): string {
  try {
    const u = new URL(window.location.href);
    const fromUrl = u.searchParams.get("lang");
    const lang = fromUrl
      || (() => { try { return window.localStorage.getItem("world.lang") ?? ""; } catch { return ""; } })();
    if (!lang) return url;
    const out = new URL(url, window.location.href);
    out.searchParams.set("lang", lang);
    return url.startsWith("/") ? out.pathname + out.search : out.toString();
  } catch {
    return url;
  }
}
