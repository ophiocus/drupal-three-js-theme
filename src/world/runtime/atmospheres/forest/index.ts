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

import type * as THREE from "three";
import type { CorpusSnapshot } from "../../../types.js";
import type { SmartObjectRegistry } from "../../smart-objects/Builder.js";
import { ArticleAsTree } from "./ArticleAsTree.js";
import { ProfileAsSpirit } from "./ProfileAsSpirit.js";
import { EventAsTotem } from "./EventAsTotem.js";
import { placeForestScenery } from "./scenery.js";
import { PollenField } from "./pollen.js";

/**
 * Per-frame updater an atmosphere can register with the host
 * (SceneManager) for animated environment elements (particles,
 * sky shifts, audio cues). Called every frame with
 * (elapsedSeconds, dt). Atmospheres without animations simply
 * don't register one.
 */
export type AtmosphereUpdater = (elapsed: number, dt: number) => void;

/**
 * Register every Builder this atmosphere ships with. Add new
 * builders here as `mappings.yml` grows beyond bundle.article.
 *
 * Status (2026-05-15):
 *   - ArticleAsTree:        shipped (primitive geometry; oak-stylized.glb pending)
 *   - ProfileAsSpirit:      shipped (primitive bipedal stack; sapling-figure.glb pending)
 *   - EventAsTotem:         shipped (primitive tapered pillar; standing-stone.glb pending;
 *                                    temporal-urgency emissive deferred to v0.3.x)
 *   - ChatvatarAsForestBeing: deferred to v0.4 (LLM dialogue layer)
 */
export function registerForestAtmosphere(registry: SmartObjectRegistry): void {
  registry.register(new ArticleAsTree());
  registry.register(new ProfileAsSpirit());
  registry.register(new EventAsTotem());
}

/**
 * Set up the forest atmosphere's environment — decorative
 * scenery (mushrooms, ferns, stones) scattered near sector
 * centroids, plus (when implemented) particle layers and any
 * other atmosphere-wide visual elements.
 *
 * Optional companion to registerForestAtmosphere. SceneManager
 * calls it after the builders are registered and entities are
 * placed. Atmospheres without environment work simply omit this
 * export; the contract is duck-typed at the SceneManager side.
 */
export function setupForestEnvironment(
  scene: THREE.Scene,
  snapshot: CorpusSnapshot,
  registerUpdater: (fn: AtmosphereUpdater) => void,
): void {
  placeForestScenery(scene, snapshot);
  // Pollen — 80 drifting motes catching the low golden sun.
  // Per-frame sinusoidal drift; registered with the host so
  // SceneManager can tick it from its animation loop.
  const pollen = new PollenField(snapshot);
  scene.add(pollen.points);
  registerUpdater((elapsed) => pollen.update(elapsed));
}
