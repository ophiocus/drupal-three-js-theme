// Drupal's URL grammar — the RouteCodec this theme hands the runtime.
//
// The forms recognised here are intentionally narrow: the routes the
// world_signature module emits. Unknown shapes fall through to a
// sentinel kind so vantage() can do something reasonable rather than
// throw.
//
//   /                      front
//   /sector/<termId>       section   (route world_signature.sector)
//   /<entityType>/<id>     detail    (snapshot key `<entityType>-<id>`)
//   /<bundle>              listing

import type { Route, RouteCodec } from "../world/routes.js";

/**
 * Entity types we recognise as valid `/<type>/<id>` URLs. Drupal
 * ships `/node/<nid>` canonically; we accept the others too so
 * future bundles (paragraphs, taxonomy terms as first-class) work
 * the day they need to.
 */
const ENTITY_TYPES = new Set(["node", "paragraph", "taxonomy_term", "user"]);

export const drupalRoutes: RouteCodec = {
  parse(url: string): Route {
    const path = url
      .replace(/[?#].*$/, "")
      .replace(/^https?:\/\/[^/]+/, "");
    const segments = path.split("/").filter(Boolean);

    if (segments.length === 0) {
      return { kind: "front" };
    }
    // Sector vantage. URL is `/sector/<termId>` (matches the cypher's
    // routing.yml route world_signature.sector). The internal kind
    // stays "section" because the vantage type predates the URL
    // settlement; rename is a wider refactor not worth doing now.
    if (segments[0] === "sector" && segments.length === 2) {
      return { kind: "section", termId: segments[1]! };
    }
    // Snapshot keys have the form `${entityType}-${entityId}`; the
    // URL carries them split (/node/19).
    if (ENTITY_TYPES.has(segments[0]!) && segments.length === 2) {
      return { kind: "detail", entityId: `${segments[0]}-${segments[1]}` };
    }
    if (segments.length === 1) {
      return { kind: "listing", bundle: segments[0]! };
    }
    return { kind: "unknown", path };
  },

  format(route: Route): string {
    switch (route.kind) {
      case "front":
        return "/";
      case "section":
        return `/sector/${route.termId}`;
      case "detail": {
        // "node-19" → "/node/19". Entity type machine names never
        // contain a dash, so the first dash is the separator.
        const parts = splitEntityId(route.entityId);
        return parts ? `/${parts.entityType}/${parts.id}` : "/";
      }
      case "listing":
        return `/${route.bundle}`;
      case "unknown":
        return route.path;
    }
  },
};

/** Split a snapshot key "node-19" into ("node", "19"); null if no type. */
export function splitEntityId(
  entityId: string,
): { entityType: string; id: string } | null {
  const dash = entityId.indexOf("-");
  if (dash <= 0) return null;
  return { entityType: entityId.slice(0, dash), id: entityId.slice(dash + 1) };
}
