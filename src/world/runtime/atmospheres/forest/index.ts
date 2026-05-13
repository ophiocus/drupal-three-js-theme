// Forest atmosphere — entry point.
//
// Registers the forest atmosphere's Builders with the shared
// SmartObjectRegistry. Called from SceneManager.mount() when
// the snapshot declares this atmosphere as active.
//
// Per docs/ATMOSPHERES.md §"Stage 6 — Renderer integration":
// atmosphere builders register BEFORE the default builders.
// First-match-wins ordering means the atmosphere claims its
// bundles; anything it doesn't claim falls through to defaults.

import type { SmartObjectRegistry } from "../../smart-objects/Builder.js";
import { ArticleAsTree } from "./ArticleAsTree.js";

/**
 * Register every Builder this atmosphere ships with. Add new
 * builders here as `mappings.yml` grows beyond bundle.article.
 *
 * Status (2026-05-13):
 *   - ArticleAsTree:        shipped (primitive geometry; oak-stylized.glb pending)
 *   - ProfileAsSpirit:      pending (sapling-figure.glb)
 *   - EventAsTotem:         pending (standing-stone.glb)
 *   - ChatvatarAsForestBeing: deferred to v0.2
 */
export function registerForestAtmosphere(registry: SmartObjectRegistry): void {
  registry.register(new ArticleAsTree());
}
