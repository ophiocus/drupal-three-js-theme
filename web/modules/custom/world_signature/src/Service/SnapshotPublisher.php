<?php

declare(strict_types=1);

namespace Drupal\world_signature\Service;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\State\StateInterface;
use Drupal\node\NodeInterface;

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
 *     "entities":    { <descriptorId>: <descriptor> },
 *     "assets":      [ {nid, slot, atmospheres, curatedFileUrl, ...} ]
 *   }
 *
 * For ALPHA: pulls every descriptor from the gateway, derives sector
 * geometry from the unique `sector` values present in the corpus,
 * spreads them evenly on a circle. Atlas-managed embedding-driven
 * layout will refine this in BETA 2 (docs/MILESTONES.md).
 *
 * v0.4 / ALPHA 1: the `assets[]` block lets the renderer load real
 * .glb meshes for entities whose bundle binds to a slot the editor
 * has marked `live`. See AssetSnapshotBuilder + ROADMAP.md §A.2.
 */
final class SnapshotPublisher {

  /** Distance from origin to each sector's centroid. */
  private const float SECTOR_RING_RADIUS = 100.0;

  /** Each sector's local radius (within-sector entity bounds). */
  private const float SECTOR_LOCAL_RADIUS = 30.0;

  /** Renderer-side world constants — match src/world/types.ts shape. */
  // closeUpDistance / closeUpHeight were tuned in ALPHA for
  // 12-unit cubes. The SmartObject era renders entities as trees
  // up to ~28 units tall with an HTML surface floating beside
  // them; a camera 8 units back at height 2 frames the trunk
  // base and nothing else. v0.2.1-P4 bumps them so the detail
  // vantage frames the entity AND its card surface.
  private const array WORLD_CONSTANTS = [
    'radius' => 200.0,
    'overviewHeight' => 200.0,
    'sectionVantageHeight' => 30.0,
    'closeUpDistance' => 32.0,
    'closeUpHeight' => 14.0,
  ];

  /** State keys for the BETA 2 semantic layout. */
  public const string STATE_LAYOUT_MODE = 'world_signature.layout_mode';
  public const string STATE_SEMANTIC_LAYOUT = 'world_signature.semantic_layout';

  /**
   * Max corpus size for which raw embedding vectors are shipped in the
   * snapshot (for client-side interpretation, docs/INTERPRETATION_ENGINE.md).
   * Above this the payload cost outweighs the benefit; large worlds use
   * the server-side projection path. ~400 × 512 floats ≈ a couple MB ceiling.
   */
  public const int INTERPRETATION_EMBEDDING_LIMIT = 400;

  public function __construct(
    private readonly WorldSearchClient $client,
    private readonly ConfigFactoryInterface $configFactory,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly AssetSnapshotBuilder $assetBuilder,
    private readonly StateInterface $state,
  ) {}

