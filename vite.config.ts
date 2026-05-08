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
