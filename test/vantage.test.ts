// Invariants of the URI-as-coordinate mechanic.
//
// These tests are the executable form of the thesis's central claim.
// If they all pass, the function is doing what the thesis says it
// must: deterministic, sector-aware, distinguishing, with the
// borderland and overview properties intact.

import { describe, it, expect } from "vitest";
import { vantage } from "../src/world/vantage.js";
import { distance } from "../src/world/layout.js";
import { fixtureCorpus } from "./fixtures.js";

describe("vantage(): URI as coordinate", () => {
  const corpus = fixtureCorpus();

  describe("invariant 1 — determinism", () => {
    it("produces identical vantages for identical inputs", () => {
      expect(vantage("/node/fish-1", corpus)).toEqual(
        vantage("/node/fish-1", corpus),
      );
    });

    it("is stable across every URL kind", () => {
      const urls = [
        "/",
        "/sector/fishing",
        "/node/fish-1",
        "/articles",
        "/some/unknown/path",
      ];
      for (const url of urls) {
        expect(vantage(url, corpus)).toEqual(vantage(url, corpus));
      }
    });
  });

  describe("invariant 2 — sector containment", () => {
    it("a detail vantage's sectorId matches the entity's primary taxonomy term", () => {
      expect(vantage("/node/fish-1", corpus).sectorId).toBe("fishing");
      expect(vantage("/node/climb-1", corpus).sectorId).toBe("climbing");
      expect(vantage("/node/cook-1", corpus).sectorId).toBe("cooking");
    });

    it("a section vantage's sectorId matches its term", () => {
      expect(vantage("/sector/fishing", corpus).sectorId).toBe("fishing");
      expect(vantage("/sector/climbing", corpus).sectorId).toBe("climbing");
    });

    it("front and listing vantages have no sectorId", () => {
      expect(vantage("/", corpus).sectorId).toBeNull();
      expect(vantage("/articles", corpus).sectorId).toBeNull();
    });
  });

  describe("invariant 3 — sector adjacency", () => {
    it("entities in the same sector are nearer than entities in disjoint sectors", () => {
      const f1 = vantage("/node/fish-1", corpus).lookAt;
      const f2 = vantage("/node/fish-2", corpus).lookAt;
      const c1 = vantage("/node/climb-1", corpus).lookAt;
      const sameSector = distance(f1, f2);
      const crossSector = distance(f1, c1);
      expect(sameSector).toBeLessThan(crossSector);
    });
  });

  describe("invariant 4 — section vantage faces its sector", () => {
    it("section lookAt is at the sector centroid and camera is outside it", () => {
      const v = vantage("/sector/fishing", corpus);
      const sector = corpus.sectors["fishing"]!;
      expect(v.lookAt.x).toBe(sector.centroid.x);
      expect(v.lookAt.z).toBe(sector.centroid.z);
      // Camera should be beyond the sector's radius from its centroid.
      const camToCentroid = Math.hypot(
        v.position.x - sector.centroid.x,
        v.position.z - sector.centroid.z,
      );
      expect(camToCentroid).toBeGreaterThan(sector.radius);
    });
  });

  describe("invariant 5 — borderland", () => {
    it("a multi-tagged entity's lookAt is near the midpoint of its sectors' centroids", () => {
      const v = vantage("/node/borderland", corpus);
      const fishing = corpus.sectors["fishing"]!.centroid;
      const climbing = corpus.sectors["climbing"]!.centroid;
      const midX = (fishing.x + climbing.x) / 2;
      const midZ = (fishing.z + climbing.z) / 2;
      // Tolerance: borderland offset is min(radius) * 0.3 = 9
      const tolerance = 9.5;
      expect(Math.abs(v.lookAt.x - midX)).toBeLessThan(tolerance);
      expect(Math.abs(v.lookAt.z - midZ)).toBeLessThan(tolerance);
    });

    it("a borderland is farther from each sector centroid than a single-tagged entity in that sector", () => {
      const border = vantage("/node/borderland", corpus).lookAt;
      const fish = vantage("/node/fish-1", corpus).lookAt;
      const fishingCentroid = {
        x: corpus.sectors["fishing"]!.centroid.x,
        y: 0,
        z: corpus.sectors["fishing"]!.centroid.z,
      };
      expect(distance(border, fishingCentroid)).toBeGreaterThan(
        distance(fish, fishingCentroid),
      );
    });
  });

  describe("invariant 6 — front-page coverage", () => {
    it("every sector centroid lies within the front vantage's view cone", () => {
      const v = vantage("/", corpus);
      const halfFovRad = (v.fov * Math.PI) / 180 / 2;

      const fwd = {
        x: v.lookAt.x - v.position.x,
        y: v.lookAt.y - v.position.y,
        z: v.lookAt.z - v.position.z,
      };
      const fwdMag = Math.hypot(fwd.x, fwd.y, fwd.z);
      const fwdN = {
        x: fwd.x / fwdMag,
        y: fwd.y / fwdMag,
        z: fwd.z / fwdMag,
      };

      for (const [id, sector] of Object.entries(corpus.sectors)) {
        const ts = {
          x: sector.centroid.x - v.position.x,
          y: 0 - v.position.y,
          z: sector.centroid.z - v.position.z,
        };
        const tsMag = Math.hypot(ts.x, ts.y, ts.z);
        const tsN = { x: ts.x / tsMag, y: ts.y / tsMag, z: ts.z / tsMag };
        const dot = fwdN.x * tsN.x + fwdN.y * tsN.y + fwdN.z * tsN.z;
        const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
        expect(
          angle,
          `sector "${id}" should be inside the front view cone (got ${
            ((angle * 180) / Math.PI).toFixed(1)
          }°)`,
        ).toBeLessThan(halfFovRad);
      }
    });
  });

  describe("invariant 7 — distinguishability", () => {
    it("different known URLs produce different vantages", () => {
      const urls = [
        "/",
        "/sector/fishing",
        "/sector/climbing",
        "/sector/cooking",
        "/node/fish-1",
        "/node/fish-2",
        "/node/climb-1",
        "/articles",
      ];
      const positions = urls.map((u) => {
        const v = vantage(u, corpus);
        return [v.position.x, v.position.y, v.position.z, v.kind].join("|");
      });
      const unique = new Set(positions);
      expect(unique.size, `expected ${urls.length} distinct vantages`).toBe(
        urls.length,
      );
    });
  });
});
