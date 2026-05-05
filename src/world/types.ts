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
}

export interface WorldConstants {
  radius: number;
  overviewHeight: number;
  sectionVantageHeight: number;
  closeUpDistance: number;
  closeUpHeight: number;
}

export interface CorpusSnapshot {
  version: string;
  world: WorldConstants;
  sectors: Record<string, Sector>;
  entities: Record<string, Entity>;
}

export type VantageKind = "front" | "section" | "detail" | "listing";

export interface Vantage {
  kind: VantageKind;
  // null when the vantage is not "inside" any sector (front, listing).
  sectorId: string | null;
  position: Vec3;
  lookAt: Vec3;
  // Vertical field of view, degrees.
  fov: number;
}
