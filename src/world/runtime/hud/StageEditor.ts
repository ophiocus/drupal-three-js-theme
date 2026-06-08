// StageEditor — Phase 2 v0 of docs/TOOLBOX_AND_STAGE.md.
//
// In-canvas placement editor for the inner-mind's surreal zodiac. An
// "EDIT STAGE" toggle in the top-right corner reveals: (a) a screen-
// space marker over each sign that tracks its world position per frame,
// (b) a small right-rail panel with the selected sign's placement, and
// (c) a Save action that writes the placements to localStorage (and
// console.log's the JSON manifest a future PATCH /world/edit/stage
// endpoint will accept — Drupal persistence is the documented next
// slice).
//
// Interactions:
//   - click a marker → select that sign (highlight).
//   - drag the marker → horizontal Δ changes its ring angle; vertical
//     Δ changes its height. Live preview by mutating the zodiac.
//   - Save → JSON to localStorage + console.
//
// Disposal: full DOM teardown on dispose(). The editor's lifecycle is
// owned by the inner-mind env (SceneManager wires it through the
// atmosphere disposers), so a switch to forest tears it down with the
// rest of the atmosphere chrome.

import * as THREE from "../../../toolbox/three.js";
import type { CorpusSnapshot } from "../../types.js";
import type { SurrealZodiac, ZodiacPlacement } from "../atmospheres/inner-mind/zodiac.js";
import { listAtmosphereKeys } from "../atmospheres/registry.js";
import { type Lang, t } from "./i18n.js";

const STORAGE_KEY = "world.stage.placements.v0";
const ANGLE_SENSITIVITY = 0.005;   // rad per pixel of horizontal drag
const HEIGHT_SENSITIVITY = 0.5;    // y units per pixel of vertical drag (inverted)

/** Choices the Phase 3 v2 "default atmosphere" dropdown offers — every
 *  registered atmosphere plus a leading `none` (the no-atmosphere
 *  default world). Derived from the registry so a 3rd / 4th / Nth
 *  atmosphere extends the dropdown automatically. The server validates
 *  against its own ALLOWED_ATMOSPHERES list, so this is just UX. */
function atmosphereChoices(): readonly string[] {
  return ["none", ...listAtmosphereKeys()];
}

/**
 * The freshness summary the panel renders (Phase 3 v0). Sourced from the
 * snapshot (corpus + signatures) and the new `world.lastEmbed` state
 * the drush command stamps. Drives the "is my world stale?" answer.
 */
interface WorldFreshness {
  activeAtmosphere: string;
  totalEntities: number;
  embeddedCount: number;
  modelVersion: string | null;
  lastEmbedAt: number | null;    // unix seconds
  lastEmbedModel: string | null;
}

/** Phase 3 v2.1 — the effective palette tints the color pickers seed
 *  themselves with. These are the *post-overlay* values from the
 *  active atmosphere (or the base palette when active is `none`); the
 *  scope-aware logic lives on the server. SceneManager reads them off
 *  the palette object it already adapts from the snapshot. */
export interface StageEditorTints {
  background: string;
  fogColor: string;
  groundColor: string;
}

/** Phase 3 v3 — one anchored axis as the panel edits it. Matches the
 *  snapshot's `world.interpretation.axes[]` shape (server-side defined
 *  in WorldInterpretationEditor). */
interface InterpretationAxis {
  name: string;
  pole_a: string;
  pole_b: string;
}

interface StageEditorOptions {
  zodiac: SurrealZodiac;
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  /** Phase 3 v0: read by the World freshness panel section. */
  snapshot: CorpusSnapshot;
  /** Active atmosphere key (snapshot's `world.palette.activeAtmosphere`
   *  isn't on the adapted snapshot type — SceneManager passes it through). */
  activeAtmosphere: string;
  /** Phase 3 v2.1: initial color-picker values. Optional — when omitted,
   *  the pickers are not rendered (older callers stay UI-compatible). */
  paletteTints?: StageEditorTints;
  /** Phase 3 v1: invoked after the admin Re-embed POST succeeds, so
   *  the panel + scene re-read the fresh snapshot (SceneManager wires
   *  this to switchAtmosphere — re-fetch + rebuild). Optional so the
   *  editor still works in contexts without a refresh path. */
  onRefresh?: () => Promise<void>;
  /** Overdrive polish: UI language. Falls back to English when omitted
   *  so legacy callers keep working. */
  lang?: Lang;
}

export class StageEditor {
  private readonly zodiac: SurrealZodiac;
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: THREE.Camera;
  private readonly snapshot: CorpusSnapshot;
  private readonly activeAtmosphere: string;
  private readonly onRefresh: (() => Promise<void>) | null;
  private readonly lang: Lang;
  private reEmbedding = false;
  /** Phase 3 v2: which atmosphere the dropdown is currently *pointing at*.
   *  Initialized to the snapshot's effective atmosphere and updated on
   *  dropdown change; SAVE pushes it to the server. */
  private pendingAtmosphere: string;
  /** Phase 3 v2: true while a PATCH /world/edit/config is in flight. */
  private savingConfig = false;
  /** Phase 3 v2: human-readable status flashed beside the dropdown. */
  private configStatus: string | null = null;
  /** Phase 3 v2.1: effective tint values at panel mount. Null when the
   *  caller didn't provide them — pickers stay hidden in that case. */
  private readonly initialTints: StageEditorTints | null;
  /** Phase 3 v2.1: tint picker state (what the user has dialed in). */
  private pendingTints: StageEditorTints | null;
  /** Phase 3 v3: snapshot of the active atmosphere's interpretation axes at
   *  mount (canonical for dirty-check). Null when the active atmosphere has
   *  no profile (none, forest). */
  private readonly initialAxes: ReadonlyArray<InterpretationAxis> | null;
  /** Phase 3 v3: editable copy of the axes. */
  private pendingAxes: InterpretationAxis[] | null;
  /** Phase 3 v3: which axis is currently being edited in the panel. */
  private selectedAxisIdx = 0;
  /** Phase 3 v3: true while a PATCH /world/edit/interpretation is in flight. */
  private savingInterpretation = false;
  /** Phase 3 v3: human-readable status flashed beside the interpretation save. */
  private interpretationStatus: string | null = null;

