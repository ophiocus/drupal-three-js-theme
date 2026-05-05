// Parse a request path into a kind we know how to place in the world.
//
// The forms recognised here are intentionally narrow — the routes
// Drupal will emit once we wire it up. Unknown shapes fall through
// to a sentinel kind so the vantage function can do something
// reasonable rather than throw.

export type ParsedUrl =
  | { kind: "front" }
  | { kind: "section"; termId: string }
  | { kind: "detail"; entityId: string }
  | { kind: "listing"; bundle: string }
  | { kind: "unknown"; path: string };

export function parseUrl(url: string): ParsedUrl {
  const path = url
    .replace(/[?#].*$/, "")
    .replace(/^https?:\/\/[^/]+/, "");
  const segments = path.split("/").filter(Boolean);

  if (segments.length === 0) {
    return { kind: "front" };
  }
  if (segments[0] === "section" && segments.length === 2) {
    return { kind: "section", termId: segments[1]! };
  }
  if (segments[0] === "node" && segments.length === 2) {
    return { kind: "detail", entityId: segments[1]! };
  }
  if (segments.length === 1) {
    return { kind: "listing", bundle: segments[0]! };
  }
  return { kind: "unknown", path };
}
