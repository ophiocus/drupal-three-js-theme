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

import * as THREE from "three";

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

export class SmartObject extends THREE.Group {
  /** Source descriptor's id, e.g. "node-12". */
  readonly entityId: string;
  /** Name of the SmartObjectBuilder that produced this object. */
  readonly builderName: string;
  private readonly _components: Component[] = [];

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
