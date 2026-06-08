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
/** Overshoots past 1 then settles — "pops" into place. */
const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
/** Decaying bounce after overshoot — feels springy/biological. */
const easeOutElastic = (t: number): number => {
  if (t === 0 || t === 1) return t;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};
/** Fast snap with a soft tail. */
const easeOutExpo = (t: number): number =>
  t === 1 ? 1 : 1 - Math.pow(2, -10 * t);

/**
 * Per-prop entrance/exit "variant" — each is a small recipe that
 * composes scale + optional positional/rotational deltas around the
 * prop's home transform. Each prop picks ONE variant deterministically
 * from its `staggerSeed`, so the choice is stable across reloads /
 * atmosphere flips: the same tree always pops with the same recipe.
 *
 * Adding a new variant: append it to `INTRO_VARIANTS` (and the matching
 * `OUTRO_VARIANTS`). The number is implicit — the picker hashes
 * staggerSeed across `length`.
 */
export type TweenVariant =
  | "scale-cubic"   // baseline: smooth scale 0.06→1
  | "scale-back"    // scale with overshoot — pops in past 1 then settles
  | "scale-elastic" // scale with bounce — biological feel
  | "drop-in"       // scale + drop from above with gravity-ish ease
  | "rise-in"       // scale + rise up from below
  | "spin-in"       // scale + 1.25 rotations around Y
  | "snap-in";      // very fast scale-expo, no spatial flourish

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
   * Catalog of intro recipes — each maps an eased `t ∈ [0,1]` to a
   * scale value + optional positional and rotational deltas (relative
   * to the prop's home pose at t=1). The recipe is chosen
   * deterministically by entityId hash, so the same prop always
   * intros the same way.
   *
   * Recipes are pure: no instance state, no rAF — they're plugged
   * into the shared `runIntroTween` driver below which handles the
   * timing, capture, and token-based abort.
   */
  private static readonly INTRO_RECIPES: ReadonlyArray<{
    name: TweenVariant;
    ease: (t: number) => number;
    /** Returns (scale, dx, dy, dz, dRotY) at time `t` in [0,1]. */
    frame: (t: number) => readonly [number, number, number, number, number];
  }> = [
    {
      name: "scale-cubic",
      ease: easeOutCubic,
      frame: (e) => [0.06 + (1 - 0.06) * e, 0, 0, 0, 0],
    },
    {
      name: "scale-back",
      ease: easeOutBack,
      frame: (e) => [0.06 + (1 - 0.06) * e, 0, 0, 0, 0],
    },
    {
      name: "scale-elastic",
      ease: easeOutElastic,
      frame: (e) => [0.06 + (1 - 0.06) * e, 0, 0, 0, 0],
    },
    {
      name: "drop-in",
      ease: easeOutCubic,
      // Falls from +18u above home, scale 0.4→1.
      frame: (e) => [0.4 + (1 - 0.4) * e, 0, 18 * (1 - e), 0, 0],
    },
    {
      name: "rise-in",
      ease: easeOutCubic,
      // Rises from −14u below home, scale 0.5→1.
      frame: (e) => [0.5 + (1 - 0.5) * e, 0, -14 * (1 - e), 0, 0],
    },
    {
      name: "spin-in",
      ease: easeOutCubic,
      // 1.25 rotations around Y while scaling 0.1→1.
      frame: (e) => [0.1 + (1 - 0.1) * e, 0, 0, 0, (1 - e) * Math.PI * 2.5],
    },
    {
      name: "snap-in",
      ease: easeOutExpo,
      frame: (e) => [0.06 + (1 - 0.06) * e, 0, 0, 0, 0],
    },
  ];

  /** Outro recipes mirror intros: scale shrinks toward `scaleFrom`,
   *  and any spatial offset returns to the displaced state (so the
   *  prop visually retreats in a direction matched to how it
   *  arrived). Picked by the SAME staggerSeed bucket, so a prop's
   *  exit echoes its entrance. */
  private static readonly OUTRO_RECIPES: ReadonlyArray<{
    name: TweenVariant;
    ease: (t: number) => number;
    frame: (t: number) => readonly [number, number, number, number, number];
  }> = [
    {
      name: "scale-cubic",
      ease: easeInCubic,
      frame: (e) => [1 - (1 - 0.06) * e, 0, 0, 0, 0],
    },
    {
      name: "scale-back",
      ease: easeInCubic,
      frame: (e) => [1 - (1 - 0.06) * e, 0, 0, 0, 0],
    },
    {
      name: "scale-elastic",
      ease: easeInCubic,
      frame: (e) => [1 - (1 - 0.06) * e, 0, 0, 0, 0],
    },
    {
      name: "drop-in", // exit upward — reverse of drop entrance
      ease: easeInCubic,
      frame: (e) => [1 - (1 - 0.4) * e, 0, 18 * e, 0, 0],
    },
    {
      name: "rise-in", // exit downward — reverse of rise entrance
      ease: easeInCubic,
      frame: (e) => [1 - (1 - 0.5) * e, 0, -14 * e, 0, 0],
    },
    {
      name: "spin-in", // unspin away
      ease: easeInCubic,
      frame: (e) => [1 - (1 - 0.1) * e, 0, 0, 0, e * Math.PI * 2.5],
    },
    {
      name: "snap-in",
      ease: easeInCubic,
      frame: (e) => [1 - (1 - 0.06) * e, 0, 0, 0, 0],
    },
  ];

  /** Pick the variant index for this prop. Deterministic by entityId. */
  private variantIndex(): number {
    const seed = this.staggerSeed; // 0..<1
    return Math.floor(seed * SmartObject.INTRO_RECIPES.length) % SmartObject.INTRO_RECIPES.length;
  }

  /** The chosen variant name, for diagnostics / tests. */
  get tweenVariant(): TweenVariant {
    return SmartObject.INTRO_RECIPES[this.variantIndex()]!.name;
  }

  /**
   * Run an entrance tween. The recipe (scale curve, optional drop /
   * rise / spin) is chosen deterministically by entityId hash, so
   * the same prop always intros the same way. Resolves on settle, or
   * early if disposed mid-tween / superseded by a newer tween.
   *
   * The render loop must be running for the tween to be visible.
   */
  intro(
    durationMs: number = SMART_OBJECT_INTRO_OUTRO_DEFAULTS.durationMs,
    delayMs = 0,
  ): Promise<void> {
    const recipe = SmartObject.INTRO_RECIPES[this.variantIndex()]!;
    return this.runRecipeTween(recipe.frame, recipe.ease, durationMs, delayMs);
  }

  /**
   * Run an exit tween. The variant matches `intro` so a prop's exit
   * echoes its entrance — a tree that DROPPED IN will RISE OUT, a
   * spirit that SPUN IN will SPIN OUT. Resolves on settle.
   *
   * `outro()` does NOT dispose the prop — the caller still runs the
   * usual teardown afterwards. The shrunk + displaced state is the
   * visual seam between "old scene leaving" and "world torn down."
   */
  outro(
    durationMs: number = SMART_OBJECT_INTRO_OUTRO_DEFAULTS.durationMs,
    delayMs = 0,
  ): Promise<void> {
    const recipe = SmartObject.OUTRO_RECIPES[this.variantIndex()]!;
    return this.runRecipeTween(recipe.frame, recipe.ease, durationMs, delayMs);
  }

  /**
   * Shared rAF driver. Captures the prop's home position + rotation
   * at the moment the tween starts so deltas accumulate from
   * wherever the prop actually IS — not from a stale home value
   * captured at construction.
   */
  private runRecipeTween(
    frame: (t: number) => readonly [number, number, number, number, number],
    ease: (t: number) => number,
    durationMs: number,
    delayMs: number,
  ): Promise<void> {
    const token = ++this.tweenToken;
    const homeX = this.position.x;
    const homeY = this.position.y;
    const homeZ = this.position.z;
    const homeRotY = this.rotation.y;
    // Seed the first frame so the very first render after caller
    // resumes the loop shows the recipe's t=0 state.
    {
      const [s, dx, dy, dz, dr] = frame(ease(0));
      this.scale.setScalar(s);
      this.position.set(homeX + dx, homeY + dy, homeZ + dz);
      this.rotation.y = homeRotY + dr;
    }
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
        const tRaw = Math.min(1, (now - startTime) / Math.max(1, durationMs));
        const eT = ease(tRaw);
        const [s, dx, dy, dz, dr] = frame(eT);
        this.scale.setScalar(s);
        this.position.set(homeX + dx, homeY + dy, homeZ + dz);
        this.rotation.y = homeRotY + dr;
        if (tRaw < 1) requestAnimationFrame(tick);
        else {
          // Snap to exact home pose to clear any floating-point drift
          // from the eased trajectory — caller code that reads pose
          // post-tween (camera centroids, click targets) expects
          // canonical values.
          this.position.set(homeX, homeY, homeZ);
          this.rotation.y = homeRotY;
          resolve();
        }
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
