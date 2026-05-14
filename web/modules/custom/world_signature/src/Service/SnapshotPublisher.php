<?php

declare(strict_types=1);

namespace Drupal\world_signature\Service;

use Drupal\Core\Config\ConfigFactoryInterface;

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
    private readonly ConfigFactoryInterface $configFactory,
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

    $world = self::WORLD_CONSTANTS;
    $world['palette'] = $this->loadPalette();

    return [
      'version' => 'v1',
      'generatedAt' => time(),
      'world' => $world,
      'sectors' => $sectors,
      'entities' => $entities,
    ];
  }

  /**
   * Read world_signature.palette config and resolve it into the
   * shape the renderer's Palette interface expects.
   *
   * Three transforms happen here, in order:
   *   1. Merge config over the baked-in fallback so every key the
   *      renderer needs is present even on a config-less install.
   *   2. Apply the active atmosphere's overlay (option-f, per
   *      docs/v0.2/ROADMAP.md §P1) — atmosphere_overrides[<active>]
   *      merged onto the base palette. The biome blend runs on top
   *      of this on the renderer side.
   *   3. snake_case → camelCase + strip config-only keys: Drupal
   *      config uses active_atmosphere; the renderer wants
   *      activeAtmosphere. atmosphere_overrides is config-only and
   *      never reaches the renderer.
   */
  private function loadPalette(): array {
    $config = $this->configFactory->get('world_signature.palette');
    $palette = $config->getRawData() ?: [];
    if ($palette === []) {
      return self::FALLBACK_PALETTE;
    }
    // 1. Merge config over the fallback.
    $merged = array_replace_recursive(self::FALLBACK_PALETTE, $palette);

    // 2. Apply the active atmosphere's palette overlay.
    $active = $merged['active_atmosphere'] ?? 'none';
    if ($active !== 'none') {
      $overlay = $merged['atmosphere_overrides'][$active] ?? [];
      if ($overlay !== []) {
        $merged = array_replace_recursive($merged, $overlay);
      }
    }

    // 3. snake_case → camelCase; strip config-only keys.
    if (isset($merged['active_atmosphere'])) {
      $merged['activeAtmosphere'] = $merged['active_atmosphere'];
      unset($merged['active_atmosphere']);
    }
    unset($merged['atmosphere_overrides']);

    return $merged;
  }

  private const array FALLBACK_PALETTE = [
    'active_atmosphere' => 'none',
    'background' => '#d0dce6',
    'fog' => ['color' => '#c8d8e0', 'near' => 80.0, 'far' => 500.0],
    'ambient' => ['color' => '#e8efe9', 'intensity' => 0.85],
    'sun' => [
      'color' => '#fffae0',
      'intensity' => 1.3,
      'position' => [80.0, 120.0, 60.0],
    ],
    'fill' => [
      'color' => '#a8c4dc',
      'intensity' => 0.45,
      'position' => [-80.0, 60.0, -60.0],
    ],
    'ground' => ['color' => '#c4dec4'],
    'sectorPad' => ['color' => '#a4c498'],
    'compassPost' => ['color' => '#a8b4c0'],
    'bundleColors' => [
      'article' => '#8eb887',
      'profile' => '#92aabe',
      'event' => '#d8d098',
      'default' => '#a8b4b8',
    ],
    // Per-sector biome overlays — see config/install/world_signature.palette.yml
    // for the canonical defaults. The renderer assigns biomes to
    // sectors in termId-ascending order, blending by inverse-square
    // distance. Empty array = renderer falls back to the global
    // palette unchanged (no biome blending).
    'biomes' => [
      [
        'label' => 'Volcanic Central America',
        'background' => '#cad6c2',
        'fog' => ['color' => '#c8d2c2', 'near' => 80.0, 'far' => 480.0],
        'ambient' => ['color' => '#f0e8c8', 'intensity' => 0.95],
      ],
      [
        'label' => 'High Andes',
        'background' => '#d8dfe6',
        'fog' => ['color' => '#cdd6e0', 'near' => 100.0, 'far' => 520.0],
        'ambient' => ['color' => '#e8eef4', 'intensity' => 0.85],
      ],
      [
        'label' => 'Cloud forest',
        'background' => '#c4cfd6',
        'fog' => ['color' => '#b8c4cc', 'near' => 60.0, 'far' => 420.0],
        'ambient' => ['color' => '#d8e0e6', 'intensity' => 0.70],
      ],
      [
        'label' => 'Mountain dust',
        'background' => '#d4ccba',
        'fog' => ['color' => '#ccc2b0', 'near' => 80.0, 'far' => 480.0],
        'ambient' => ['color' => '#f4e8c8', 'intensity' => 0.90],
      ],
      [
        'label' => 'Saturated green',
        'background' => '#c6d6c4',
        'fog' => ['color' => '#bccdba', 'near' => 90.0, 'far' => 500.0],
        'ambient' => ['color' => '#e0e8d8', 'intensity' => 0.88],
      ],
    ],
  ];

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
