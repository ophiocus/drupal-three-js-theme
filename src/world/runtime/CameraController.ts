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
import type { CorpusSnapshot, Vantage } from "../types.js";

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
   * Snapshot reference — needed for keyboard navigation (Tab to
   * cycle entities within a sector, number keys to jump sectors).
   * Optional: hotkeys silently no-op when absent.
   */
  snapshot?: CorpusSnapshot;
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

// Drag-orbit configuration. Polar-constrained (Q2=b) so the camera
// can never flip upside down. Polar measured from +Y; 0 = straight
// down on the target, π/2 = horizontal.
const DRAG_AZIMUTH_SENSITIVITY = 0.005; // rad / pixel
const DRAG_POLAR_SENSITIVITY = 0.004;
const POLAR_MIN = 0.2;            // ~11° — almost overhead
const POLAR_MAX = Math.PI / 2 - 0.1; // ~84° — just above horizon

// Zoom configuration. applyZoomDelta(deltaPixels) multiplies the
// orbit radius by exp(deltaPixels * ZOOM_SENSITIVITY). A pinch
// spread of 100px or a wheel notch of ~100px gives ~exp(0.4) ≈
// 1.5× radius — a perceptible but not jumpy step. Sign convention:
// positive deltaPixels = zoom out (world recedes); negative = zoom in.
const ZOOM_SENSITIVITY = 0.004;
const ORBIT_RADIUS_MIN = 4;        // can't zoom past the entity into negative space
const ORBIT_RADIUS_MAX = 600;      // can't zoom out so far the world becomes a dot

// Idle drift configuration. After IDLE_THRESHOLD seconds of no
// interaction and no in-flight motion, gentle sinusoidal
// perturbation around baseTargetPos keeps the world feeling alive
// without changing the URL (the velocity stays under settle
// threshold).
const IDLE_THRESHOLD_SECONDS = 3;
const IDLE_DRIFT_AMPLITUDE = 6;   // world units
const IDLE_DRIFT_PERIOD_SECONDS = 11;

export class CameraController {
  private targetVantage: Vantage;
  private readonly lookTarget = new THREE.Vector3();
  /** Drifted target (base + idle perturbation). Damp converges here. */
  private readonly targetPos = new THREE.Vector3();
  /** Canonical vantage position before drift. Drag-orbit moves this. */
  private readonly baseTargetPos = new THREE.Vector3();
  private readonly targetLook = new THREE.Vector3();
  private readonly lastPos = new THREE.Vector3();
  // Spherical coords of baseTargetPos relative to targetLook —
  // makes drag-orbit a simple azimuth/polar/radius mutation.
  private orbitAzimuth = 0;
  private orbitPolar = 0.5;
  private orbitRadius = 100;
  private settleTimer = 0;
  private idleTimer = 0;
  private elapsedTime = 0;
  private lastReportedUri: string | null = null;
  private bloomedMesh: THREE.Object3D | null = null;
  private userInteracting = false;
  /**
   * Per-frame camera offset in viewport-axis units (x = canvas-X
   * axis / camera-local right; y = canvas-Y axis / camera-local up).
   *
   * Reading mode populates this so the entity ends up out from
   * under the modal:
   *   - Desktop (modal anchored LEFT):   shift.x negative ⇒ camera
   *     moves left ⇒ entity apparently moves right ⇒ visible in the
   *     right half.
   *   - Mobile  (modal anchored TOP):    shift.y positive ⇒ camera
   *     moves up ⇒ entity apparently moves down ⇒ visible in the
   *     bottom half.
   *
   * Applied per-frame in update() against the camera-local right
   * + up vectors derived from (targetLook - targetPos). This means
   * the shift direction tracks view orientation through drag-orbit
   * and vantage transitions — no need to recompute on settle, no
   * direct-write to camera.position that the damp would undo on
   * the next frame.
   *
   * Two-axis design (instead of a single signed magnitude per axis)
   * keeps the API symmetric across desktop / mobile and allows
   * future compound shifts (e.g. corner-anchored modal) without
   * another renaming pass.
   */
  private readonly viewportShift = new THREE.Vector2(0, 0);
  /**
   * When true, idle drift never starts (idleTimer stays at 0). Used
   * by reading mode: the user's mouse is over the modal, not the
   * canvas, so resetIdle() doesn't fire — without this gate, the
   * camera would drift away from the framing they picked the moment
   * they started reading.
   */
  private suppressIdleDrift = false;
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
    this.elapsedTime += dt;

