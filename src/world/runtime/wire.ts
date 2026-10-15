// The wire side of the runtime: the snapshot shape the server sends
// (the descriptor contract, docs/ARCHITECTURE.md §3) and the transport
// that delivers it.
//
// The runtime never opens a connection itself. Every request — the
// snapshot, card HTML, asset URLs — goes through the WorldTransport the
// host binding supplies, so a host can serve the world from any backend
// (or from a bundled file, with no network at all). The rule is
// enforced by scripts/check-runtime-boundary.mjs.

import type { CorpusSnapshot } from "../types.js";
import type { BiomePaletteEntry } from "./BiomeMixer.js";

/** One entity as the snapshot carries it, before adaptSnapshot(). */
export interface DescriptorShape {
  _id: string;
  type: string;
  title?: string;
  summary?: string;
  sector?: string;
  sectorTermIds?: string[];
  signature?: unknown;
  /** BETA 2: explicit semantic-layout position, stamped by the
   *  publisher in semantic mode. Absent in taxonomy mode. */
  worldPos?: { x: number; z: number };
}

/**
 * Palette shape — mirrors the server's palette config schema. Every
 * color is a CSS hex string the renderer parses with THREE.Color.
 */
export interface Palette {
  background: string;
  fog: { color: string; near: number; far: number };
  ambient: { color: string; intensity: number };
  sun: { color: string; intensity: number; position: [number, number, number] };
  fill: { color: string; intensity: number; position: [number, number, number] };
  ground: { color: string };
  sectorPad: { color: string };
  compassPost: { color: string };
  bundleColors: Record<string, string>;
  /** Per-sector biome overlays. Empty array = global palette unchanged. */
  biomes?: BiomePaletteEntry[];
  /**
   * Active atmosphere key. "none" (or absent) = no atmosphere
   * builders register; defaults handle everything. Other values
   * load the atmosphere the host registered under that key, per
   * docs/ATMOSPHERES.md.
   */
  activeAtmosphere?: string;
}

/** The snapshot exactly as the transport returns it. */
export interface RawSnapshot {
  version: string;
  generatedAt: number;
  world: CorpusSnapshot["world"] & { palette?: Palette };
  sectors: CorpusSnapshot["sectors"];
  entities: Record<string, DescriptorShape>;
  /** v0.4+: live assets — omitted on legacy publish runs. */
  assets?: CorpusSnapshot["assets"];
}

export interface SnapshotRequest {
  /**
   * Read-only preview hint: serve this atmosphere instead of the
   * server's active one. A server may ignore it; the runtime renders
   * whatever the returned snapshot declares.
   */
  atmosphere?: string;
  /** Bypass HTTP caches — rebuilds need a just-saved change to show. */
  fresh: boolean;
}

/** Fetch an HTML fragment; rejects on any non-success response. */
export type HtmlFetcher = (url: string) => Promise<string>;

export interface WorldTransport {
  /** Load the descriptor snapshot. Rejects with a readable message. */
  loadSnapshot(request: SnapshotRequest): Promise<RawSnapshot>;
  /**
   * Where the HTML card for an entity lives, in a given view mode
   * ("default" for the in-world surface, the reading view mode for
   * FullView). Null when this entity has no card; the entity then
   * stays out of the card lifecycle.
   */
  cardUrl(entityId: string, viewMode: string): string | null;
  /** Fetch card / surface HTML from a URL cardUrl() produced. */
  fetchHtml: HtmlFetcher;
  /** Resolve a host asset path (textures, sounds) to a fetchable URL. */
  assetUrl(path: string): string;
}
