// Core data shapes for the world model.
//
// The thesis: a URI is a coordinate. These types are the vocabulary
// the URI-to-coordinate function speaks.

export interface Vec2 {
  x: number;
  z: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Sector {
  termId: string;
  displayName: string;
  centroid: Vec2;
  radius: number;
}

export interface SignatureStructural {
  wordCount: number;
  paragraphCount: number;
  imageCount: number;
}

export interface SignatureTemporal {
  createdAt: number;
  changedAt: number;
}

export interface SignatureRelational {
  inDegree: number;
  outDegree: number;
}

export interface SignatureSemantic {
  // Embedding deferred to v2; signature schema reserves the slot.
  embedding?: number[];
}

export interface Signature {
  structural: SignatureStructural;
  temporal: SignatureTemporal;
  relational: SignatureRelational;
  semantic: SignatureSemantic;
}

export interface Entity {
  id: string;
  bundle: string;
  // Top-level taxonomy term ids; first is the "primary" sector.
  taxonomyTerms: string[];
  signature: Signature;
  // Display title. Added v0.4 for HUD labels (information LOD
  // Activity B). Empty for legacy snapshots before the
  // DescriptorBuilder exposed it as a top-level field.
  title?: string;
  // First-sentence body summary (~140 chars). Surfaced as a hover
  // subtitle on the entity's title label. Empty for legacy
  // snapshots from before DescriptorBuilder.extractSummary.
  summary?: string;
  // BETA 2: explicit world position from the semantic layout
  // projection. Present only when the snapshot was built in
  // semantic layout-mode (drush world:relayout). When present,
  // entityPosition() returns it directly instead of computing the
  // taxonomy+hash placement. Absent → taxonomy fallback.
  worldPos?: Vec2;
}

export interface WorldConstants {
  radius: number;
  overviewHeight: number;
  sectionVantageHeight: number;
  closeUpDistance: number;
  closeUpHeight: number;
  /**
   * Phase 3 freshness signal (docs/TOOLBOX_AND_STAGE.md): last
   * `drush world:embed` execution. Null when no embed has ever run.
   */
  lastEmbed?: {
    at: number;            // unix seconds
    modelVersion: string;
    dimensions: number;
    embedded: number;
  } | null;
}

/**
 * A live asset emitted by /world/snapshot/* — see
 * docs/v0.4/ROADMAP.md §A.2 for the server-side spec.
 *
 * The `slot` is the canonical join key: builders binding a bundle
 * to a slot via mappings.yml look up the asset by slot machine name.
 *
 * `atmospheres` is the eligibility list — builders intersect it
 * with the active atmosphere to decide whether this asset applies
 * to the current world.
 */
export interface AssetDescriptor {
  nid: number;
  slot: string;
  atmospheres: string[];
  curatedFileUrl: string;
  curatedFileSize: number;
  polycount: number | null;
  pivot: "base" | "center" | "custom";
  pack?: {
    nid: number;
    title: string;
    license: string;
    attribution: string;
    sourceUrl: string;
  };
}

export interface CorpusSnapshot {
  version: string;
  world: WorldConstants;
  sectors: Record<string, Sector>;
  entities: Record<string, Entity>;
  /**
   * Live assets the editor has marked `live` in Drupal. v0.4+ /
   * ALPHA 1 — assets the renderer should load instead of falling
   * back to primitive geometry. Always present as an array
   * (possibly empty); legacy snapshots before A.2 omitted the key,
   * and adaptSnapshot supplies `[]` as the default.
   */
  assets: AssetDescriptor[];
}

export type VantageKind = "front" | "section" | "detail" | "listing";

export interface Vantage {
  kind: VantageKind;
  /**
   * The URL this vantage is the inverse of. CameraController uses
   * this when settling to write `history.replaceState` so the
   * world→URL arrow of the coordinate diagram commutes.
   */
  uri: string;
  // null when the vantage is not "inside" any sector (front, listing).
  sectorId: string | null;
  position: Vec3;
  lookAt: Vec3;
  // Vertical field of view, degrees.
  fov: number;
}
