// A small synthetic corpus used by the vantage tests.
//
// Three sectors arranged around the origin in an equilateral triangle:
// fishing east, climbing northwest, cooking southwest. Six entities,
// including one borderland (fishing+climbing) for the multi-tag test.

import type { CorpusSnapshot, Entity, Signature } from "../src/world/types.js";

function sig(wordCount = 500, inDegree = 0): Signature {
  return {
    structural: {
      wordCount,
      paragraphCount: Math.ceil(wordCount / 100),
      imageCount: 0,
    },
    temporal: { createdAt: 1700000000, changedAt: 1700000000 },
    relational: { inDegree, outDegree: 0 },
    semantic: {},
  };
}

function entity(
  id: string,
  bundle: string,
  taxonomyTerms: string[],
  signature: Signature = sig(),
): Entity {
  return { id, bundle, taxonomyTerms, signature };
}

export function fixtureCorpus(): CorpusSnapshot {
  return {
    version: "test-1",
    world: {
      radius: 200,
      overviewHeight: 200,
      sectionVantageHeight: 30,
      closeUpDistance: 8,
      closeUpHeight: 2,
    },
    sectors: {
      fishing: {
        termId: "fishing",
        displayName: "Fishing",
        centroid: { x: 100, z: 0 },
        radius: 30,
      },
      climbing: {
        termId: "climbing",
        displayName: "Climbing",
        centroid: { x: -50, z: 87 },
        radius: 30,
      },
      cooking: {
        termId: "cooking",
        displayName: "Cooking",
        centroid: { x: -50, z: -87 },
        radius: 30,
      },
    },
    // Keys carry the entity-type prefix to match the cypher's
    // production snapshot shape ("node-19" etc.). The URLs in
    // vantage.test.ts strip the prefix (`/node/fish-1`); parseUrl
    // reconstructs `node-${id}` for the lookup.
    entities: {
      "node-fish-1": entity("node-fish-1", "article", ["fishing"]),
      "node-fish-2": entity("node-fish-2", "article", ["fishing"], sig(800, 3)),
      "node-climb-1": entity("node-climb-1", "article", ["climbing"]),
      "node-climb-2": entity("node-climb-2", "article", ["climbing"]),
      "node-cook-1": entity("node-cook-1", "article", ["cooking"]),
      "node-borderland": entity("node-borderland", "article", ["fishing", "climbing"]),
    },
  };
}