  private readonly toggleBtn: HTMLButtonElement;
  private readonly panel: HTMLDivElement;
  private readonly markersRoot: HTMLDivElement;
  private readonly markers: HTMLDivElement[] = [];

  private editMode = false;
  private selectedIdx: number | null = null;
  private dragging = false;
  private dragStart = { x: 0, y: 0 };
  private dragBase: ZodiacPlacement | null = null;
  private dragPointerId = -1;
  private readonly scratchVec = new THREE.Vector3();

  constructor(options: StageEditorOptions) {
    this.zodiac = options.zodiac;
    this.canvas = options.canvas;
    this.camera = options.camera;
    this.snapshot = options.snapshot;
    this.activeAtmosphere = options.activeAtmosphere;
    this.onRefresh = options.onRefresh ?? null;
    this.lang = options.lang ?? "en";
    this.pendingAtmosphere = options.activeAtmosphere;
    this.initialTints = options.paletteTints ?? null;
    this.pendingTints = options.paletteTints ? { ...options.paletteTints } : null;
    // Phase 3 v3: read interpretation axes directly off the snapshot.
    // Present only when the active atmosphere has a server-side profile.
    const interp = this.snapshot.world.interpretation;
    if (interp && Array.isArray(interp.axes) && interp.axes.length > 0) {
      this.initialAxes = interp.axes.map((a) => ({ ...a }));
      this.pendingAxes = interp.axes.map((a) => ({ ...a }));
    } else {
      this.initialAxes = null;
      this.pendingAxes = null;
    }

    this.toggleBtn = this.buildToggleBtn();
    document.body.appendChild(this.toggleBtn);

    this.panel = this.buildPanel();
    document.body.appendChild(this.panel);

    this.markersRoot = this.buildMarkersRoot();
    for (let i = 0; i < this.zodiac.signCount; i++) {
      const m = this.buildMarker(i);
      this.markers.push(m);
      this.markersRoot.appendChild(m);
    }
    document.body.appendChild(this.markersRoot);

    // Apply any previously-saved placements so a reload preserves edits.
    this.loadSaved();
  }

  /** Per-frame projection: keep markers glued to their sign positions. */
  update(): void {
    if (!this.editMode) return;
    const rect = this.canvas.getBoundingClientRect();
    for (let i = 0; i < this.markers.length; i++) {
      const m = this.markers[i]!;
      const pos = this.zodiac.getSignWorldPos(i, this.scratchVec);
      pos.project(this.camera);
      const inFront = pos.z < 1;
      if (!inFront) {
        if (m.style.display !== "none") m.style.display = "none";
        continue;
      }
      const cssX = rect.left + (pos.x * 0.5 + 0.5) * rect.width;
      const cssY = rect.top + (-pos.y * 0.5 + 0.5) * rect.height;
      m.style.left = cssX + "px";
      m.style.top = cssY + "px";
      if (m.style.display === "none") m.style.display = "flex";
    }
  }

  dispose(): void {
    this.toggleBtn.remove();
    this.panel.remove();
    this.markersRoot.remove();
  }

  // ─── UI construction ───────────────────────────────────────────────────────

