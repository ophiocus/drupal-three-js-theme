// Atmosphere module contract.
//
// An atmosphere is a self-contained "visual theme" for the world:
// per-bundle SmartObject builders, environment scenery and updaters,
// an optional layout override (3D positions), and an optional
// procedural soundscape. SceneManager doesn't know any atmosphere's
// name — it asks the registry for a module by key and calls its hooks.
//
// Adding a 3rd / 4th / Nth atmosphere is a single directory under
// `src/world/runtime/atmospheres/<key>/` whose `index.ts` exports a
// `default: AtmosphereModule`, plus one `registerAtmosphereLoader`
// line in `registry.ts`. No edits anywhere else.
//
// The shape was distilled from the original forest + inner-mind
// modules: both have builders + environment, only inner-mind has a
// layout projector and a Stage editor. The contract makes every hook
// optional so a sparse atmosphere (one builder, no env, no audio) is
// fine, and a rich atmosphere (everything) plugs in cleanly.

import type * as THREE from "../../../toolbox/three.js";
import type { CorpusSnapshot, Vec3 } from "../../types.js";
import type { SmartObjectRegistry } from "../smart-objects/Builder.js";
import type { Lang } from "../hud/i18n.js";

/**
 * Per-frame updater an atmosphere can register with the host
 * (SceneManager) for animated environment elements — particles,
 * sky shifts, audio cues. Called every animation tick with
 * (elapsedSeconds, dtSeconds). Atmospheres without animation
 * simply never call `registerUpdater`.
 */
export type AtmosphereUpdater = (elapsed: number, dt: number) => void;

/**
 * Everything an atmosphere's `setupEnvironment` hook needs. Adding
 * a new field here is a fan-out change (every atmosphere can opt
 * in), so the host is the right owner.
 */
export interface AtmosphereSetupContext {
  /** The full scene — needed to mutate scene.background / scene.fog
   *  per frame (inner-mind's hue cycle does this). Most atmospheres
   *  should attach to `root` instead. */
  scene: THREE.Scene;
  /** Disposable world-layer group. Anything an atmosphere attaches
   *  here is torn down on a switch (geometries/materials via the
   *  scene-walk, Points via the disposer). Always prefer `root` over
   *  `scene` for additions. */
  root: THREE.Object3D;
  /** The corpus snapshot the renderer is currently driving. */
  snapshot: CorpusSnapshot;
  /** Push a per-frame updater. SceneManager ticks all updaters in
   *  registration order after the camera + biome each frame. */
  registerUpdater: (fn: AtmosphereUpdater) => void;
  /** The atmosphere's computed layout (from `computeLayout`), or
   *  null when this atmosphere doesn't override placement. */
  layout: Map<string, Vec3> | null;
  /** Camera + canvas — needed by HUDs that project world coords to
   *  screen space (the StageEditor, e.g.). */
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
  /** Active UI language — i18n keys for any in-atmosphere HUD. */
  currentLang: Lang;
  /** Active atmosphere name — atmospheres rarely need to read their
   *  own name (they already know), but Stage-editor-style chrome
   *  may. */
  activeAtmosphere: string;
  /** Effective post-overlay palette values, for in-atmosphere
   *  chrome that wants to read its own theme (tint pickers, panels). */
  paletteTints: {
    background: string;
    fogColor: string;
    groundColor: string;
  };
  /** Trigger a full snapshot refetch + scene rebuild — used by
   *  in-atmosphere editors that mutated server-side state and need
   *  the renderer to pick up the change. */
  onRefresh: () => Promise<void>;
}

/**
 * What `setupEnvironment` returns. Mandatory `dispose` (called on
 * atmosphere switch). `extras` is a free-form bag for an atmosphere
 * that wants to expose handles to its own callers — rarely needed;
 * most modules return only `dispose`.
 */
export interface AtmosphereEnvironment {
  dispose: () => void;
  extras?: Record<string, unknown>;
}

/**
 * A live procedural soundscape. Built by an atmosphere's
 * `buildSoundscape` hook (optional); AtmosphereAudio wraps the
 * lifecycle (fade in, fade out, swap).
 */
export interface Soundscape {
  /** Per-bed gain (0..1), ramped for fades; feeds the master gain. */
  gain: GainNode;
  /** Stop + disconnect every node in this bed. */
  stop: () => void;
}

/**
 * The contract every atmosphere ships. All hooks except `key`,
 * `i18nLabelKey`, and `registerBuilders` are optional — an
 * atmosphere with one bundle builder and no env / audio / layout
 * is a valid module.
 */
export interface AtmosphereModule {
  /** Unique snapshot key — must match the server's
   *  `WorldConfigEditor::ALLOWED_ATMOSPHERES`. */
  readonly key: string;
  /** i18n key suffix for the switcher label. Convention:
   *  `switcher.atmosphere.<key>` resolves the human name. */
  readonly i18nLabelKey: string;
  /** Register per-bundle SmartObject builders against the shared
   *  registry. Always called first, before any other hook. */
  registerBuilders(registry: SmartObjectRegistry): void;
  /** Set up scenery, particles, in-atmosphere HUDs, and per-frame
   *  updaters. Returns a dispose handle SceneManager calls on
   *  switch. Atmospheres without environment work simply omit this. */
  setupEnvironment?(ctx: AtmosphereSetupContext): AtmosphereEnvironment;
  /** Compute a layout override (3D positions per entity id) from
   *  the snapshot. Returning null means "no override; use the
   *  default taxonomy placement." Most atmospheres omit this. */
  computeLayout?(snapshot: CorpusSnapshot): Map<string, Vec3> | null;
  /** Build the atmosphere's ambient soundscape. Omit for silent
   *  atmospheres; AtmosphereAudio simply plays nothing. */
  buildSoundscape?(ctx: AudioContext, master: GainNode): Soundscape;
}
