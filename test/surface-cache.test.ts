// SurfaceCache invariants.
//
// The cache is the only place in the runtime that owns texture
// disposal, so the eviction/version-change rules must be exact.
// We mock createHtmlSurface to a counter so we can prove fetches
// happen exactly when we expect.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted stubs — vi.mock is hoisted to the top of the file, so the
// factory cannot reference outer-scope variables. We expose state
// via the mocked module's named exports.
const factoryCounter = { count: 0 };
const disposeCounter = { count: 0 };

vi.mock("../src/world/runtime/HtmlSurface.js", () => ({
  createHtmlSurface: vi.fn(async (options: { url: string }) => {
    factoryCounter.count += 1;
    return {
      mesh: { __fake: true },
      refresh: vi.fn(async () => {}),
      dispose: vi.fn(() => {
        disposeCounter.count += 1;
      }),
      __url: options.url,
    } as unknown as Awaited<ReturnType<typeof import("../src/world/runtime/HtmlSurface.js").createHtmlSurface>>;
  }),
}));

import { SurfaceCache } from "../src/world/runtime/SurfaceCache.js";

beforeEach(() => {
  factoryCounter.count = 0;
  disposeCounter.count = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SurfaceCache", () => {
  const opts = (url: string) => ({ url, widthPx: 100, heightPx: 100 });

  it("returns the same surface on repeated acquires (cache hit)", async () => {
    const cache = new SurfaceCache();
    const a = await cache.acquire(opts("/world/card/node/1/default"));
    const b = await cache.acquire(opts("/world/card/node/1/default"));
    expect(a).toBe(b);
    expect(factoryCounter.count).toBe(1);
  });

  it("de-duplicates concurrent acquires for the same URL", async () => {
    const cache = new SurfaceCache();
    const url = "/world/card/node/1/default";
    const [a, b, c] = await Promise.all([
      cache.acquire(opts(url)),
      cache.acquire(opts(url)),
      cache.acquire(opts(url)),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(factoryCounter.count).toBe(1);
  });

  it("issues separate fetches for different URLs", async () => {
    const cache = new SurfaceCache();
    await cache.acquire(opts("/world/card/node/1/default"));
    await cache.acquire(opts("/world/card/node/1/full"));
    expect(factoryCounter.count).toBe(2);
    expect(cache.size()).toBe(2);
  });

  it("evicts least-recently-used when over capacity", async () => {
    const cache = new SurfaceCache(2);
    await cache.acquire(opts("/a"));
    await cache.acquire(opts("/b"));
    // Re-touch /a so /b becomes the LRU.
    await cache.acquire(opts("/a"));
    await cache.acquire(opts("/c"));
    expect(cache.size()).toBe(2);
    expect(disposeCounter.count).toBe(1);
    // /b was evicted; /a and /c remain. Re-acquiring /b refetches.
    await cache.acquire(opts("/b"));
    expect(factoryCounter.count).toBe(4);
  });

  it("clears + disposes everything on snapshot-version change", async () => {
    const cache = new SurfaceCache();
    cache.setSnapshotVersion("v1");
    await cache.acquire(opts("/a"));
    await cache.acquire(opts("/b"));
    expect(cache.size()).toBe(2);

    cache.setSnapshotVersion("v2");
    expect(cache.size()).toBe(0);
    expect(disposeCounter.count).toBe(2);

    // Same URL post-bump: refetched, fresh surface.
    await cache.acquire(opts("/a"));
    expect(factoryCounter.count).toBe(3);
  });

  it("does not clear on the first version set (no prior version)", async () => {
    const cache = new SurfaceCache();
    await cache.acquire(opts("/a"));
    cache.setSnapshotVersion("v1");
    expect(cache.size()).toBe(1);
    expect(disposeCounter.count).toBe(0);
  });

  it("setSnapshotVersion is idempotent for the same version", async () => {
    const cache = new SurfaceCache();
    cache.setSnapshotVersion("v1");
    await cache.acquire(opts("/a"));
    cache.setSnapshotVersion("v1");
    expect(cache.size()).toBe(1);
    expect(disposeCounter.count).toBe(0);
  });
});