  private buildToggleBtn(): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = t(this.lang, "stage.toggle.label");
    b.title = t(this.lang, "stage.toggle.title");
    b.style.cssText = [
      "position:fixed", "top:18px", "right:18px", "z-index:200",
      "padding:6px 14px", "border:0", "border-radius:999px",
      "background:rgba(20,30,30,0.6)",
      "backdrop-filter:blur(8px)", "-webkit-backdrop-filter:blur(8px)",
      "color:rgba(240,240,235,0.7)",
      "font:500 12px/1 system-ui,-apple-system,sans-serif",
      "letter-spacing:0.04em", "text-transform:uppercase",
      "cursor:pointer", "transition:background 160ms,color 160ms",
      "pointer-events:auto", "user-select:none",
      "box-shadow:0 2px 12px rgba(0,0,0,0.25)",
    ].join(";");
    b.addEventListener("click", () => this.setEditMode(!this.editMode));
    return b;
  }

  private buildPanel(): HTMLDivElement {
    const p = document.createElement("div");
    p.className = "stage-editor-panel";
    p.style.cssText = [
      "position:fixed", "top:60px", "right:18px", "z-index:200",
      "width:240px", "padding:14px", "border-radius:8px",
      "background:rgba(20,30,30,0.7)",
      "backdrop-filter:blur(8px)", "-webkit-backdrop-filter:blur(8px)",
      "color:rgba(240,240,235,0.92)",
      "font:13px/1.45 system-ui,-apple-system,sans-serif",
      "display:none", "pointer-events:auto", "user-select:none",
      "box-shadow:0 2px 12px rgba(0,0,0,0.25)",
    ].join(";");
    return p;
  }

  private buildMarkersRoot(): HTMLDivElement {
    const r = document.createElement("div");
    r.className = "stage-editor-markers";
    r.style.cssText = "position:fixed;inset:0;z-index:150;pointer-events:none;display:none";
    return r;
  }

  private buildMarker(idx: number): HTMLDivElement {
    const m = document.createElement("div");
    m.className = "stage-editor-marker";
    m.dataset.signIdx = String(idx);
    m.textContent = String(idx + 1);
    m.style.cssText = [
      "position:absolute", "transform:translate(-50%,-50%)",
      "width:28px", "height:28px", "border-radius:50%",
      "background:rgba(255,255,255,0.18)",
      "border:1.5px solid rgba(255,255,255,0.7)",
      "color:#fff",
      "font:600 11px/1 system-ui,sans-serif",
      "display:none", "align-items:center", "justify-content:center",
      "cursor:grab", "pointer-events:auto", "user-select:none",
      "touch-action:none",
      "box-shadow:0 0 0 0 rgba(255,255,255,0)",
      "transition:box-shadow 200ms, background 200ms",
    ].join(";");
    m.addEventListener("pointerdown", (e) => this.onPointerDown(e, idx));
    return m;
  }

  // ─── Edit-mode + selection ─────────────────────────────────────────────────

  private setEditMode(on: boolean): void {
    this.editMode = on;
    if (on) {
      this.toggleBtn.style.background = "rgba(240,232,200,0.92)";
      this.toggleBtn.style.color = "#1d2230";
      this.markersRoot.style.display = "block";
      this.panel.style.display = "block";
      this.renderPanel();
    } else {
      this.toggleBtn.style.background = "rgba(20,30,30,0.6)";
      this.toggleBtn.style.color = "rgba(240,240,235,0.7)";
      this.markersRoot.style.display = "none";
      this.panel.style.display = "none";
      this.clearSelection();
    }
  }

  private selectSign(idx: number): void {
    if (this.selectedIdx !== null) {
      const prev = this.markers[this.selectedIdx];
      if (prev) prev.style.boxShadow = "0 0 0 0 rgba(255,255,255,0)";
    }
    this.selectedIdx = idx;
    const m = this.markers[idx];
    if (m) m.style.boxShadow = "0 0 0 6px rgba(255,255,255,0.35)";
    this.renderPanel();
  }

  private clearSelection(): void {
    if (this.selectedIdx !== null) {
      const m = this.markers[this.selectedIdx];
      if (m) m.style.boxShadow = "0 0 0 0 rgba(255,255,255,0)";
      this.selectedIdx = null;
    }
  }

  // ─── Drag → placement edit ─────────────────────────────────────────────────

  private onPointerDown(e: PointerEvent, idx: number): void {
    e.preventDefault();
    e.stopPropagation();
    this.selectSign(idx);
    this.dragging = true;
    this.dragStart = { x: e.clientX, y: e.clientY };
    this.dragBase = this.zodiac.getPlacement(idx);
    this.dragPointerId = e.pointerId;
    const t = e.currentTarget as HTMLElement;
    t.setPointerCapture(e.pointerId);
    t.style.cursor = "grabbing";
    t.addEventListener("pointermove", this.onPointerMove);
    t.addEventListener("pointerup", this.onPointerUp);
    t.addEventListener("pointercancel", this.onPointerUp);
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging || this.selectedIdx === null || !this.dragBase) return;
    const dx = e.clientX - this.dragStart.x;
    const dy = e.clientY - this.dragStart.y;
    this.zodiac.setPlacement(this.selectedIdx, {
      angle: this.dragBase.angle - dx * ANGLE_SENSITIVITY,
      height: this.dragBase.height - dy * HEIGHT_SENSITIVITY,
    });
    this.renderPanel();
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragging = false;
    this.dragBase = null;
    const t = e.currentTarget as HTMLElement;
    try { t.releasePointerCapture(this.dragPointerId); } catch { /* already released */ }
    t.style.cursor = "grab";
    t.removeEventListener("pointermove", this.onPointerMove);
    t.removeEventListener("pointerup", this.onPointerUp);
    t.removeEventListener("pointercancel", this.onPointerUp);
  };

  // ─── Panel + save/load ─────────────────────────────────────────────────────

  private renderPanel(): void {
    if (!this.editMode) return;
    const worldSection = this.renderWorldSection();
    const interpretationSection = this.renderInterpretationSection();
    const signSection = this.selectedIdx === null
      ? `<div style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.08);">
           <b>${escapeHtml(t(this.lang, "stage.sign.heading.empty"))}</b>
           <p style="margin:6px 0 0;opacity:0.75;font-size:12px;line-height:1.45;">
             ${t(this.lang, "stage.sign.empty.hint")}
           </p>
         </div>`
      : (() => {
          const p = this.zodiac.getPlacement(this.selectedIdx!);
          return `<div style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.08);">
            <b>${escapeHtml(t(this.lang, "stage.sign.heading", {n: this.selectedIdx! + 1}))}</b>
            <p style="margin:6px 0 0;opacity:0.75;font-size:11px;line-height:1.4;">
              ${escapeHtml(t(this.lang, "stage.sign.hint"))}
            </p>
            <div style="margin-top:10px;font-variant-numeric:tabular-nums;font-size:12px;line-height:1.6;">
              <div>${escapeHtml(t(this.lang, "stage.sign.angle"))} &nbsp;<b>${p.angle.toFixed(2)}</b> ${escapeHtml(t(this.lang, "stage.sign.angle.unit"))}</div>
              <div>${escapeHtml(t(this.lang, "stage.sign.height"))} <b>${p.height.toFixed(1)}</b> ${escapeHtml(t(this.lang, "stage.sign.height.unit"))}</div>
              <div>${escapeHtml(t(this.lang, "stage.sign.scale"))} &nbsp;<b>${p.scale.toFixed(1)}</b></div>
            </div>
          </div>`;
        })();
    const actions = `
      <div style="margin-top:14px;display:flex;gap:8px;">
        ${this.selectedIdx !== null
          ? `<button data-act="deselect" style="flex:0 0 auto;padding:6px 10px;border:0;border-radius:4px;background:rgba(255,255,255,0.08);color:#fff;cursor:pointer;font:500 11px/1 system-ui,sans-serif;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(t(this.lang, "stage.sign.deselect"))}</button>`
          : ""}
        <button data-act="save" style="flex:1;padding:8px 12px;border:0;border-radius:4px;background:rgba(240,232,200,0.92);color:#1d2230;cursor:pointer;font:600 12px/1 system-ui,sans-serif;text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(t(this.lang, "stage.sign.save"))}</button>
      </div>`;
    this.panel.innerHTML = worldSection + interpretationSection + signSection + actions;
    this.panel.querySelector('[data-act="save"]')?.addEventListener("click", () => this.save());
    this.panel.querySelector('[data-act="deselect"]')?.addEventListener("click", () => {
      this.clearSelection();
      this.renderPanel();
    });
    this.panel.querySelector('[data-act="reembed"]')?.addEventListener("click", () => {
      void this.reEmbed();
    });
    // Phase 3 v2 — default-atmosphere dropdown + save.
    const sel = this.panel.querySelector('[data-act="atmosphere-select"]') as HTMLSelectElement | null;
    if (sel) {
      sel.addEventListener("change", () => {
        this.pendingAtmosphere = sel.value;
        this.configStatus = null;
        this.renderPanel();
      });
    }
    this.panel.querySelector('[data-act="save-config"]')?.addEventListener("click", () => {
      void this.saveConfig();
    });
    // Phase 3 v2.1 — tint pickers. Each input change updates the pending
    // value and re-renders. (innerHTML wipes/rebinds listeners on each
    // render — fine for this small surface; the alternative would be
    // surgical DOM updates.)
    (["background", "fogColor", "groundColor"] as const).forEach((key) => {
      const sel = this.panel.querySelector(`[data-tint="${key}"]`) as HTMLInputElement | null;
      if (sel) {
        sel.addEventListener("input", () => {
          if (!this.pendingTints) return;
          this.pendingTints[key] = sel.value;
          this.configStatus = null;
          this.renderPanel();
        });
      }
    });
    // Phase 3 v3 — axis selector + per-field text inputs + save button.
    const axisSel = this.panel.querySelector('[data-act="axis-select"]') as HTMLSelectElement | null;
    if (axisSel) {
      axisSel.addEventListener("change", () => {
        this.selectedAxisIdx = Number(axisSel.value);
        this.interpretationStatus = null;
        this.renderPanel();
      });
    }
    (["name", "pole_a", "pole_b"] as const).forEach((field) => {
      const inp = this.panel.querySelector(`[data-axis-field="${field}"]`) as HTMLInputElement | HTMLTextAreaElement | null;
      if (inp) {
        inp.addEventListener("input", () => {
          if (!this.pendingAxes) return;
          const idx = this.selectedAxisIdx;
          const cur = this.pendingAxes[idx];
          if (!cur) return;
          cur[field] = inp.value;
          this.interpretationStatus = null;
          // Avoid full re-render on every keystroke (text inputs lose
          // focus). Only update the dirty-indicator class on the save
          // button; defer the bigger re-render to blur.
          const btn = this.panel.querySelector('[data-act="save-interp"]') as HTMLButtonElement | null;
          if (btn) {
            const dirty = this.interpretationDirty();
            btn.disabled = !dirty || this.savingInterpretation;
            btn.style.opacity = dirty && !this.savingInterpretation ? "1" : "0.5";
          }
        });
      }
    });
    this.panel.querySelector('[data-act="save-interp"]')?.addEventListener("click", () => {
      void this.saveInterpretation();
    });
  }

  /** Phase 3 v0 freshness section + Phase 3 v2 default-atmosphere
   *  editor — see docs/TOOLBOX_AND_STAGE.md §2. */
  private renderWorldSection(): string {
    const ents = Object.values(this.snapshot.entities);
    const total = ents.length;
    const embedded = ents.filter((e) => {
      const v = e.signature?.semantic?.embedding;
      return Array.isArray(v) && v.length > 0;
    }).length;
    const allEmbedded = total > 0 && embedded === total;
    const le = this.snapshot.world.lastEmbed ?? null;
    const ago = le?.at ? this.formatTimeAgo(le.at) : "—";
    const model = le?.modelVersion ?? "—";
    const atmosphereDirty = this.pendingAtmosphere !== this.activeAtmosphere;
    const tintsDirty = this.tintsDirty();
    const dirty = atmosphereDirty || tintsDirty;
    const options = atmosphereChoices().map((a) => {
      const selected = a === this.pendingAtmosphere ? " selected" : "";
      return `<option value="${escapeHtml(a)}"${selected}>${escapeHtml(a)}</option>`;
    }).join("");
    const statusLine = this.configStatus
      ? `<div style="margin-top:6px;font-size:10.5px;opacity:0.75;">${escapeHtml(this.configStatus)}</div>`
      : "";
    const tintsSection = this.pendingTints ? this.renderTintsSection() : "";
    const tintScopeHint = this.pendingTints
      ? (this.pendingAtmosphere === "none"
          ? `<div style="margin-top:2px;opacity:0.55;font-size:10px;">${escapeHtml(t(this.lang, "stage.world.tints.scope.base"))}</div>`
          : `<div style="margin-top:2px;opacity:0.55;font-size:10px;">${escapeHtml(t(this.lang, "stage.world.tints.scope.overlay", {atmosphere: this.pendingAtmosphere}))}</div>`)
      : "";
    return `
      <b>${escapeHtml(t(this.lang, "stage.world.heading"))}</b>
      <div style="margin-top:8px;font-variant-numeric:tabular-nums;font-size:12px;line-height:1.55;">
        <div style="opacity:0.75;">${escapeHtml(t(this.lang, "stage.world.atmosphere.label"))}</div>
        <div style="margin-bottom:4px;display:flex;gap:6px;align-items:center;">
          <select data-act="atmosphere-select"
            style="flex:1;padding:4px 6px;border:1px solid rgba(255,255,255,0.18);
                   border-radius:4px;background:rgba(0,0,0,0.25);color:#fff;
                   font:600 12px/1.2 system-ui,-apple-system,sans-serif;">
            ${options}
          </select>
          <button data-act="save-config"
            ${(!dirty || this.savingConfig) ? "disabled" : ""}
            style="flex:0 0 auto;padding:6px 10px;border:0;border-radius:4px;
                   background:${dirty && !this.savingConfig ? "rgba(240,232,200,0.92)" : "rgba(255,255,255,0.08)"};
                   color:${dirty && !this.savingConfig ? "#1d2230" : "rgba(255,255,255,0.5)"};
                   cursor:${dirty && !this.savingConfig ? "pointer" : "not-allowed"};
                   font:600 10.5px/1 system-ui,sans-serif;text-transform:uppercase;
                   letter-spacing:0.06em;">
            ${this.savingConfig ? "…" : escapeHtml(t(this.lang, "stage.world.atmosphere.save"))}
          </button>
        </div>
        ${tintsSection}
        ${tintScopeHint}
        ${statusLine}
        <div style="opacity:0.75;margin-top:6px;">${escapeHtml(t(this.lang, "stage.world.embedded.label"))}</div>
        <div style="margin-bottom:6px;">
          <b style="color:${allEmbedded ? "rgba(180,235,180,1)" : "rgba(255,200,120,1)"};">${embedded} / ${total}</b>
          ${allEmbedded ? "" : `&nbsp;<span style="opacity:0.6;">${escapeHtml(t(this.lang, "stage.world.embedded.stale"))}</span>`}
        </div>
        <div style="opacity:0.75;">${escapeHtml(t(this.lang, "stage.world.model"))}</div>
        <div style="margin-bottom:6px;font-size:11px;"><b>${escapeHtml(model)}</b></div>
        <div style="opacity:0.75;">${escapeHtml(t(this.lang, "stage.world.lastembed"))}</div>
        <div style="font-size:11px;"><b>${ago}</b></div>
      </div>
      <button data-act="reembed" ${this.reEmbedding ? "disabled" : ""}
        style="margin-top:10px;width:100%;padding:8px 12px;border:0;border-radius:4px;
               background:${this.reEmbedding
                  ? "rgba(255,255,255,0.08)"
                  : (this.polesStale() ? "rgba(255,170,80,0.95)" : "rgba(160,210,255,0.85)")};
               color:${this.reEmbedding ? "rgba(255,255,255,0.5)" : "#0e1a28"};
               cursor:${this.reEmbedding ? "wait" : "pointer"};
               font:600 11px/1 system-ui,-apple-system,sans-serif;
               text-transform:uppercase;letter-spacing:0.06em;
               box-shadow:${this.polesStale() && !this.reEmbedding ? "0 0 0 2px rgba(255,170,80,0.35)" : "none"};
               transition:background 200ms,color 200ms,box-shadow 200ms;">
        ${this.reEmbedding
            ? escapeHtml(t(this.lang, "stage.world.reembed.busy"))
            : (this.polesStale()
                ? escapeHtml(t(this.lang, "stage.world.reembed.stale"))
                : escapeHtml(t(this.lang, "stage.world.reembed")))}
      </button>
      <p style="margin:6px 0 0;opacity:0.55;font-size:10.5px;line-height:1.4;">
        ${escapeHtml(t(this.lang, "stage.world.reembed.help"))}
      </p>`;
  }

  /** Phase 3 v1 — POST /world/admin/embed, then re-fetch via SceneManager. */
  private async reEmbed(): Promise<void> {
    if (this.reEmbedding) return;
    this.reEmbedding = true;
    this.renderPanel();
    let ok = false;
    let message = "";
    try {
      const r = await fetch("/world/admin/embed", {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (r.status === 401 || r.status === 403) {
        message = t(this.lang, "status.auth.failed");
      } else if (!r.ok) {
        const body = await r.text().catch(() => "");
        message = `HTTP ${r.status} ${body.slice(0, 80)}`;
      } else {
        const body = (await r.json()) as { embedded?: number; errors?: number };
        message = `embedded ${body.embedded ?? "?"}, ${body.errors ?? 0} errors`;
        ok = true;
      }
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    console.log(`[stage] re-embed: ${ok ? "ok" : "fail"} — ${message}`);
    if (ok && this.onRefresh) {
      // Re-fetch the snapshot via SceneManager — the rebuild will
      // construct a fresh StageEditor with the updated lastEmbed; this
      // instance gets disposed mid-await, so no further UI updates.
      try { await this.onRefresh(); } catch { /* swallow */ }
      return;
    }
    // Failure path: show the error briefly in the button.
    this.reEmbedding = false;
    this.renderPanel();
    const btn = this.panel.querySelector('[data-act="reembed"]') as HTMLButtonElement | null;
    if (btn) {
      const original = btn.textContent;
      btn.textContent = "FAILED — see console";
      btn.style.background = "rgba(255,150,150,0.85)";
      setTimeout(() => {
        if (btn.isConnected) {
          btn.textContent = original;
          btn.style.background = "rgba(160,210,255,0.85)";
        }
      }, 2400);
    }
  }

  /** Phase 3 v2.1 — Are the tint pickers dirty vs. the initial values? */
  private tintsDirty(): boolean {
    if (!this.pendingTints || !this.initialTints) return false;
    return this.pendingTints.background !== this.initialTints.background
      || this.pendingTints.fogColor !== this.initialTints.fogColor
      || this.pendingTints.groundColor !== this.initialTints.groundColor;
  }

  /** Phase 3 v2.1 — render the 3 color picker inputs. */
  private renderTintsSection(): string {
    if (!this.pendingTints) return "";
    const t_pending = this.pendingTints;
    const row = (label: string, dataKey: string, value: string) => `
      <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
        <span style="flex:1;opacity:0.75;font-size:11.5px;">${escapeHtml(label)}</span>
        <input type="color" data-tint="${dataKey}" value="${escapeHtml(value)}"
          style="width:38px;height:22px;border:1px solid rgba(255,255,255,0.18);
                 border-radius:3px;background:transparent;padding:0;cursor:pointer;">
        <code style="font-size:10.5px;opacity:0.6;letter-spacing:0.02em;">${escapeHtml(value)}</code>
      </div>`;
    return `
      <div style="margin-top:8px;padding-top:6px;border-top:1px dashed rgba(255,255,255,0.08);">
        ${row(t(this.lang, "stage.world.tints.background"), "background", t_pending.background)}
        ${row(t(this.lang, "stage.world.tints.fog"),        "fogColor",   t_pending.fogColor)}
        ${row(t(this.lang, "stage.world.tints.ground"),     "groundColor",t_pending.groundColor)}
      </div>`;
  }

  /** Phase 3 v2 (+ v2.1 tints) — PATCH /world/edit/config with the dirty
   *  fields (active_atmosphere + tints), then re-fetch via SceneManager.
   *  The rebuild in onRefresh re-instantiates StageEditor against the
   *  fresh snapshot, so this instance gets disposed mid-await. */
  private async saveConfig(): Promise<void> {
    if (this.savingConfig) return;
    const patch: Record<string, string> = {};
    if (this.pendingAtmosphere !== this.activeAtmosphere) {
      patch.active_atmosphere = this.pendingAtmosphere;
    }
    if (this.pendingTints && this.initialTints) {
      if (this.pendingTints.background !== this.initialTints.background) {
        patch.background = this.pendingTints.background;
      }
      if (this.pendingTints.fogColor !== this.initialTints.fogColor) {
        patch["fog.color"] = this.pendingTints.fogColor;
      }
      if (this.pendingTints.groundColor !== this.initialTints.groundColor) {
        patch["ground.color"] = this.pendingTints.groundColor;
      }
    }
    if (Object.keys(patch).length === 0) return;

    this.savingConfig = true;
    this.configStatus = null;
    this.renderPanel();
    let ok = false;
    let message = "";
    try {
      const r = await fetch("/world/edit/config", {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(patch),
      });
      if (r.status === 401 || r.status === 403) {
        message = t(this.lang, "status.auth.failed");
      } else if (!r.ok) {
        const body = await r.text().catch(() => "");
        message = `HTTP ${r.status} ${body.slice(0, 80)}`;
      } else {
        const body = (await r.json()) as { updated?: string[] };
        const updated = body.updated ?? [];
        message = updated.length
          ? t(this.lang, "status.save.ok", {
              count: updated.length,
              keys: t(this.lang, updated.length === 1 ? "status.save.ok.keys.singular" : "status.save.ok.keys.plural"),
            })
          : t(this.lang, "status.save.nochange");
        ok = true;
      }
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    console.log(`[stage] save config: ${ok ? "ok" : "fail"} — ${message}`, patch);
    if (ok && this.onRefresh) {
      try { await this.onRefresh(); } catch { /* swallow */ }
      return;
    }
    this.savingConfig = false;
    this.configStatus = message;
    this.renderPanel();
  }

  // ─── Phase 3 v3 — interpretation (anchor poles) ───────────────────────────

  /** Phase 3 v3 polish — are the published axes (interpretation prose)
   *  newer than the embedded axis vectors? When true, a re-embed is
   *  required for the new poles to actually project. */
  private polesStale(): boolean {
    const interp = this.snapshot.world.interpretation;
    const axes = this.snapshot.world.interpretationAxes;
    if (!interp || !interp.updatedAt) return false;
    if (!axes) return interp.updatedAt > 0;   // poles authored, never embedded
    return interp.updatedAt > axes.embeddedAt;
  }

  /** Render the panel section for editing the active atmosphere's
   *  interpretation axes. Returns empty string when the active
   *  atmosphere has no profile (none / forest) — the section silently
   *  hides so the panel stays compact. */
  private renderInterpretationSection(): string {
    if (!this.pendingAxes || this.pendingAxes.length === 0) return "";
    const dirty = this.interpretationDirty();
    const idx = Math.min(this.selectedAxisIdx, this.pendingAxes.length - 1);
    const axis = this.pendingAxes[idx]!;
    const axisOpts = this.pendingAxes.map((a, i) => {
      const selected = i === idx ? " selected" : "";
      return `<option value="${i}"${selected}>${i + 1}. ${escapeHtml(a.name || "(unnamed)")}</option>`;
    }).join("");
    const statusLine = this.interpretationStatus
      ? `<div style="margin-top:6px;font-size:10.5px;opacity:0.75;">${escapeHtml(this.interpretationStatus)}</div>`
      : "";
    const fieldRow = (label: string, field: "name" | "pole_a" | "pole_b", value: string, multiline: boolean) => `
      <div style="margin-top:6px;">
        <div style="opacity:0.6;font-size:10.5px;margin-bottom:2px;">${escapeHtml(label)}</div>
        ${multiline
          ? `<textarea data-axis-field="${field}" rows="2"
              style="width:100%;box-sizing:border-box;padding:4px 6px;
                     border:1px solid rgba(255,255,255,0.18);border-radius:4px;
                     background:rgba(0,0,0,0.25);color:#fff;resize:vertical;
                     font:400 11px/1.4 system-ui,-apple-system,sans-serif;">${escapeHtml(value)}</textarea>`
          : `<input data-axis-field="${field}" type="text" value="${escapeHtml(value)}"
              style="width:100%;box-sizing:border-box;padding:4px 6px;
                     border:1px solid rgba(255,255,255,0.18);border-radius:4px;
                     background:rgba(0,0,0,0.25);color:#fff;
                     font:600 11.5px/1.2 system-ui,-apple-system,sans-serif;">`}
      </div>`;
    const staleBanner = this.polesStale()
      ? `<div style="margin-top:6px;padding:5px 8px;border-radius:4px;
                     background:rgba(255,180,80,0.18);
                     border:1px solid rgba(255,180,80,0.35);
                     color:rgba(255,210,140,0.95);font-size:10.5px;line-height:1.4;">
           ${escapeHtml(t(this.lang, "stage.interpretation.stale"))}
         </div>`
      : "";
    return `
      <div style="margin-top:14px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.08);">
        <b>${escapeHtml(t(this.lang, "stage.interpretation.heading"))}</b>
        <div style="margin-top:6px;opacity:0.6;font-size:10.5px;line-height:1.4;">
          ${escapeHtml(t(this.lang, "stage.interpretation.help"))}
        </div>
        ${staleBanner}
        <div style="margin-top:8px;display:flex;gap:6px;align-items:center;">
          <span style="opacity:0.75;font-size:11.5px;">${escapeHtml(t(this.lang, "stage.interpretation.axis"))}</span>
          <select data-act="axis-select"
            style="flex:1;padding:4px 6px;border:1px solid rgba(255,255,255,0.18);
                   border-radius:4px;background:rgba(0,0,0,0.25);color:#fff;
                   font:600 11.5px/1.2 system-ui,-apple-system,sans-serif;">
            ${axisOpts}
          </select>
        </div>
        ${fieldRow(t(this.lang, "stage.interpretation.field.name"),   "name",   axis.name,   false)}
        ${fieldRow(t(this.lang, "stage.interpretation.field.pole_a"), "pole_a", axis.pole_a, true)}
        ${fieldRow(t(this.lang, "stage.interpretation.field.pole_b"), "pole_b", axis.pole_b, true)}
        <button data-act="save-interp"
          ${(!dirty || this.savingInterpretation) ? "disabled" : ""}
          style="margin-top:8px;width:100%;padding:6px 12px;border:0;border-radius:4px;
                 background:rgba(240,232,200,0.92);color:#1d2230;
                 cursor:${dirty && !this.savingInterpretation ? "pointer" : "not-allowed"};
                 opacity:${dirty && !this.savingInterpretation ? "1" : "0.5"};
                 font:600 11px/1 system-ui,sans-serif;text-transform:uppercase;
                 letter-spacing:0.06em;">
          ${this.savingInterpretation
              ? escapeHtml(t(this.lang, "stage.interpretation.save.busy"))
              : escapeHtml(t(this.lang, "stage.interpretation.save"))}
        </button>
        ${statusLine}
      </div>`;
  }

  /** Are the pending axes different from initial? */
  private interpretationDirty(): boolean {
    if (!this.pendingAxes || !this.initialAxes) return false;
    if (this.pendingAxes.length !== this.initialAxes.length) return true;
    for (let i = 0; i < this.pendingAxes.length; i++) {
      const p = this.pendingAxes[i]!;
      const o = this.initialAxes[i]!;
      if (p.name !== o.name || p.pole_a !== o.pole_a || p.pole_b !== o.pole_b) return true;
    }
    return false;
  }

  /** PATCH /world/edit/interpretation with the dirty axis fields. */
  private async saveInterpretation(): Promise<void> {
    if (this.savingInterpretation) return;
    if (!this.pendingAxes || !this.initialAxes) return;
    // Build a sparse patch — only fields that actually changed.
    const axes: Record<string, Partial<InterpretationAxis>> = {};
    for (let i = 0; i < this.pendingAxes.length; i++) {
      const p = this.pendingAxes[i]!;
      const o = this.initialAxes[i]!;
      const delta: Partial<InterpretationAxis> = {};
      if (p.name !== o.name) delta.name = p.name;
      if (p.pole_a !== o.pole_a) delta.pole_a = p.pole_a;
      if (p.pole_b !== o.pole_b) delta.pole_b = p.pole_b;
      if (Object.keys(delta).length > 0) axes[String(i)] = delta;
    }
    if (Object.keys(axes).length === 0) return;

    this.savingInterpretation = true;
    this.interpretationStatus = null;
    this.renderPanel();
    let ok = false;
    let message = "";
    try {
      const r = await fetch("/world/edit/interpretation", {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ atmosphere: this.activeAtmosphere, axes }),
      });
      if (r.status === 401 || r.status === 403) {
        message = t(this.lang, "status.auth.failed");
      } else if (!r.ok) {
        const body = await r.text().catch(() => "");
        message = `HTTP ${r.status} ${body.slice(0, 80)}`;
      } else {
        const body = (await r.json()) as { updated?: Record<string, string[]> };
        const updated = body.updated ?? {};
        const count = Object.values(updated).reduce((n, fields) => n + fields.length, 0);
        message = count > 0
          ? t(this.lang, "status.save.activate", {
              n: count,
              fields: t(this.lang, count === 1 ? "status.save.fields.singular" : "status.save.fields.plural"),
            })
          : t(this.lang, "status.save.nochange");
        ok = true;
      }
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    console.log(`[stage] save interpretation: ${ok ? "ok" : "fail"} — ${message}`);
    if (ok && this.onRefresh) {
      try { await this.onRefresh(); } catch { /* swallow */ }
      return;
    }
    this.savingInterpretation = false;
    this.interpretationStatus = message;
    this.renderPanel();
  }

  /** Human-readable time-ago for a unix-seconds timestamp,
   *  language-aware via the i18n catalog. */
  private formatTimeAgo(ts: number): string {
    const dt = Math.max(0, Math.floor(Date.now() / 1000 - ts));
    if (dt < 60)    return t(this.lang, "time.seconds", {n: dt});
    if (dt < 3600)  return t(this.lang, "time.minutes", {n: Math.floor(dt / 60)});
    if (dt < 86400) return t(this.lang, "time.hours",   {n: Math.floor(dt / 3600)});
    return t(this.lang, "time.days", {n: Math.floor(dt / 86400)});
  }

  private save(): void {
    const placements: Array<Pick<ZodiacPlacement, "angle" | "height" | "scale">> = [];
    for (let i = 0; i < this.zodiac.signCount; i++) {
      const p = this.zodiac.getPlacement(i);
      placements.push({ angle: p.angle, height: p.height, scale: p.scale });
    }
    // Local-first: always cache to localStorage so a refresh from
    // anonymous (or auth-failed) sessions still preserves the edit.
    const blob = { version: 0, atmosphere: this.activeAtmosphere, zodiac: placements };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
    } catch { /* quota / private browsing */ }
    // Phase 4 — fire-and-forget PATCH /world/edit/stage. Authoritative
    // when the user has the perm; on failure (403, network, etc.)
    // localStorage is the silent fallback.
    void this.publishPlacements(placements);
    const original = this.toggleBtn.textContent;
    this.toggleBtn.textContent = t(this.lang, "stage.save.flash");
    setTimeout(() => { this.toggleBtn.textContent = original; }, 1200);
  }

  private async publishPlacements(
    placements: Array<Pick<ZodiacPlacement, "angle" | "height" | "scale">>,
  ): Promise<void> {
    try {
      const r = await fetch("/world/edit/stage", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          atmosphere: this.activeAtmosphere,
          layer: "zodiac",
          placements,
        }),
      });
      if (r.status === 401 || r.status === 403) {
        console.log("[stage] publish placements: auth failed — kept in localStorage only");
        return;
      }
      if (!r.ok) {
        console.log(`[stage] publish placements: HTTP ${r.status}`);
        return;
      }
      const body = (await r.json()) as { updated?: boolean; count?: number };
      console.log(`[stage] placements published — updated=${body.updated} count=${body.count}`);
    } catch (e) {
      console.log("[stage] publish placements: network error —", e);
    }
  }

  private loadSaved(): void {
    // Phase 4: prefer the snapshot's published placements (canonical,
    // cross-device). Fall back to localStorage when the server has no
    // edits yet for this atmosphere.
    const published = this.snapshot.world.stage?.layers?.zodiac;
    if (Array.isArray(published) && published.length > 0) {
      this.applyPlacementArray(published);
      return;
    }
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const blob = JSON.parse(raw) as { zodiac?: unknown };
      const placements = blob.zodiac;
      if (Array.isArray(placements)) {
        this.applyPlacementArray(placements);
      }
    } catch {
      /* corrupted blob — ignore */
    }
  }

  /** Shared between the snapshot-published path and the localStorage
   *  fallback: copy a placements array onto the live zodiac. */
  private applyPlacementArray(arr: unknown[]): void {
    const n = Math.min(arr.length, this.zodiac.signCount);
    for (let i = 0; i < n; i++) {
      const p = arr[i] as { angle?: unknown; height?: unknown; scale?: unknown };
      const partial: Partial<{ angle: number; height: number; scale: number }> = {};
      if (typeof p.angle === "number") partial.angle = p.angle;
      if (typeof p.height === "number") partial.height = p.height;
      if (typeof p.scale === "number") partial.scale = p.scale;
      this.zodiac.setPlacement(i, partial);
    }
  }
}

/** Minimal HTML escape so untrusted strings (model versions, atmospheres)
 *  rendered into the panel innerHTML can't inject markup. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
