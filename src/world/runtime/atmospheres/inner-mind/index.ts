// inner-mind atmosphere — entry point.
//
// The "acid trip" skin. Abstract procedural geometry (thought
// crystals, psyche orbs, ripple rings) in vivid hue-from-hash
// colours, over a hue-cycling background + multicoloured motes,
// with the surreal zodiac orbiting the outer field.
//
// Exports the canonical `AtmosphereModule` shape (default export);
// the registry-driven SceneManager calls its hooks generically.

import * as THREE from "../../../../toolbox/three.js";
import type { CorpusSnapshot, Vec3 } from "../../../types.js";
import type { SmartObjectRegistry } from "../../smart-objects/Builder.js";
import type {
  AtmosphereEnvironment,
  AtmosphereModule,
  AtmosphereSetupContext,
} from "../types.js";
import { ArticleAsCrystal } from "./ArticleAsCrystal.js";
import { ProfileAsOrb } from "./ProfileAsOrb.js";
import { EventAsRing } from "./EventAsRing.js";
import { AcidMotes } from "./motes.js";
import { SurrealZodiac } from "./zodiac.js";
import { FuzzyRegions } from "./regions.js";
import { fibonacciSphere, projectAnchored, projectMds3D } from "./projection.js";
import { buildInnerMindSoundscape } from "./audio.js";
import { StageEditor } from "../../hud/StageEditor.js";

function registerBuilders(registry: SmartObjectRegistry): void {
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
 */
function computeLayout(snapshot: CorpusSnapshot): Map<string, Vec3> | null {
  const targetRadius = snapshot.world.radius * 0.55;
  const baseY = snapshot.world.overviewHeight * 0.6;

  const embeddings = new Map<string, number[]>();
  for (const e of Object.values(snapshot.entities)) {
    const emb = e.signature?.semantic?.embedding;
    if (Array.isArray(emb) && emb.length > 0) embeddings.set(e.id, emb);
  }

  let cloud: Map<string, Vec3>;
  if (embeddings.size >= 2) {
    // Embedded path — the real interpretation layout. Anchored axes
    // when they're shipped + meaningful (a neural model has run
    // world:embed Pass 4); MDS-3D otherwise (always works).
    const anchors = snapshot.world.interpretationAxes;
    cloud = anchors && anchors.axes.length > 0
      ? projectAnchored(embeddings, anchors.axes, targetRadius)
      : new Map<string, Vec3>();
    if (cloud.size === 0) {
      cloud = projectMds3D(embeddings, targetRadius);
    }
    applyTemporalShift(cloud, snapshot);
  } else {
    // No embeddings yet (world:embed hasn't run, was wiped, or
    // strippedat the INTERPRETATION_EMBEDDING_LIMIT). Still give the
    // user a distinctively 3D layout — a Fibonacci sphere on the
    // entity ids — so the inner-mind atmosphere reads as "different
    // universe" rather than "forest with abstract assets." This is a
    // structural placeholder, not a meaningful frame: positions
    // carry no semantics, just an isotropic 3D arrangement.
    const ids = Object.keys(snapshot.entities);
    if (ids.length === 0) return null;
    cloud = fibonacciSphere(ids, targetRadius);
  }

  const out = new Map<string, Vec3>();
  for (const [id, p] of cloud) {
    out.set(id, { x: p.x, y: p.y + baseY, z: p.z });
  }
  return out;
}

/** Per-entity radial shift toward (newer) or away from (older) the
 *  cloud's centroid, normalised over the corpus's createdAt range. */
function applyTemporalShift(
  cloud: Map<string, Vec3>,
  snapshot: CorpusSnapshot,
): void {
  const n = cloud.size;
  if (n < 2) return;
  const ages = new Map<string, number>();
  let oldest = Infinity, newest = -Infinity;
  for (const id of cloud.keys()) {
    const e = snapshot.entities[id];
    const t = e?.signature?.temporal?.createdAt;
    if (typeof t === "number" && t > 0) {
      ages.set(id, t);
      if (t < oldest) oldest = t;
      if (t > newest) newest = t;
    }
  }
  if (ages.size === 0 || oldest === newest) return;
  const span = newest - oldest;
  let cx = 0, cy = 0, cz = 0;
  for (const p of cloud.values()) { cx += p.x; cy += p.y; cz += p.z; }
  cx /= n; cy /= n; cz /= n;
  const TEMPORAL_GAIN = 0.15;
  for (const [id, p] of cloud) {
    const t = ages.get(id);
    if (t === undefined) continue;
    const ageNorm = (t - oldest) / span;
    const factor = 1 + TEMPORAL_GAIN * (1 - 2 * ageNorm);
    cloud.set(id, {
      x: cx + (p.x - cx) * factor,
      y: cy + (p.y - cy) * factor,
      z: cz + (p.z - cz) * factor,
    });
  }
}

/**
 * Environment: drifting acid motes + the surreal zodiac orbiting at
 * the outer edge + (when a 3D layout is present) fuzzy region spheres
 * + a per-frame hue cycle of the scene background + fog + the
 * in-canvas Stage editor for zodiac placement.
 *
 * Everything that needs disposal on switch is folded into a single
 * `dispose` closure. The StageEditor is mounted here (rather than from
 * SceneManager) so SceneManager has no inner-mind-specific code.
 */
function setupEnvironment(ctx: AtmosphereSetupContext): AtmosphereEnvironment {
  const motes = new AcidMotes(ctx.snapshot);
  ctx.root.add(motes.points);

  const zodiac = new SurrealZodiac(ctx.snapshot);
  ctx.root.add(zodiac.group);

  const regions = ctx.layout ? new FuzzyRegions(ctx.snapshot, ctx.layout) : null;
  if (regions) ctx.root.add(regions.group);

  const fog = ctx.scene.fog instanceof THREE.Fog ? ctx.scene.fog : null;

  ctx.registerUpdater((elapsed) => {
    motes.update(elapsed);
    zodiac.update(elapsed);
    regions?.update(elapsed);
    const hue = (elapsed * 0.025) % 1;
    if (ctx.scene.background instanceof THREE.Color) {
      ctx.scene.background.setHSL(hue, 0.7, 0.12);
    }
    if (fog) {
      fog.color.setHSL((hue + 0.5) % 1, 0.8, 0.18);
    }
  });

  // Phase 2 (TOOLBOX_AND_STAGE.md) — in-canvas placement editor for
  // the zodiac. Mounted here so SceneManager has no atmosphere-
  // specific HUD code. Updater + disposer are pushed through the
  // host's standard fanout.
  const editor = new StageEditor({
    zodiac,
    canvas: ctx.canvas,
    camera: ctx.camera,
    snapshot: ctx.snapshot,
    activeAtmosphere: ctx.activeAtmosphere,
    paletteTints: ctx.paletteTints,
    onRefresh: ctx.onRefresh,
    lang: ctx.currentLang,
  });
  ctx.registerUpdater(() => editor.update());

  return {
    extras: { zodiac },
    dispose: () => {
      motes.dispose();
      zodiac.dispose();
      regions?.dispose();
      editor.dispose();
    },
  };
}

const innerMindAtmosphere: AtmosphereModule = {
  key: "inner-mind",
  i18nLabelKey: "switcher.atmosphere.inner-mind",
  registerBuilders,
  setupEnvironment,
  computeLayout,
  buildSoundscape: buildInnerMindSoundscape,
};

export default innerMindAtmosphere;
