// Parse a request path into a kind we know how to place in the world.
//
// The forms recognised here are intentionally narrow — the routes
// Drupal will emit once we wire it up. Unknown shapes fall through
// to a sentinel kind so the vantage function can do something
// reasonable rather than throw.

export type ParsedUrl =
  | { kind: "front" }
  | { kind: "section"; termId: string }
  /**
   * Detail of a specific entity. `entityType` is the Drupal
   * machine name (node, paragraph, taxonomy_term, ...) and
   * `entityId` is the slug-or-numeric portion. Snapshot keys
   * have the form `${entityType}-${entityId}` — vantage.ts
   * reconstructs.
   */
  | { kind: "detail"; entityType: string; entityId: string }
  | { kind: "listing"; bundle: string }
  | { kind: "unknown"; path: string };

/**
 * Entity types we recognise as valid `/<type>/<id>` URLs. Drupal
 * ships `/node/<nid>` canonically; we accept the others too so
 * future bundles (paragraphs, taxonomy terms as first-class) work
 * the day they need to.
 */
const ENTITY_TYPES = new Set(["node", "paragraph", "taxonomy_term", "user"]);

export function parseUrl(url: string): ParsedUrl {
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
  if (ENTITY_TYPES.has(segments[0]!) && segments.length === 2) {
    return {
      kind: "detail",
      entityType: segments[0]!,
      entityId: segments[1]!,
    };
  }
  if (segments.length === 1) {
    return { kind: "listing", bundle: segments[0]! };
  }
  return { kind: "unknown", path };
}
