// CameraController — closes the world→URL arrow of the
// coordinate-system commutative diagram.
//
// Owns per-frame camera motion: damps position + look-target
// toward the current target Vantage (read from the URL),
// detects when motion has settled, writes the URL inverse of
// the settled vantage. Also continuously re-orients any
// bloomed surface mesh toward the camera (subsumed from
// CardController's bloom-once behavior).
//
// Replaces the ALPHA orbit in SceneManager.startLoop().
//
// See docs/v0.1/CAMERA_CONTROLLER.md for the full spec.

import * as THREE from "three";
import type { Vantage } from "../types.js";

export interface CameraControllerOptions {
  camera: THREE.PerspectiveCamera;
  /**
   * Read the desired vantage from current URL state. Called on
   * construction and on every hashchange/popstate event.
   */
  getTargetVantageFromUrl: () => Vantage;
  /**
   * Push a vantage into the URL — typically `history.replaceState`.
   * Called only when the camera *settles* at a vantage that
   * differs from the previously-reported one.
   */
  setUrlFromVantage: (v: Vantage) => void;
  /**
   * Damping stiffness; higher = faster convergence. Default 4
   * gives ~250ms to 90% convergence at typical frame rates.
   */
  lambda?: number;
  /**
   * Settle threshold in seconds — how long the camera must be
   * below the velocity threshold before the URL is written.
   * Default 0.6.
   */
  settleSeconds?: number;
}

const DEFAULT_LAMBDA = 4;
const DEFAULT_SETTLE_SECONDS = 0.6;
/** Camera position velocity (world-units/sec) below which we count as "settled." */
const SETTLE_VELOCITY_THRESHOLD = 0.5;

export class CameraController {
  private targetVantage: Vantage;
  private readonly lookTarget = new THREE.Vector3();
  private readonly targetPos = new THREE.Vector3();
  private readonly targetLook = new THREE.Vector3();
  private readonly lastPos = new THREE.Vector3();
  private settleTimer = 0;
  private lastReportedUri: string | null = null;
  private bloomedMesh: THREE.Object3D | null = null;
  private readonly lambda: number;
  private readonly settleSeconds: number;

  constructor(private readonly options: CameraControllerOptions) {
    this.lambda = options.lambda ?? DEFAULT_LAMBDA;
    this.settleSeconds = options.settleSeconds ?? DEFAULT_SETTLE_SECONDS;

    this.targetVantage = options.getTargetVantageFromUrl();
    this.syncTargetVectors();
    // Seed the camera + look-target from the initial vantage so the
    // first frame doesn't dolly in from origin.
    options.camera.position.copy(this.targetPos);
    this.lookTarget.copy(this.targetLook);
    options.camera.lookAt(this.lookTarget);
    this.lastPos.copy(options.camera.position);
    this.lastReportedUri = this.targetVantage.uri;

    window.addEventListener("hashchange", this.onHashChange);
    window.addEventListener("popstate", this.onHashChange);
    window.addEventListener("keydown", this.onKeyDown);
  }

  /** Call each frame from the animation loop with the elapsed seconds. */
  update(dt: number): void {
    const camera = this.options.camera;

    // 1. Damp position toward target.
    camera.position.x = THREE.MathUtils.damp(
      camera.position.x, this.targetPos.x, this.lambda, dt,
    );
    camera.position.y = THREE.MathUtils.damp(
      camera.position.y, this.targetPos.y, this.lambda, dt,
    );
    camera.position.z = THREE.MathUtils.damp(
      camera.position.z, this.targetPos.z, this.lambda, dt,
    );

    // 2. Damp look-target toward the vantage's lookAt; Vector3.lerp
    // with an exponential alpha is the rotation equivalent.
    const alpha = 1 - Math.exp(-this.lambda * dt);
    this.lookTarget.lerp(this.targetLook, alpha);
    camera.lookAt(this.lookTarget);

    // 3. Continuous facing for the bloomed mesh, if any. Owned here
    // because we have the per-frame beat and the camera transform.
    this.bloomedMesh?.lookAt(camera.position);

    // 4. Settle detection.
    this.updateSettleState(dt);
  }

  /**
   * CardController calls this on bloom/collapse. Null clears.
   * Single-bloom invariant means at most one mesh tracked at a time.
   */
  setBloomedMesh(mesh: THREE.Object3D | null): void {
    this.bloomedMesh = mesh;
  }

  /**
   * Force a vantage target without going through the URL — used by
   * keyboard hotkeys (Tab, number keys, Esc). The URL will follow
   * via settle detection.
   */
  setTarget(vantage: Vantage): void {
    this.targetVantage = vantage;
    this.syncTargetVectors();
    // Don't reset settleTimer here — motion will rise above threshold
    // naturally on the next frame's damp, which resets the timer.
  }

  /** Free event listeners. Call when tearing down the runtime. */
  dispose(): void {
    window.removeEventListener("hashchange", this.onHashChange);
    window.removeEventListener("popstate", this.onHashChange);
    window.removeEventListener("keydown", this.onKeyDown);
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private syncTargetVectors(): void {
    this.targetPos.set(
      this.targetVantage.position.x,
      this.targetVantage.position.y,
      this.targetVantage.position.z,
    );
    this.targetLook.set(
      this.targetVantage.lookAt.x,
      this.targetVantage.lookAt.y,
      this.targetVantage.lookAt.z,
    );
  }

  private updateSettleState(dt: number): void {
    if (dt <= 0) return;
    const dist = this.options.camera.position.distanceTo(this.lastPos);
    const velocity = dist / dt;
    this.lastPos.copy(this.options.camera.position);

    if (velocity < SETTLE_VELOCITY_THRESHOLD) {
      this.settleTimer += dt;
      if (
        this.settleTimer >= this.settleSeconds
        && this.targetVantage.uri !== this.lastReportedUri
      ) {
        this.options.setUrlFromVantage(this.targetVantage);
        this.lastReportedUri = this.targetVantage.uri;
      }
    } else {
      this.settleTimer = 0;
    }
  }

  private onHashChange = (): void => {
    const next = this.options.getTargetVantageFromUrl();
    if (next.uri === this.targetVantage.uri) return;
    this.targetVantage = next;
    this.syncTargetVectors();
  };

  /**
   * Keyboard bindings, gated on no text-input being focused. PC-only
   * for v0.1; mobile/touch + VR are deferred.
   *
   *   Escape         — return to overview (`/`)
   *   Tab            — next entity vantage
   *   Shift+Tab      — previous entity vantage
   *   1..9           — jump to sector N (sorted by termId asc)
   */
  private onKeyDown = (event: KeyboardEvent): void => {
    const ae = document.activeElement;
    if (
      ae instanceof HTMLInputElement
      || ae instanceof HTMLTextAreaElement
      || (ae as HTMLElement | null)?.isContentEditable
    ) {
      return;
    }

    if (event.key === "Escape") {
      // CardController also listens for Escape (collapses cards).
      // Both can fire; the order doesn't matter — collapsing a
      // card and jumping to overview are independent state mutations.
      this.navigateToUri("/");
      event.preventDefault();
      return;
    }
    // Tab / Shift+Tab navigation and number-key sector jumps require
    // the snapshot's sector + entity list, which lives on
    // SceneManager. v0.1 plumbs that via callbacks if the deferred
    // requirement justifies it; for now this is a stub.
  };

  private navigateToUri(uri: string): void {
    history.replaceState(null, "", uri);
    // replaceState doesn't fire popstate/hashchange; route manually.
    this.onHashChange();
  }
}
