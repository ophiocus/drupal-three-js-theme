// Forest atmosphere — entry point.
//
// Exports the canonical `AtmosphereModule` shape (default export).
// SceneManager reads the registry, not this file directly.
//
// Per docs/ATMOSPHERES.md §"Stage 6 — Renderer integration":
// atmosphere builders register BEFORE the default builders.
// First-match-wins ordering means the atmosphere claims its
// bundles; anything it doesn't claim falls through to defaults.

import type {
  AtmosphereEnvironment,
  AtmosphereModule,
  AtmosphereSetupContext,
} from "../types.js";
import type { SmartObjectRegistry } from "../../smart-objects/Builder.js";
import { ArticleAsTree } from "./ArticleAsTree.js";
import { ProfileAsSpirit } from "./ProfileAsSpirit.js";
import { EventAsTotem } from "./EventAsTotem.js";
import { placeForestScenery } from "./scenery.js";
import { PollenField } from "./pollen.js";
import { buildForestSoundscape } from "./audio.js";

/** Builder registration — extends as `mappings.yml` grows beyond bundle.article. */
function registerBuilders(registry: SmartObjectRegistry): void {
  registry.register(new ArticleAsTree());
  registry.register(new ProfileAsSpirit());
  registry.register(new EventAsTotem());
}

/**
 * Environment: decorative scenery (mushrooms, ferns, stones) near
 * sector centroids, plus a drifting pollen particle layer.
 *
 * Everything attaches into `ctx.root` — SceneManager's disposable
 * world-layer group — so a switch tears it down with the rest of
 * the world. Returns a disposer for the pollen `THREE.Points`
 * (the world-layer Mesh-walk teardown deliberately skips Points).
 */
function setupEnvironment(ctx: AtmosphereSetupContext): AtmosphereEnvironment {
  placeForestScenery(ctx.root, ctx.snapshot);
  const pollen = new PollenField(ctx.snapshot);
  ctx.root.add(pollen.points);
  ctx.registerUpdater((elapsed) => pollen.update(elapsed));
  return { dispose: () => pollen.dispose() };
}

const forestAtmosphere: AtmosphereModule = {
  key: "forest",
  i18nLabelKey: "switcher.atmosphere.forest",
  registerBuilders,
  setupEnvironment,
  buildSoundscape: buildForestSoundscape,
};

export default forestAtmosphere;
