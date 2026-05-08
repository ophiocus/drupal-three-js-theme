<?php

declare(strict_types=1);

namespace Drupal\world_signature\Service;

/**
 * Assembles a corpus snapshot the renderer consumes.
 *
 * Snapshot shape (matches docs/ARCHITECTURE.md §5):
 *
 *   {
 *     "version":     "v1",
 *     "generatedAt": <unix-ts>,
 *     "world":       { radius, overviewHeight, sectionVantageHeight,
 *                      closeUpDistance, closeUpHeight },
 *     "sectors":     { <termId>: { termId, displayName, centroid, radius } },
 *     "entities":    { <descriptorId>: <descriptor> }
 *   }
 *
 * For ALPHA: pulls every descriptor from the gateway, derives sector
 * geometry from the unique `sector` values present in the corpus,
 * spreads them evenly on a circle. Atlas-managed embedding-driven
 * layout will refine this in v0.0.2.
 */
final class SnapshotPublisher {

  /** Distance from origin to each sector's centroid. */
  private const float SECTOR_RING_RADIUS = 100.0;

  /** Each sector's local radius (within-sector entity bounds). */
  private const float SECTOR_LOCAL_RADIUS = 30.0;

  /** Renderer-side world constants — match src/world/types.ts shape. */
  private const array WORLD_CONSTANTS = [
    'radius' => 200.0,
    'overviewHeight' => 200.0,
    'sectionVantageHeight' => 30.0,
    'closeUpDistance' => 8.0,
    'closeUpHeight' => 2.0,
  ];

  public function __construct(
    private readonly WorldSearchClient $client,
  ) {}

  /**
   * Build the full snapshot. Cheap when the corpus is small (ALPHA);
   * static-file caching lands in v0.0.2.
   */
  public function buildSnapshot(): array {
    $descriptors = $this->client->findAll();

    $sectorIds = $this->collectSectorIds($descriptors);
    $sectors = $this->placeSectors($sectorIds);

    $entities = [];
    foreach ($descriptors as $d) {
      $id = $d['_id'] ?? NULL;
      if ($id === NULL) {
        continue;
      }
      // Strip RESTHeart-internal fields the renderer doesn't need.
      unset($d['_etag']);
      $entities[$id] = $d;
    }

    return [
      'version' => 'v1',
      'generatedAt' => time(),
      'world' => self::WORLD_CONSTANTS,
      'sectors' => $sectors,
      'entities' => $entities,
    ];
  }

  /**
   * Deterministic sector centroid layout: spread N sectors evenly on
   * a circle. Same inputs → same coordinates across visitors and
   * snapshot generations (so `vantage()`'s determinism invariant
   * survives).
   */
  private function placeSectors(array $sectorIds): array {
    $sectorIds = array_values(array_unique(array_filter($sectorIds)));
    sort($sectorIds);
    $n = count($sectorIds);

    $sectors = [];
    foreach ($sectorIds as $i => $id) {
      $angle = $n > 0 ? (2.0 * M_PI * $i / $n) : 0.0;
      $sectors[$id] = [
        'termId' => $id,
        'displayName' => $this->humaniseTermId($id),
        'centroid' => [
          'x' => cos($angle) * self::SECTOR_RING_RADIUS,
          'z' => sin($angle) * self::SECTOR_RING_RADIUS,
        ],
        'radius' => self::SECTOR_LOCAL_RADIUS,
      ];
    }
    return $sectors;
  }

  private function collectSectorIds(array $descriptors): array {
    $ids = [];
    foreach ($descriptors as $d) {
      if (!empty($d['sector'])) {
        $ids[] = (string) $d['sector'];
      }
      foreach ($d['sectorTermIds'] ?? [] as $tid) {
        $ids[] = (string) $tid;
      }
    }
    return $ids;
  }

  private function humaniseTermId(string $id): string {
    // Numeric IDs (Drupal term tids) get a fallback label; future
    // snapshots can join the term entity to fetch real names.
    if (ctype_digit($id)) {
      return 'Sector ' . $id;
    }
    return ucwords(str_replace(['-', '_'], ' ', $id));
  }

}
