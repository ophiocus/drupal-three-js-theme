// SceneManager — owns the three.js renderer, scene, camera, and
// the render loop. Reads a corpus snapshot from the cypher's
// /world/snapshot/full endpoint, instantiates one placeholder mesh
// per entity at the position `entityPosition()` derives from sector
// + within-sector hash.
//
// ALPHA scope: cubes only, static camera at the front vantage,
// ambient + directional light. Sprint 5 brings the card runtime,
// trigger pads, sector light shifts, and engine-pause on FullView.

import * as THREE from "../../toolbox/three.js";
import type { CorpusSnapshot, Entity, Vec3 } from "../types.js";
import { entityPosition } from "../layout.js";
import { hasHtmlInCanvas, type HtmlSurface } from "./HtmlSurface.js";
import { SurfaceCache } from "./SurfaceCache.js";
import { AssetCache } from "./AssetCache.js";
import { CardController } from "./CardController.js";
import { BiomeMixer, type BiomePaletteEntry } from "./BiomeMixer.js";
import { CameraController } from "./CameraController.js";
import { PointerNavigator } from "./PointerNavigator.js";
import { SmartObject, type FrameContext } from "./smart-objects/SmartObject.js";
import { SmartObjectRegistry } from "./smart-objects/Builder.js";
import { FallbackBuilder } from "./smart-objects/builders/FallbackBuilder.js";
import { ArticleBuilder } from "./smart-objects/builders/ArticleBuilder.js";
import { LoaderOverlay } from "../../shared/LoaderOverlay.js";
import { FLOOR_LAYERS } from "./floor-layers.js";
import { sectorPadDecal } from "./sector-pad-texture.js";
import { vantage } from "../vantage.js";
import { WorldHud, type HudLabel } from "./hud/WorldHud.js";
import { AtmosphereSwitcher } from "./hud/AtmosphereSwitcher.js";
import { CrossfadeOverlay } from "./hud/CrossfadeOverlay.js";
import { AtmosphereAudio } from "./AtmosphereAudio.js";

interface BootOptions {
  snapshotUrl: string;
  /** Optional override of the starting camera position. */
  cameraPosition?: Vec3;
}

interface DescriptorShape {
  _id: string;
  type: string;
  title?: string;
  summary?: string;
  sector?: string;
  sectorTermIds?: string[];
  signature?: unknown;
  /** BETA 2: explicit semantic-layout position, stamped by the
   *  publisher in semantic mode. Absent in taxonomy mode. */
  worldPos?: { x: number; z: number };
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
  /**
   * Active atmosphere key. "none" (or absent) = no atmosphere
   * builders register; defaults handle everything. Other values
   * trigger lazy-import of `./atmospheres/<name>/index.js` and
   * registration before the default builders, per
   * docs/ATMOSPHERES.md.
   */
  activeAtmosphere?: string;
}

/**
 * Viewport-width threshold for "mobile-ish" layout. Below this,
 * the FullView modal anchors TOP (covering the upper band of the
 * canvas) and the reading-mode camera shift goes vertical. Above
 * this, modal anchors LEFT and the shift goes horizontal.
 *
 * 768px aligns with the common phone+portrait-tablet breakpoint
 * used in CSS frameworks; it's wide enough that a 48vw left modal
 * remains readable above the threshold, narrow enough that a
 * full-width top modal makes sense below.
 */
const MOBILE_BREAKPOINT_PX = 768;

