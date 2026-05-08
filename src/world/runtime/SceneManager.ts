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
  private mode: Mode = "exploration";

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.resize();

    this.scene = new THREE.Scene();
    // Warm-earth fog matches atlas_coffee's atmospheric mode brief.
    this.scene.background = new THREE.Color(0x1a1410);
    this.scene.fog = new THREE.Fog(0x1a1410, 50, 400);

    this.camera = new THREE.PerspectiveCamera(
      60,
      this.canvas.clientWidth / this.canvas.clientHeight,
      0.1,
      1000,
    );

    this.addLights();

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

    this.placeCamera(options.cameraPosition);
    this.placeEntities();
    this.startLoop();
    console.info(
      `[world] mounted: ${Object.keys(this.snapshot.entities).length} entities ` +
        `across ${Object.keys(this.snapshot.sectors).length} sectors`,
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

  private addLights(): void {
    const ambient = new THREE.AmbientLight(0xffeacc, 0.45);
    this.scene.add(ambient);

    // Golden-hour key light per atlas_coffee's atmospheric brief.
    const sun = new THREE.DirectionalLight(0xffd9a0, 0.9);
    sun.position.set(80, 120, 60);
    this.scene.add(sun);
  }

  private placeCamera(override?: Vec3): void {
    if (!this.snapshot) return;
    const w = this.snapshot.world;
    const pos = override ?? {
      x: 0,
      y: w.overviewHeight,
      z: w.overviewHeight,
    };
    this.camera.position.set(pos.x, pos.y, pos.z);
    this.camera.lookAt(0, 0, 0);
  }

  private placeEntities(): void {
    if (!this.snapshot) return;
    const geometry = new THREE.BoxGeometry(4, 4, 4);
    for (const entity of Object.values(this.snapshot.entities)) {
      const pos = entityPosition(entity, this.snapshot);
      // Bundle-coloured material — articles are warm umber, profiles
      // a touch greener, events brassier. Refined per atlas_coffee
      // palette in Sprint 5.
      const material = new THREE.MeshStandardMaterial({
        color: this.bundleColor(entity.bundle),
        roughness: 0.7,
        metalness: 0.05,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(pos.x, 2, pos.z);
      mesh.userData.entityId = entity.id;
      this.scene.add(mesh);
    }
    // Sector centroid markers — small floor pads. Visual landmark
    // for the user; placeholder until Sprint 5's biome treatment.
    const padGeo = new THREE.CircleGeometry(this.snapshot.world.radius * 0.15, 32);
    padGeo.rotateX(-Math.PI / 2);
    for (const sector of Object.values(this.snapshot.sectors)) {
      const padMaterial = new THREE.MeshStandardMaterial({
        color: 0x2a1f15,
        roughness: 0.95,
      });
      const pad = new THREE.Mesh(padGeo, padMaterial);
      pad.position.set(sector.centroid.x, 0.01, sector.centroid.z);
      this.scene.add(pad);
    }
  }

  private bundleColor(bundle: string): number {
    switch (bundle) {
      case "article":
        return 0xa05a2c; // umber
      case "profile":
        return 0x5a7a3c; // muted moss
      case "event":
        return 0xc2a04a; // brass
      default:
        return 0x808080;
    }
  }

  private startLoop(): void {
    this.renderer.setAnimationLoop(() => {
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
  world: CorpusSnapshot["world"];
  sectors: CorpusSnapshot["sectors"];
  entities: Record<string, DescriptorShape>;
}
