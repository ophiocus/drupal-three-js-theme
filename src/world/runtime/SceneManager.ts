// SceneManager — owns the three.js renderer, scene, camera, and
// the render loop. Reads a corpus snapshot from the cypher's
// /world/snapshot/full endpoint, instantiates one placeholder mesh
// per entity at the position `entityPosition()` derives from sector
// + within-sector hash.
//
// ALPHA scope: cubes only, static camera at the front vantage,
// ambient + directional light. Sprint 5 brings the card runtime,
// trigger pads, sector light shifts, and engine-pause on FullView.

import * as THREE from "three";
import type { CorpusSnapshot, Entity, Vec3 } from "../types.js";
import { entityPosition } from "../layout.js";
import { hasHtmlInCanvas, type HtmlSurface } from "./HtmlSurface.js";
import { SurfaceCache } from "./SurfaceCache.js";
import { CardController, type CardRecord } from "./CardController.js";

interface BootOptions {
  snapshotUrl: string;
  /** Optional override of the starting camera position. */
  cameraPosition?: Vec3;
}

interface DescriptorShape {
  _id: string;
  type: string;
  sector?: string;
  sectorTermIds?: string[];
  signature?: unknown;
}

/**
 * Palette shape — mirrors world_signature.palette config schema
 * (see web/modules/custom/world_signature/config/schema/...). Every
 * color is a CSS hex string the renderer parses with THREE.Color.
 */
interface Palette {
  background: string;
  fog: { color: string; near: number; far: number };
  ambient: { color: string; intensity: number };
  sun: { color: string; intensity: number; position: [number, number, number] };
  fill: { color: string; intensity: number; position: [number, number, number] };
  ground: { color: string };
  sectorPad: { color: string };
  compassPost: { color: string };
  bundleColors: Record<string, string>;
}

/** Hardcoded fallback if a snapshot lands without a palette key. */
const DEFAULT_PALETTE: Palette = {
  background: "#d0dce6",
  fog: { color: "#c8d8e0", near: 80, far: 500 },
  ambient: { color: "#e8efe9", intensity: 0.85 },
  sun: { color: "#fffae0", intensity: 1.3, position: [80, 120, 60] },
  fill: { color: "#a8c4dc", intensity: 0.45, position: [-80, 60, -60] },
  ground: { color: "#c4dec4" },
  sectorPad: { color: "#a4c498" },
  compassPost: { color: "#a8b4c0" },
  bundleColors: {
    article: "#8eb887",
    profile: "#92aabe",
    event: "#d8d098",
    default: "#a8b4b8",
  },
};

/**
 * The renderer's macro-state. exploration = walking the world.
 * reading = card in FullView, engine paused. Card runtime in
 * Sprint 5 wires this to a state machine.
 */
type Mode = "exploration" | "reading";

export class SceneManager {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private snapshot: CorpusSnapshot | null = null;
  private palette: Palette = DEFAULT_PALETTE;
  private mode: Mode = "exploration";
  private readonly htmlSurfaces: HtmlSurface[] = [];
  private readonly surfaceCache = new SurfaceCache();
  private cardController: CardController | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.resize();

    this.scene = new THREE.Scene();
    // Background + fog applied properly once the snapshot's palette
    // arrives in mount(); these defaults prevent a flash before then.
    this.applyPaletteBackground();

    this.camera = new THREE.PerspectiveCamera(
      60,
      this.canvas.clientWidth / this.canvas.clientHeight,
      0.1,
      1000,
    );

