// Route vocabulary — the kinds of place a URI can name.
//
// The runtime speaks in Routes; it never parses or builds a path
// itself. A RouteCodec supplied by the host binding owns the grammar
// (which path shapes exist, how an entity id appears in a URI), so
// the same runtime can sit under any server's URL scheme.
//
// Invariant the codec must keep: format(parse(p)) is the canonical
// form of p, and parse(format(r)) gives r back for every Route the
// runtime builds (front, section, detail). vantage() relies on it to
// make the URI ⇄ world arrow commute.

export type Route =
  | { kind: "front" }
  /** A sector vantage. `termId` is the snapshot's sector key. */
  | { kind: "section"; termId: string }
  /** A single entity. `entityId` is the snapshot's entity key. */
  | { kind: "detail"; entityId: string }
  | { kind: "listing"; bundle: string }
  | { kind: "unknown"; path: string };

export interface RouteCodec {
  /** Read a request path (query and fragment are ignored). */
  parse(path: string): Route;
  /** Write the canonical path for a Route. */
  format(route: Route): string;
}