    // 0. Idle drift — sinusoidal perturbation around baseTargetPos
    // when no interaction or in-flight motion. The drift is small
    // enough that the camera's apparent velocity stays under the
    // settle threshold, so URLs don't get written during drift.
    this.updateIdleDriftState(dt);
    if (this.idleTimer > IDLE_THRESHOLD_SECONDS) {
      const phase = (this.elapsedTime / IDLE_DRIFT_PERIOD_SECONDS) * 2 * Math.PI;
      const eased = (this.idleTimer - IDLE_THRESHOLD_SECONDS) / 2;
      const easeIn = Math.min(eased, 1); // ramp in over 2s
      this.targetPos.set(
        this.baseTargetPos.x + Math.sin(phase) * IDLE_DRIFT_AMPLITUDE * easeIn,
        this.baseTargetPos.y,
        this.baseTargetPos.z + Math.cos(phase) * IDLE_DRIFT_AMPLITUDE * easeIn,
      );
    } else {
      this.targetPos.copy(this.baseTargetPos);
    }

    // 0.5. Viewport-axis shift (reading-mode parallax). Applied to
    // targetPos rather than camera.position so the damp converges
    // to the SHIFTED target — direct-writes to camera.position
    // would be undone by the next frame's damp toward baseTargetPos.
    //
    // The shift basis is camera-local (right + up), recomputed each
    // frame from the current view direction. Drag-orbiting rotates
    // baseTargetPos around targetLook; the next frame recomputes
    // right/up from the new orientation, so whichever axis the modal
    // is anchored to (left on desktop → x; top on mobile → y) stays
    // consistent through any camera motion.
    if (this.viewportShift.lengthSq() > 1e-6) {
      const forward = new THREE.Vector3()
        .subVectors(this.targetLook, this.targetPos)
        .normalize();
      if (forward.lengthSq() > 1e-6) {
        const right = new THREE.Vector3()
          .crossVectors(forward, new THREE.Vector3(0, 1, 0))
          .normalize();
        if (right.lengthSq() > 1e-6) {
          // True camera-local up = right × forward (right-handed
          // basis). Using world-up here would make vertical shifts
          // wander forward/back as the camera tilts; this keeps the
          // shift in the canvas plane regardless of pitch.
          const cameraUp = new THREE.Vector3()
            .crossVectors(right, forward)
            .normalize();
          this.targetPos.addScaledVector(right, this.viewportShift.x);
          this.targetPos.addScaledVector(cameraUp, this.viewportShift.y);
        }
      }
    }

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

  /**
   * Macro navigation: push a new URL into history and re-target
   * the camera. Used by PointerNavigator on entity/sector clicks
   * and (commit 2) by keyboard hotkeys.
   *
   * Uses pushState so the user can browser-back through navigation
   * history. Settle detection still controls when the URL gets
   * REwritten on natural arrival; this is for explicit jumps.
   */
  navigateTo(uri: string): void {
    if (uri === window.location.pathname) return;
    history.pushState(null, "", uri);
    // pushState doesn't fire popstate/hashchange; route manually.
    this.onHashChange();
  }

  /**
   * Signal that the user is actively dragging or otherwise driving
   * the camera. While true, settle detection is suppressed so the
   * URL doesn't get rewritten mid-interaction.
   *
   * Wired by PointerNavigator. Drag-orbit math arrives in commit 2.
   */
  setUserInteracting(interacting: boolean): void {
    this.userInteracting = interacting;
    if (!interacting) {
      // Reset the settle timer on release so the camera has to
      // physically stop before a URL write happens.
      this.settleTimer = 0;
    }
  }

  /**
   * Mark "the user is alive" without claiming an interaction.
   * Resets the idle-drift timer so any in-flight sinusoidal
   * perturbation winds down and a fresh countdown starts toward
   * IDLE_THRESHOLD_SECONDS.
   *
   * Called from PointerNavigator on every pointermove event.
   * Unlike setUserInteracting(true), this DOESN'T suppress
   * settle-detection — the URL still gets written when the
   * camera stops. The user moving the mouse over the canvas
   * isn't a navigation gesture, just a "still here" signal.
   *
   * Stopping in-flight drift: idleTimer = 0 falls below the
   * IDLE_THRESHOLD gate at line ~124; the perturbation is no
   * longer applied; this.targetPos returns to baseTargetPos;
   * existing damping converges the camera back smoothly. No
   * teleport, no jolt.
   */
  resetIdle(): void {
    this.idleTimer = 0;
  }

  /**
   * Set the reading-mode viewport-axis parallax shift (world units,
   * signed per axis).
   *
   *   x: positive  ⇒ camera moves right (entity apparently left)
   *      negative  ⇒ camera moves left  (entity apparently right) — desktop modal
   *   y: positive  ⇒ camera moves up    (entity apparently down)   — mobile modal
   *      negative  ⇒ camera moves down  (entity apparently up)
   *
   * Owned by SceneManager.setMode("reading"/"exploration"). Applied
   * each frame in camera-local basis so the canvas-X / canvas-Y
   * axes stay stable through any camera motion.
   */
  setViewportShift(shift: { x: number; y: number }): void {
    this.viewportShift.set(shift.x, shift.y);
  }

