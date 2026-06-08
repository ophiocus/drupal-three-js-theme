// Atmosphere registry — the catalog of available visual themes.
//
// Every supported atmosphere is registered here with a lazy loader.
// SceneManager + AtmosphereSwitcher + AtmosphereAudio + StageEditor
// all read from this registry; none of them name an atmosphere
// directly. To ship a new visual theme:
//
//   1. Create `src/world/runtime/atmospheres/<key>/index.ts` exporting
//      `export default <AtmosphereModule>`.
//   2. Add one line below:
//        registerAtmosphereLoader("<key>", () =>
//          import("./<key>/index.js").then(m => m.default));
//   3. Add the i18n entries `switcher.atmosphere.<key>` in
//      hud/i18n.ts (per supported language).
//   4. Add the key to the server-side palette config's
//      `atmosphere_overrides` map and to
//      `WorldConfigEditor::ALLOWED_ATMOSPHERES`.
//
// Nothing else. The renderer picks up the new atmosphere from the
// registry list on the next page load.

import type { AtmosphereModule } from "./types.js";

type AtmosphereLoader = () => Promise<AtmosphereModule>;

/** Insertion-ordered so the AtmosphereSwitcher renders pills in the
 *  same order they were registered. Reorder by changing the
 *  registration order at the bottom of this file. */
const loaders = new Map<string, AtmosphereLoader>();

/** Module cache so the second `loadAtmosphere(key)` is synchronous. */
const cache = new Map<string, AtmosphereModule>();

/**
 * Register an atmosphere's lazy-load entry. Idempotent — calling
 * twice with the same key replaces the loader (useful for tests).
 * Order of registration is preserved in `listAtmosphereKeys()`.
 */
export function registerAtmosphereLoader(
  key: string,
  loader: AtmosphereLoader,
): void {
  loaders.set(key, loader);
  // Clear the cache for this key — the loader changed, the cached
  // module is stale. New loaders for the same key are rare outside
  // tests, but the guard keeps test reloads deterministic.
  cache.delete(key);
}

/** Keys in registration order. Drives the switcher pill list. */
export function listAtmosphereKeys(): readonly string[] {
  return Array.from(loaders.keys());
}

/** Whether an atmosphere is registered. Useful for the StageEditor's
 *  "default atmosphere" dropdown validation. */
export function hasAtmosphere(key: string): boolean {
  return loaders.has(key);
}

/**
 * Load an atmosphere module. Caches on first success; subsequent
 * calls return the same instance without re-importing. Returns null
 * on unknown key, or when the dynamic import fails (logs a warning).
 */
export async function loadAtmosphere(
  key: string,
): Promise<AtmosphereModule | null> {
  const cached = cache.get(key);
  if (cached) return cached;
  const loader = loaders.get(key);
  if (!loader) return null;
  try {
    const mod = await loader();
    cache.set(key, mod);
    return mod;
  } catch (err) {
    console.warn(`[atmospheres] load "${key}" failed:`, err);
    return null;
  }
}

// ─── Catalog ───────────────────────────────────────────────────────────────
// Add a new atmosphere by adding one line. The dynamic import keeps
// inactive atmospheres out of the main bundle (vite splits them into
// separate chunks).

registerAtmosphereLoader("forest", async () =>
  (await import("./forest/index.js")).default,
);

registerAtmosphereLoader("inner-mind", async () =>
  (await import("./inner-mind/index.js")).default,
);
