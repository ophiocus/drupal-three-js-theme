// AssetCache — singleton cache for .glb / .gltf models loaded from
// the asset catalog.
//
// Parallel to SurfaceCache (which caches Drupal-rendered HTML
// surfaces). Each asset URL fetches once via three.js's GLTFLoader;
// subsequent `acquire()` calls return a SkeletonUtils clone of the
// cached scene, so multiple SmartObjects can share the same source
// model without re-parsing the .glb on each.
//
// Lifecycle:
//   - SceneManager constructs one AssetCache per renderer instance.
//   - Builders call `await cache.acquire(url)` to get a fresh
//     THREE.Group clone they can attach as a child.
//   - Cache invalidation happens on snapshot version change, same
//     pattern as SurfaceCache.setSnapshotVersion().
//
// Memory model: each cached entry holds (a) the parsed scene
// (kept indefinitely for cloning) and (b) the underlying
// BufferGeometry / Texture / Material instances. clones share the
// geometry + material instances by default — three.js's standard
// behavior. dispose() walks every cached entry and frees them.
//
// See docs/v0.4/ROADMAP.md §A.3.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// SkeletonUtils exports each helper individually (no namespace); we
// only need `clone` for skeleton-preserving deep copies of GLTF scenes.
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";

interface CacheEntry {
  scene: THREE.Group;
  /** Loading promise; multiple in-flight acquires for the same url share it. */
  loading: Promise<THREE.Group> | null;
}

export class AssetCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly loader = new GLTFLoader();
  private snapshotVersion: string | null = null;

  /**
   * Bind the cache to a snapshot version. When the version changes,
   * the cache flushes (entities have changed; old assets may be
   * gone). First-mount call seeds; subsequent calls flush only
   * if the version actually changed.
   */
  setSnapshotVersion(version: string): void {
    if (this.snapshotVersion === version) return;
    if (this.snapshotVersion !== null) {
      this.flush();
    }
    this.snapshotVersion = version;
  }

  /**
   * Get a fresh clone of the asset at `url`. Returns a THREE.Group
   * (the .glb's root scene) the caller can add to its own group.
   * Each call returns a NEW clone; geometry + materials are shared
   * with the cached source for memory efficiency.
   *
   * Multiple in-flight calls for the same url share the same
   * underlying fetch promise — only one network request fires.
   */
  async acquire(url: string): Promise<THREE.Group> {
    let entry = this.entries.get(url);
    if (entry?.scene) {
      return skeletonClone(entry.scene) as THREE.Group;
    }
    if (entry?.loading) {
      const scene = await entry.loading;
      return skeletonClone(scene) as THREE.Group;
    }

    // First call for this url — kick off the load. Subsequent
    // simultaneous calls (during the same animation frame from
    // different builders) wait on the same promise.
    const loading = this.load(url);
    entry = { scene: null as unknown as THREE.Group, loading };
    this.entries.set(url, entry);

    try {
      const scene = await loading;
      entry.scene = scene;
      entry.loading = null;
      return skeletonClone(scene) as THREE.Group;
    } catch (err) {
      // Pop the entry on failure so the next acquire retries.
      this.entries.delete(url);
      throw err;
    }
  }

  /**
   * Parse a .glb / .gltf via three's GLTFLoader. Returns the
   * scene root (a THREE.Group with the meshes attached). The
   * loader handles binary or JSON gltf transparently.
   */
  private load(url: string): Promise<THREE.Group> {
    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (gltf) => resolve(gltf.scene),
        // onProgress — ignored at MVP; could plumb to LoaderOverlay.
        undefined,
        (error) => reject(error),
      );
    });
  }

  /**
   * Free every cached scene's GPU resources. Called when the
   * snapshot version changes, or on full teardown.
   */
  flush(): void {
    for (const entry of this.entries.values()) {
      if (entry.scene) {
        entry.scene.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry.dispose();
            if (Array.isArray(obj.material)) {
              obj.material.forEach((m) => m.dispose());
            } else {
              obj.material.dispose();
            }
          }
        });
      }
    }
    this.entries.clear();
  }

  /** Number of cached entries — useful for tests + diagnostics. */
  get size(): number {
    return this.entries.size;
  }
}
