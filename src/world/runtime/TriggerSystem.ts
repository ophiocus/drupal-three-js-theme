// TriggerSystem — per-entity activation surfaces ("trigger pads")
// and the raycaster that resolves pointer events against them.
//
// Each entity in the world owns a CardRecord:
//   - pad: small disc near the cube; the click target
//   - surface: the HtmlSurface painting the entity's default card
//   - bloomed: whether the card is currently surfaced (preview state)
//
// Click a pad → bloom that entity's card (scale up + push toward
// camera). Click empty space → un-bloom whatever's bloomed. Sprint
// 5e formalises this as a Hidden→Bloomed→FullView state machine
// with engine pause and URL coupling; for now bloom is a binary
// scale toggle.
//
// The system listens on the canvas with pointerdown only; hover
// effects come in 5d once the LRU cache is in place to prevent
// hover-thrash from invalidating textures.

import * as THREE from "three";
import type { HtmlSurface } from "./HtmlSurface.js";

/** Per-entity activation record. The world holds an array of these. */
export interface CardRecord {
  entityId: string;
  /** Small disc on the ground; the click target. */
  pad: THREE.Mesh;
  /** The HtmlSurface painting this entity's default card. */
  surface: HtmlSurface;
  /** Resting position of the surface mesh — bloom adds a delta from here. */
  homePosition: THREE.Vector3;
  /** Resting scale of the surface mesh — bloom multiplies this. */
  homeScale: THREE.Vector3;
  bloomed: boolean;
}

export class TriggerSystem {
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly cards: CardRecord[] = [];
  private bloomedRecord: CardRecord | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.Camera,
  ) {
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
  }

  /**
   * Build a trigger pad disc, palette-driven, ready to add to the
   * scene. Returns the mesh; caller adds it to the scene and
   * registers the full record via {@link register}.
   */
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

  register(record: CardRecord): void {
    this.cards.push(record);
  }

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private onPointerDown = (event: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    const padMeshes = this.cards.map((c) => c.pad);
    const hits = this.raycaster.intersectObjects(padMeshes, false);
    if (hits.length === 0) {
      // Empty-space click → collapse any bloomed card.
      if (this.bloomedRecord) this.collapse(this.bloomedRecord);
      return;
    }
    const hitPad = hits[0].object as THREE.Mesh;
    const record = this.cards.find((c) => c.pad === hitPad);
    if (!record) return;

    if (record.bloomed) {
      this.collapse(record);
      return;
    }
    // Single-bloom invariant: only one card surfaced at a time.
    if (this.bloomedRecord && this.bloomedRecord !== record) {
      this.collapse(this.bloomedRecord);
    }
    this.bloom(record);
  };

  private bloom(record: CardRecord): void {
    // Push the surface toward the camera by a fixed world distance
    // and scale it up. Visual upgrade (smooth tween, hover affordance)
    // is Sprint 5d/5e territory.
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    const offset = camDir.clone().multiplyScalar(-15); // toward camera
    record.surface.mesh.position.copy(record.homePosition).add(offset);
    record.surface.mesh.scale.copy(record.homeScale).multiplyScalar(1.8);
    record.surface.mesh.lookAt(this.camera.position);
    record.bloomed = true;
    this.bloomedRecord = record;
  }

  private collapse(record: CardRecord): void {
    record.surface.mesh.position.copy(record.homePosition);
    record.surface.mesh.scale.copy(record.homeScale);
    record.surface.mesh.lookAt(0, record.homePosition.y, 0);
    record.bloomed = false;
    if (this.bloomedRecord === record) this.bloomedRecord = null;
  }
}