/** True when the viewport is in the mobile-layout band. */
export function isMobileViewport(): boolean {
  return typeof window !== "undefined"
    && window.innerWidth < MOBILE_BREAKPOINT_PX;
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
  /** Snapshot endpoint pinned at mount(); switchAtmosphere() re-fetches it. */
  private snapshotUrl: string | null = null;
  /**
   * v1.5 world switcher: the single disposable world-layer group.
   * Everything mount/atmosphere-time attaches HERE (lights, ground,
   * posts, pads, scenery, particles) so teardown is "remove + dispose
   * one subtree," not a checklist. renderer / scene / camera live
   * OUTSIDE it and survive a switch. (SmartObjects are tracked in
   * `smartObjects` and disposed via their component-aware dispose();
   * see docs/feature-requests/world-switcher.md.)
   */
  private worldLayer: THREE.Group | null = null;
  private palette: Palette = DEFAULT_PALETTE;
  private mode: Mode = "exploration";
  private readonly htmlSurfaces: HtmlSurface[] = [];
  private readonly surfaceCache = new SurfaceCache();
  /** AssetCache — singleton-per-renderer cache of .glb scenes. */
  private readonly assetCache = new AssetCache();
  private registry: SmartObjectRegistry | null = null;
  private readonly smartObjects = new Map<string, SmartObject>();
  /**
   * Per-frame updaters registered by atmospheres (particles,
   * sky shifts, audio cues). Atmospheres register via their
   * setupXEnvironment hook; SceneManager ticks them in the
   * animation loop.
   */
  private readonly atmosphereUpdaters: ((elapsed: number, dt: number) => void)[] = [];
  /**
   * Disposers an atmosphere's setupXEnvironment returns for GPU
   * resources the world-layer Mesh-walk can't reach — namely the
   * pollen / mote `THREE.Points` (geometry + material). Called on
   * teardown before the group is freed. Mutable: cleared per switch.
   */
  private readonly atmosphereDisposers: (() => void)[] = [];
  private cardController: CardController | null = null;
  private biomeMixer: BiomeMixer | null = null;
  private cameraController: CameraController | null = null;
  private pointerNavigator: PointerNavigator | null = null;
  private ambientLight: THREE.AmbientLight | null = null;
  /** Persistent screen-space HUD; populated with sector + entity labels at mount. */
  private worldHud: WorldHud | null = null;
  private sectorLabels: HudLabel[] = [];
  private entityLabels: HudLabel[] = [];
  /** Compass letter labels — held so teardown can clear them too. */
  private compassLabels: HudLabel[] = [];
  /**
   * v2 world switcher: in-world skin toggle. Chrome, NOT world content
   * — created once in mount() and survives a switch (buildScene/teardown
   * never touch it).
   */
  private atmosphereSwitcher: AtmosphereSwitcher | null = null;
  /**
   * Procedural per-atmosphere ambient audio. Created with the switcher;
   * silent until the user flips the sound toggle (autoplay etiquette).
   */
  private audio: AtmosphereAudio | null = null;
  /** Re-entrancy guard: a switch in flight ignores further switch calls. */
  private switching = false;
  /**
   * Per-atmosphere layout override (interpretation engine). When the
   * active atmosphere exports computeLayout(), its result — an entityId →
   * 3D position map — wins over the default taxonomy placement. inner-mind
   * uses it for its MDS-3D cloud; forest leaves it null (ground layout).
   */
  private atmosphereLayout: Map<string, Vec3> | null = null;

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
    // v0.2.2: pause-on-window-blur AND tab-visibility. Either
    // source pauses; both must be true to run. Covers:
    //   - tab change within the same browser window  (visibility)
    //   - switching apps / windows                    (focus)
    //   - browser minimise                            (both)
    //   - undocked DevTools claims focus              (focus)
    // CPU + battery reclaimed whenever the user is no longer
    // looking at the world.
    window.addEventListener("blur", this.onWindowFocusChange);
    window.addEventListener("focus", this.onWindowFocusChange);
    document.addEventListener("visibilitychange", this.onWindowFocusChange);
  }

  /**
   * Boot: fetch snapshot, build the scene, start the render loop.
   * Resolves when the first frame has rendered.
   *
   * v0.1.2c: LoaderOverlay covers the screen while pre-warming
   * (snapshot fetch + SmartObject builds + HTML surface fetches).
   * Fades out once everything's ready; the user never sees the
   * mid-build canvas.
   */
  async mount(options: BootOptions): Promise<void> {
    const loader = new LoaderOverlay({
      title: "Building the world",
      message: "fetching corpus",
      namespace: "world-loader",
    });

    this.snapshotUrl = options.snapshotUrl;
    try {
      await this.fetchSnapshot(options.snapshotUrl, false, loader);
      loader.setMessage("assembling entities");
      await this.buildScene(loader);
      // Start the render loop only after the scene is fully built.
      this.refreshLoopState();
      this.ensureAtmosphereSwitcher();
      await loader.hide();
    } catch (err) {
      loader.setMessage("world failed to load");
      // Leave the loader visible briefly so the user sees the error
      // before the page falls back to a blank state.
      setTimeout(() => loader.dispose(), 1500);
      throw err;
    }
  }

  /**
   * Fetch + adapt the snapshot, set the palette, and bind the asset
   * / surface caches to its version. Shared by mount() (first load)
   * and switchAtmosphere() (rebuild). `noStore` bypasses the HTTP
   * cache — switchAtmosphere needs a fresh read so a node-save
   * atmosphere flip is reflected immediately.
   */
  private async fetchSnapshot(
    url: string,
    noStore: boolean,
    loader?: LoaderOverlay,
  ): Promise<void> {
    const init: RequestInit = { headers: { Accept: "application/json" } };
    if (noStore) init.cache = "no-store";
    const response = await fetch(url, init);
    if (!response.ok) {
      loader?.setMessage(`snapshot fetch failed: HTTP ${response.status}`);
      throw new Error(`snapshot fetch failed: HTTP ${response.status}`);
    }
    const raw = (await response.json()) as RawSnapshot;
    this.snapshot = this.adaptSnapshot(raw);
    this.palette = (raw.world.palette as Palette) ?? DEFAULT_PALETTE;
    // Cache invalidates atomically when the cypher publishes a new
    // snapshot version. First-mount call is the initial set; no flush.
    this.surfaceCache.setSnapshotVersion(raw.version);
    this.assetCache.setSnapshotVersion(raw.version);
  }

  /**
   * Build the entire world from the current snapshot + palette.
   * Called by mount() (first build) and switchAtmosphere() (rebuild
   * after teardown). Everything mount/atmosphere-time attaches to a
   * single disposable world-layer group; the renderer / scene /
   * camera live OUTSIDE it and survive a switch.
   *
   * Does NOT start the render loop — callers own that: mount() starts
   * it after the first build; switchAtmosphere() resumes it after the
   * camera pose is restored.
   */
  private async buildScene(loader?: LoaderOverlay): Promise<void> {
    if (!this.snapshot) return;

    // The disposable seam. One group holds every mount/atmosphere-time
    // object; teardown removes + disposes its subtree in one shot.
    this.worldLayer = new THREE.Group();
    this.worldLayer.name = "world-layer";
    this.scene.add(this.worldLayer);

    this.applyPaletteBackground();
    this.addLights();

    // v0.2: build the SmartObjectRegistry with atmosphere
    // builders FIRST, defaults AFTER. First-match-wins means
    // an active atmosphere claims its bundles; anything it
    // doesn't claim falls through to ArticleBuilder /
    // FallbackBuilder. See docs/ATMOSPHERES.md §"Stage 6".
    this.registry = new SmartObjectRegistry(new FallbackBuilder());
    const atmosphere = this.palette.activeAtmosphere;
    if (atmosphere && atmosphere !== "none") {
      loader?.setMessage(`loading ${atmosphere} atmosphere`);
      await this.registerAtmosphere(atmosphere);
    }
    this.registry.register(new ArticleBuilder());

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
        // v0.4 information-lod: detail vantages auto-open FullView.
        // When the camera settles at /node/<id>, the user is at a
        // node URL and expects to see the article. Previously they
        // only saw the entity from a detail vantage with no text;
        // the FullView modal had to be triggered separately. This
        // closes that gap.
        if (v.kind === "detail" && v.uri.startsWith("/")) {
          // /node/123 → "node-123" — the descriptorId shape.
          const parts = v.uri.split("/").filter(Boolean);
          if (parts.length === 2) {
            const entityId = `${parts[0]}-${parts[1]}`;
            this.cardController?.openFullView(entityId);
          }
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
      // v0.4: hover-driven subtitle reveal. PointerNavigator emits
      // an entityId on hover start / null on clear; WorldHud finds
      // the matching label and toggles its subtitle.
      onHoverChange: (entityId) => {
        this.worldHud?.setHoveredEntity(entityId);
      },
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
    await this.placeEntities(loader);
    // Interpretation engine: when the atmosphere supplies its own 3D
    // layout, aim the camera at the entity mass centre (not the world
    // origin) so the floating cloud is framed; also widen the polar
    // clamps so drag-orbit tumbles freely around the cloud. Both
    // cleared for ground atmospheres (forest stays itself).
    const centroid = this.atmosphereLayoutCentroid();
    this.cameraController?.setFocusOverride(centroid);
    this.cameraController?.setFreeOrbit(centroid !== null);
    console.info(
      `[world] built: ${Object.keys(this.snapshot.entities).length} entities ` +
        `across ${Object.keys(this.snapshot.sectors).length} sectors, ` +
        `atmosphere=${this.palette.activeAtmosphere ?? "none"}, ` +
        `html-surface path: ${hasHtmlInCanvas() ? "HIC (native)" : "html-to-image (bridge)"}`,
    );
  }

  /**
   * Live, in-place atmosphere flip — no page reload. Tears the world
   * down to the surviving renderer / scene / camera, re-fetches the
   * snapshot (no-store), and rebuilds behind the LoaderOverlay with
   * the camera pose preserved.
   *
   * `name`, if given, is sent as an `?atmosphere=` hint on the
   * re-fetch so a client can request a specific skin; a server that
   * ignores it simply serves the currently-active atmosphere (e.g.
   * one set earlier via `drush world:switch`). Either way the rebuilt
   * world reflects whatever the snapshot now declares.
   *
   * Disposal completeness is THE risk (docs/feature-requests/
   * world-switcher.md §Risks): verify renderer.info.memory returns to
   * baseline across several switches. The post-switch log prints the
   * live geometry / texture counts for exactly that check.
   */
  async switchAtmosphere(name?: string): Promise<void> {
    if (!this.snapshotUrl) {
      console.warn("[world] switchAtmosphere() before mount(); ignoring.");
      return;
    }
    if (this.switching) {
      console.info("[world] switch already in flight; ignoring re-entrant call.");
      return;
    }
    this.switching = true;
    this.atmosphereSwitcher?.setBusy(true);
    // Pause the loop for the teardown / rebuild window. (The loop body
    // is fully optional-chained, so a stray focus event re-starting it
    // mid-rebuild renders behind the crossfade cover without error.)
    this.renderer.setAnimationLoop(null);
    this.loopRunning = false;

    // Preserve exactly where the user is looking from. The rebuilt
    // CameraController re-seeds from the (unchanged) URL vantage, so
    // restoring position avoids a dolly while the look-target damps.
    const stashedPos = this.camera.position.clone();

    // v2 polish: a palette crossfade in place of the loader's hard cut —
    // fade the world out to the OUTGOING palette background, rebuild
    // behind the cover, then fade in on the new skin.
    const fade = new CrossfadeOverlay({
      color: this.palette.background,
      namespace: "world-crossfade",
    });

    try {
      await fade.cover();
      this.teardownScene();
      const url = name
        ? this.withQuery(this.snapshotUrl, "atmosphere", name)
        : this.snapshotUrl;
      await this.fetchSnapshot(url, true);
      await this.buildScene();
      this.camera.position.copy(stashedPos);
      // Recolour the cover to the INCOMING palette (invisible swap while
      // opaque), update the toggle highlight, resume the loop, and paint
      // one frame of the new scene under the cover so the reveal shows
      // the world even if the loop is paused (tab defocused).
      fade.setColor(this.palette.background);
      this.atmosphereSwitcher?.setActive(this.palette.activeAtmosphere ?? "none");
      this.audio?.setAtmosphere(this.palette.activeAtmosphere ?? "none");
      this.refreshLoopState();
      this.renderer.render(this.scene, this.camera);
      await fade.reveal();
      const mem = this.renderer.info.memory;
      console.info(
        `[world] atmosphere switched → ${this.palette.activeAtmosphere ?? "none"} ` +
          `(mem: geometries=${mem.geometries}, textures=${mem.textures})`,
      );
    } catch (err) {
      console.error("[world] atmosphere switch failed:", err);
      // Best-effort: drop the cover + resume so a failed switch doesn't
      // strand the user behind an opaque overlay on a frozen world.
      fade.dispose();
      this.refreshLoopState();
      throw err;
    } finally {
      this.switching = false;
      this.atmosphereSwitcher?.setBusy(false);
    }
  }

  /**
   * Tear down everything buildScene() created, returning to a clean
   * baseline (only renderer / scene / camera survive). Three buckets:
   * SmartObjects (component-aware dispose), the world-layer group
   * (Mesh geometry+material), and the atmosphere Points (via the
   * disposers). Controllers are disposed so their bound listeners
   * detach before rebuild.
   */
  private teardownScene(): void {
    // 1. SmartObjects — component-aware dispose, then drop from scene.
    //    (They live on `scene`, not the world-layer, so the Mesh-walk
    //    below never double-frees their geometry — keeps
    //    renderer.info.memory accounting honest.)
    for (const obj of this.smartObjects.values()) {
      obj.dispose();
      // removeFromParent() (vs scene.remove(obj)) sidesteps the
      // pre-existing SmartObject-vs-Object3D `attach` type clash while
      // doing exactly the same thing — drop it from the scene graph.
      obj.removeFromParent();
    }
    this.smartObjects.clear();

    // 2. Atmosphere — per-frame updaters + their Points disposers
    //    (pollen / motes geometry+material, which the Mesh-walk skips).
    for (const dispose of this.atmosphereDisposers) dispose();
    this.atmosphereDisposers.length = 0;
    this.atmosphereUpdaters.length = 0;

    // 3. World-layer group — lights, ground, posts, pads, scenery.
    //    Remove from scene, then free every Mesh's geometry+material.
    //    (Lights have no GPU geo/mat; Points were freed in step 2;
    //    textures are shared module caches — left intact.)
    if (this.worldLayer) {
      this.scene.remove(this.worldLayer);
      this.worldLayer.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const mat = o.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
      this.worldLayer = null;
    }
    this.ambientLight = null;

    // 4. HUD labels — sector + entity + compass all share the one
    //    WorldHud; clear() removes their DOM. Keep the HUD instance
    //    (its container + resize listener persist across switches).
    this.worldHud?.clear();
    this.sectorLabels = [];
    this.entityLabels = [];
    this.compassLabels = [];

    // 5. Asset cache — atmosphere-tagged .glb assets differ; drop the
    //    GPU resources so the rebuild reloads the new skin's models
    //    and memory returns to baseline. (Surface cache is keyed by
    //    node + atmosphere-independent; fetchSnapshot's version bump
    //    handles it.)
    this.assetCache.flush();

    // 6. Controllers — hold scene / snapshot / camera refs + bound
    //    listeners. Dispose (detaches listeners, frees overlay +
    //    silhouette) then null for a clean rebuild.
    this.pointerNavigator?.dispose();
    this.pointerNavigator = null;
    this.cardController?.dispose();
    this.cardController = null;
    this.cameraController?.dispose();
    this.cameraController = null;
    this.biomeMixer = null;
    this.registry = null;
    this.atmosphereLayout = null;
  }

  /** Append a query param to a URL, choosing `?` or `&` as needed. */
  private withQuery(url: string, key: string, value: string): string {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }

  /**
   * Mass centre of the active atmosphere's 3D layout (interpretation
   * engine), or null when there's no atmosphere layout. The camera
   * focuses here so a floating cloud is framed, not the ground origin.
   */
  private atmosphereLayoutCentroid(): Vec3 | null {
    const layout = this.atmosphereLayout;
    if (!layout || layout.size === 0) return null;
    let x = 0, y = 0, z = 0;
    for (const p of layout.values()) {
      x += p.x;
      y += p.y;
      z += p.z;
    }
    const n = layout.size;
    return { x: x / n, y: y / n, z: z / n };
  }

  /**
   * Create the in-world atmosphere toggle once (idempotent). It's chrome
   * that survives switches — buildScene/teardown never touch it. Offers
   * the two real skins; "none" (the UE5 blockout) stays reachable via
   * drush / the URL hint but isn't a casual preview button. Clicking a
   * skin calls switchAtmosphere(name), which previews it via the
   * read-only ?atmosphere= hint (no node write).
   */
  private ensureAtmosphereSwitcher(): void {
    const active = this.palette.activeAtmosphere ?? "none";
    if (this.atmosphereSwitcher) {
      this.atmosphereSwitcher.setActive(active);
      return;
    }
    this.audio = new AtmosphereAudio();
    this.atmosphereSwitcher = new AtmosphereSwitcher({
      atmospheres: [
        { name: "forest", label: "Forest" },
        { name: "inner-mind", label: "Inner mind" },
      ],
      initial: active,
      onSelect: (name) => {
        void this.switchAtmosphere(name);
      },
      // Ambient sound is off by default; the toggle click is the gesture
      // that lets the Web Audio context start. Enabling plays the current
      // skin's bed; switching crossfades it (see switchAtmosphere).
      sound: {
        initialOn: false,
        onToggle: (on) => {
          if (on) void this.audio?.enable(this.palette.activeAtmosphere ?? "none");
          else this.audio?.disable();
        },
      },
    });
  }

  setMode(mode: Mode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    // v0.4 reading-mode is a left-anchored modal at min(760px, 48vw)
    // — the right half of the canvas stays a live world the user
    // can still navigate. Two ingredients keep the right half
    // navigable:
    //
    //   1. Lateral parallax shift — moves the camera leftward
    //      (perpendicular to view) so the centered entity ends up
    //      in the right half rather than under the modal.
    //   2. Idle-drift suppression — the user's mouse sits over the
    //      modal (not the canvas) while reading, so resetIdle()
    //      doesn't fire from pointermove. Without the suppression
    //      the camera would drift away from the framing they
    //      picked the moment they started reading.
    //
    // The animation loop KEEPS RUNNING in reading mode (v0.4-fix):
    // earlier versions paused it on the assumption "the modal
    // covers everything, why render?" — but the modal no longer
    // does, and pausing froze drag-orbit, hover silhouettes, and
    // any navigation-during-reading. The loop's exploration vs
    // reading distinction is now ONLY the lateral shift + idle gate.
    //
    // History note: the lateral shift was originally implemented by
    // writing camera.position directly — that worked while the loop
    // was paused (the position survived as the last-rendered frame),
    // but breaks the moment the loop resumes because the per-frame
    // damp toward baseTargetPos undoes the write. The shift now
    // lives in CameraController as a per-frame addition to targetPos
    // (see setLateralShiftMagnitude) so the damp converges to the
    // shifted target instead of fighting it.
    //
    // Predecessor: a setViewOffset(W*2, H, 0, 0, W, H) attempt
    // shifted framing by narrowing the horizontal frustum without
    // narrowing the canvas — stretched everything horizontally.
    // Tiled-rendering function, wrong shape for viewport pan.
    if (mode === "reading") {
      this.enterReadingMode();
    } else {
      this.exitReadingMode();
    }
    this.refreshLoopState();
  }

  /**
   * Configure the camera controller for reading mode: shift the
   * effective target away from the modal's anchor (so the entity
   * sits in the navigable half), suppress idle drift (so the camera
   * doesn't wander away from the framing while the user reads).
   *
   * The shift axis switches by viewport:
   *
   *   - Wide viewport (desktop)  → modal anchors LEFT  → shift x ⇒
   *     camera moves LEFT → entity in RIGHT half.
   *   - Narrow viewport (mobile) → modal anchors TOP   → shift y ⇒
   *     camera moves UP   → entity in BOTTOM half.
   *
   * Magnitude: a fraction of the established close-up distance.
   * Sign chosen per axis so positive close-up distance produces a
   * shift away from the modal. Empirically tuned to ~0.5 — roughly
   * the angle subtended by a quarter-canvas at the 60° FOV.
   *
   * Idempotent: calling repeatedly is fine; the shift is just
   * re-set and re-applied per frame by the controller. Also called
   * on resize so an orientation change recomputes the right axis.
   */
  private enterReadingMode(): void {
    const w = this.snapshot?.world;
    if (!w || !this.cameraController) return;
    const magnitude = w.closeUpDistance * 0.5;
    if (isMobileViewport()) {
      // Modal top-anchored on mobile: shift up so entity drops into
      // the bottom half. Positive y = camera moves up = entity
      // apparent shift downward in viewport space.
      this.cameraController.setViewportShift({ x: 0, y: magnitude });
    } else {
      // Modal left-anchored on desktop: shift left so entity slides
      // into the right half. Negative x = camera moves left = entity
      // apparent shift rightward in viewport space.
      this.cameraController.setViewportShift({ x: -magnitude, y: 0 });
    }
    this.cameraController.setIdleDriftSuppressed(true);
  }

  /**
   * Reset the camera controller to exploration defaults: zero both
   * axes of viewport shift (next-frame damp slides the entity back
   * into canvas-center), re-enable idle drift.
   */
  private exitReadingMode(): void {
    if (!this.cameraController) return;
    this.cameraController.setViewportShift({ x: 0, y: 0 });
    this.cameraController.setIdleDriftSuppressed(false);
  }

  /** Whether the animation loop is currently running. Mirrors the
   *  result of refreshLoopState() so we only log + dispatch on
   *  actual state transitions, not on every visibility tick.
   */
  private loopRunning = false;

  /**
   * Idempotent loop-state evaluation: starts the animation loop
   * if-and-only-if the world is in `exploration` mode AND the
   * window has focus AND the tab is visible. Any of the three
   * pulling low triggers a pause; all three must be true to run.
   *
   * Logs each transition so an operator can verify the pause is
   * firing from the browser console — alt-tab to another app
   * OR switch tabs and you should see "loop paused"; come back
   * and you should see "loop running". The log shows which
   * flag is preventing run when paused.
   */
  private refreshLoopState(): void {
    const focused = typeof document.hasFocus === "function"
      ? document.hasFocus()
      : true;
    const visible = !document.hidden;
    // v0.4-fix: reading mode no longer pauses the loop. The modal
    // covers only the left band (min 760px, 48vw); the right half
    // is a live, navigable world. The loop runs whenever the user
    // is looking at the page — focus + visibility are the only gates.
    // Reading-mode-specific concerns (lateral parallax + idle drift
    // suppression) are owned by CameraController, not by the loop.
    const shouldRun = focused && visible;
    if (shouldRun === this.loopRunning) return;
    this.loopRunning = shouldRun;
    if (shouldRun) {
      this.startLoop();
      console.info(
        `[world] loop running (mode=${this.mode}, focused=true, visible=true)`,
      );
    } else {
      this.renderer.setAnimationLoop(null);
      console.info(
        `[world] loop paused (mode=${this.mode}, focused=${focused}, visible=${visible})`,
      );
    }
  }

  /**
   * Window focus + tab visibility listener — v0.2.2 cleanup.
   * One handler wired to three events (window blur, window
   * focus, document visibilitychange); each fire triggers a
   * fresh refreshLoopState() evaluation. The state-determining
   * reads (document.hasFocus + document.hidden) happen inside
   * refreshLoopState, so the handler doesn't care which event
   * arrived.
   */
  private onWindowFocusChange = (): void => {
    this.refreshLoopState();
  };

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
    // Lights parent to the disposable world-layer so a switch removes
    // them with the rest of the world. (Lights own no GPU geometry/
    // material, so teardown's Mesh-walk skips them harmlessly.)
    const layer = this.worldLayer ?? this.scene;

    const ambient = new THREE.AmbientLight(
      new THREE.Color(p.ambient.color),
      p.ambient.intensity,
    );
    layer.add(ambient);
    this.ambientLight = ambient;

    const sun = new THREE.DirectionalLight(
      new THREE.Color(p.sun.color),
      p.sun.intensity,
    );
    sun.position.set(...p.sun.position);
    layer.add(sun);

    const fill = new THREE.DirectionalLight(
      new THREE.Color(p.fill.color),
      p.fill.intensity,
    );
    fill.position.set(...p.fill.position);
    layer.add(fill);
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

  private async placeEntities(loader?: LoaderOverlay): Promise<void> {
    if (!this.snapshot) return;
    const p = this.palette;
    // Static world geometry parents to the disposable world-layer so a
    // switch tears it down in one shot. (SmartObjects are the
    // exception — they stay on `scene` and are disposed individually
    // via their component-aware dispose(); see teardownScene().)
    const layer = this.worldLayer ?? this.scene;
    // Interpretation engine: a 3D atmosphere layout means there's no
    // "ground" in the metaphor — entities float in a cloud, the zodiac
    // rings the outer orbit, FuzzyRegions sphere the clusters. Skip
    // ground plane / sector pads / compass / flat sector labels in
    // that mode; keep them for ground worlds (forest).
    const is3D = !!this.atmosphereLayout;

    if (!is3D) {
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
      layer.add(ground);
    }

    // WorldHud is needed by entity labels in every atmosphere; create
    // it once here regardless of mode.
    if (!this.worldHud) {
      this.worldHud = new WorldHud({ canvas: this.canvas });
    }
    for (const l of this.compassLabels) l.remove();
    this.compassLabels = [];

    if (!is3D) {
      // Cardinal compass posts + their letter labels. Ground-world
      // orientation aid; meaningless in a 3D-orbited cloud.
      // Convention: -Z = North; +Z = South; +X = East; -X = West.
      // Posts at distance 60 from origin.
      const compassGeo = new THREE.BoxGeometry(2, 6, 2);
      const compassMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(p.compassPost.color),
        roughness: 0.9,
      });
      const compassPoints: Array<{ letter: string; x: number; z: number }> = [
        { letter: "E", x: 60, z: 0 },
        { letter: "W", x: -60, z: 0 },
        { letter: "S", x: 0, z: 60 },
        { letter: "N", x: 0, z: -60 },
      ];
      for (const { x, z } of compassPoints) {
        const post = new THREE.Mesh(compassGeo, compassMat);
        post.position.set(x, 3, z);
        layer.add(post);
      }
      for (const { letter, x, z } of compassPoints) {
        const label = this.worldHud.addLabel({
          worldPos: new THREE.Vector3(x, 10, z),
          text: letter,
          className: "world-hud__compass-label",
        });
        this.compassLabels.push(label);
      }
    }

    // v0.1.2: SmartObject registry owns entity geometry. The
    // FallbackBuilder + ArticleBuilder produce cubes + pads +
    // HTML surfaces; later builders (Profile, Event) attach when
    // registered. All entities build in parallel. The loader's
    // progress counter ticks as each build settles.
    const snap = this.snapshot;
    const registry = this.registry;
    if (!registry) return;
    const total = Object.keys(snap.entities).length;
    let built = 0;
    loader?.setProgress(0, total);
    // tryLoadProp closure — shared across every builder invocation.
    // Reads from the snapshot's assets[] (already filtered to
    // `live` server-side) + the active atmosphere. Returns null on
    // any miss (no slot match, no atmosphere overlap, load failure);
    // builders treat null as "use the primitive fallback."
    const activeAtmosphere = this.palette.activeAtmosphere ?? "none";
    const tryLoadProp = async (slot: string) => {
      const candidates = snap.assets.filter(
        (a) =>
          a.slot === slot &&
          (a.atmospheres.length === 0 || a.atmospheres.includes(activeAtmosphere)),
      );
      if (candidates.length === 0) return null;
      // Prefer assets explicitly tagged for the active atmosphere
      // over "universal" assets (empty atmospheres[]). Within those,
      // lowest nid wins — same deterministic tiebreak the server uses.
      candidates.sort((a, b) => {
        const aExplicit = a.atmospheres.includes(activeAtmosphere) ? 0 : 1;
        const bExplicit = b.atmospheres.includes(activeAtmosphere) ? 0 : 1;
        return aExplicit - bExplicit || a.nid - b.nid;
      });
      const pick = candidates[0]!;
      try {
        const scene = await this.assetCache.acquire(pick.curatedFileUrl);
        return { scene, descriptor: pick };
      } catch (err) {
        console.warn(
          `[world] failed to load asset ${pick.curatedFileUrl} for slot "${slot}"; falling back. Cause:`,
          err,
        );
        return null;
      }
    };

    const buildPromises = Object.values(snap.entities).map(async (entity) => {
      // Interpretation engine: the active atmosphere's layout (if any)
      // places the entity; otherwise taxonomy placement. The layout
      // carries a real y (3D); entityPosition returns y=0 (ground).
      const wp = this.atmosphereLayout?.get(entity.id) ?? entityPosition(entity, snap);
      const obj = await registry.build(entity, {
        snapshot: snap,
        palette: this.palette,
        surfaceCache: this.surfaceCache,
        assetUrl: (path) => `/themes/custom/drupal_threejs/assets/${path}`,
        worldPosition: new THREE.Vector3(wp.x, wp.y, wp.z),
        activeAtmosphere,
        tryLoadProp,
      });
      this.scene.add(obj);
      this.smartObjects.set(entity.id, obj);
      // Card lifecycle registration — CardController reads
      // TriggerPad + HtmlSurface components off the SmartObject.
      this.cardController?.register(obj);
      built++;
      loader?.setProgress(built, total);
    });
    await Promise.allSettled(buildPromises);

    // Sector centroid pads + sector labels — both are ground-world
    // affordances. In 3D atmospheres FuzzyRegions replaces the pad as a
    // region cue (translucent sphere overlap on commonality), and
    // entity labels float with the cloud — flat sector labels would
    // sit far below it and read as detached.
    for (const l of this.sectorLabels) l.remove();
    this.sectorLabels = [];
    // Hoisted so the per-entity label loop further down can still read
    // it on the (rare) non-ground path; harmless in 3D.
    const overviewHeightThreshold = this.snapshot.world.overviewHeight * 0.45;
    if (!is3D) {
      // Sector centroid pads — click target + visual clearing.
      const padGeo = new THREE.CircleGeometry(this.snapshot.world.radius * 0.25, 48);
      padGeo.rotateX(-Math.PI / 2);
      const padAlpha = sectorPadDecal();
      for (const sector of Object.values(this.snapshot.sectors)) {
        const padMaterial = new THREE.MeshStandardMaterial({
          color: new THREE.Color(p.sectorPad.color),
          roughness: 0.95,
          metalness: 0,
          alphaMap: padAlpha,
          transparent: true,
          // depthWrite off so transparent edges don't write a hard
          // depth boundary the canopy would z-fight against.
          depthWrite: false,
        });
        const pad = new THREE.Mesh(padGeo, padMaterial);
        pad.position.set(sector.centroid.x, FLOOR_LAYERS.sector_pad, sector.centroid.z);
        pad.userData.isSectorPad = true;
        pad.userData.termId = sector.termId;
        // Render before opaque geometry so the alpha blend reads
        // ground-as-background.
        pad.renderOrder = -1;
        layer.add(pad);
      }

      // Sector labels — overview-altitude only (Information LOD A).
      for (const sector of Object.values(this.snapshot.sectors)) {
        const label = this.worldHud.addLabel({
          worldPos: new THREE.Vector3(
            sector.centroid.x,
            FLOOR_LAYERS.sector_pad + 4,
            sector.centroid.z,
          ),
          text: sector.displayName,
          className: "world-hud__sector-label",
          visibleIf: (camera) => camera.position.y > overviewHeightThreshold,
          onClick: () => {
            this.cameraController?.setTarget(
              vantage(`/sector/${sector.termId}`, this.snapshot!),
            );
          },
        });
        this.sectorLabels.push(label);
      }
    }

    // v0.4 information-lod Activity B: per-entity title labels.
    // Each entity gets a WorldHud label at its world position.
    // visibleIf takes care of scope: visible only when the camera
    // is below the overview threshold (region labels go away) AND
    // above the detail threshold (a single entity card takes over)
    // AND the camera's nearest sector matches this entity's
    // primary sector. The "title spray" the user asked for.
    //
    // onClick fires CardController straight into FullView for
    // "one click to node" (Activity C — same gesture from the
    // label as from the entity body).
    for (const l of this.entityLabels) l.remove();
    this.entityLabels = [];
    // Detail vantage height — anything below this means the user
    // is at one entity, where individual titles are noise.
    const detailHeightThreshold = this.snapshot.world.closeUpHeight + 4;
    const sectorList = Object.values(this.snapshot.sectors);

    /** Find the sector whose centroid is closest to the camera. */
    const nearestSector = (camera: THREE.Camera): string | null => {
      let best: string | null = null;
      let bestSq = Infinity;
      for (const s of sectorList) {
        const dx = camera.position.x - s.centroid.x;
        const dz = camera.position.z - s.centroid.z;
        const sq = dx * dx + dz * dz;
        if (sq < bestSq) {
          bestSq = sq;
          best = s.termId;
        }
      }
      return best;
    };

    for (const entity of Object.values(snap.entities)) {
      const title = entity.title;
      if (!title) continue;
      const primarySector = entity.taxonomyTerms[0];
      if (!primarySector) continue;
      // Same layout resolution as the entity body so labels track the
      // 3D position in an atmosphere that supplies its own layout.
      const wp = this.atmosphereLayout?.get(entity.id) ?? entityPosition(entity, snap);
      const label = this.worldHud.addLabel({
        worldPos: new THREE.Vector3(
          wp.x,
          // Lift above the entity so the anchor projects to a point in
          // the air above its geometry. On the ground layout wp.y=0, so
          // a fixed +12 reads as before; on a 3D layout wp.y carries the
          // height and we lift a little above it.
          wp.y + 12,
          wp.z,
        ),
        text: title,
        // v0.4 hover subtitle: first-sentence body summary shown
        // only when this entity is the current hover target (HUD
        // toggles it via setHoveredEntity). Empty on legacy
        // snapshots; WorldHud skips creating the subtitle node.
        subtitle: entity.summary,
        // Keyed for hover-driven subtitle reveal.
        entityId: entity.id,
        className: "world-hud__entity-label",
        // 3D atmospheres: just be visible (the orbit camera makes
        // camera.y a poor "scope" signal, and there's no flat sector to
        // pick a "nearest" from). Ground worlds: keep the LOD scoping.
        visibleIf: is3D
          ? undefined
          : (camera) => {
              const y = camera.position.y;
              if (y > overviewHeightThreshold) return false;
              if (y < detailHeightThreshold) return false;
              return nearestSector(camera) === primarySector;
            },
        onClick: () => {
          this.cardController?.openFullView(entity.id);
        },
      });
      this.entityLabels.push(label);
    }

    console.info(
      `[world] canvas: ${this.canvas.clientWidth}x${this.canvas.clientHeight}, ` +
        `camera at (${this.camera.position.x.toFixed(0)},${this.camera.position.y.toFixed(0)},${this.camera.position.z.toFixed(0)}), ` +
        `palette: ${p.background}`,
    );
  }

  /**
   * Lazy-import an atmosphere by name and register its
   * builders. Atmospheres become separate Vite chunks
   * (parallel to the HtmlSurface chunks), so unused
   * atmospheres never bloat the main bundle. Unknown
   * atmosphere names log a warning and proceed without
   * registering — the world still renders with the defaults.
   */
  private async registerAtmosphere(name: string): Promise<void> {
    if (!this.registry) return;
    try {
      switch (name) {
        case "forest": {
          const mod = await import("./atmospheres/forest/index.js");
          mod.registerForestAtmosphere(this.registry);
          // Environment setup (scenery, particles, atmosphere-wide
          // visual elements) attaches into the disposable world-layer
          // and returns a disposer for its Points (pollen). Atmospheres
          // without env work simply don't export setupXEnvironment; the
          // duck-typed call no-ops cleanly.
          if (this.snapshot && this.worldLayer) {
            const dispose = mod.setupForestEnvironment?.(
              this.worldLayer,
              this.snapshot,
              (fn) => this.atmosphereUpdaters.push(fn),
            );
            if (dispose) this.atmosphereDisposers.push(dispose);
          }
          break;
        }
        case "inner-mind": {
          // The "acid trip" skin — abstract procedural geometry +
          // a hue-cycling environment. A stub proving the world
          // switcher; real inner-mind is BETA 1. Its updater mutates
          // scene.background/fog, so it takes the scene as well as the
          // disposable world-layer root for its motes.
          const mod = await import("./atmospheres/inner-mind/index.js");
          mod.registerInnerMindAtmosphere(this.registry);
          // Interpretation engine: inner-mind projects the embeddings
          // into its own 3D layout (overrides taxonomy placement).
          if (this.snapshot) {
            this.atmosphereLayout = mod.computeLayout?.(this.snapshot) ?? null;
          }
          if (this.snapshot && this.worldLayer) {
            const dispose = mod.setupInnerMindEnvironment?.(
              this.scene,
              this.worldLayer,
              this.snapshot,
              (fn) => this.atmosphereUpdaters.push(fn),
              this.atmosphereLayout,
            );
            if (dispose) this.atmosphereDisposers.push(dispose);
          }
          break;
        }
        default:
          console.warn(`[world] unknown atmosphere "${name}"; running with defaults.`);
      }
    } catch (err) {
      console.warn(
        `[world] failed to load atmosphere "${name}"; running with defaults. Cause:`,
        err,
      );
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
      // v0.2.1-A5: atmosphere-registered per-frame updaters
      // (forest's pollen layer; future atmospheres' equivalents).
      if (this.atmosphereUpdaters.length > 0) {
        const elapsed = time / 1000;
        for (const fn of this.atmosphereUpdaters) fn(elapsed, dt);
      }
      // v0.4 research/information-lod: WorldHud label projection.
      // Cheap (O(labels) per frame). Runs AFTER camera update so
      // the projected positions reflect the camera's current pose.
      this.worldHud?.update(this.camera);
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
      // v0.4-fix: with the loop running in reading mode, the next
      // animation frame repaints automatically. The old explicit
      // renderer.render(...) call here was a side-effect of the
      // loop-pause approach we no longer use.
    }
    // Mobile: an orientation change crosses the MOBILE_BREAKPOINT
    // mid-session (portrait → landscape on a tablet). If the user
    // is in reading mode at the moment of the cross, the camera
    // shift axis needs to swap (vertical ↔ horizontal). Re-running
    // enterReadingMode is idempotent — it just re-sets the shift
    // from the new viewport classification.
    if (this.mode === "reading") {
      this.enterReadingMode();
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
        signature: this.adaptSignature(d.signature),
        // v0.4 information-lod: WorldHud entity labels need the
        // title. DescriptorBuilder now writes it as a top-level
        // field; adapt it here. Missing on legacy descriptors
        // (pre-v0.4 publish runs) — falls through cleanly because
        // the label loop short-circuits on empty.
        title: d.title ?? "",
        // First-sentence summary shown as subtitle on hover. Same
        // contract as `title` — present on v0.4+ descriptors, empty
        // on legacy. (Battle-scar P1: every new descriptor field
        // needs DescriptorBuilder + Entity type + adaptSnapshot.)
        summary: d.summary ?? "",
        // BETA 2: explicit semantic-layout position. Present only
        // when the snapshot was built in semantic mode; absent →
        // entityPosition falls back to taxonomy+hash. (Battle-scar
        // P1 again — new field needs the full plumbing.)
        worldPos: d.worldPos,
      };
    }
    return {
      version: raw.version,
      world: raw.world,
      sectors: raw.sectors,
      entities,
      // v0.4 / ALPHA 1: assets[] arrives from the snapshot publisher
      // when the editor has marked at least one asset live. Legacy
      // snapshots (pre-A.2) omit the key — default to [] so builder
      // tryLoadProp() returns null cleanly without crashing.
      assets: raw.assets ?? [],
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
      semantic: {} as { embedding?: number[] },
    };
  }

  /**
   * Build the renderer's Signature from the raw descriptor signature.
   * The renderer only needs the semantic embedding (interpretation
   * engine, docs/INTERPRETATION_ENGINE.md) — structural/temporal/
   * relational stay zeroed. The embedding is present only when the
   * snapshot shipped it (small corpora); absent → atmospheres without
   * their own layout fall back to taxonomy placement.
   */
  private adaptSignature(raw: unknown): ReturnType<typeof this.fallbackSignature> {
    const sig = this.fallbackSignature();
    if (typeof raw === "object" && raw !== null) {
      const semantic = (raw as { semantic?: unknown }).semantic;
      if (typeof semantic === "object" && semantic !== null) {
        const emb = (semantic as { embedding?: unknown }).embedding;
        if (Array.isArray(emb) && emb.every((v) => typeof v === "number")) {
          sig.semantic.embedding = emb as number[];
        }
      }
    }
    return sig;
  }
}

interface RawSnapshot {
  version: string;
  generatedAt: number;
  world: CorpusSnapshot["world"] & { palette?: Palette };
  sectors: CorpusSnapshot["sectors"];
  entities: Record<string, DescriptorShape>;
  /** v0.4+: live assets — omitted on legacy publish runs. */
  assets?: CorpusSnapshot["assets"];
}
