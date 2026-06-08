// SmartObject — composable presence in the world.
//
// Extends THREE.Group so it's a direct scene-graph node (no
// wrapping layer between SceneManager.scene and the actual
// three.js tree). Carries an entityId for hit-test routing and
// a list of attached Components that drive per-frame behavior.
//
// One SmartObject per descriptor. Built by a SmartObjectBuilder
// matched against descriptor.bundle. See SMART_OBJECTS.md for
// the full design.

import * as THREE from "../../../toolbox/three.js";

/**
 * Per-frame shared context. Components consume what they need;
 * unused fields cost nothing.
 */
export interface FrameContext {
  camera: THREE.Camera;
  /** Elapsed time since session start, in seconds. Useful for animation phase. */
  time: number;
  /** The sector the camera is currently in (nearest by XZ); null at overview. */
  currentSectorId: string | null;
}

/**
 * Component — reusable functionality attached to a SmartObject.
 * Three lifecycle hooks: onAttach (mandatory), update (optional,
 * called per frame), dispose (optional, frees GPU resources).
 *
 * Components are framework-agnostic — they never reach for
 * window, document, or fetch. Anything they need must arrive via
 * the host or constructor args. This keeps them testable under
 * jsdom and portable across builders.
 */
export interface Component {
  onAttach(host: SmartObject): void;
  update?(dt: number, ctx: FrameContext): void;
  dispose?(): void;
}

/** Default per-prop entrance/exit timing. */
export const SMART_OBJECT_INTRO_OUTRO_DEFAULTS = {
  /** How small the prop starts (intro) / ends (outro). 0 collapses normals; */
  /** keep a sliver so disposal-by-shrink-then-snap remains visible. */
  scaleFrom: 0.06,
  /** Per-prop tween length, ms. */
  durationMs: 450,
  /** Stagger window — fastest prop starts at delay=0; slowest at this delay. */
  staggerMs: 260,
} as const;

/** Ease functions reused by intro/outro. */
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number): number => t * t * t;

export class SmartObject extends THREE.Group {
  /** Source descriptor's id, e.g. "node-12". */
  readonly entityId: string;
  /** Name of the SmartObjectBuilder that produced this object. */
  readonly builderName: string;
  private readonly _components: Component[] = [];
  /** Monotone token bumped on each intro/outro/dispose. A running */
  /** tween whose captured token no longer matches aborts on the next */
  /** frame — so a re-entered switch or a mid-tween dispose can't */
  /** strand multiple rAF callbacks fighting over `scale`. */
  private tweenToken = 0;
  private disposed = false;

  constructor(entityId: string, builderName: string) {
    super();
    this.entityId = entityId;
    this.builderName = builderName;
    // userData.entityId surfaces on every child mesh via traversal
    // — PointerNavigator's raycaster reads it for hit routing.
    this.userData.entityId = entityId;
    this.name = `SmartObject:${entityId}`;
  }

  /**
   * Deterministic stagger fraction in `[0, 1)`, derived from
   * `entityId` via a djb2 hash. The same prop always animates with
   * the same offset across runs — so the "bloom" pattern across
   * the world is stable rather than visibly shuffling each time
   * the user flips an atmosphere.
   *
   * Used by SceneManager when handing the prop a `delayMs` for
   * `intro()` / `outro()`. Multiply by the desired stagger window
   * and pass it in.
   */
  get staggerSeed(): number {
    let h = 5381;
    for (let i = 0; i < this.entityId.length; i++) {
      h = ((h * 33) ^ this.entityId.charCodeAt(i)) & 0xffffffff;
    }
    return ((h >>> 0) % 1024) / 1024;
  }

