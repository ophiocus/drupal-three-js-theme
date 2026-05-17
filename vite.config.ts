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
