// CardController — the formal Hidden → Bloomed → FullView state
// machine for every card in the world.
//
// Per ARCHITECTURE §4.3 / THESIS "the document, in situ":
//   - Hidden    — zero cost; the card has no surface presence.
//   - Bloomed   — preview surfaced as a 3D plane next to its
//                 entity. Engine still running.
//   - FullView  — DOM overlay; full article HTML; engine paused
//                 (renderer.setAnimationLoop(null)) so battery
//                 and focus go to the document.
//
// Transition table:
//
//   Hidden → Bloomed     pad click  ·  hashchange #card=<id>
//   Bloomed → Hidden     empty-space click  ·  hash cleared
//   Bloomed → FullView   pad click while bloomed  ·  hash …&v=full
//   FullView → Bloomed   close button  ·  hash without &v=full
//   FullView → Hidden    close button + Esc  ·  hash cleared
//
// Single-bloom / single-fullview invariant: at most one card is
// bloomed and at most one card is in FullView, system-wide. The
// FullView card is the same as the previously-bloomed one.
//
// CardController subsumes the old TriggerSystem (raycaster + pad
// management) — the bloom/collapse logic moved into the state
// machine and the click router routes through transition().

import * as THREE from "three";
import type { HtmlSurface, HtmlSurfaceOptions } from "./HtmlSurface.js";
import type { SurfaceCache } from "./SurfaceCache.js";
import type { SmartObject } from "./smart-objects/SmartObject.js";
import { HtmlSurfaceComponent } from "./smart-objects/components/HtmlSurfaceComponent.js";
import { TriggerPadComponent } from "./smart-objects/components/TriggerPadComponent.js";

export type CardState = "hidden" | "bloomed" | "fullView";

/**
 * Per-entity card lifecycle state.
 *
 * v0.1.2: CardController derives this from a SmartObject at
 * register time — pad, surface, and bundle metadata all come
 * from the SmartObject's attached components.
 */
interface CardRecord {
  entityId: string;
  /** Numeric/string id used to build the FullView card endpoint URL. */
  numericId: string;
  entityType: string;
  /** Small disc on the ground; the click target. */
  pad: THREE.Mesh;
  /** Default-view-mode surface (the "Bloomed" preview). */
  surface: HtmlSurface;
  /** Resting position; bloom adds a delta from here. */
  homePosition: THREE.Vector3;
  homeScale: THREE.Vector3;
  state: CardState;
}

/** Mode toggle the controller raises on its host (SceneManager). */
export type ModeSetter = (mode: "exploration" | "reading") => void;

interface ControllerOptions {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  surfaceCache: SurfaceCache;
  setMode: ModeSetter;
  /**
   * Notify the host (CameraController) when a surface mesh enters
   * or leaves the bloomed state. The CameraController uses this to
   * keep the bloomed surface facing the camera each frame.
   * Null = no surface bloomed.
   */
  onBloomedMesh?: (mesh: THREE.Object3D | null) => void;
  /** FullView fetches use this view-mode (e.g. "full"). */
  fullViewViewMode?: string;
}

const FULL_VIEW_MODE_DEFAULT = "full";

export class CardController {
  private readonly cards: CardRecord[] = [];
  private readonly overlay: CardOverlay;
  private bloomedRecord: CardRecord | null = null;
  private fullViewRecord: CardRecord | null = null;
  private readonly fullViewMode: string;

  constructor(private readonly options: ControllerOptions) {
    this.fullViewMode = options.fullViewViewMode ?? FULL_VIEW_MODE_DEFAULT;
    this.overlay = new CardOverlay(() => this.exitFullView());
    // v0.1.1: PointerNavigator owns the canvas pointer events and
    // routes pad clicks via activatePad(). CardController no longer
    // touches the canvas; it owns card *state*, not input.
    window.addEventListener("hashchange", this.onHashChange);
    window.addEventListener("keydown", this.onKeyDown);
  }

  /** Build a trigger pad disc, palette-tinted, ready to add to the scene. */
  static makePad(color: THREE.ColorRepresentation): THREE.Mesh {
    const geo = new THREE.CircleGeometry(2.4, 32);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
      metalness: 0.1,
      emissive: new THREE.Color(color).multiplyScalar(0.15),
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.isTriggerPad = true;
    return mesh;
  }

