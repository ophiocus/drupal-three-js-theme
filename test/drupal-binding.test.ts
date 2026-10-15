// @vitest-environment jsdom
//
// The seam between the runtime and the Drupal binding.
//
// What we're locking:
//   - drupalRoutes reads and writes exactly the URL shapes the runtime
//     hand-built before the seam was cut (/, /sector/<id>, /node/<id>)
//   - format(parse(p)) is canonical; parse(format(r)) gives r back
//   - DrupalTransport composes the same request URLs the runtime used
//     to build inline (snapshot, ?atmosphere=, ?lang=, card routes)
//   - vantage() carries no URL grammar of its own: under a foreign
//     codec it lands on the same place, with the codec's URI

import { afterEach, describe, expect, it, vi } from "vitest";
import { drupalRoutes } from "../src/binding/drupal-routes.js";
import { DrupalTransport } from "../src/binding/drupal-transport.js";
import { vantage } from "../src/world/vantage.js";
import type { Route, RouteCodec } from "../src/world/routes.js";
import { fixtureCorpus } from "./fixtures.js";

describe("drupalRoutes", () => {
  it("parses the Drupal URL shapes into routes", () => {
    expect(drupalRoutes.parse("/")).toEqual({ kind: "front" });
    expect(drupalRoutes.parse("")).toEqual({ kind: "front" });
    expect(drupalRoutes.parse("/sector/12")).toEqual({ kind: "section", termId: "12" });
    expect(drupalRoutes.parse("/node/19")).toEqual({ kind: "detail", entityId: "node-19" });
    expect(drupalRoutes.parse("/node/fish-1?x=1#y")).toEqual({ kind: "detail", entityId: "node-fish-1" });
    expect(drupalRoutes.parse("https://site.test/user/3")).toEqual({ kind: "detail", entityId: "user-3" });
    expect(drupalRoutes.parse("/articles")).toEqual({ kind: "listing", bundle: "articles" });
    expect(drupalRoutes.parse("/a/b/c")).toEqual({ kind: "unknown", path: "/a/b/c" });
  });

  it("formats routes as the runtime used to hand-build them", () => {
    expect(drupalRoutes.format({ kind: "front" })).toBe("/");
    expect(drupalRoutes.format({ kind: "section", termId: "12" })).toBe("/sector/12");
    expect(drupalRoutes.format({ kind: "detail", entityId: "node-19" })).toBe("/node/19");
    expect(drupalRoutes.format({ kind: "detail", entityId: "node-fish-1" })).toBe("/node/fish-1");
    expect(drupalRoutes.format({ kind: "detail", entityId: "taxonomy_term-5" })).toBe("/taxonomy_term/5");
    // No entity type → overview, as PointerNavigator.uriForEntity did.
    expect(drupalRoutes.format({ kind: "detail", entityId: "orphan" })).toBe("/");
  });

  it("round-trips every route the runtime builds", () => {
    const routes: Route[] = [
      { kind: "front" },
      { kind: "section", termId: "fishing" },
      { kind: "detail", entityId: "node-fish-1" },
      { kind: "listing", bundle: "articles" },
    ];
    for (const r of routes) {
      expect(drupalRoutes.parse(drupalRoutes.format(r))).toEqual(r);
    }
  });
});

describe("DrupalTransport", () => {
  const transport = new DrupalTransport({
    snapshotUrl: "/world/snapshot/full",
    assetBase: "/themes/custom/drupal_threejs/assets/",
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("builds card routes from snapshot keys", () => {
    expect(transport.cardUrl("node-12", "card")).toBe("/world/card/node/12/card");
    expect(transport.cardUrl("node-fish-1", "default")).toBe("/world/card/node/fish-1/default");
    expect(transport.cardUrl("orphan", "card")).toBeNull();
  });

  it("resolves theme assets under the asset base", () => {
    expect(transport.assetUrl("textures/uv.png")).toBe("/themes/custom/drupal_threejs/assets/textures/uv.png");
  });

  it("requests the snapshot with the atmosphere hint, the language and no-store", async () => {
    localStorage.setItem("world.lang", "es");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ version: "v1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const raw = await transport.loadSnapshot({ atmosphere: "forest", fresh: true });
    expect(raw.version).toBe("v1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/world/snapshot/full?atmosphere=forest&lang=es",
      { headers: { Accept: "application/json" }, cache: "no-store" },
    );

    await transport.loadSnapshot({ fresh: false });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/world/snapshot/full?lang=es",
      { headers: { Accept: "application/json" } },
    );
  });

  it("rejects a failed snapshot with the status the loader shows", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    await expect(transport.loadSnapshot({ fresh: false })).rejects.toThrow(
      "snapshot fetch failed: HTTP 503",
    );
  });

  it("fetches card HTML with the language and rejects on HTTP errors", async () => {
    localStorage.setItem("world.lang", "en");
    const fetchMock = vi.fn(async () => new Response("<p>card</p>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(transport.fetchHtml("/world/card/node/1/default")).resolves.toBe("<p>card</p>");
    expect(fetchMock).toHaveBeenCalledWith(
      "/world/card/node/1/default?lang=en",
      { headers: { Accept: "text/html" } },
    );

    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    await expect(transport.fetchHtml("/world/card/node/1/default")).rejects.toThrow("HTTP 404");
  });
});

describe("vantage() under a foreign URL grammar", () => {
  // A host that addresses everything under /w/: /w, /w/s/<termId>, /w/e/<entityId>.
  const foreign: RouteCodec = {
    parse(path) {
      const [, w, kind, id] = path.split("/");
      if (w !== "w") return { kind: "unknown", path };
      if (!kind) return { kind: "front" };
      if (kind === "s" && id) return { kind: "section", termId: id };
      if (kind === "e" && id) return { kind: "detail", entityId: id };
      return { kind: "unknown", path };
    },
    format(route) {
      switch (route.kind) {
        case "front": return "/w";
        case "section": return `/w/s/${route.termId}`;
        case "detail": return `/w/e/${route.entityId}`;
        case "listing": return `/w/l/${route.bundle}`;
        case "unknown": return route.path;
      }
    },
  };
  const corpus = fixtureCorpus();

  it("lands on the same place and reports the host's URI", () => {
    const pairs: Array<[string, string]> = [
      ["/", "/w"],
      ["/sector/fishing", "/w/s/fishing"],
      ["/node/fish-1", "/w/e/node-fish-1"],
    ];
    for (const [drupalPath, foreignPath] of pairs) {
      const a = vantage(drupalPath, corpus, drupalRoutes);
      const b = vantage(foreignPath, corpus, foreign);
      expect(b.position).toEqual(a.position);
      expect(b.lookAt).toEqual(a.lookAt);
      expect(b.kind).toBe(a.kind);
      expect(b.uri).toBe(foreignPath);
    }
  });

  it("falls back to the host's front URI on an unknown path", () => {
    expect(vantage("/elsewhere", corpus, foreign).uri).toBe("/w");
  });
});