  /**
   * Build the full snapshot. Cheap when the corpus is small (ALPHA);
   * static-file caching lands later.
   *
   * Returns the snapshot payload + the CacheableMetadata to attach
   * to the response so editorial asset edits invalidate the
   * downstream caches. Caller is responsible for assembling the
   * HTTP response with the metadata.
   *
   * @param string|null $atmosphereOverride
   *   Optional read-only atmosphere preview hint (v1.5 world switcher).
   *   When set, it overrides the active World node's atmosphere for THIS
   *   snapshot only — the palette overlay differs, nothing is persisted.
   *   The caller (WorldController) validates it against the known set.
   *
   * @return array{
   *   payload: array<string, mixed>,
   *   cacheability: \Drupal\Core\Cache\CacheableMetadata,
   * }
   */
  public function buildSnapshot(?string $atmosphereOverride = NULL): array {
    $descriptors = $this->client->findAll();

    // ALPHA 1: the world's characteristics are declared as content.
    // Read the active World node; every value falls back to the
    // baked-in learned-lesson constant when its field is empty (or
    // when no World node exists at all — additive, non-breaking).
    $worldNode = $this->activeWorld();
    $ringRadius = $this->worldNum($worldNode, 'field_world_sector_ring_radius', self::SECTOR_RING_RADIUS);
    $localRadius = $this->worldNum($worldNode, 'field_world_sector_local_radius', self::SECTOR_LOCAL_RADIUS);

    $sectorIds = $this->collectSectorIds($descriptors);
    $sectors = $this->placeSectors($sectorIds, $ringRadius, $localRadius);

    // Interpretation engine (docs/INTERPRETATION_ENGINE.md): for small
    // corpora, ship the raw embedding vectors so a world's atmosphere can
    // run its OWN client-side interpretation (e.g. inner-mind's 3D
    // projection) — "each world its own lens." Above this size the
    // payload cost wins and we keep stripping; large worlds use the
    // server-side projection path instead (open question O-I3).
    $shipEmbeddings = count($descriptors) <= self::INTERPRETATION_EMBEDDING_LIMIT;

    $entities = [];
    foreach ($descriptors as $d) {
      $id = $d['_id'] ?? NULL;
      if ($id === NULL) {
        continue;
      }
      // Strip RESTHeart-internal fields the renderer doesn't need.
      unset($d['_etag']);
      // The raw embedding is high-dim (256-2048 floats × N). Strip it
      // unless we're shipping it for client-side interpretation.
      if (!$shipEmbeddings && isset($d['signature']['semantic']['embedding'])) {
        unset($d['signature']['semantic']['embedding']);
      }
      $entities[$id] = $d;
    }

    // BETA 2: semantic layout override. When layout_mode is
    // "semantic" and a stored layout exists (from drush
    // world:relayout), stamp each entity with its projected
    // worldPos and replace sector centroids/radii with the
    // emergent values. Renderer reads worldPos first, falling back
    // to taxonomy+hash placement for any entity the layout misses.
    $layoutMode = (string) $this->state->get(self::STATE_LAYOUT_MODE, 'taxonomy');
    if ($layoutMode === 'semantic') {
      $layout = $this->state->get(self::STATE_SEMANTIC_LAYOUT);
      if (is_array($layout)) {
        $this->applySemanticLayout($entities, $sectors, $layout);
      }
    }

    // World block — node fields over baked-in constants.
    $world = [
      'radius' => $this->worldNum($worldNode, 'field_world_radius', self::WORLD_CONSTANTS['radius']),
      'overviewHeight' => $this->worldNum($worldNode, 'field_world_overview_height', self::WORLD_CONSTANTS['overviewHeight']),
      'sectionVantageHeight' => $this->worldNum($worldNode, 'field_world_section_height', self::WORLD_CONSTANTS['sectionVantageHeight']),
      'closeUpDistance' => $this->worldNum($worldNode, 'field_world_closeup_distance', self::WORLD_CONSTANTS['closeUpDistance']),
      'closeUpHeight' => $this->worldNum($worldNode, 'field_world_closeup_height', self::WORLD_CONSTANTS['closeUpHeight']),
    ];
    // Atmosphere: the World node overrides palette config's active_atmosphere;
    // a request-level preview hint (v1.5 switcher, controller-validated) in
    // turn overrides the node — read-only, this response only.
    $atmosphere = $this->worldStr($worldNode, 'field_world_atmosphere', NULL);
    if ($atmosphereOverride !== NULL && $atmosphereOverride !== '') {
      $atmosphere = $atmosphereOverride;
    }
    $world['palette'] = $this->loadPalette($atmosphere);
    $world['layoutMode'] = $layoutMode;
    // Phase 3 v3 (docs/INTERPRETATION_ENGINE.md): ship the active
    // atmosphere's interpretation profile so the Stage editor can
    // surface it and so a future client-side anchored projector can
    // read poles + axes from the snapshot instead of hardcoding them.
    // NULL when the active atmosphere has no profile entry.
    $world['interpretation'] = $this->loadInterpretation($atmosphere);
    // Phase 3 v3 activation: per-atmosphere anchor-axis vectors as
    // computed by the most recent embed pass (EmbedRunner Pass 4).
    // NULL when no embed has produced axes yet, or when the active
    // atmosphere has no anchors profile. The renderer's anchored
    // projector multiplies each entity embedding against these to
    // mint authored meaning (INTERPRETATION_ENGINE.md §3).
    $world['interpretationAxes'] = $this->loadInterpretationAxes($atmosphere);
    // Phase 4 — per-atmosphere stage-fixture placements (zodiac
    // signs and, later, scenery rings / monuments). NULL when no
    // edits have been published yet for this atmosphere; the
    // renderer falls back to its deterministic default placement.
    $world['stage'] = $this->loadStage($atmosphere);
    // Phase 3 freshness signal (docs/TOOLBOX_AND_STAGE.md): the most
    // recent `drush world:embed` records when it ran and which model;
    // editors read it via the in-canvas Stage panel to see how stale
    // their world's semantics are. Null when no embed has ever run.
    $lastEmbed = $this->state->get('world_signature.last_embed');
    $world['lastEmbed'] = is_array($lastEmbed) ? $lastEmbed : NULL;

    // v0.4 / ALPHA 1: live asset payload embedded alongside entities.
    // The sidecar /world/snapshot/assets endpoint serves the same
    // block in isolation for diagnostic use; both call the same
    // builder so cache invariants stay coherent.
    $assetResult = $this->assetBuilder->build();

    $cacheability = new CacheableMetadata();
    $cacheability->addCacheableDependency($assetResult['cacheability']);
    // Palette config tag — atmosphere overlay shifts invalidate.
    $cacheability->addCacheTags(['config:world_signature.palette']);
    // Phase 3 v3 interpretation config tag — anchor pole edits invalidate.
    $cacheability->addCacheTags(['config:world_signature.interpretation']);
    // Phase 4 stage config tag — placement edits invalidate.
    $cacheability->addCacheTags(['config:world_signature.stage']);
    // World content — editing the active World node invalidates the snapshot.
    $cacheability->addCacheTags(['node_list:world']);
    // Phase 3 v1: state-driven freshness (world.lastEmbed) — State API
    // has no cache tags of its own, so we mint one. EmbedRunner
    // invalidates it after a successful embed so the next snapshot
    // fetch sees the fresh timestamp instead of a stale dynamic-page
    // cache hit.
    $cacheability->addCacheTags(['world_signature:embed']);
    if ($worldNode !== NULL) {
      $cacheability->addCacheableDependency($worldNode);
    }

    $payload = [
      'version' => 'v1',
      'generatedAt' => time(),
      'world' => $world,
      'sectors' => $sectors,
      'entities' => $entities,
      'assets' => $assetResult['assets'],
    ];

    return ['payload' => $payload, 'cacheability' => $cacheability];
  }