  /**
   * Legacy single-axis API. Equivalent to setViewportShift({x: magnitude, y: 0}).
   * Retained for one release while call sites migrate; mobile work
   * uses setViewportShift() directly.
   *
   * @deprecated Use setViewportShift({x, y}) instead.
   */
  setLateralShiftMagnitude(magnitude: number): void {
    this.viewportShift.set(magnitude, 0);
  }

  /**
   * Zoom by adjusting the orbit radius. Positive delta = zoom out
   * (radius grows); negative delta = zoom in. Magnitude is in
   * "pixels-of-input" space; the internal scaling chooses a
   * sensitivity that feels natural for both pinch fingers spreading
   * apart (~hundreds of pixels) and wheel ticks (~tens of pixels).
   *
   * Clamped to [ORBIT_RADIUS_MIN, ORBIT_RADIUS_MAX] so the user can
   * never zoom past the entity (into negative radius) or so far out
   * that the world becomes a dot.
   */
  applyZoomDelta(deltaPixels: number): void {
    const factor = Math.exp(deltaPixels * ZOOM_SENSITIVITY);
    this.orbitRadius = THREE.MathUtils.clamp(
      this.orbitRadius * factor,
      ORBIT_RADIUS_MIN,
      ORBIT_RADIUS_MAX,
    );
    this.syncBaseFromOrbit();
  }

  /**
   * Toggle idle-drift suppression. Reading mode sets this true so
   * the camera doesn't sinusoidally drift while the user reads —
   * their mouse is over the modal, not the canvas, so the natural
   * resetIdle() trigger doesn't fire.
   *
   * Owned by SceneManager.setMode("reading"/"exploration").
   */
  setIdleDriftSuppressed(suppressed: boolean): void {
    this.suppressIdleDrift = suppressed;
    if (suppressed) this.idleTimer = 0;
  }

  /**
   * Apply a pointer drag delta to the camera. Polar-constrained
   * orbit around the current vantage's lookAt point (Q2=b).
   *
   * X delta → azimuth around Y axis (yaw). Y delta → polar angle
   * (pitch), clamped to [POLAR_MIN, POLAR_MAX] so the camera can
   * never flip overhead or burrow below the ground. The drag
   * "sticks" — releasing pointerup doesn't snap back; the new
   * angle persists until the next URL-driven re-target.
   */
  applyDragDelta(dx: number, dy: number): void {
    this.orbitAzimuth -= dx * DRAG_AZIMUTH_SENSITIVITY;
    this.orbitPolar = THREE.MathUtils.clamp(
      this.orbitPolar + dy * DRAG_POLAR_SENSITIVITY,
      POLAR_MIN, POLAR_MAX,
    );
    this.syncBaseFromOrbit();
  }

