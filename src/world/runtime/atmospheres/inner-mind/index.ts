// inner-mind atmosphere — entry point.
//
// The "acid trip" skin. Abstract procedural geometry (thought
// crystals, psyche orbs, ripple rings) in vivid hue-from-hash
// colours, over a hue-cycling background + multicoloured motes.
// A deliberate STUB to prove the world switcher (docs/feature-
// requests/world-switcher.md) — the real inner-mind metaphor is
// BETA 1. Refine the forms via the asset catalog later.
//
// Mirrors the forest atmosphere's contract: registerXAtmosphere
// + setupXEnvironment, both called by SceneManager.

import * as THREE from "three";
import type { CorpusSnapshot } from "../../../types.js";
import type { SmartObjectRegistry } from "../../smart-objects/Builder.js";
import type { AtmosphereUpdater } from "../forest/index.js";
import { ArticleAsCrystal } from "./ArticleAsCrystal.js";
import { ProfileAsOrb } from "./ProfileAsOrb.js";
import { EventAsRing } from "./EventAsRing.js";
import { AcidMotes } from "./motes.js";
import { SurrealZodiac } from "./zodiac.js";

export function registerInnerMindAtmosphere(registry: SmartObjectRegistry): void {
  registry.register(new ArticleAsCrystal());
  registry.register(new ProfileAsOrb());
  registry.register(new EventAsRing());
}

/**
 * Environment: drifting acid motes + a per-frame hue cycle of the
 * scene background + fog. The hue cycle runs in an atmosphereUpdater,
 * which SceneManager ticks AFTER the BiomeMixer each frame — so for
 * inner-mind the trip overrides the (forest-tuned) biome blend.
 *
 * v1.5 world switcher: the motes attach into `root` (SceneManager's
 * disposable world-layer) so a switch tears them down with the world;
 * `scene` is still needed for the background/fog hue mutation. Returns
 * a disposer for the mote `THREE.Points` (the world-layer Mesh-walk
 * teardown skips Points).
 */
export function setupInnerMindEnvironment(
  scene: THREE.Scene,
  root: THREE.Object3D,
  snapshot: CorpusSnapshot,
  registerUpdater: (fn: AtmosphereUpdater) => void,
): () => void {
  const motes = new AcidMotes(snapshot);
  root.add(motes.points);

  // BETA 1: the surrounding zodiac — surreal structures in the
  // unreachable outer orbit, framing the navigable centre as a star
  // system. Slowly orbits the centre; self-spins per structure.
  const zodiac = new SurrealZodiac(snapshot);
  root.add(zodiac.group);

  // Cache fog ref once; cheap per-frame writes thereafter.
  const fog = scene.fog instanceof THREE.Fog ? scene.fog : null;

  registerUpdater((elapsed) => {
    motes.update(elapsed);
    zodiac.update(elapsed);
    // Slow hue rotation — the whole world breathes through the
    // spectrum. ~40s per full cycle.
    const hue = (elapsed * 0.025) % 1;
    if (scene.background instanceof THREE.Color) {
      scene.background.setHSL(hue, 0.7, 0.12);
    }
    if (fog) {
      fog.color.setHSL((hue + 0.5) % 1, 0.8, 0.18);
    }
  });

  return () => {
    motes.dispose();
    zodiac.dispose();
  };
}
