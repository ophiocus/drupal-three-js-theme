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

import * as THREE from "../../../../toolbox/three.js";
import type { CorpusSnapshot, Vec3 } from "../../../types.js";
import type { SmartObjectRegistry } from "../../smart-objects/Builder.js";
import type { AtmosphereUpdater } from "../forest/index.js";
import { ArticleAsCrystal } from "./ArticleAsCrystal.js";
import { ProfileAsOrb } from "./ProfileAsOrb.js";
import { EventAsRing } from "./EventAsRing.js";
import { AcidMotes } from "./motes.js";
import { SurrealZodiac } from "./zodiac.js";
import { FuzzyRegions } from "./regions.js";
import { projectMds3D } from "./projection.js";

export function registerInnerMindAtmosphere(registry: SmartObjectRegistry): void {
  registry.register(new ArticleAsCrystal());
  registry.register(new ProfileAsOrb());
  registry.register(new EventAsRing());
}

/**
 * inner-mind's OWN interpretation of the embedding data
 * (docs/INTERPRETATION_ENGINE.md): project the corpus embeddings into a
 * 3D cloud (MDS-3D) and lift it into the air, so the centre reads as a
 * star system the camera orbits in full 3D — rather than the forest's
 * 2D ground layout. Returns null when too few entities carry embeddings
 * (the snapshot strips them for large corpora, or world:embed hasn't
 * run), in which case SceneManager falls back to taxonomy placement.
 *
 * SceneManager calls this (duck-typed) at registerAtmosphere time and
 * uses the result as the per-entity world position.
 */
export function computeLayout(snapshot: CorpusSnapshot): Map<string, Vec3> | null {
  const embeddings = new Map<string, number[]>();
  for (const e of Object.values(snapshot.entities)) {
    const emb = e.signature?.semantic?.embedding;
    if (Array.isArray(emb) && emb.length > 0) embeddings.set(e.id, emb);
  }
  if (embeddings.size < 2) return null;

  // Project into a ball ~half the world radius, then lift the whole
  // cloud airborne so the free-orbit camera circles a floating system
  // (not something half-buried in the ground plane).
  const cloud = projectMds3D(embeddings, snapshot.world.radius * 0.55);
  const baseY = snapshot.world.overviewHeight * 0.6;
  const out = new Map<string, Vec3>();
  for (const [id, p] of cloud) {
    out.set(id, { x: p.x, y: p.y + baseY, z: p.z });
  }
  return out;
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
  layout: Map<string, Vec3> | null,
): () => void {
  const motes = new AcidMotes(snapshot);
  root.add(motes.points);

  // BETA 1: the surrounding zodiac — surreal structures in the
  // unreachable outer orbit, framing the navigable centre as a star
  // system. Slowly orbits the centre; self-spins per structure.
  const zodiac = new SurrealZodiac(snapshot);
  root.add(zodiac.group);

  // Interpretation engine §2: fuzzy cluster spheres around each sector's
  // 3D members — multi-tagged entities pull centroids together so
  // spheres overlap on commonality (additive blending makes the
  // intersection glow). Only meaningful when a 3D layout is present.
  const regions = layout ? new FuzzyRegions(snapshot, layout) : null;
  if (regions) root.add(regions.group);

  // Cache fog ref once; cheap per-frame writes thereafter.
  const fog = scene.fog instanceof THREE.Fog ? scene.fog : null;

  registerUpdater((elapsed) => {
    motes.update(elapsed);
    zodiac.update(elapsed);
    regions?.update(elapsed);
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
    regions?.dispose();
  };
}
