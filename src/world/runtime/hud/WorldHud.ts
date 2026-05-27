// WorldHud — persistent, non-modal DOM overlay anchored to world
// positions.
//
// Sibling to the existing CardOverlay (which is MODAL — it takes
// over the screen and pauses the engine for FullView). WorldHud
// is the opposite: persistent, lightweight, non-blocking,
// screen-space labels that float over the canvas and follow
// world-space anchors as the camera moves.
//
// Use case (Activity A — Information LOD research):
//   At overview vantage, the world shows no text. WorldHud adds
//   five region labels at the sector centroids so visitors know
//   what they're looking at without having to fly down to a
//   sector.
//
// Design boundary: WorldHud is "dumb." It renders the labels you
// give it, projects them every frame, and shows/hides based on
// camera frustum + per-label predicate. Scope-awareness (which
// labels are active at which vantage) lives where the consumer
// decides — typically SceneManager or a per-scope orchestrator,
// not the HUD itself.
//
// Per docs/v0.4/research/INFORMATION_LOD.md.

import * as THREE from "../../../toolbox/three.js";

export interface HudLabelOptions {
  /** World-space anchor — where this label "points at" in the scene. */
  worldPos: THREE.Vector3;
  /** Displayed text (the title line). */
  text: string;
  /**
   * Optional subtitle line — hidden by default; revealed when the
   * HUD's setHoveredEntity matches this label's entityId. Used for
   * one-line summaries that appear on hover without cluttering the
   * default spray.
   */
  subtitle?: string;
  /**
   * Optional entity ID for hover-driven subtitle routing. When
   * `WorldHud.setHoveredEntity(id)` is called, the label with the
   * matching entityId shows its subtitle; others hide theirs.
   */
  entityId?: string;
  /** Optional click handler. If absent, the label is a passive label. */
  onClick?: () => void;
  /**
   * Optional CSS class for per-label styling. The HUD applies
   * `world-hud__label` always; this is additive.
   */
  className?: string;
  /**
   * Visibility predicate evaluated per frame. Receives the current
   * camera and the projected NDC (normalized device coordinate)
   * z value (< 1 = in front of camera). Return false to hide.
   * Default: always visible while in front of the camera.
   */
  visibleIf?: (camera: THREE.Camera, ndcZ: number) => boolean;
}

/**
 * A single label inside the HUD. Returned by `addLabel`; the
 * caller holds it to dispose or update later.
 */
export class HudLabel {
  /** The owned DOM node. */
  readonly element: HTMLDivElement;
  /** Inner title element. */
  private readonly titleEl: HTMLDivElement;
  /** Optional subtitle element — created only when options.subtitle is set. */
  private readonly subtitleEl: HTMLDivElement | null = null;

  constructor(
    private readonly hud: WorldHud,
    readonly options: HudLabelOptions,
  ) {
    this.element = document.createElement("div");
    this.element.className = "world-hud__label" +
      (options.className ? " " + options.className : "");
    this.element.style.cssText = [
      "position:absolute",
      "transform:translate(-50%, -100%)",   // centered horizontally, bottom of div on the anchor
      "pointer-events:auto",
      "user-select:none",
      // Visible-by-default styling — consumers override via .className.
      "padding:6px 10px",
      "background:rgba(20,30,30,0.65)",
      "color:#f0e8c8",
      "font:14px/1.25 system-ui,-apple-system,sans-serif",
      "letter-spacing:0.02em",
      "border-radius:4px",
      "backdrop-filter:blur(6px)",
      "-webkit-backdrop-filter:blur(6px)",
      "display:none",                       // start hidden; first update() reveals
      "transition:opacity 120ms ease-out",
      "opacity:0",
      "cursor:" + (options.onClick ? "pointer" : "default"),
      // Allow subtitles to wrap; the title row stays nowrap via its own style.
      "max-width:320px",
    ].join(";");

    // Title row — nowrap so the entity name stays on one line.
    this.titleEl = document.createElement("div");
    this.titleEl.className = "world-hud__label-title";
    this.titleEl.style.cssText = "white-space:nowrap;";
    this.titleEl.textContent = options.text;
    this.element.appendChild(this.titleEl);

    // Optional subtitle — hidden by default; toggled via
    // setSubtitleVisible() which the HUD calls in response to
    // hover events.
    if (options.subtitle) {
      this.subtitleEl = document.createElement("div");
      this.subtitleEl.className = "world-hud__label-subtitle";
      this.subtitleEl.style.cssText = [
        "display:none",
        "margin-top:4px",
        "font-size:12px",
        "font-style:italic",
        "opacity:0.85",
        "letter-spacing:0",
        "white-space:normal",
        "line-height:1.35",
      ].join(";");
      this.subtitleEl.textContent = options.subtitle;
      this.element.appendChild(this.subtitleEl);
    }

    if (options.onClick) {
      this.element.addEventListener("click", (e) => {
        e.stopPropagation();
        options.onClick!();
      });
    }
  }

