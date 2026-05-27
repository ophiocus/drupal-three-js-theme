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
import type { SurrealZodiac, ZodiacPlacement } from "../atmospheres/inner-mind/zodiac.js";

const STORAGE_KEY = "world.stage.placements.v0";
const ANGLE_SENSITIVITY = 0.005;   // rad per pixel of horizontal drag
const HEIGHT_SENSITIVITY = 0.5;    // y units per pixel of vertical drag (inverted)

interface StageEditorOptions {
  zodiac: SurrealZodiac;
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
}

export class StageEditor {
  private readonly zodiac: SurrealZodiac;
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: THREE.Camera;

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
    b.textContent = "EDIT STAGE";
    b.title = "Toggle the in-canvas stage editor";
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
    const body = this.selectedIdx === null
      ? `<b>Stage editor</b>
         <p style="margin:8px 0 0;opacity:0.75;font-size:12px;line-height:1.45;">
           Click a numbered marker to select a sign.<br>
           Drag the marker: horizontal → angle, vertical → height.
         </p>`
      : (() => {
          const p = this.zodiac.getPlacement(this.selectedIdx!);
          return `<b>Sign ${this.selectedIdx! + 1}</b>
            <p style="margin:6px 0 0;opacity:0.75;font-size:11px;line-height:1.4;">
              Drag the marker: horizontal → angle, vertical → height.
            </p>
            <div style="margin-top:10px;font-variant-numeric:tabular-nums;font-size:12px;line-height:1.6;">
              <div>angle &nbsp;<b>${p.angle.toFixed(2)}</b> rad</div>
              <div>height <b>${p.height.toFixed(1)}</b> units</div>
              <div>scale &nbsp;<b>${p.scale.toFixed(1)}</b></div>
            </div>`;
        })();
    const actions = `
      <div style="margin-top:14px;display:flex;gap:8px;">
        ${this.selectedIdx !== null
          ? `<button data-act="deselect" style="flex:0 0 auto;padding:6px 10px;border:0;border-radius:4px;background:rgba(255,255,255,0.08);color:#fff;cursor:pointer;font:500 11px/1 system-ui,sans-serif;text-transform:uppercase;letter-spacing:0.04em;">Deselect</button>`
          : ""}
        <button data-act="save" style="flex:1;padding:8px 12px;border:0;border-radius:4px;background:rgba(240,232,200,0.92);color:#1d2230;cursor:pointer;font:600 12px/1 system-ui,sans-serif;text-transform:uppercase;letter-spacing:0.06em;">Save</button>
      </div>`;
    this.panel.innerHTML = body + actions;
    this.panel.querySelector('[data-act="save"]')?.addEventListener("click", () => this.save());
    this.panel.querySelector('[data-act="deselect"]')?.addEventListener("click", () => {
      this.clearSelection();
      this.renderPanel();
    });
  }

  private save(): void {
    const placements: Array<Pick<ZodiacPlacement, "angle" | "height" | "scale">> = [];
    for (let i = 0; i < this.zodiac.signCount; i++) {
      const p = this.zodiac.getPlacement(i);
      placements.push({ angle: p.angle, height: p.height, scale: p.scale });
    }
    const blob = { version: 0, atmosphere: "inner-mind", zodiac: placements };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
    } catch {
      /* private browsing / quota — preview still works */
    }
    console.log(
      "[stage] saved (the JSON a future PATCH /world/edit/stage will accept):",
      blob,
    );
    // Brief visual confirmation on the toggle.
    const original = this.toggleBtn.textContent;
    this.toggleBtn.textContent = "SAVED ✓";
    setTimeout(() => { this.toggleBtn.textContent = original; }, 1200);
  }

  private loadSaved(): void {
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
      if (!Array.isArray(placements)) return;
      const n = Math.min(placements.length, this.zodiac.signCount);
      for (let i = 0; i < n; i++) {
        const p = placements[i] as { angle?: unknown; height?: unknown; scale?: unknown };
        const partial: Partial<{ angle: number; height: number; scale: number }> = {};
        if (typeof p.angle === "number") partial.angle = p.angle;
        if (typeof p.height === "number") partial.height = p.height;
        if (typeof p.scale === "number") partial.scale = p.scale;
        this.zodiac.setPlacement(i, partial);
      }
    } catch {
      /* corrupted blob — ignore */
    }
  }
}
