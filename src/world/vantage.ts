// vantage(url, snapshot) → Vantage
//
// The thesis's central claim made executable: every URI deterministically
// maps to a place in the world. This is the only function in the module
// that an outside caller needs.

import type { CorpusSnapshot, Vantage, Vec3 } from "./types.js";
import { entityPosition, normalize2D } from "./layout.js";
import { parseUrl } from "./url.js";

const DEFAULT_FOV = 60;

export function vantage(url: string, snapshot: CorpusSnapshot): Vantage {
  const parsed = parseUrl(url);
  const w = snapshot.world;

  switch (parsed.kind) {
    case "front": {
      // Elevated overview, offset along +z so we look diagonally
      // across all sectors rather than straight down.
      return {
        kind: "front",
        uri: "/",
        sectorId: null,
        position: { x: 0, y: w.overviewHeight, z: w.overviewHeight },
        lookAt: { x: 0, y: 0, z: 0 },
        fov: DEFAULT_FOV,
      };
    }

    case "section": {
      const sector = snapshot.sectors[parsed.termId];
      if (!sector) throw new Error(`Unknown sector: ${parsed.termId}`);
      // Stand on the rim of the sector, looking into the centroid.
      // Rim direction is "outward" from the world origin — sectors
      // near the origin fall back to +x.
      const outward = normalize2D(sector.centroid);
      const dir = outward.x === 0 && outward.z === 0
        ? { x: 1, z: 0 }
        : outward;
      const rim: Vec3 = {
        x: sector.centroid.x + dir.x * sector.radius * 1.2,
        y: w.sectionVantageHeight,
        z: sector.centroid.z + dir.z * sector.radius * 1.2,
      };
      return {
        kind: "section",
        uri: `/sector/${parsed.termId}`,
        sectorId: parsed.termId,
        position: rim,
        lookAt: { x: sector.centroid.x, y: 0, z: sector.centroid.z },
        fov: DEFAULT_FOV,
      };
    }

    case "detail": {
      const entity = snapshot.entities[parsed.entityId];
      if (!entity) throw new Error(`Unknown entity: ${parsed.entityId}`);
      const pos = entityPosition(entity, snapshot);
      // Camera stands back from the object along the vector from
      // world origin to object — the natural "approach angle" from
      // the front-page overview.
      const fromOrigin = normalize2D({ x: pos.x, z: pos.z });
      const back = fromOrigin.x === 0 && fromOrigin.z === 0
        ? { x: 0, z: 1 }
        : fromOrigin;
      const camera: Vec3 = {
        x: pos.x + back.x * w.closeUpDistance,
        y: w.closeUpHeight,
        z: pos.z + back.z * w.closeUpDistance,
      };
      const primarySector = entity.taxonomyTerms[0] ?? null;
      return {
        kind: "detail",
        uri: `/node/${parsed.entityId}`,
        sectorId: primarySector,
        position: camera,
        // v0.2.1-P4: aim partway up so the HTML surface (which
        // floats at y≈CARD_Y, per cardPlacement) is in frame.
        // Aiming at the entity's foot at y=0 framed the trunk
        // base and missed the card. CARD_Y is duplicated rather
        // than imported because vantage.ts is renderer-pure
        // (no smart-objects dependency); 8 matches.
        lookAt: { x: pos.x, y: 8, z: pos.z },
        fov: DEFAULT_FOV,
      };
    }

    case "listing": {
      // Slightly different from front so the URLs are
      // distinguishable; in v2 this will scope to the bundle's
      // relevant sectors rather than the whole world.
      return {
        kind: "listing",
        uri: url,
        sectorId: null,
        position: {
          x: 0,
          y: w.overviewHeight * 0.7,
          z: w.overviewHeight * 0.7,
        },
        lookAt: { x: 0, y: 0, z: 0 },
        fov: DEFAULT_FOV,
      };
    }

    case "unknown": {
      // Fallback to overview rather than throwing; the world should
      // remain navigable even when a URL doesn't match a known shape.
      // Report the front URI — the camera ends up there regardless.
      return {
        kind: "front",
        uri: "/",
        sectorId: null,
        position: { x: 0, y: w.overviewHeight, z: w.overviewHeight },
        lookAt: { x: 0, y: 0, z: 0 },
        fov: DEFAULT_FOV,
      };
    }
  }
}
