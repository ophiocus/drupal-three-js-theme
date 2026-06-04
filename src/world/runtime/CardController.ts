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

import * as THREE from "../../toolbox/three.js";
import type { HtmlSurface, HtmlSurfaceOptions } from "./HtmlSurface.js";
import type { SurfaceCache } from "./SurfaceCache.js";
import type { SmartObject } from "./smart-objects/SmartObject.js";
import { withLangQuery } from "./hud/lang.js";
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
  /** Small disc on the ground; the click target. Optional — entity-body
   *  clicks still register through openFullView even if no pad. */
  pad: THREE.Mesh | null;
  /** Default-view-mode surface (the "Bloomed" preview). Optional —
   *  Bloomed state skips visually when absent; FullView still works
   *  because it fetches its own card HTML via fetchCardHtml. */
  surface: HtmlSurface | null;
  /** Resting position; bloom adds a delta from here. Only meaningful
   *  when surface is present. */
  homePosition: THREE.Vector3 | null;
  homeScale: THREE.Vector3 | null;
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

// View-mode the FullView modal fetches.
//
// Lineage:
//   "full"    → suppressed <h2 class='node__title'> (Drupal expects
//               the canonical page template to render the title).
//               Modal showed no title.
//   "default" → restored the title, but Standard's article default
//               view-display includes comments + login prompts the
//               modal doesn't need; required CSS chrome-hiding.
//   "card"    → dedicated view-mode shipped by world_signature,
//               with per-bundle view-displays scoped to the
//               modal's needs (body + title + image where present,
//               no comments). Architecturally cleaner: Drupal
//               renders only what the modal surfaces; no client-
//               side chrome-hiding needed.
const FULL_VIEW_MODE_DEFAULT = "card";

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
    const pad = smartObject.findComponent(TriggerPadComponent)?.pad ?? null;
    const surface = smartObject.findComponent(HtmlSurfaceComponent)?.surface ?? null;

    if (!pad && !surface) {
      console.warn(
        `[card] register(${smartObject.entityId}): no pad AND no surface; entity will not respond to clicks`,
      );
      return;
    }
    if (!surface) {
      console.warn(
        `[card] register(${smartObject.entityId}): surface missing; FullView works, Bloomed is unavailable`,
      );
    }

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
      homePosition: surface?.mesh.position.clone() ?? null,
      homeScale: surface?.mesh.scale.clone() ?? null,
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
   *
   * v0.4-fix: when a FullView is already open, a pad click on a
   * DIFFERENT entity jumps straight to FullView for that entity
   * (skipping the Bloomed step — the user is in reading mode and
   * wants the document, not the preview). A pad click on the
   * SAME entity is a no-op (already showing).
   *
   * The earlier "if (this.fullViewRecord) return;" gate ("Overlay
   * owns interaction") was a holdover from when the modal covered
   * the whole canvas. The v0.4 modal covers only the left band, so
   * pads on the right half MUST stay clickable for the user to
   * browse between entities while reading.
   */
  activatePad(entityId: string): void {
    const record = this.cards.find((c) => c.entityId === entityId);
    if (!record) return;

    if (this.fullViewRecord) {
      if (this.fullViewRecord.entityId !== entityId) {
        this.openFullView(entityId);
      }
      return;
    }

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
    if (!record) {
      console.warn(`[card] openFullView: no record for ${entityId}`);
      return;
    }
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
    // Surface-less records can't bloom visually; bookkeeping only.
    if (!record.surface || !record.homePosition || !record.homeScale) {
      this.bloomedRecord = record;
      return;
    }
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
    if (record.surface && record.homePosition && record.homeScale) {
      record.surface.mesh.position.copy(record.homePosition);
      record.surface.mesh.scale.copy(record.homeScale);
      record.surface.mesh.lookAt(0, record.homePosition.y, 0);
    }
    if (this.bloomedRecord === record) {
      this.bloomedRecord = null;
      this.options.onBloomedMesh?.(null);
    }
  }

  /**
   * Single-slot prefetch cache. PointerNavigator calls
   * prefetchEntity() when the user clicks a far entity in reading
   * mode; the camera starts flying, the fetch fires in parallel,
   * and by the time settle fires openFullView() the HTML is already
   * in hand. The slot is replaced on each call — only the most
   * recent prefetch matters; earlier in-flight fetches resolve and
   * get ignored if they don't match the eventual fullViewRecord.
   */
  private prefetchSlot: {
    entityId: string;
    html: Promise<string>;
  } | null = null;

  /**
   * Begin loading the entity's FullView HTML in advance of the
   * camera arriving. Two effects:
   *   1. The fetch starts immediately (parallel with the camera fly).
   *   2. If a FullView is already open, the overlay flips to the
   *      `loading` state — the user sees a steady skeleton
   *      throughout the fly+fetch rather than the modal flickering
   *      from old-content → "Loading…" → new-content on settle.
   *
   * Idempotent for the same entityId. Calling with a different
   * entityId replaces the slot — any prior in-flight fetch is
   * orphaned and its result discarded on resolution.
   *
   * Returns silently for unknown entityIds; PointerNavigator
   * doesn't need to know whether a record is registered.
   */
  prefetchEntity(entityId: string): void {
    if (this.prefetchSlot?.entityId === entityId) return;
    const record = this.cards.find((c) => c.entityId === entityId);
    if (!record) return;
    const url = `/world/card/${record.entityType}/${record.numericId}/${this.fullViewMode}`;
    this.prefetchSlot = { entityId, html: fetchCardHtml(url) };
    if (this.fullViewRecord !== null) {
      // Already in reading mode — give the user immediate "going
      // somewhere new" feedback by swapping the overlay to its
      // loading state. The current content slides to opacity 0,
      // skeleton blocks pulse during the fly.
      this.overlay.setState("loading");
    }
  }

  private async applyFullView(record: CardRecord): Promise<void> {
    // v0.4-fix: keep the engine running — the right half of the
    // canvas stays a navigable live world while the modal occupies
    // the left band. setMode("reading") just configures the camera
    // controller (lateral shift + idle suppression).
    this.options.setMode("reading");
    this.fullViewRecord = record;
    // The 3D surface mesh stays in the scene but recedes from
    // attention; CameraController doesn't need to keep re-orienting
    // it while the DOM overlay carries the content.
    if (this.bloomedRecord === record) {
      this.bloomedRecord = null;
      this.options.onBloomedMesh?.(null);
    }

    // Resolve which fetch we're going to consume.
    //   - prefetch slot matches this entity → reuse its promise
    //     (likely already resolved or near-resolved — the camera
    //     fly buys the fetch a head start).
    //   - prefetch slot mismatched / empty → fresh fetch.
    // Either way, show the loading state until the promise resolves.
    let htmlPromise: Promise<string>;
    if (this.prefetchSlot?.entityId === record.entityId) {
      htmlPromise = this.prefetchSlot.html;
    } else {
      const url = `/world/card/${record.entityType}/${record.numericId}/${this.fullViewMode}`;
      htmlPromise = fetchCardHtml(url);
    }
    // Clear the slot regardless — applyFullView is the consumer.
    this.prefetchSlot = null;
    // Show skeleton unless the overlay is already in loading or
    // content state with content that matches. The simpler rule:
    // always flip to loading on FullView entry; setContent's
    // requestAnimationFrame dance fades content in cleanly even
    // if the promise resolved before we got here.
    this.overlay.setState("loading");

    try {
      const html = await htmlPromise;
      // Defensive: guard against the user closing or switching during fetch.
      if (this.fullViewRecord === record) {
        this.overlay.setContent(html);
      }
    } catch (err) {
      console.warn(`[world] FullView fetch failed for ${record.entityId}:`, err);
      if (this.fullViewRecord === record) {
        this.overlay.setError(
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
 * Modal lifecycle state.
 *
 *   hidden  — root display:none; user not in reading mode.
 *   loading — root visible; skeleton blocks pulse; content slot hidden.
 *             Shown when:
 *               (a) FullView entered with no prefetched HTML, OR
 *               (b) prefetchEntity() called while a FullView is open
 *                   (i.e., user clicked a far entity and a fly+swap
 *                   is in flight).
 *   content — root visible; content slot fades in (opacity 0→1, 220ms);
 *             skeleton hidden.
 *   error   — root visible; error message visible; content/skeleton hidden.
 *
 * The state machine eliminates the v0.4-fix-of-a-fix "instant
 * content swap" jerk: the user sees a steady skeleton while the
 * fetch is in flight rather than the modal flickering between
 * "Loading…" plain-text and the article body. Especially valuable
 * for far-click-while-reading where the camera flies for ~1s and
 * the prefetch returns somewhere mid-flight.
 */
type OverlayState = "hidden" | "loading" | "content" | "error";

/**
 * The FullView panel — a fixed-position fullscreen overlay with a
 * backdrop and a centered article container. Built once, mounted
 * to document.body, shown/hidden + state-transitioned via class.
 * Listens for the `[data-card-close]` button inside its content.
 */
class CardOverlay {
  private readonly root: HTMLDivElement;
  private readonly article: HTMLDivElement;
  /** Content slot — innerHTML target for the fetched article. */
  private readonly content: HTMLDivElement;
  /** Skeleton — pulsing rectangles shown during loading. */
  private readonly skeleton: HTMLDivElement;
  /** Error message slot. */
  private readonly errorEl: HTMLDivElement;
  /** Close button. */
  private readonly closeBtn: HTMLButtonElement;
  private state: OverlayState = "hidden";

  constructor(private readonly onClose: () => void) {
    this.root = document.createElement("div");
    this.root.className = "world-card-overlay";
    this.root.setAttribute("aria-hidden", "true");
    // Root layout: position/z/pointer rules are static. The anchor
    // (flex direction + alignment) is responsive — see the
    // <style> block below. Inline styles cover the universal bits;
    // the stylesheet handles the desktop vs mobile split via
    // media query.
    this.root.style.cssText = [
      "position:fixed",
      "inset:0",
      // v0.4: dial back the backdrop so the navigable half of the
      // world (where the entity has been recentered via the camera's
      // viewport shift) reads through. Only the modal article
      // itself carries the heavy backdrop.
      "background:transparent",
      "display:none",   // toggled to "flex" via setState()
      "z-index:1000",
      "overflow:auto",
      // Pointer events only on the modal article itself; the rest
      // of the root passes mouse/touch through to the canvas so
      // users can drag/orbit while reading.
      "pointer-events:none",
    ].join(";");

    this.article = document.createElement("div");
    this.article.className = "world-card-overlay__article";
    // Universal article styles (typography + chrome). Layout
    // (max-width / max-height / which edge it anchors to) is
    // CSS-class driven — see the .world-card-overlay rules in
    // the <style> block, which respond to the MOBILE_BREAKPOINT_PX
    // media query.
    this.article.style.cssText = [
      // Slightly translucent so the world behind the article shows
      // a hint through — feels less like a hard takeover.
      "background:rgba(252,250,246,0.97)",
      "backdrop-filter:blur(12px)",
      "-webkit-backdrop-filter:blur(12px)",
      "color:#222",
      "border-radius:8px",
      "box-shadow:0 24px 48px rgba(0,0,0,0.32)",
      // v0.4 typography pass — Iowan Old Style / Hoefler Text /
      // Georgia serif ladder. The modal reads as an article, not
      // a UI panel.
      "font-family:'Iowan Old Style','Hoefler Text','Georgia',serif",
      "font-size:17px",
      "line-height:1.65",
      "position:relative",
      // Re-enable pointer events ON the article (the root container
      // is pointer-events:none for canvas mouse-through).
      "pointer-events:auto",
    ].join(";");

    // The `card` view-mode (shipped by world_signature in
    // config/install/core.entity_view_mode.node.card.yml + matching
    // per-bundle view-displays) renders only the fields the modal
    // surfaces — no comments, no login prompts. View-display layer
    // is the proper home for those decisions; client-side CSS
    // chrome-hiding was a v0.4-fix-of-a-fix that's now obsolete.
    //
    // Remaining CSS:
    //   - .node__title styling — Drupal's node template renders
    //     title as <h2><a></a></h2>; without a page wrapper around
    //     it the inline-link decoration reads as junk. Restyle to
    //     editorial heading proportions, strip the underline.
    //   - .node__meta hidden — display_submitted is template-level,
    //     not view-display-level; article in Standard install has
    //     display_submitted=true, so byline appears unless hidden.
    //   - .node--type-event .field--name-body first paragraph as
    //     hero callout. Events lead with "Dates: ..." in the body
    //     prose; styling the first <p> elevates that anchor as the
    //     reader's first read.
    //
    // Plus v0.4: skeleton-loader keyframes (pulse) + a content
    // fade-in transition. Both live in the same style block so the
    // article carries its own styles regardless of mount order.
    //
    // When a field_event_date lands as a real field in a future
    // v0.4.x, the event-body first-line CSS becomes redundant —
    // the date renders as its own templated block above body.
    const overlayStyle = document.createElement("style");
    overlayStyle.textContent = `
      /* ─── Responsive layout ─────────────────────────────────────
         The modal anchors to the side opposite the navigable half.
         Desktop (≥768px): left-anchored, max-width:min(760px,48vw),
                           camera shifts laterally → entity in right half.
         Mobile  (<768px): top-anchored,  max-height:min(60vh,520px),
                           camera shifts vertically → entity in bottom half.

         Layout is decided by CSS media query so an orientation
         flip on a tablet doesn't require JS to swap anchors —
         the browser does it. SceneManager.resize() handles the
         camera-shift axis swap on the same trigger. */
      .world-card-overlay {
        align-items: flex-start;
        justify-content: flex-start;
        padding: 48px 24px;
      }
      .world-card-overlay__article {
        max-width: min(760px, 48vw);
        width: 100%;
        padding: 48px 56px;
      }
      @media (max-width: 767px) {
        .world-card-overlay {
          /* Mobile: stack from top, full width, the modal occupies
             the upper band. flex-start on the cross axis still works
             because the article is full-width. */
          align-items: stretch;
          padding: 24px 16px;
        }
        .world-card-overlay__article {
          /* Cap height so the bottom half of the canvas remains
             a navigable world. 60vh gives reading room on most
             phones; the article scrolls internally if longer. */
          max-width: 100%;
          max-height: min(60vh, 520px);
          width: 100%;
          padding: 28px 24px;
          overflow-y: auto;
        }
        .world-card-overlay__article .node__title {
          font-size: 28px !important;
          margin-bottom: 18px !important;
        }
      }
      @keyframes world-card-skeleton-pulse {
        0%,100% { opacity: 0.4; }
        50%     { opacity: 0.85; }
      }
      .world-card-overlay__skeleton-block {
        background: linear-gradient(90deg,
          rgba(120,110,90,0.18) 0%,
          rgba(120,110,90,0.32) 50%,
          rgba(120,110,90,0.18) 100%);
        border-radius: 4px;
        animation: world-card-skeleton-pulse 1.4s ease-in-out infinite;
      }
      .world-card-overlay__content {
        opacity: 0;
        transition: opacity 220ms ease-out;
      }
      .world-card-overlay--state-content .world-card-overlay__content {
        opacity: 1;
      }
      .world-card-overlay__content .node__meta {
        display: none;
      }
      .world-card-overlay__content .node__title {
        font-family: 'Iowan Old Style','Hoefler Text','Georgia',serif;
        font-size: 36px;
        line-height: 1.15;
        font-weight: 600;
        margin: 0 0 28px;
        letter-spacing: -0.01em;
      }
      .world-card-overlay__content .node__title a {
        color: inherit;
        text-decoration: none;
      }
      .world-card-overlay__content p {
        margin: 0 0 1em;
      }
      /* Event date callout — first paragraph of the body of an
         event entity. Reads as the temporal anchor before the
         outcome text. */
      .world-card-overlay__content .node--type-event
        .field--name-body > .field__item::first-line {
        font-weight: 600;
        font-size: 1.15em;
        color: #6a4820;
        letter-spacing: 0.01em;
      }
      /* Profile role-anchor opener — same treatment, cooler tint. */
      .world-card-overlay__content .node--type-profile
        .field--name-body > .field__item::first-line {
        font-weight: 600;
        color: #3a4a2a;
      }
    `;
    this.article.appendChild(overlayStyle);

    this.closeBtn = document.createElement("button");
    this.closeBtn.type = "button";
    this.closeBtn.setAttribute("data-card-close", "");
    this.closeBtn.setAttribute("aria-label", "Close article");
    this.closeBtn.textContent = "×";
    this.closeBtn.style.cssText = [
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

    // Skeleton: a stack of rectangles approximating
    // <title> + <paragraph chunks> + a wider closing chunk. Visual
    // analogue of "article-shaped placeholder" while content fetches.
    // Authored as inline-styled divs rather than a separate <style>
    // block because there are only six and the magic numbers are
    // load-bearing for the article-shape silhouette.
    this.skeleton = document.createElement("div");
    this.skeleton.className = "world-card-overlay__skeleton";
    this.skeleton.style.cssText = "display:none";
    const skelDims: Array<{ h: number; w: string; mt: number }> = [
      { h: 28, w: "70%", mt: 0 },    // title row 1
      { h: 28, w: "55%", mt: 6 },    // title row 2
      { h: 14, w: "100%", mt: 36 },  // body
      { h: 14, w: "98%", mt: 12 },
      { h: 14, w: "94%", mt: 12 },
      { h: 14, w: "60%", mt: 12 },
    ];
    for (const dim of skelDims) {
      const block = document.createElement("div");
      block.className = "world-card-overlay__skeleton-block";
      block.style.cssText = `height:${dim.h}px;width:${dim.w};margin-top:${dim.mt}px`;
      this.skeleton.appendChild(block);
    }

    this.content = document.createElement("div");
    this.content.className = "world-card-overlay__content";
    this.content.style.cssText = "display:none";

    this.errorEl = document.createElement("div");
    this.errorEl.className = "world-card-overlay__error";
    this.errorEl.style.cssText = [
      "display:none",
      "padding:24px 0",
      "color:#7a3a2a",
      "font-style:italic",
    ].join(";");

    this.article.appendChild(this.closeBtn);
    this.article.appendChild(this.skeleton);
    this.article.appendChild(this.content);
    this.article.appendChild(this.errorEl);
    this.root.appendChild(this.article);
    document.body.appendChild(this.root);

    // Click on close button closes. Backdrop-click was a v0.4-pre
    // affordance that quietly stopped working when the root went
    // pointer-events:none (target === root never fires); honest
    // close paths are now the × button and Escape.
    this.root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-card-close]")) {
        this.onClose();
      }
    });
  }

  /**
   * Transition the overlay to a new state. Idempotent — re-setting
   * the same state re-applies the visibility flags. setContent /
   * setError handle their own state transition; this method is
   * for callers who want the loading state without yet having html.
   */
  setState(state: OverlayState): void {
    this.state = state;
    this.root.style.display = state === "hidden" ? "none" : "flex";
    this.root.setAttribute("aria-hidden", state === "hidden" ? "true" : "false");
    this.root.className = "world-card-overlay world-card-overlay--state-" + state;
    this.skeleton.style.display = state === "loading" ? "block" : "none";
    this.content.style.display = state === "content" ? "block" : "none";
    this.errorEl.style.display = state === "error" ? "block" : "none";
  }

  /**
   * Show HTML content with a fade-in transition. The opacity 0→1
   * is driven by the .world-card-overlay--state-content class
   * toggle on the root + the .world-card-overlay__content CSS rule
   * (220ms ease-out). The two-step (display:block then class flip)
   * ensures the transition actually fires; setting opacity on an
   * element that just appeared via display change is a no-op
   * without a frame in between.
   */
  setContent(html: string): void {
    this.content.innerHTML = html;
    // Force content visible immediately; defer the class flip so
    // the opacity transition has a frame to register.
    this.skeleton.style.display = "none";
    this.content.style.display = "block";
    this.errorEl.style.display = "none";
    this.root.style.display = "flex";
    this.root.setAttribute("aria-hidden", "false");
    this.root.className = "world-card-overlay world-card-overlay--state-loading";
    this.state = "loading";
    requestAnimationFrame(() => {
      this.root.className = "world-card-overlay world-card-overlay--state-content";
      this.state = "content";
    });
  }

  /** Show an error message in place of content. */
  setError(html: string): void {
    this.errorEl.innerHTML = html;
    this.setState("error");
  }

  /**
   * Compat shim — old call sites that did overlay.show("<p>...</p>")
   * now go through setContent for fade-in semantics. Kept as a
   * dedicated method because there are still error-path call sites
   * that pass raw HTML; treat them as a flat content set without
   * the prefetch dance.
   */
  show(html: string): void {
    this.setContent(html);
  }

  hide(): void {
    this.setState("hidden");
  }

  /** Current state — useful for callers reasoning about whether
   *  a setContent will be a fresh-load or a transition-from-loading. */
  getState(): OverlayState {
    return this.state;
  }

  dispose(): void {
    this.root.remove();
  }
}

async function fetchCardHtml(url: string): Promise<string> {
  const r = await fetch(withLangQuery(url), { headers: { Accept: "text/html" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

// HtmlSurfaceOptions re-export so the SceneManager doesn't need a
// separate import path for typed surface acquisition.
export type { HtmlSurfaceOptions };