  /**
   * v0.1.2: register a SmartObject. CardController derives the
   * internal CardRecord from the SmartObject's components —
   * TriggerPadComponent for the pad mesh, HtmlSurfaceComponent
   * for the surface. Entities without both components silently
   * skip registration (not every SmartObject participates in the
   * card lifecycle).
   */
  register(smartObject: SmartObject): void {
    const pad = smartObject.findComponent(TriggerPadComponent)?.pad;
    const surface = smartObject.findComponent(HtmlSurfaceComponent)?.surface;
    if (!pad || !surface) return;

    // Parse "node-12" → ("node", "12") for the FullView URL.
    const dashIdx = smartObject.entityId.indexOf("-");
    if (dashIdx < 0) return;
    const entityType = smartObject.entityId.slice(0, dashIdx);
    const numericId = smartObject.entityId.slice(dashIdx + 1);

    const record: CardRecord = {
      entityId: smartObject.entityId,
      entityType,
      numericId,
      pad,
      surface,
      homePosition: surface.mesh.position.clone(),
      homeScale: surface.mesh.scale.clone(),
      state: "hidden",
    };
    this.cards.push(record);
    // Seed initial state from URL hash on first registration only.
    // (Cards register asynchronously; we want each one to honor the
    // already-present hash if it matches.)
    this.applyHashState(record);
  }

  dispose(): void {
    window.removeEventListener("hashchange", this.onHashChange);
    window.removeEventListener("keydown", this.onKeyDown);
    this.overlay.dispose();
  }

  // ─── Public surface for PointerNavigator ─────────────────────────────────

  /**
   * Activate a trigger pad by entityId — what happens when the user
   * clicks a pad in the world. Drives the Hidden → Bloomed →
   * FullView progression for that entity, collapsing any other
   * card first (single-bloom invariant).
   */
  activatePad(entityId: string): void {
    if (this.fullViewRecord) return; // Overlay owns interaction.
    const record = this.cards.find((c) => c.entityId === entityId);
    if (!record) return;

    if (record.state === "hidden") {
      if (this.bloomedRecord && this.bloomedRecord !== record) {
        this.transitionTo(this.bloomedRecord, "hidden");
      }
      this.transitionTo(record, "bloomed");
    } else if (record.state === "bloomed") {
      this.transitionTo(record, "fullView");
    }
  }

  /**
   * Collapse any bloomed / FullView card back to Hidden. Called by
   * PointerNavigator when the user clicks empty space at overview
   * (per the navigation Q3 decision).
   */
  collapseAll(): void {
    if (this.fullViewRecord) {
      this.transitionTo(this.fullViewRecord, "hidden");
    } else if (this.bloomedRecord) {
      this.transitionTo(this.bloomedRecord, "hidden");
    }
  }

  /**
   * Open an entity directly in FullView, skipping the Bloomed
   * intermediate. The v0.4 information-lod "one click to node"
   * gesture: clicking an entity body or a WorldHud title label
   * jumps straight to the full DOM-overlay content surface,
   * pausing the engine. Any previously-bloomed/FullView card
   * collapses first (single-bloom invariant preserved).
   *
   * The Bloomed state remains reachable via the trigger-pad ramp
   * (pad click → Bloomed → pad click → FullView) and via URL hash
   * (#card=<id> without &v=full). This method is the express path
   * for users who want the document, not the preview.
   */
  openFullView(entityId: string): void {
    if (this.fullViewRecord?.entityId === entityId) return; // Already there.
    const record = this.cards.find((c) => c.entityId === entityId);
    if (!record) return;
    // Collapse any other card holding state before opening.
    if (this.fullViewRecord && this.fullViewRecord !== record) {
      this.transitionTo(this.fullViewRecord, "hidden");
    } else if (this.bloomedRecord && this.bloomedRecord !== record) {
      this.transitionTo(this.bloomedRecord, "hidden");
    }
    this.transitionTo(record, "fullView");
  }

  // ─── State machine ───────────────────────────────────────────────────────

