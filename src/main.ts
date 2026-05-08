// Entry point for the renderer. The theme's page.html.twig override
// emits a <canvas data-world-canvas> + a <script type="application/json"
// data-scene-root>. Vite bundles this file into dist/world.bundle.js,
// which the theme's libraries.yml ships to the browser.

import { SceneManager } from "./world/runtime/SceneManager.js";

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>(
    "canvas[data-world-canvas]",
  );
  if (!canvas) {
    console.warn("[world] no canvas[data-world-canvas] found; renderer dormant.");
    return;
  }

  // Snapshot URL is pinned to the cypher's REST resource. v0.0.2 will
  // accept a snapshot version override in the URL query for permalinks.
  const sm = new SceneManager(canvas);
  try {
    await sm.mount({ snapshotUrl: "/world/snapshot/full" });
  } catch (error) {
    console.error("[world] mount failed:", error);
  }

  // Expose for debugging at the JS console while we're in ALPHA.
  // Removed in v0.0.2 once Vantage + Card runtime own URL routing.
  (window as unknown as { worldScene?: SceneManager }).worldScene = sm;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void boot());
} else {
  void boot();
}