  /** Update displayed title text without recreating the label. */
  setText(text: string): void {
    this.titleEl.textContent = text;
  }

  /** Show / hide the subtitle. No-op if the label has no subtitle. */
  setSubtitleVisible(visible: boolean): void {
    if (!this.subtitleEl) return;
    this.subtitleEl.style.display = visible ? "block" : "none";
  }

  /** Move the world anchor (e.g. if the entity is repositioned). */
  setWorldPos(pos: THREE.Vector3): void {
    this.options.worldPos.copy(pos);
  }

  /** Remove from the HUD. */
  remove(): void {
    this.hud.removeLabel(this);
  }
}

export interface WorldHudOptions {
  /** The host canvas; HUD overlays it positionally. */
  canvas: HTMLCanvasElement;
  /**
   * Optional CSS z-index for the HUD container.
   * Default 100 — well below CardOverlay's 1000 (so the modal
   * always wins) and below Drupal's admin toolbar which sits at
   * `position:fixed` with z-index 502+.
   */
  zIndex?: number;
}

export class WorldHud {
  private readonly root: HTMLDivElement;
  private readonly labels = new Set<HudLabel>();
  /** entityId → label lookup for hover-driven subtitle routing. */
  private readonly labelsByEntityId = new Map<string, HudLabel>();
  /** Currently hovered entity. The matching label shows its subtitle. */
  private hoveredEntityId: string | null = null;
  /** Scratch vector reused across project() calls — avoids GC churn. */
  private readonly scratchVec = new THREE.Vector3();

  constructor(private readonly options: WorldHudOptions) {
    this.root = document.createElement("div");
    this.root.className = "world-hud";
    this.root.setAttribute("aria-hidden", "false");
    this.root.style.cssText = [
      "position:fixed",
      "inset:0",
      "pointer-events:none",   // children opt back into events
      "z-index:" + (options.zIndex ?? 100),
      "overflow:hidden",
    ].join(";");
    document.body.appendChild(this.root);

    // Position the HUD container precisely over the canvas. The
    // canvas might not fill the viewport (it doesn't in Drupal —
    // the admin toolbar takes some height). We resize the HUD on
    // canvas resize.
    this.syncToCanvas();
    window.addEventListener("resize", () => this.syncToCanvas());
  }

  /**
   * Add a label. The returned object can be used to update text,
   * move the anchor, or remove from the HUD.
   */
  addLabel(opts: HudLabelOptions): HudLabel {
    const label = new HudLabel(this, opts);
    this.labels.add(label);
    this.root.appendChild(label.element);
    if (opts.entityId) {
      this.labelsByEntityId.set(opts.entityId, label);
    }
    return label;
  }