  /**
   * Apply a stored semantic layout over the taxonomy-derived
   * entities + sectors. Mutates both arrays in place.
   *
   * - Each entity gains a `worldPos` {x, z} from the projection.
   * - Each sector's centroid + radius are replaced with the
   *   emergent values (mean of member positions + spread). The
   *   sector concept survives but becomes DESCRIPTIVE (where this
   *   region's content landed in semantic space) rather than
   *   PRESCRIPTIVE (a circle slice the content is forced into).
   *
   * @param array<string, array<string, mixed>> $entities
   * @param array<string, array<string, mixed>> $sectors
   * @param array{entities?: array, sectors?: array} $layout
   */
  private function applySemanticLayout(array &$entities, array &$sectors, array $layout): void {
    $entityPos = $layout['entities'] ?? [];
    $sectorPos = $layout['sectors'] ?? [];

    foreach ($entities as $id => &$d) {
      if (isset($entityPos[$id]['x'], $entityPos[$id]['z'])) {
        $d['worldPos'] = [
          'x' => (float) $entityPos[$id]['x'],
          'z' => (float) $entityPos[$id]['z'],
        ];
      }
    }
    unset($d);

    foreach ($sectors as $termId => &$sector) {
      if (isset($sectorPos[$termId]['x'], $sectorPos[$termId]['z'])) {
        $sector['centroid'] = [
          'x' => (float) $sectorPos[$termId]['x'],
          'z' => (float) $sectorPos[$termId]['z'],
        ];
        if (isset($sectorPos[$termId]['radius'])) {
          $sector['radius'] = (float) $sectorPos[$termId]['radius'];
        }
      }
    }
    unset($sector);
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
  /**
   * Phase 3 v3 — read the interpretation profile for the active
   * atmosphere from `world_signature.interpretation` config. Returns
   * NULL when the atmosphere has no profile (e.g. `none`, `forest`),
   * which the client treats as "use the default behavior."
   *
   * Shape (today, see config/install/world_signature.interpretation.yml):
   *   { frame_mode, dimensionality, axes: [{ name, pole_a, pole_b }] }
   *
   * The shipped block carries authorial intent — until the server-side
   * anchored projector lands (INTERPRETATION_ENGINE.md §4 / §6), poles
   * are not yet projected against. The Stage editor still benefits:
   * editors can author + save poles now; activation follows.
   */
  private function loadInterpretation(?string $atmosphere): ?array {
    if ($atmosphere === NULL || $atmosphere === '' || $atmosphere === 'none') {
      return NULL;
    }
    $config = $this->configFactory->get('world_signature.interpretation');
    $profiles = $config->get('profiles') ?? [];
    if (!is_array($profiles) || !isset($profiles[$atmosphere])) {
      return NULL;
    }
    $profile = $profiles[$atmosphere];
    if (!is_array($profile)) {
      return NULL;
    }
    // Defensive shape — the client should be able to assume axes is
    // an array of {name, pole_a, pole_b} maps.
    $axes = [];
    foreach ($profile['axes'] ?? [] as $a) {
      if (!is_array($a)) {
        continue;
      }
      $axes[] = [
        'name' => (string) ($a['name'] ?? ''),
        'pole_a' => (string) ($a['pole_a'] ?? ''),
        'pole_b' => (string) ($a['pole_b'] ?? ''),
      ];
    }
    return [
      'frameMode' => (string) ($profile['frame_mode'] ?? 'mds'),
      'dimensionality' => (int) ($profile['dimensionality'] ?? 3),
      'axes' => $axes,
      // Phase 3 v3 polish — last edit timestamp for the staleness
      // indicator. 0 when the profile hasn't been edited since
      // install (the seed values).
      'updatedAt' => (int) ($profile['updated_at'] ?? 0),
    ];
  }

  /**
   * Phase 3 v3 activation — read the per-atmosphere anchor-axis
   * vectors EmbedRunner stamps into State after embedding the
   * authored poles. NULL when no axes are stamped for this
   * atmosphere (no embed has run, or this atmosphere's profile
   * isn't `anchors`).
   *
   * Shape returned to the client (under `world.interpretationAxes`):
   *   {
   *     modelVersion: string,
   *     embeddedAt: int,
   *     dimensions: int,
   *     axes: [{ name: string, vector: float[] }]
   *   }
   *
   * The freshness signal (`config:world_signature.interpretation`
   * + `world_signature:embed` cache tags already attached to the
   * snapshot) covers invalidation: editing the profile prose busts
   * the snapshot but the *vectors* don't refresh until the editor
   * triggers a re-embed.
   */
  private function loadInterpretationAxes(?string $atmosphere): ?array {
    if ($atmosphere === NULL || $atmosphere === '' || $atmosphere === 'none') {
      return NULL;
    }
    $all = $this->state->get('world_signature.interpretation_axes');
    if (!is_array($all) || !isset($all[$atmosphere]) || !is_array($all[$atmosphere])) {
      return NULL;
    }
    $bundle = $all[$atmosphere];
    $axes = [];
    foreach (($bundle['axes'] ?? []) as $a) {
      if (!is_array($a) || !is_array($a['vector'] ?? NULL)) {
        continue;
      }
      $axes[] = [
        'name' => (string) ($a['name'] ?? ''),
        'vector' => array_values(array_map('floatval', $a['vector'])),
      ];
    }
    if ($axes === []) {
      return NULL;
    }
    return [
      'modelVersion' => (string) ($bundle['modelVersion'] ?? ''),
      'embeddedAt' => (int) ($bundle['embeddedAt'] ?? 0),
      'dimensions' => (int) ($bundle['dimensions'] ?? count($axes[0]['vector'])),
      'axes' => $axes,
    ];
  }

  /**
   * Phase 4 — read the active atmosphere's published stage-fixture
   * placements from `world_signature.stage`. Shape shipped to the
   * client (under `world.stage`):
   *
   *   { layers: { zodiac: [{ angle, height, scale }], ... } }
   *
   * Empty layers are omitted; if no layer has been published yet
   * the whole block is NULL — the renderer treats absence as
   * "use the deterministic default placement."
   */
  private function loadStage(?string $atmosphere): ?array {
    if ($atmosphere === NULL || $atmosphere === '' || $atmosphere === 'none') {
      return NULL;
    }
    $all = $this->configFactory
      ->get('world_signature.stage')
      ->get('placements') ?? [];
    if (!is_array($all) || !isset($all[$atmosphere]) || !is_array($all[$atmosphere])) {
      return NULL;
    }
    $layers = [];
    foreach ($all[$atmosphere] as $layer => $placements) {
      if (!is_array($placements) || $placements === []) {
        continue;
      }
      $clean = [];
      foreach ($placements as $p) {
        if (!is_array($p)) {
          continue;
        }
        $clean[] = [
          'angle' => (float) ($p['angle'] ?? 0),
          'height' => (float) ($p['height'] ?? 0),
          'scale' => (float) ($p['scale'] ?? 1),
        ];
      }
      if ($clean !== []) {
        $layers[(string) $layer] = $clean;
      }
    }
    return $layers === [] ? NULL : ['layers' => $layers];
  }

  private function loadPalette(?string $atmosphereOverride = NULL): array {
    $config = $this->configFactory->get('world_signature.palette');
    $palette = $config->getRawData() ?: [];
    if ($palette === [] && $atmosphereOverride === NULL) {
      return self::FALLBACK_PALETTE;
    }
    // 1. Merge config over the fallback.
    $merged = array_replace_recursive(self::FALLBACK_PALETTE, $palette);

    // ALPHA 1: the active World node's atmosphere wins over config.
    if ($atmosphereOverride !== NULL && $atmosphereOverride !== '') {
      $merged['active_atmosphere'] = $atmosphereOverride;
    }

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
  private function placeSectors(array $sectorIds, float $ringRadius = self::SECTOR_RING_RADIUS, float $localRadius = self::SECTOR_LOCAL_RADIUS): array {
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
          'x' => cos($angle) * $ringRadius,
          'z' => sin($angle) * $ringRadius,
        ],
        'radius' => $localRadius,
      ];
    }
    return $sectors;
  }

  /**
   * Load the active World node — the one whose characteristics the
   * snapshot publishes. Selection: the published `world` node with
   * field_world_active set; if none (or several), the lowest node id
   * wins; NULL when there are no World nodes at all (publisher then
   * uses the baked-in constants).
   */
  private function activeWorld(): ?NodeInterface {
    try {
      $storage = $this->entityTypeManager->getStorage('node');
      $worlds = $storage->loadByProperties(['type' => 'world', 'status' => 1]);
    }
    catch (\Throwable) {
      return NULL;
    }
    if ($worlds === []) {
      return NULL;
    }
    ksort($worlds);
    foreach ($worlds as $world) {
      if ($world->hasField('field_world_active')
        && !$world->get('field_world_active')->isEmpty()
        && (bool) $world->get('field_world_active')->value) {
        return $world;
      }
    }
    return reset($worlds);
  }

  /** Read a numeric World field, or the baked-in default when empty. */
  private function worldNum(?NodeInterface $world, string $field, float $default): float {
    if ($world !== NULL && $world->hasField($field) && !$world->get($field)->isEmpty()) {
      return (float) $world->get($field)->value;
    }
    return $default;
  }

  /** Read a string World field, or a default when empty. */
  private function worldStr(?NodeInterface $world, string $field, ?string $default): ?string {
    if ($world !== NULL && $world->hasField($field) && !$world->get($field)->isEmpty()) {
      return (string) $world->get($field)->value;
    }
    return $default;
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
    // Numeric IDs (Drupal term tids): load the term and use its
    // real name ("Antigua, Guatemala", "Cauca, Colombia", etc.).
    // Resurrected from the v0.1.x placeholder "Sector $id" fallback
    // — surfaced as visible-but-wrong labels by the v0.4 research
    // WorldHud prototype on master's research/information-lod
    // branch.
    if (ctype_digit($id)) {
      $term = $this->entityTypeManager
        ->getStorage('taxonomy_term')
        ->load((int) $id);
      if ($term) {
        return (string) $term->label();
      }
      // Term gone (deleted between publish + snapshot fetch) —
      // fall through to the legacy placeholder rather than crash.
      return 'Sector ' . $id;
    }
    return ucwords(str_replace(['-', '_'], ' ', $id));
  }

}