  private transitionTo(record: CardRecord, to: CardState): void {
    if (record.state === to) return;
    const from = record.state;
    record.state = to;

    if (to === "bloomed") this.applyBloom(record);
    if (to === "hidden") this.applyHidden(record);
    if (to === "fullView") {
      void this.applyFullView(record);
    }

    if (from === "fullView" && to !== "fullView") {
      this.options.setMode("exploration");
      this.overlay.hide();
      this.fullViewRecord = null;
    }

    this.syncHash();
  }

  private applyBloom(record: CardRecord): void {
    const camDir = new THREE.Vector3();
    this.options.camera.getWorldDirection(camDir);
    const offset = camDir.clone().multiplyScalar(-15);
    record.surface.mesh.position.copy(record.homePosition).add(offset);
    record.surface.mesh.scale.copy(record.homeScale).multiplyScalar(1.8);
    // Initial facing — CameraController takes over from here, keeping
    // the mesh oriented toward the camera continuously each frame.
    record.surface.mesh.lookAt(this.options.camera.position);
    this.bloomedRecord = record;
    this.options.onBloomedMesh?.(record.surface.mesh);
  }

  private applyHidden(record: CardRecord): void {
    record.surface.mesh.position.copy(record.homePosition);
    record.surface.mesh.scale.copy(record.homeScale);
    record.surface.mesh.lookAt(0, record.homePosition.y, 0);
    if (this.bloomedRecord === record) {
      this.bloomedRecord = null;
      this.options.onBloomedMesh?.(null);
    }
  }

  private async applyFullView(record: CardRecord): Promise<void> {
    // Pause the engine first — even if the fetch is slow, the
    // contract is "world stops the moment the user enters reading."
    this.options.setMode("reading");
    this.fullViewRecord = record;
    // The 3D surface mesh stays in the scene but recedes from
    // attention; CameraController doesn't need to keep re-orienting
    // it while the DOM overlay carries the content.
    if (this.bloomedRecord === record) {
      this.bloomedRecord = null;
      this.options.onBloomedMesh?.(null);
    }
    this.overlay.show("<p>Loading…</p>");

    try {
      const url = `/world/card/${record.entityType}/${record.numericId}/${this.fullViewMode}`;
      const html = await fetchCardHtml(url);
      // Defensive: guard against the user closing during fetch.
      if (this.fullViewRecord === record) {
        this.overlay.show(html);
      }
    } catch (err) {
      console.warn(`[world] FullView fetch failed for ${record.entityId}:`, err);
      if (this.fullViewRecord === record) {
        this.overlay.show(
          `<p>Could not load this article. <button data-card-close>Close</button></p>`,
        );
      }
    }
  }

  private exitFullView(): void {
    if (!this.fullViewRecord) return;
    // FullView → Bloomed (the previous state). Esc handler can
    // collapse fully via collapseAll().
    this.transitionTo(this.fullViewRecord, "bloomed");
  }

  // ─── URL hash coupling ───────────────────────────────────────────────────

  /**
   * Hash format: `#card=<id>` for Bloomed, `#card=<id>&v=full` for
   * FullView. Empty hash → all hidden. Matches ARCHITECTURE §4.3's
   * URL coupling spec, scaled to client-side-only routing.
   */
  private syncHash(): void {
    const target = this.fullViewRecord ?? this.bloomedRecord;
    if (!target) {
      if (window.location.hash) {
        history.replaceState(null, "", window.location.pathname);
      }
      return;
    }
    const params = new URLSearchParams();
    params.set("card", target.entityId);
    if (target.state === "fullView") params.set("v", this.fullViewMode);
    history.replaceState(null, "", `#${params.toString()}`);
  }

  private onHashChange = (): void => {
    const desired = this.parseHash();
    if (!desired) {
      // Hash cleared externally — collapse all.
      this.collapseAll();
      return;
    }
    const record = this.cards.find((c) => c.entityId === desired.cardId);
    if (!record) return;
    if (record.state !== desired.target) {
      // Collapse any other card first.
      if (this.bloomedRecord && this.bloomedRecord !== record) {
        this.transitionTo(this.bloomedRecord, "hidden");
      }
      this.transitionTo(record, desired.target);
    }
  };

