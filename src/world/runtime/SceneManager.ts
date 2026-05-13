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
import { CardController } from "./CardController.js";
import { BiomeMixer, type BiomePaletteEntry } from "./BiomeMixer.js";
import { CameraController } from "./CameraController.js";
import { PointerNavigator } from "./PointerNavigator.js";
import { SmartObject, type FrameContext } from "./smart-objects/SmartObject.js";
import { SmartObjectRegistry } from "./smart-objects/Builder.js";
import { FallbackBuilder } from "./smart-objects/builders/FallbackBuilder.js";
import { vantage } from "../vantage.js";

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
  /** Per-sector biome overlays. Empty array = global palette unchanged. */
  biomes?: BiomePaletteEntry[];
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
  private readonly registry = new SmartObjectRegistry(new FallbackBuilder());
  private readonly smartObjects = new Map<string, SmartObject>();
  private cardController: CardController | null = null;
  private biomeMixer: BiomeMixer | null = null;
  private cameraController: CameraController | null = null;
  private pointerNavigator: PointerNavigator | null = null;
  private ambientLight: THREE.AmbientLight | null = null;

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
    // v0.1: CameraController owns motion. Seed from the URL's
    // vantage; the ALPHA orbit is gone.
    const snap = this.snapshot;
    this.cameraController = new CameraController({
      camera: this.camera,
      snapshot: snap,
      getTargetVantageFromUrl: () => vantage(window.location.pathname, snap),
      setUrlFromVantage: (v) => {
        if (window.location.pathname !== v.uri) {
          history.replaceState(null, "", v.uri);
        }
      },
    });
    this.cardController = new CardController({
      canvas: this.canvas,
      camera: this.camera,
      surfaceCache: this.surfaceCache,
      setMode: (m) => this.setMode(m),
      onBloomedMesh: (mesh) => this.cameraController?.setBloomedMesh(mesh),
    });
    // v0.1.1: macro-navigation click router. Owns canvas pointer
    // events; routes them to card / camera controllers by mesh tag.
    this.pointerNavigator = new PointerNavigator({
      canvas: this.canvas,
      camera: this.camera,
      scene: this.scene,
      cardController: this.cardController,
      cameraController: this.cameraController,
      snapshot: snap,
    });
    // Sprint 6b: region biomes. Each sector contributes a tonal
    // overlay weighted by inverse-square distance from the camera's
    // XZ. As the camera shifts position, the scene shifts tone.
    // v0.1: biome list comes from world_signature.palette.biomes
    // config; editors tune the world tonally without touching code.
    if (this.ambientLight) {
      this.biomeMixer = new BiomeMixer(
        Object.values(this.snapshot.sectors),
        this.palette.biomes ?? [],
        this.scene,
        this.ambientLight,
      );
    }
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
    this.ambientLight = ambient;

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

    // v0.1.2: SmartObject registry owns entity geometry. The
    // FallbackBuilder produces today's cube + pad + HTML surface;
    // later builders (Article, Profile, Event) attach when
    // registered. All entities build in parallel.
    const snap = this.snapshot;
    const buildPromises = Object.values(snap.entities).map(async (entity) => {
      const wp = entityPosition(entity, snap);
      const obj = await this.registry.build(entity, {
        snapshot: snap,
        palette: this.palette,
        surfaceCache: this.surfaceCache,
        assetUrl: (path) => `/themes/custom/drupal_threejs/assets/${path}`,
        worldPosition: new THREE.Vector3(wp.x, 0, wp.z),
      });
      this.scene.add(obj);
      this.smartObjects.set(entity.id, obj);
      // Card lifecycle registration — CardController reads
      // TriggerPad + HtmlSurface components off the SmartObject.
      this.cardController?.register(obj);
    });
    await Promise.allSettled(buildPromises);

    // Sector centroid pads. v0.1.1: tagged as click targets so
    // PointerNavigator routes a click → "navigate to this sector."
    const padGeo = new THREE.CircleGeometry(this.snapshot.world.radius * 0.25, 48);
    padGeo.rotateX(-Math.PI / 2);
    for (const sector of Object.values(this.snapshot.sectors)) {
      const padMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color(p.sectorPad.color),
        roughness: 0.9,
      });
      const pad = new THREE.Mesh(padGeo, padMaterial);
      pad.position.set(sector.centroid.x, 0.05, sector.centroid.z);
      pad.userData.isSectorPad = true;
      pad.userData.termId = sector.termId;
      this.scene.add(pad);
    }

    console.info(
      `[world] canvas: ${this.canvas.clientWidth}x${this.canvas.clientHeight}, ` +
        `camera at (${this.camera.position.x.toFixed(0)},${this.camera.position.y.toFixed(0)},${this.camera.position.z.toFixed(0)}), ` +
        `palette: ${p.background}`,
    );
  }

  private bundleColor(bundle: string): THREE.Color {
    const hex =
      this.palette.bundleColors[bundle] ??
      this.palette.bundleColors.default ??
      "#808080";
    return new THREE.Color(hex);
  }

  private startLoop(): void {
    // v0.1: CameraController owns motion; loop just routes the
    // per-frame dt to every controller that asks for it.
    let lastTime = performance.now();
    this.renderer.setAnimationLoop((time) => {
      // Clamp the first-frame dt so a stale `lastTime` from a long
      // setMode pause doesn't teleport the camera. 0.1s is the
      // ceiling; anything longer is treated as a single 100ms step.
      const dt = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      this.cameraController?.update(dt);
      // Spatial biome blend after camera motion so the tonal shift
      // reflects the latest position. Cheap (O(sectors)).
      this.biomeMixer?.update({
        x: this.camera.position.x,
        z: this.camera.position.z,
      });
      // v0.1.2: per-SmartObject fanout. Pure-geometry components
      // no-op; future components (animations, gaze) wake up here.
      if (this.smartObjects.size > 0) {
        const ctx: FrameContext = {
          camera: this.camera,
          time: time / 1000,
          currentSectorId: null,
        };
        for (const obj of this.smartObjects.values()) obj.update(dt, ctx);
      }
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
