import { defineConfig } from "vite";
import { resolve } from "path";

// Vite config for the world renderer.
//
// Build target: a single bundle the Drupal theme's libraries.yml
// references. Dev server runs on the port DDEV exposes via
// web_extra_exposed_ports (5173).
export default defineConfig({
  root: ".",
  publicDir: false,
  // CRITICAL: dedupe Three.js across dynamically-imported chunks.
  //
  // Without this, every chunk that does `import * as THREE from "three"`
  // bundles its own copy. Lazy-loaded atmospheres (forest/, etc.)
  // are separate chunks → separate three instances → cross-instance
  // `instanceof` checks fail.
  //
  // The symptom that surfaced this: builders attach TriggerPadComponent
  // and HtmlSurfaceComponent (one three instance), CardController's
  // `findComponent` checks via `instanceof` (another three instance),
  // every component check returns false, register() reports
  // 'no pad AND no surface' for every entity, no clicks work.
  //
  // Three itself prints 'THREE.WARNING: Multiple instances of Three.js
  // being imported' which made the diagnosis cheap. Without dedupe,
  // any class identity (THREE.Mesh, THREE.Material, THREE.Vector3,
  // user-defined component classes that happen to import three) is
  // chunk-local.
  resolve: {
    dedupe: ["three"],
  },
  build: {
    // Build into the theme so libraries.yml can reference the
    // bundle via a theme-relative path. The whole dist/ tree is
    // gitignored; engineers run `ddev npm run build` after a
    // fresh clone.
    outDir: "web/themes/custom/drupal_threejs/dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        world: resolve(__dirname, "src/main.ts"),
      },
      output: {
        entryFileNames: "[name].bundle.js",
        chunkFileNames: "[name]-[hash].js",
        assetFileNames: "[name].[ext]",
        // CRITICAL: inline ALL dynamic imports into the main bundle.
        //
        // Without this, dynamic imports (atmosphere chunks, html-to-image
        // chunks) become separate chunks that import back from
        // ./world.bundle.js with NO query string. The page's <script>
        // tag loads world.bundle.js?v=<hash> for cache-busting. ES
        // module identity is keyed on the FULL URL including query —
        // these are two different module instances.
        //
        // Consequence pre-fix: every class defined in world.bundle.js
        // (TriggerPadComponent, HtmlSurfaceComponent, SmartObject,
        // Three.js itself) was created TWICE — once per module
        // instance. Builders living in the chunk attached components
        // built from the second instance's classes; CardController in
        // the main page checked `instanceof` against the first
        // instance's classes; every check returned false; every
        // entity dropped out of CardController; no clicks worked.
        //
        // Three.js itself spotted the double-init and printed
        // 'THREE.WARNING: Multiple instances of Three.js being
        // imported.' which is the high-value signal that this is
        // happening.
        //
        // Tradeoff: the bundle is slightly larger (forest atmosphere
        // ~13 KB + html-to-image ~9 KB now inlined). For our scale
        // (~24 entities, single atmosphere) this is fine. When
        // multiple atmospheres ship, the better fix is to align
        // the cache-bust URL across script tag AND chunk imports —
        // either by switching cache-bust from ?v=<hash> query to
        // filename hashing (world-<hash>.bundle.js) or by stripping
        // the query entirely.
        inlineDynamicImports: true,
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    cors: true,
  },
});