    window.addEventListener("resize", () => this.resize());
  }

  /**
   * Boot: fetch snapshot, build the scene, start the render loop.
   * Resolves when the first frame has rendered.
   */
  async mount(options: BootOptions): Promise<void> {
    const response = await fetch(options.snapshotUrl, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`snapshot fetch failed: HTTP ${response.status}`);
    }
    const raw = (await response.json()) as RawSnapshot;
    this.snapshot = this.adaptSnapshot(raw);
    this.palette = (raw.world.palette as Palette) ?? DEFAULT_PALETTE;
    // Cache invalidates atomically when the cypher publishes a new
    // snapshot version. First-mount call is the initial set; no flush.
    this.surfaceCache.setSnapshotVersion(raw.version);

    this.applyPaletteBackground();
    this.addLights();
    this.placeCamera(options.cameraPosition);
    this.cardController = new CardController({
      canvas: this.canvas,
      camera: this.camera,
      surfaceCache: this.surfaceCache,
      setMode: (m) => this.setMode(m),
    });
    await this.placeEntities();
    this.startLoop();
    console.info(
      `[world] mounted: ${Object.keys(this.snapshot.entities).length} entities ` +
        `across ${Object.keys(this.snapshot.sectors).length} sectors, ` +
        `html-surface path: ${hasHtmlInCanvas() ? "HIC (native)" : "html-to-image (bridge)"}`,
    );
  }

  setMode(mode: Mode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === "reading") {
      // Engine pause per ARCHITECTURE §4.3.
      this.renderer.setAnimationLoop(null);
    } else {
      this.startLoop();
    }
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private applyPaletteBackground(): void {
    this.scene.background = new THREE.Color(this.palette.background);
    this.scene.fog = new THREE.Fog(
      this.palette.fog.color,
      this.palette.fog.near,
      this.palette.fog.far,
    );
  }

  private addLights(): void {
    const p = this.palette;

    const ambient = new THREE.AmbientLight(
      new THREE.Color(p.ambient.color),
      p.ambient.intensity,
    );
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(
      new THREE.Color(p.sun.color),
      p.sun.intensity,
    );
    sun.position.set(...p.sun.position);
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(
      new THREE.Color(p.fill.color),
      p.fill.intensity,
    );
    fill.position.set(...p.fill.position);
    this.scene.add(fill);
  }

  private placeCamera(override?: Vec3): void {
    if (!this.snapshot) return;
    const w = this.snapshot.world;
    // ALPHA-friendly closer overview — fits a 1-entity corpus in
    // the frame. Sprint 5's vantage system replaces this with
    // proper URI→camera transitions.
    const pos = override ?? {
      x: 0,
      y: w.overviewHeight * 0.45,
      z: w.overviewHeight * 0.55,
    };
    this.camera.position.set(pos.x, pos.y, pos.z);
    this.camera.lookAt(0, 0, 0);
  }

  private async placeEntities(): Promise<void> {
    if (!this.snapshot) return;
    const p = this.palette;

    // Ground plane — sized to the world. Palette-driven.
    const groundSize = this.snapshot.world.radius * 4;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(groundSize, groundSize, 1, 1),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(p.ground.color),
        roughness: 0.95,
        metalness: 0,
      }),
    );
    ground.rotateX(-Math.PI / 2);
    ground.position.y = 0;
    this.scene.add(ground);

    // Cardinal compass posts — ALPHA placeholder; removed once
    // the corpus reaches ~5 entities and feels populated.
    const compassGeo = new THREE.BoxGeometry(2, 6, 2);
    const compassMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(p.compassPost.color),
      roughness: 0.9,
    });
    for (const [dx, dz] of [[60, 0], [-60, 0], [0, 60], [0, -60]]) {
      const post = new THREE.Mesh(compassGeo, compassMat);
      post.position.set(dx, 3, dz);
      this.scene.add(post);
    }

    // Entity meshes — bumped to 12-unit cubes so a single entity
    // reads at a distance during ALPHA. Sprint 5's SmartObject
    // base class replaces this with metaphor-specific geometry.
    const geometry = new THREE.BoxGeometry(12, 12, 12);
    const surfacePromises: Promise<void>[] = [];
    for (const entity of Object.values(this.snapshot.entities)) {
      const pos = entityPosition(entity, this.snapshot);
      const material = new THREE.MeshStandardMaterial({
        color: this.bundleColor(entity.bundle),
        roughness: 0.65,
        metalness: 0.08,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(pos.x, 6, pos.z);
      mesh.userData.entityId = entity.id;
      this.scene.add(mesh);

      // Sprint 5b: paint a Drupal-served HTML card on a quad next
      // to each entity. The quad faces world-origin so the orbiting
      // camera always catches a readable angle. Failures are logged
      // but never block the scene — a missing surface degrades to
      // "just the cube," matching the bridge philosophy.
      surfacePromises.push(this.attachHtmlSurface(entity, pos));
    }
    await Promise.allSettled(surfacePromises);

    // Sector centroid pads.
    const padGeo = new THREE.CircleGeometry(this.snapshot.world.radius * 0.25, 48);
    padGeo.rotateX(-Math.PI / 2);
    for (const sector of Object.values(this.snapshot.sectors)) {
      const padMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color(p.sectorPad.color),
        roughness: 0.9,
      });
      const pad = new THREE.Mesh(padGeo, padMaterial);
      pad.position.set(sector.centroid.x, 0.05, sector.centroid.z);
      this.scene.add(pad);
    }

    console.info(
      `[world] canvas: ${this.canvas.clientWidth}x${this.canvas.clientHeight}, ` +
        `camera at (${this.camera.position.x.toFixed(0)},${this.camera.position.y.toFixed(0)},${this.camera.position.z.toFixed(0)}), ` +
        `palette: ${p.background}`,
    );
  }

  /**
   * Sprint 5b: instantiate one HtmlSurface per entity, painted with
   * the Drupal-served `default` view-mode of that entity. Positioned
   * just above and slightly outward from its cube, oriented to face
   * the world origin so the orbit always reveals it.
   *
   * Errors are caught and logged — a failed surface should never
   * crater the whole world. The cube alone is still a valid
   * placeholder representation.
   */
  private async attachHtmlSurface(
    entity: Entity,
    pos: { x: number; z: number },
  ): Promise<void> {
    // entity.id is shaped "node-1"; the cypher's card endpoint
    // takes (entityType, id, viewMode) → /world/card/node/1/default.
    const dashIdx = entity.id.indexOf("-");
    if (dashIdx < 0) {
      console.warn(`[world] skipping HtmlSurface for ${entity.id}: malformed id`);
      return;
    }
    const entityType = entity.id.slice(0, dashIdx);
    const numericId = entity.id.slice(dashIdx + 1);
    const url = `/world/card/${entityType}/${numericId}/default`;

    try {
      const surface = await this.surfaceCache.acquire({
        url,
        widthPx: 600,
        heightPx: 400,
        widthWorld: 18,
        heightWorld: 12,
        transparent: true,
      });
      // Quad floats above the cube and pushed outward from origin so
      // the orbit camera reads the front face. lookAt() here aims the
      // surface at world-center — Sprint 5e's vantage system replaces
      // this with proper per-entity facing rules.
      const dist = Math.sqrt(pos.x * pos.x + pos.z * pos.z) || 1;
      const outX = pos.x + (pos.x / dist) * 12;
      const outZ = pos.z + (pos.z / dist) * 12;
      surface.mesh.position.set(outX, 14, outZ);
      surface.mesh.lookAt(0, 14, 0);
      this.scene.add(surface.mesh);
      this.htmlSurfaces.push(surface);

      // Trigger pad — small disc on the ground, click target.
      // Bundle-tinted so the user reads "this pad belongs to this
      // article/profile/event" before clicking.
      const pad = CardController.makePad(this.bundleColor(entity.bundle));
      pad.position.set(pos.x, 0.1, pos.z + 7);
      pad.userData.entityId = entity.id;
      this.scene.add(pad);

      this.cardController?.register({
        entityId: entity.id,
        entityType,
        numericId,
        pad,
        surface,
        homePosition: surface.mesh.position.clone(),
        homeScale: surface.mesh.scale.clone(),
        state: "hidden",
      } satisfies CardRecord);
    } catch (err) {
      console.warn(`[world] HtmlSurface failed for ${entity.id} (${url}):`, err);
    }
  }

  private bundleColor(bundle: string): THREE.Color {
    const hex =
      this.palette.bundleColors[bundle] ??
      this.palette.bundleColors.default ??
      "#808080";
    return new THREE.Color(hex);
  }

  private startLoop(): void {
    // ALPHA-only gentle orbit — proof of liveness. Removed in
    // Sprint 5 when proper Turbo-driven vantage transitions
    // take over. Two-thirds-full revolution per minute.
    const start = performance.now();
    const radius = 130;
    const yLevel = (this.snapshot?.world.overviewHeight ?? 200) * 0.45;

    this.renderer.setAnimationLoop(() => {
      const t = (performance.now() - start) / 1000;
      const angle = t * 0.07; // ~6° per second
      this.camera.position.set(
        Math.sin(angle) * radius,
        yLevel,
        Math.cos(angle) * radius,
      );
      this.camera.lookAt(0, 6, 0);
      this.renderer.render(this.scene, this.camera);
    });
  }

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Reshape the gateway's snapshot (descriptor-keyed) into the
   * CorpusSnapshot shape the renderer's pure functions expect.
   * Descriptor → Entity adaptation happens here in one place.
   */
  private adaptSnapshot(raw: RawSnapshot): CorpusSnapshot {
    const entities: Record<string, Entity> = {};
    for (const [id, d] of Object.entries(raw.entities)) {
      entities[id] = {
        id: d._id,
        bundle: (d.type ?? "node:unknown").split(":")[1] ?? "unknown",
        taxonomyTerms: d.sectorTermIds ?? (d.sector ? [d.sector] : []),
        signature: this.fallbackSignature(),
      };
    }
    return {
      version: raw.version,
      world: raw.world,
      sectors: raw.sectors,
      entities,
    };
  }

  private fallbackSignature() {
    return {
      structural: {
        wordCount: 0,
        paragraphCount: 0,
        imageCount: 0,
      },
      temporal: { createdAt: 0, changedAt: 0 },
      relational: { inDegree: 0, outDegree: 0 },
      semantic: {},
    };
  }
}

interface RawSnapshot {
  version: string;
  generatedAt: number;
  world: CorpusSnapshot["world"] & { palette?: Palette };
  sectors: CorpusSnapshot["sectors"];
  entities: Record<string, DescriptorShape>;
}