  /** Free event listeners. Call when tearing down the runtime. */
  dispose(): void {
    window.removeEventListener("hashchange", this.onHashChange);
    window.removeEventListener("popstate", this.onHashChange);
    window.removeEventListener("keydown", this.onKeyDown);
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private syncTargetVectors(): void {
    this.baseTargetPos.set(
      this.targetVantage.position.x,
      this.targetVantage.position.y,
      this.targetVantage.position.z,
    );
    this.targetPos.copy(this.baseTargetPos);
    this.targetLook.set(
      this.targetVantage.lookAt.x,
      this.targetVantage.lookAt.y,
      this.targetVantage.lookAt.z,
    );
    this.syncOrbitFromBase();
    // Re-targeting (URL change, hotkey) ends any in-flight idle drift.
    this.idleTimer = 0;
  }

  /**
   * Derive (azimuth, polar, radius) from baseTargetPos relative to
   * targetLook. Called when the canonical vantage changes; the
   * drag-orbit's spherical state must agree with the new target.
   */
  private syncOrbitFromBase(): void {
    const dx = this.baseTargetPos.x - this.targetLook.x;
    const dy = this.baseTargetPos.y - this.targetLook.y;
    const dz = this.baseTargetPos.z - this.targetLook.z;
    this.orbitRadius = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (this.orbitRadius < 0.001) {
      // Degenerate — camera on top of target. Pick reasonable defaults.
      this.orbitRadius = 1;
      this.orbitAzimuth = 0;
      this.orbitPolar = Math.PI / 4;
      return;
    }
    this.orbitAzimuth = Math.atan2(dx, dz);
    this.orbitPolar = Math.acos(
      THREE.MathUtils.clamp(dy / this.orbitRadius, -1, 1),
    );
    this.orbitPolar = THREE.MathUtils.clamp(this.orbitPolar, POLAR_MIN, POLAR_MAX);
  }

  /**
   * Recompute baseTargetPos from current spherical coords. Called
   * after a drag delta mutates azimuth / polar / radius.
   */
  private syncBaseFromOrbit(): void {
    const sinPolar = Math.sin(this.orbitPolar);
    this.baseTargetPos.set(
      this.targetLook.x + this.orbitRadius * sinPolar * Math.sin(this.orbitAzimuth),
      this.targetLook.y + this.orbitRadius * Math.cos(this.orbitPolar),
      this.targetLook.z + this.orbitRadius * sinPolar * Math.cos(this.orbitAzimuth),
    );
  }

  /**
   * Idle drift gate. Increments idleTimer when the user isn't
   * interacting. Reset to zero by setUserInteracting(true) or by
   * setTarget()/URL changes (via syncTargetVectors).
   *
   * Previous attempt gated on distance-to-base, but drift itself
   * moves the camera away from base — creating a feedback loop
   * that reset the timer mid-drift. The simpler "time since last
   * interaction" gate is correct: drift IS the response to idle.
   */
  private updateIdleDriftState(dt: number): void {
    if (this.userInteracting || this.suppressIdleDrift) {
      this.idleTimer = 0;
      return;
    }
    this.idleTimer += dt;
  }

  private updateSettleState(dt: number): void {
    if (dt <= 0) return;
    const dist = this.options.camera.position.distanceTo(this.lastPos);
    const velocity = dist / dt;
    this.lastPos.copy(this.options.camera.position);

    // During active user interaction (drag, etc.) suppress settle
    // so URLs don't thrash mid-gesture.
    if (this.userInteracting) {
      this.settleTimer = 0;
      return;
    }
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
      this.navigateTo("/");
      event.preventDefault();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      this.cycleEntity(event.shiftKey ? -1 : 1);
      return;
    }
    // Number keys 1–9 jump to sector N (termId-ascending order).
    // Beyond the available sector count is a no-op.
    if (/^[1-9]$/.test(event.key)) {
      const index = parseInt(event.key, 10) - 1;
      this.jumpToSectorByIndex(index);
      event.preventDefault();
      return;
    }
  };

  /**
   * Cycle to the next/prev entity in the current path's sector.
   * "Current sector" is derived from the URL: at `/node/<n>`, the
   * primary sector of that node; at `/sector/<n>`, that sector;
   * at `/`, all entities corpus-wide.
   *
   * Entity order is `Object.values(snapshot.entities)` by id —
   * stable across reloads since the snapshot is deterministic.
   * v0.2 may surface editorial ordering via the descriptor.
   */
  private cycleEntity(direction: 1 | -1): void {
    const snap = this.options.snapshot;
    if (!snap) return;
    const path = window.location.pathname;
    let pool: string[] = [];

    const allEntities = Object.values(snap.entities);
    if (path.startsWith("/node/")) {
      const currentId = `node-${path.slice("/node/".length)}`;
      const sector = snap.entities[currentId]?.taxonomyTerms?.[0];
      pool = sector
        ? allEntities
            .filter((e) => e.taxonomyTerms[0] === sector)
            .map((e) => e.id)
        : allEntities.map((e) => e.id);
    } else if (path.startsWith("/sector/")) {
      const sectorId = path.slice("/sector/".length);
      pool = allEntities
        .filter((e) => e.taxonomyTerms.includes(sectorId))
        .map((e) => e.id);
    } else {
      pool = allEntities.map((e) => e.id);
    }
    if (pool.length === 0) return;

    // Find current position in the pool; if not present, start at the
    // direction-appropriate end.
    const currentNodeId = path.startsWith("/node/")
      ? `node-${path.slice("/node/".length)}`
      : null;
    let idx = currentNodeId ? pool.indexOf(currentNodeId) : -1;
    if (idx === -1) idx = direction > 0 ? -1 : pool.length;
    const next = pool[(idx + direction + pool.length) % pool.length];
    const dash = next.indexOf("-");
    if (dash < 0) return;
    this.navigateTo(`/${next.slice(0, dash)}/${next.slice(dash + 1)}`);
  }

  /**
   * Jump to a sector by zero-based index in termId-ascending order.
   * Matches the BiomeMixer's sector ordering so number keys feel
   * "geographically consistent" — pressing `1` lands on the same
   * sector whose biome is the first one in the palette.
   */
  private jumpToSectorByIndex(index: number): void {
    const snap = this.options.snapshot;
    if (!snap) return;
    const sectorIds = Object.values(snap.sectors)
      .map((s) => s.termId)
      .sort((a, b) => Number(a) - Number(b));
    if (index >= sectorIds.length) return;
    this.navigateTo(`/sector/${sectorIds[index]}`);
  }

}
