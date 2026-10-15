// Drupal's WorldTransport — how this theme feeds the runtime.
//
// Everything the renderer reads from the server goes through here:
//   - the snapshot      GET <snapshotUrl>[?atmosphere=<key>]&lang=<code>
//   - card HTML         GET /world/card/<entityType>/<id>/<viewMode>?lang=<code>
//   - theme assets      /themes/custom/drupal_threejs/assets/<path>
//
// `?lang=` is the server's convention: SnapshotPublisher and the card
// controller overlay the requested translation at response time. The
// active language itself is runtime state (world/runtime/hud/lang.ts).

import type {
  RawSnapshot,
  SnapshotRequest,
  WorldTransport,
} from "../world/runtime/wire.js";
import { getCurrentLang } from "../world/runtime/hud/lang.js";
import { splitEntityId } from "./drupal-routes.js";

export interface DrupalTransportOptions {
  /** The cypher's snapshot REST resource, e.g. /world/snapshot/full. */
  snapshotUrl: string;
  /** Base path of the theme's static assets, with trailing slash. */
  assetBase: string;
}

export class DrupalTransport implements WorldTransport {
  constructor(private readonly options: DrupalTransportOptions) {}

  async loadSnapshot(request: SnapshotRequest): Promise<RawSnapshot> {
    const url = request.atmosphere
      ? withQuery(this.options.snapshotUrl, "atmosphere", request.atmosphere)
      : this.options.snapshotUrl;
    const init: RequestInit = { headers: { Accept: "application/json" } };
    if (request.fresh) init.cache = "no-store";
    // Tell the server which language to overlay descriptor
    // title/summary/body to. 3D positions stay language-agnostic —
    // same world, different labels.
    const response = await fetch(withLangQuery(url), init);
    if (!response.ok) {
      throw new Error(`snapshot fetch failed: HTTP ${response.status}`);
    }
    return (await response.json()) as RawSnapshot;
  }

  cardUrl(entityId: string, viewMode: string): string | null {
    const parts = splitEntityId(entityId);
    if (!parts) return null;
    return `/world/card/${parts.entityType}/${parts.id}/${viewMode}`;
  }

  fetchHtml = async (url: string): Promise<string> => {
    const r = await fetch(withLangQuery(url), { headers: { Accept: "text/html" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  };

  assetUrl(path: string): string {
    return `${this.options.assetBase}${path}`;
  }
}

/**
 * Append the active language as `?lang=<code>` to a request URL.
 * Reads the language via getCurrentLang() — never looks at
 * window.location.
 */
export function withLangQuery(url: string): string {
  const lang = getCurrentLang();
  try {
    const out = new URL(url, window.location.href);
    out.searchParams.set("lang", lang);
    // Preserve relative paths when the input was relative.
    return url.startsWith("/")
      ? out.pathname + out.search + out.hash
      : out.toString();
  } catch {
    // Pathological URL — fall back to a naive append.
    return url + (url.includes("?") ? "&" : "?") + "lang=" + encodeURIComponent(lang);
  }
}

/** Append a query param to a URL, choosing `?` or `&` as needed. */
function withQuery(url: string, key: string, value: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}
