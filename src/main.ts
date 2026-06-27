// Entry point for the renderer. The theme's page.html.twig override
// emits a <canvas data-world-canvas> + a <script type="application/json"
// data-scene-root>. Vite bundles this file into dist/world.bundle.js,
// which the theme's libraries.yml ships to the browser.

import { SceneManager } from "./world/runtime/SceneManager.js";
import { maybeShowFirstVisitOverlay } from "./world/runtime/hud/FirstVisitOverlay.js";

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>(
    "canvas[data-world-canvas]",
  );
  if (!canvas) {
    console.warn("[world] no canvas[data-world-canvas] found; renderer dormant.");
    return;
  }
  // Idempotency guard. type=module scripts evaluate once per URL,
  // but Drupal's aggregation / BigPipe / dev-tool quirks have been
  // observed to fire two mounts in a row. The canvas dataset is
  // the single source of truth: if we've already booted, no-op.
  if (canvas.dataset.worldBooted === "1") {
    console.warn("[world] boot() re-entry; ignoring (already mounted).");
    return;
  }
  canvas.dataset.worldBooted = "1";

  // Snapshot URL is pinned to the cypher's REST resource. v0.0.2 will
  // accept a snapshot version override in the URL query for permalinks.
  const sm = new SceneManager(canvas);
  try {
    await sm.mount({ snapshotUrl: "/world/snapshot/full" });
  } catch (error) {
    console.error("[world] mount failed:", error);
  }

  // First-visit overlay — only mounts when the onboarding wizard
  // flagged it via drupalSettings AND localStorage hasn't seen it.
  // Idempotent and gated; safe to call unconditionally.
  maybeShowFirstVisitOverlay();

  // Expose for debugging at the JS console while we're in ALPHA.
  // Removed in v0.0.2 once Vantage + Card runtime own URL routing.
  (window as unknown as { worldScene?: SceneManager }).worldScene = sm;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void boot());
} else {
  void boot();
}
