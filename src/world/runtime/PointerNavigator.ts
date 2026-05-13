// PointerNavigator — the macro-navigation click router.
//
// Owns canvas pointer events. Routes them to:
//   - CardController (when a trigger pad is clicked)
//   - CameraController (when an entity body or sector pad is
//     clicked; or when the user drags to micro-orbit)
//   - "step out" navigation (when empty ground is clicked)
//
// Implements:
//   - Click vs drag discrimination by movement threshold (3px)
//     and timing (200ms). Below either threshold = click.
//   - Hover affordance via raycasted pointermove: the mesh under
//     the pointer gets a temporary emissive lift so the user can
//     read "what would happen if I clicked here" before clicking.
//   - Empty-space click semantics: at overview, clears any
//     bloomed/FullView card state (Q3); at sector or detail,
//     steps out one URL level.
//
// See docs/v0.1/CAMERA_CONTROLLER.md and the navigation proposal
// for the gesture map.

import * as THREE from "three";
import type { CardController } from "./CardController.js";
import type { CameraController } from "./CameraController.js";
import type { CorpusSnapshot } from "../types.js";

interface NavigatorOptions {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  scene: THREE.Scene;
  cardController: CardController;
  cameraController: CameraController;
  snapshot: CorpusSnapshot;
}

/** Click vs drag thresholds. */
const CLICK_MAX_DISTANCE = 3;
const CLICK_MAX_DURATION_MS = 200;
/** Hover throttle — every Nth pointermove event runs a raycast. */
const HOVER_RAYCAST_THROTTLE = 3;
/** Emissive multiplier on hover. */
const HOVER_EMISSIVE_GAIN = 2.8;

export class PointerNavigator {
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private downAt: { x: number; y: number; time: number } | null = null;
  private dragging = false;
  private hovered: THREE.Mesh | null = null;
  private hoverThrottleCounter = 0;

  constructor(private readonly options: NavigatorOptions) {
    const c = options.canvas;
    c.addEventListener("pointerdown", this.onPointerDown);
    c.addEventListener("pointermove", this.onPointerMove);
    c.addEventListener("pointerup", this.onPointerUp);
    c.addEventListener("pointerleave", this.onPointerLeave);
  }

  dispose(): void {
    const c = this.options.canvas;
    c.removeEventListener("pointerdown", this.onPointerDown);
    c.removeEventListener("pointermove", this.onPointerMove);
    c.removeEventListener("pointerup", this.onPointerUp);
    c.removeEventListener("pointerleave", this.onPointerLeave);
    this.clearHover();
  }

  // ─── Pointer events ──────────────────────────────────────────────────────

  private onPointerDown = (event: PointerEvent): void => {
    this.downAt = { x: event.clientX, y: event.clientY, time: event.timeStamp };
    this.dragging = false;
  };

  private onPointerMove = (event: PointerEvent): void => {
    // If a pointerdown is in progress, watch for the drag threshold.
    if (this.downAt && !this.dragging) {
      const dx = event.clientX - this.downAt.x;
      const dy = event.clientY - this.downAt.y;
      if (Math.hypot(dx, dy) > CLICK_MAX_DISTANCE) {
        this.dragging = true;
        this.options.cameraController.setUserInteracting(true);
        this.clearHover(); // suppress hover during drag
      }
    }
    if (this.dragging) {
      // Forward dx/dy deltas to the camera controller. We send the
      // movementX/Y from the event so multi-frame drags accumulate.
      this.options.cameraController.applyDragDelta(
        event.movementX, event.movementY,
      );
      return;
    }
    // Hover, throttled so a fast mouse doesn't run a raycast per
    // pixel of motion.
    this.hoverThrottleCounter = (this.hoverThrottleCounter + 1)
      % HOVER_RAYCAST_THROTTLE;
    if (this.hoverThrottleCounter !== 0) return;
    this.updateHover(event);
  };

  private onPointerUp = (event: PointerEvent): void => {
    const down = this.downAt;
    this.downAt = null;
    if (this.dragging) {
      this.dragging = false;
      this.options.cameraController.setUserInteracting(false);
      return;
    }
    if (!down) return;
    const dx = event.clientX - down.x;
    const dy = event.clientY - down.y;
    const dt = event.timeStamp - down.time;
    if (Math.hypot(dx, dy) > CLICK_MAX_DISTANCE) return;
    if (dt > CLICK_MAX_DURATION_MS) return;
    // Confirmed click.
    this.handleClick(event);
  };

  private onPointerLeave = (): void => {
    this.clearHover();
    if (this.dragging) {
      this.dragging = false;
      this.options.cameraController.setUserInteracting(false);
    }
    this.downAt = null;
  };

  // ─── Click routing ───────────────────────────────────────────────────────