  /**
   * Run an entrance tween — scale from a small seed value to 1.0,
   * eased-out. Resolves on settle (or immediately if disposed
   * mid-tween, or if a newer tween supersedes this one).
   *
   * The render loop must be running for the tween to be visible
   * — the caller is responsible for that. The prop's component
   * `update()` calls keep firing throughout, so animated children
   * (HTML surfaces, billboarded labels) compose naturally.
   */
  intro(
    durationMs: number = SMART_OBJECT_INTRO_OUTRO_DEFAULTS.durationMs,
    delayMs = 0,
    scaleFrom: number = SMART_OBJECT_INTRO_OUTRO_DEFAULTS.scaleFrom,
  ): Promise<void> {
    return this.runScaleTween(scaleFrom, 1, durationMs, delayMs, easeOutCubic);
  }

  /**
   * Run an exit tween — scale from the current scale down to a
   * small seed value, eased-in. Resolves on settle. Intended to
   * be awaited (or `Promise.all`-ed) before `dispose()` so the
   * prop visibly contracts away rather than vanishing in one
   * frame.
   *
   * `outro()` does NOT dispose the prop itself — the caller still
   * runs the usual teardown afterwards. The shrunk state is the
   * visual seam between "old scene leaving" and "world torn down."
   */
  outro(
    durationMs: number = SMART_OBJECT_INTRO_OUTRO_DEFAULTS.durationMs,
    delayMs = 0,
    scaleTo: number = SMART_OBJECT_INTRO_OUTRO_DEFAULTS.scaleFrom,
  ): Promise<void> {
    return this.runScaleTween(this.scale.x, scaleTo, durationMs, delayMs, easeInCubic);
  }

  private runScaleTween(
    from: number,
    to: number,
    durationMs: number,
    delayMs: number,
    ease: (t: number) => number,
  ): Promise<void> {
    const token = ++this.tweenToken;
    // Seed the starting scale immediately so the very first frame
    // after the caller resumes the loop shows the "from" state. If
    // the parent layer is still hidden behind a cover overlay, the
    // user never sees the snap.
    this.scale.setScalar(from);
    const startTime = performance.now() + Math.max(0, delayMs);
    return new Promise<void>((resolve) => {
      const tick = (now: number) => {
        if (this.disposed || token !== this.tweenToken) {
          resolve();
          return;
        }
        if (now < startTime) {
          requestAnimationFrame(tick);
          return;
        }
        const t = Math.min(1, (now - startTime) / Math.max(1, durationMs));
        const s = from + (to - from) * ease(t);
        this.scale.setScalar(s);
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
  }

  /**
   * Attach a Component. Calls onAttach immediately so the
   * Component can add its meshes/lights/etc. to the host group.
   */
  attach(component: Component): void {
    this._components.push(component);
    component.onAttach(this);
  }

  /**
   * Per-frame fanout. Called from SceneManager's animation loop.
   * Each component's update fires; pure-geometry components
   * (Mesh, TriggerPad) leave the method out and cost nothing.
   */
  update(dt: number, ctx: FrameContext): void {
    for (const c of this._components) c.update?.(dt, ctx);
  }

  /**
   * Free GPU resources owned by this object. Components dispose
   * first (so they can clean their own state), then the group's
   * meshes get their geometry + material disposed via traversal.
   *
   * Called when (a) the snapshot changes and this entity no
   * longer exists, or (b) the runtime tears down (page navigation
   * away).
   */
  dispose(): void {
    // Bump the tween token + flag so any rAF callback in flight
    // (from a still-running intro/outro) exits on its next tick
    // instead of writing to `scale` on a torn-down group.
    this.disposed = true;
    this.tweenToken++;
    for (const c of this._components) c.dispose?.();
    this.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
  }

  /**
   * Find an attached component by class. Returns the first
   * match or undefined. Used by CardController to extract the
   * trigger pad and HTML surface from a SmartObject.
   */
  findComponent<T extends Component>(
    kind: new (...args: never[]) => T,
  ): T | undefined {
    return this._components.find((c) => c instanceof kind) as T | undefined;
  }

  /** Iterate components — useful for diagnostics. */
  get components(): readonly Component[] {
    return this._components;
  }
}
