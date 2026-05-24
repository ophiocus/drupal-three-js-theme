/**
 * Headless glTF transform — optimize + normalize a model for the world.
 *
 * Geometry ops (no native deps): dedup, flatten, join, weld, prune.
 * Plus a recenter pass that puts the model's base at y=0 and centers
 * it on X/Z — the "base pivot" curation goal — and an optional
 * fit-height rescale. Reads .glb/.gltf, writes a self-contained .glb.
 *
 * Texture re-compression is intentionally NOT done here (it needs the
 * native `sharp` dep); that's a later option if texture weight bites.
 */

import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, weld, prune } from '@gltf-transform/functions';

/**
 * @param {string} input  path to .glb/.gltf
 * @param {string} output path to write .glb
 * @param {{recenter?: boolean, fitHeight?: number|null}} opts
 */
export async function transform(input, output, opts = {}) {
  const { recenter = true, fitHeight = null } = opts;

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(input);

  // Optimization pass — merge + clean. join() collapses compatible
  // meshes toward the "single material slot" curation goal; weld()
  // de-duplicates vertices; prune() drops anything now unused.
  await doc.transform(
    dedup(),
    flatten(),
    join(),
    weld(),
    prune(),
  );

  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  if (scene && (recenter || fitHeight)) {
    const { min, max } = getBounds(scene);
    const height = max[1] - min[1] || 1;
    const cx = (min[0] + max[0]) / 2;
    const cz = (min[2] + max[2]) / 2;
    const scale = fitHeight ? fitHeight / height : 1;

    for (const node of scene.listChildren()) {
      const t = node.getTranslation();
      if (recenter) {
        // Center X/Z, drop base to y=0, then apply uniform scale
        // about that recentred origin.
        node.setTranslation([
          (t[0] - cx) * scale,
          (t[1] - min[1]) * scale,
          (t[2] - cz) * scale,
        ]);
      } else if (fitHeight) {
        node.setTranslation([t[0] * scale, t[1] * scale, t[2] * scale]);
      }
      if (fitHeight) {
        const s = node.getScale();
        node.setScale([s[0] * scale, s[1] * scale, s[2] * scale]);
      }
    }
  }

  await io.write(output, doc);

  // Report a compact summary.
  const after = getBounds(scene);
  return {
    output,
    bounds: after,
    height: (after.max[1] - after.min[1]).toFixed(3),
  };
}
