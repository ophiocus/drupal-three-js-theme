// SurfaceCache — LRU + snapshot-version-keyed cache for HtmlSurfaces.
//
// HtmlSurface.refresh() is the single most expensive operation in
// the runtime: a network fetch + (rasterisation or drawElementImage).
// Re-bloom-ing a collapsed card, switching view-modes, or pulling
// the same entity into multiple vantage points should reuse the
// same texture rather than refetching.
//
// Two invalidation modes:
//   - Capacity (LRU)  — fixed cap; evicting calls surface.dispose()
//                       so GPU memory is reclaimed.
//   - Snapshot version — when the cypher publishes a new snapshot,
//                       cards may have changed. setSnapshotVersion()
//                       clears the cache atomically.
//
// Acquire is async and de-duplicates concurrent requests for the
// same key — a stampede of card-bloom events for the same URL
// resolves to a single fetch.

import {
  createHtmlSurface,
  type HtmlSurface,
  type HtmlSurfaceOptions,
} from "./HtmlSurface.js";

interface CacheEntry {
  surface: HtmlSurface;
  /** Order key; bumped on each acquire to track LRU recency. */
  lastAccess: number;
}

const DEFAULT_CAPACITY = 32;

export class SurfaceCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<HtmlSurface>>();
  private snapshotVersion: string | null = null;
  private accessClock = 0;

  constructor(private readonly capacity: number = DEFAULT_CAPACITY) {}

  /**
   * Get or create the surface for `options.url`. The factory's
   * capability detection (HIC vs html-to-image) runs only on cache
   * misses; hits return the cached surface immediately. Concurrent
   * acquires for the same URL share one fetch (stampede control).
   *
   * The caller owns reading the mesh from the returned surface; the
   * cache owns disposal on eviction or version change.
   */
  async acquire(options: HtmlSurfaceOptions): Promise<HtmlSurface> {
    const key = options.url;
    const existing = this.entries.get(key);
    if (existing) {
      existing.lastAccess = ++this.accessClock;
      return existing.surface;
    }
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const promise = (async () => {
      const surface = await createHtmlSurface(options);
      await surface.refresh();
      this.entries.set(key, { surface, lastAccess: ++this.accessClock });
      this.evictIfOverCapacity();
      this.inflight.delete(key);
      return surface;
    })();
    this.inflight.set(key, promise);
    return promise;
  }

  /**
   * Mark the cache as belonging to a particular snapshot version.
   * If the version changes, every entry is disposed and the cache
   * starts fresh. First call (from null → first version) is the
   * initial set and does not clear.
   */
  setSnapshotVersion(version: string): void {
    if (this.snapshotVersion === version) return;
    if (this.snapshotVersion !== null) {
      this.clear();
    }
    this.snapshotVersion = version;
  }

  /** Force-clear the entire cache. Disposes every entry. */
  clear(): void {
    for (const entry of this.entries.values()) {
      entry.surface.dispose();
    }
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private evictIfOverCapacity(): void {
    while (this.entries.size > this.capacity) {
      let oldestKey: string | null = null;
      let oldestAccess = Infinity;
      for (const [key, entry] of this.entries) {
        if (entry.lastAccess < oldestAccess) {
          oldestAccess = entry.lastAccess;
          oldestKey = key;
        }
      }
      if (oldestKey === null) return;
      const evicted = this.entries.get(oldestKey)!;
      evicted.surface.dispose();
      this.entries.delete(oldestKey);
    }
  }
}