  private applyHashState(record: CardRecord): void {
    const desired = this.parseHash();
    if (desired && desired.cardId === record.entityId) {
      this.transitionTo(record, desired.target);
    }
  }

  private parseHash(): { cardId: string; target: CardState } | null {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return null;
    const params = new URLSearchParams(hash);
    const cardId = params.get("card");
    if (!cardId) return null;
    const target: CardState = params.get("v") === this.fullViewMode ? "fullView" : "bloomed";
    return { cardId, target };
  }

  private collapseAll(): void {
    if (this.fullViewRecord) {
      this.transitionTo(this.fullViewRecord, "hidden");
    } else if (this.bloomedRecord) {
      this.transitionTo(this.bloomedRecord, "hidden");
    }
  }

  // ─── Keyboard ────────────────────────────────────────────────────────────

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    if (this.fullViewRecord) {
      this.transitionTo(this.fullViewRecord, "hidden");
    } else if (this.bloomedRecord) {
      this.transitionTo(this.bloomedRecord, "hidden");
    }
  };
}

// ─── DOM overlay ──────────────────────────────────────────────────────────

/**
 * The FullView panel — a fixed-position fullscreen overlay with a
 * backdrop and a centered article container. Built once, mounted
 * to document.body, shown/hidden via CSS class. Listens for the
 * `[data-card-close]` button inside its content.
 */
class CardOverlay {
  private readonly root: HTMLDivElement;
  private readonly article: HTMLDivElement;

  constructor(private readonly onClose: () => void) {
    this.root = document.createElement("div");
    this.root.className = "world-card-overlay";
    this.root.setAttribute("aria-hidden", "true");
    this.root.style.cssText = [
      "position:fixed",
      "inset:0",
      "background:rgba(20,30,40,0.78)",
      "backdrop-filter:blur(8px)",
      "-webkit-backdrop-filter:blur(8px)",
      "display:none",
      "align-items:flex-start",
      "justify-content:center",
      "z-index:1000",
      "overflow:auto",
      "padding:48px 24px",
    ].join(";");

    this.article = document.createElement("div");
    this.article.className = "world-card-overlay__article";
    this.article.style.cssText = [
      "background:#fff",
      "color:#222",
      "max-width:760px",
      "width:100%",
      "padding:48px 56px",
      "border-radius:8px",
      "box-shadow:0 24px 48px rgba(0,0,0,0.32)",
      "font-family:system-ui,-apple-system,sans-serif",
      "line-height:1.55",
      "position:relative",
    ].join(";");

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.setAttribute("data-card-close", "");
    closeBtn.setAttribute("aria-label", "Close article");
    closeBtn.textContent = "×";
    closeBtn.style.cssText = [
      "position:absolute",
      "top:12px",
      "right:16px",
      "background:transparent",
      "border:none",
      "font-size:32px",
      "line-height:1",
      "cursor:pointer",
      "color:#888",
      "padding:4px 12px",
    ].join(";");

    const content = document.createElement("div");
    content.className = "world-card-overlay__content";

    this.article.appendChild(closeBtn);
    this.article.appendChild(content);
    this.root.appendChild(this.article);
    document.body.appendChild(this.root);

    // Click on backdrop OR on close button closes. Click inside the
    // article (but not on the close button) does nothing.
    this.root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target === this.root || target.closest("[data-card-close]")) {
        this.onClose();
      }
    });
  }

  show(html: string): void {
    const content = this.article.querySelector(".world-card-overlay__content");
    if (content) content.innerHTML = html;
    this.root.style.display = "flex";
    this.root.setAttribute("aria-hidden", "false");
  }

  hide(): void {
    this.root.style.display = "none";
    this.root.setAttribute("aria-hidden", "true");
  }

  dispose(): void {
    this.root.remove();
  }
}

async function fetchCardHtml(url: string): Promise<string> {
  const r = await fetch(url, { headers: { Accept: "text/html" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

// HtmlSurfaceOptions re-export so the SceneManager doesn't need a
// separate import path for typed surface acquisition.
export type { HtmlSurfaceOptions };