  /**
   * Mark one entity as hovered. The matching label's subtitle
   * (if any) reveals; any previously-hovered label's subtitle hides.
   * Call with null to clear.
   *
   * This is the universal hover-driven UI extension point — the
   * HUD owns it because subtitles are HUD content; PointerNavigator
   * just emits the event.
   */
  setHoveredEntity(entityId: string | null): void {
    if (entityId === this.hoveredEntityId) return;
    if (this.hoveredEntityId) {
      this.labelsByEntityId.get(this.hoveredEntityId)?.setSubtitleVisible(false);
    }
    if (entityId) {
      this.labelsByEntityId.get(entityId)?.setSubtitleVisible(true);
    }
    this.hoveredEntityId = entityId;
  }

  /** Remove a label and its DOM node. */
  removeLabel(label: HudLabel): void {
    if (this.labels.delete(label)) {
      label.element.remove();
      if (label.options.entityId) {
        this.labelsByEntityId.delete(label.options.entityId);
      }
    }
  }

  /** Clear every label. */
  clear(): void {
    for (const l of this.labels) l.element.remove();
    this.labels.clear();
    this.labelsByEntityId.clear();
    this.hoveredEntityId = null;
  }

  /**
   * Per-frame update: project each label's world anchor to screen
   * coordinates and position the DOM node. Hides labels behind
   * the camera (ndc.z > 1). Cost is O(labels) per frame — at the
   * tens-of-labels scale this is negligible.
   *
   * Call from SceneManager's animation loop after camera updates
   * but before rendering — render order doesn't matter visually
   * since this writes DOM, not the canvas.
   */
  update(camera: THREE.Camera): void {
    const canvas = this.options.canvas;
    const rect = canvas.getBoundingClientRect();
    // Avoid resyncing rect.position every frame — the canvas
    // doesn't move unless the user scrolls or resizes; we trust
    // syncToCanvas() to keep root aligned.

    for (const label of this.labels) {
      this.scratchVec.copy(label.options.worldPos);
      this.scratchVec.project(camera);
      const ndcX = this.scratchVec.x;
      const ndcY = this.scratchVec.y;
      const ndcZ = this.scratchVec.z;

      // Reject if behind the camera or far beyond the far plane.
      // ndc.z is in [-1, 1] for visible; > 1 means behind, < -1 is rare.
      const inFront = ndcZ < 1;

      // Per-label predicate.
      const wanted = inFront &&
        (label.options.visibleIf?.(camera, ndcZ) ?? true);

      if (!wanted) {
        if (label.element.style.display !== "none") {
          label.element.style.opacity = "0";
          // Defer display:none so the fade has time to play out.
          // For prototype simplicity we do it instantly; a real
          // fade-out uses transitionend listener.
          label.element.style.display = "none";
        }
        continue;
      }

      // Project NDC → CSS pixels relative to the canvas.
      const cssX = (ndcX * 0.5 + 0.5) * rect.width;
      const cssY = (-ndcY * 0.5 + 0.5) * rect.height;

      // Position in viewport-space (root is position:fixed; offset
      // by rect.left/top to align with the canvas).
      label.element.style.left = (rect.left + cssX) + "px";
      label.element.style.top = (rect.top + cssY) + "px";

      if (label.element.style.display === "none") {
        label.element.style.display = "block";
        // Trigger fade-in next frame so the opacity transition fires.
        requestAnimationFrame(() => {
          label.element.style.opacity = "1";
        });
      }
    }
  }

  private syncToCanvas(): void {
    const rect = this.options.canvas.getBoundingClientRect();
    // Root is position:fixed inset:0 — labels are absolutely
    // positioned with explicit left/top in viewport coords, so
    // the root's exact box doesn't need to mirror the canvas.
    // We keep this method as a hook for if we later want
    // canvas-aligned clipping.
    void rect;
  }

  /** Number of labels currently registered. Useful for tests. */
  get labelCount(): number {
    return this.labels.size;
  }

  dispose(): void {
    this.clear();
    this.root.remove();
  }
}