  private handleClick(event: PointerEvent): void {
    this.setPointerNdc(event);
    this.raycaster.setFromCamera(this.pointerNdc, this.options.camera);
    const intersects = this.raycaster.intersectObjects(
      this.options.scene.children, true,
    );

    // Walk intersects in distance order, looking for a recognized
    // tag. Decorative meshes (ground plane, compass posts) have no
    // tag and are skipped — letting the click "pass through" to
    // empty-space semantics is the right behavior.
    for (const hit of intersects) {
      const tag = this.classifyMesh(hit.object);
      if (tag.kind === "trigger_pad") {
        this.options.cardController.activatePad(tag.entityId);
        return;
      }
      if (tag.kind === "entity_body") {
        this.options.cameraController.navigateTo(
          this.uriForEntity(tag.entityId),
        );
        return;
      }
      if (tag.kind === "sector_pad") {
        this.options.cameraController.navigateTo(
          this.uriForSector(tag.termId),
        );
        return;
      }
    }
    // No recognized tag intersected → empty-space click.
    this.handleEmptyClick();
  }

  private handleEmptyClick(): void {
    const path = window.location.pathname;
    if (path === "/" || path === "") {
      // Q3: at overview, empty-space click clears card state.
      this.options.cardController.collapseAll();
      return;
    }
    // At sector or detail vantage, step out one URL level.
    if (path.startsWith("/node/")) {
      // node/<id> → its primary sector. If we can't resolve a
      // sector, fall back to overview.
      const numericId = path.slice("/node/".length);
      const entity = this.options.snapshot.entities[`node-${numericId}`];
      const primarySector = entity?.taxonomyTerms?.[0];
      const target = primarySector
        ? this.uriForSector(primarySector)
        : "/";
      this.options.cameraController.navigateTo(target);
      return;
    }
    if (path.startsWith("/sector/")) {
      this.options.cameraController.navigateTo("/");
      return;
    }
    // Unknown path shape — back to overview.
    this.options.cameraController.navigateTo("/");
  }

  private uriForSector(termId: string): string {
    return `/sector/${termId}`;
  }

  private uriForEntity(entityId: string): string {
    // entityId is shaped "node-<n>"; URI is "/node/<n>".
    const dash = entityId.indexOf("-");
    if (dash < 0) return "/";
    return `/${entityId.slice(0, dash)}/${entityId.slice(dash + 1)}`;
  }

  // ─── Hover ───────────────────────────────────────────────────────────────

  private updateHover(event: PointerEvent): void {
    this.setPointerNdc(event);
    this.raycaster.setFromCamera(this.pointerNdc, this.options.camera);
    const intersects = this.raycaster.intersectObjects(
      this.options.scene.children, true,
    );
    let candidate: THREE.Mesh | null = null;
    for (const hit of intersects) {
      const tag = this.classifyMesh(hit.object);
      if (tag.kind !== "decorative") {
        candidate = hit.object as THREE.Mesh;
        break;
      }
    }
    if (candidate === this.hovered) return;
    this.clearHover();
    if (candidate) this.applyHover(candidate);
  }

  private applyHover(mesh: THREE.Mesh): void {
    const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
    if (!mat || !("emissive" in mat)) return;
    // Stash the baseline emissive once so we can restore exactly.
    if (!mesh.userData._baseEmissive) {
      mesh.userData._baseEmissive = mat.emissive.clone();
    }
    const base = mesh.userData._baseEmissive as THREE.Color;
    // Multiply, but clamp to a sensible band so we don't blow out
    // bright base colors.
    mat.emissive.copy(base).multiplyScalar(HOVER_EMISSIVE_GAIN);
    // If the baseline emissive was zero, give it a faint tint
    // anyway — pads with zero emissive (e.g. compass posts) wouldn't
    // light up otherwise.
    if (base.r + base.g + base.b < 0.01) {
      mat.emissive.setRGB(0.15, 0.15, 0.15);
    }
    this.hovered = mesh;
    document.body.style.cursor = "pointer";
  }

  private clearHover(): void {
    if (!this.hovered) {
      document.body.style.cursor = "";
      return;
    }
    const mat = this.hovered.material as THREE.MeshStandardMaterial | undefined;
    const base = this.hovered.userData._baseEmissive as THREE.Color | undefined;
    if (mat && "emissive" in mat && base) {
      mat.emissive.copy(base);
    }
    this.hovered = null;
    document.body.style.cursor = "";
  }

  // ─── Util ────────────────────────────────────────────────────────────────

  private setPointerNdc(event: PointerEvent): void {
    const rect = this.options.canvas.getBoundingClientRect();
    this.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /**
   * Read a mesh's userData tags. SceneManager tags entity bodies
   * with `isEntityBody`, sector pads with `isSectorPad`, trigger
   * pads with `isTriggerPad`. Anything untagged is "decorative"
   * (ground, compass posts, surfaces, lights) — clicks fall
   * through.
   */
  private classifyMesh(obj: THREE.Object3D): MeshTag {
    const ud = obj.userData;
    if (ud.isTriggerPad && ud.entityId) {
      return { kind: "trigger_pad", entityId: String(ud.entityId) };
    }
    if (ud.isEntityBody && ud.entityId) {
      return { kind: "entity_body", entityId: String(ud.entityId) };
    }
    if (ud.isSectorPad && ud.termId) {
      return { kind: "sector_pad", termId: String(ud.termId) };
    }
    return { kind: "decorative" };
  }
}

type MeshTag =
  | { kind: "trigger_pad"; entityId: string }
  | { kind: "entity_body"; entityId: string }
  | { kind: "sector_pad"; termId: string }
  | { kind: "decorative" };
