<?php

declare(strict_types=1);

namespace Drupal\world_signature\Service;

use Drupal\Core\Cache\Cache;
use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Logger\LoggerChannelInterface;
use Drupal\Core\State\StateInterface;
use Drupal\world_signature\Embedding\EmbeddingManager;
use Drupal\world_signature\Plugin\MetaphorPluginManager;
use Drupal\world_signature\Signature\Signature;
use Drupal\world_signature\Signature\SignatureExtractor;
use Drupal\world_signature\Signature\SignatureSemantic;

/**
 * EmbedRunner — single source of truth for "embed the whole corpus and
 * write the vectors back into each entity's signature."
 *
 * Used by both `drush world:embed` and the admin
 * `POST /world/admin/embed` endpoint (Phase 3 v1, see
 * docs/TOOLBOX_AND_STAGE.md §2.3 and §4 Phase 3), so a CLI vs.
 * in-canvas-button invocation can never drift in semantics.
 *
 * Embedding *compute* still happens externally when WORLD_EMBED_URL is
 * set (per docs/BOUNDARY.md); the local TF-IDF provider is the dev
 * fallback. This service just orchestrates the gather → embed →
 * write-back loop and records the freshness state the Stage panel
 * reads.
 */
final class EmbedRunner {

  /** State key — per-atmosphere anchor-axis vectors stamped by the
   *  Phase 3 v3 activation pass. Snapshot ships them under
   *  `world.interpretationAxes`. */
  public const string STATE_INTERPRETATION_AXES = 'world_signature.interpretation_axes';

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly EntityFactsReader $factsReader,
    private readonly SignatureExtractor $extractor,
    private readonly SignatureWriter $writer,
    private readonly DescriptorBuilder $descriptorBuilder,
    private readonly WorldSearchClient $searchClient,
    private readonly MetaphorPluginManager $metaphorManager,
    private readonly EmbeddingManager $embeddingManager,
    private readonly StateInterface $state,
    private readonly LoggerChannelInterface $logger,
    private readonly ConfigFactoryInterface $configFactory,
  ) {}

  /**
   * Run the full embed pass.
   *
   * @return array{
   *   embedded: int,
   *   errors: int,
   *   modelVersion: string,
   *   dimensions: int,
   *   embeddedAt: int,
   * }
   *
   * @throws \RuntimeException
   *   When there are no metaphor plugins (nothing claims any bundle)
   *   or the corpus is empty (no participating entities exist).
   */
  public function run(): array {
    $participating = $this->collectParticipatingBundles();
    if ($participating === []) {
      throw new \RuntimeException('No metaphor plugins registered. Nothing to embed.');
    }

    // Pass 1: gather corpus text per descriptor.
    $corpus = [];
    $work = [];
    foreach ($participating as $entityType => $bundles) {
      $storage = $this->entityTypeManager->getStorage($entityType);
      $query = $storage->getQuery()->accessCheck(FALSE);
      $bundleKey = $this->entityTypeManager->getDefinition($entityType)->getKey('bundle');
      if ($bundleKey) {
        $query->condition($bundleKey, $bundles, 'IN');
      }
      foreach ($query->execute() as $id) {
        $entity = $storage->load($id);
        if ($entity === NULL) {
          continue;
        }
        $facts = $this->factsReader->read($entity);
        if ($facts === NULL) {
          continue;
        }
        $descriptorId = $this->descriptorBuilder->descriptorId($entityType, (string) $id);
        $corpus[$descriptorId] = $this->descriptorBuilder->embeddingText($entity, $facts);
        $work[$descriptorId] = [
          'entityType' => $entityType,
          'entityId' => (string) $id,
          'entity' => $entity,
          'facts' => $facts,
        ];
      }
    }

    if ($corpus === []) {
      throw new \RuntimeException('Corpus is empty. Nothing to embed.');
    }

    // Pass 2: embed the whole corpus at once.
    $result = $this->embeddingManager->embedCorpus($corpus);
    $vectors = $result['vectors'];
    $modelVersion = $result['modelVersion'];
    $dimensions = $result['dimensions'];
    $embeddedAt = time();

    // Pass 3: inject the vector into each signature, write back,
    // re-upsert the descriptor so the gateway carries the vector.
    $written = 0;
    $errors = 0;
    foreach ($work as $descriptorId => $w) {
      $vector = $vectors[$descriptorId] ?? NULL;
      if ($vector === NULL) {
        continue;
      }
      try {
        $base = $this->extractor->extract($w['facts']);
        $semantic = new SignatureSemantic(
          embedding: $vector,
          modelVersion: $modelVersion,
          embeddedAt: $embeddedAt,
          semanticHash: $base->semantic->semanticHash,
        );
        $signature = new Signature(
          $base->structural,
          $base->temporal,
          $base->relational,
          $semantic,
        );
        $this->writer->write($w['entity'], $signature);

        $pluginId = sprintf('%s:%s', $w['entityType'], $w['entity']->bundle());
        $metaphor = $this->metaphorManager->createInstance($pluginId);
        $descriptor = $this->descriptorBuilder->build(
          $w['entity'], $w['facts'], $signature, $metaphor,
        );
        $this->searchClient->upsert($descriptor);
        $written++;
      }
      catch (\Throwable $e) {
        $errors++;
        $this->logger->error(sprintf('%s embed failed: %s', $descriptorId, $e->getMessage()));
      }
    }

    // Pass 4 (Phase 3 v3 activation, INTERPRETATION_ENGINE.md §3):
    // for each atmosphere with an `anchors` frame mode, embed each
    // axis's pole prose, compute the axis direction
    // `normalize(emb_a - emb_b)`, orthogonalize the axis set
    // (Gram–Schmidt), and persist per-atmosphere axis vectors so
    // the snapshot can ship them and the client can project against
    // authored meaning.
    $axesByAtmosphere = $this->embedAnchorAxes($modelVersion, $embeddedAt);

    // Phase 3 freshness signal (the Stage panel reads this via the
    // snapshot's world.lastEmbed block).
    $this->state->set('world_signature.last_embed', [
      'at' => $embeddedAt,
      'modelVersion' => $modelVersion,
      'dimensions' => $dimensions,
      'embedded' => $written,
    ]);
    if ($axesByAtmosphere !== []) {
      $this->state->set(self::STATE_INTERPRETATION_AXES, $axesByAtmosphere);
    }
    // Bust the snapshot's dynamic-page-cache entry so the next fetch
    // serves the fresh lastEmbed + interpretation axes (State has no
    // cache tags of its own).
    Cache::invalidateTags(['world_signature:embed']);

    return [
      'embedded' => $written,
      'errors' => $errors,
      'modelVersion' => $modelVersion,
      'dimensions' => $dimensions,
      'embeddedAt' => $embeddedAt,
    ];
  }

  // ─── Batch-driven API ─────────────────────────────────────────────────
  // Three public methods that mirror the phases inside run(), so a
  // Drupal Batch can drive the pipeline with progress + cancel + the
  // session not timing out. The corpus-wide IDF stays consistent
  // because prepare() embeds the FULL corpus in one shot; writeOne()
  // just spends the prepared vector against a single descriptor;
  // finalize() runs the anchor-axis pass + bookkeeping.

  /**
   * Phase 1 + 2: gather entities + embed the whole corpus once. The
   * returned payload is JSON-serialisable so a Drupal batch can stash
   * it in `$context['results']` across operations.
   *
   * `descriptors` is the ordered list of ids to drive `writeOne` over;
   * the caller can also filter it to a subset (delta — only re-write
   * the entities flagged pending) before iterating.
   *
   * @return array{
   *   work: array<string, array{entityType: string, entityId: string}>,
   *   vectors: array<string, float[]>,
   *   descriptors: array<int, string>,
   *   modelVersion: string,
   *   dimensions: int,
   *   embeddedAt: int,
   * }
   */
  public function prepareBatchContext(): array {
    $participating = $this->collectParticipatingBundles();
    if ($participating === []) {
      throw new \RuntimeException('No metaphor plugins registered. Nothing to embed.');
    }

    $corpus = [];
    $work = [];
    foreach ($participating as $entityType => $bundles) {
      $storage = $this->entityTypeManager->getStorage($entityType);
      $query = $storage->getQuery()->accessCheck(FALSE);
      $bundleKey = $this->entityTypeManager->getDefinition($entityType)->getKey('bundle');
      if ($bundleKey) {
        $query->condition($bundleKey, $bundles, 'IN');
      }
      foreach ($query->execute() as $id) {
        $entity = $storage->load($id);
        if ($entity === NULL) {
          continue;
        }
        $facts = $this->factsReader->read($entity);
        if ($facts === NULL) {
          continue;
        }
        $descriptorId = $this->descriptorBuilder->descriptorId($entityType, (string) $id);
        $corpus[$descriptorId] = $this->descriptorBuilder->embeddingText($entity, $facts);
        // Stash the lightweight identification only — full entity +
        // facts are re-loaded inside writeOne so the batch context
        // stays small enough to serialise across requests.
        $work[$descriptorId] = [
          'entityType' => $entityType,
          'entityId' => (string) $id,
        ];
      }
    }

    if ($corpus === []) {
      throw new \RuntimeException('Corpus is empty. Nothing to embed.');
    }

    $result = $this->embeddingManager->embedCorpus($corpus);
    return [
      'work' => $work,
      'vectors' => $result['vectors'],
      'descriptors' => array_keys($work),
      'modelVersion' => $result['modelVersion'],
      'dimensions' => $result['dimensions'],
      'embeddedAt' => time(),
    ];
  }

  /**
   * Phase 3 — write a single descriptor's signature + upsert to the
   * gateway. Reloads the entity from the batch context's bare ids so
   * the cross-request serialisation cost stays small.
   *
   * Returns TRUE on success, FALSE on no-vector or thrown error
   * (logged). Caller increments its own written/error counters.
   */
  public function writeOneFromContext(array $context, string $descriptorId): bool {
    $w = $context['work'][$descriptorId] ?? NULL;
    $vector = $context['vectors'][$descriptorId] ?? NULL;
    if (!is_array($w) || !is_array($vector) || $vector === []) {
      return FALSE;
    }
    try {
      $storage = $this->entityTypeManager->getStorage($w['entityType']);
      $entity = $storage->load($w['entityId']);
      if ($entity === NULL) {
        return FALSE;
      }
      $facts = $this->factsReader->read($entity);
      if ($facts === NULL) {
        return FALSE;
      }
      $base = $this->extractor->extract($facts);
      $semantic = new SignatureSemantic(
        embedding: $vector,
        modelVersion: $context['modelVersion'],
        embeddedAt: $context['embeddedAt'],
        semanticHash: $base->semantic->semanticHash,
      );
      $signature = new Signature(
        $base->structural,
        $base->temporal,
        $base->relational,
        $semantic,
      );
      $this->writer->write($entity, $signature);
      $pluginId = sprintf('%s:%s', $w['entityType'], $entity->bundle());
      $metaphor = $this->metaphorManager->createInstance($pluginId);
      $descriptor = $this->descriptorBuilder->build($entity, $facts, $signature, $metaphor);
      $this->searchClient->upsert($descriptor);
      return TRUE;
    }
    catch (\Throwable $e) {
      $this->logger->error(sprintf('%s embed failed: %s', $descriptorId, $e->getMessage()));
      return FALSE;
    }
  }

  /**
   * Phase 4 + bookkeeping. Runs the anchor-axis pass, stamps State,
   * busts the snapshot cache. Returns the same shape `run()` returns
   * so the batch's finished callback can flash the same summary.
   *
   * @return array{
   *   embedded: int,
   *   errors: int,
   *   modelVersion: string,
   *   dimensions: int,
   *   embeddedAt: int,
   * }
   */
  public function finalizeBatch(array $context, int $written, int $errors): array {
    $modelVersion = $context['modelVersion'];
    $embeddedAt = $context['embeddedAt'];
    $dimensions = $context['dimensions'];
    $axesByAtmosphere = $this->embedAnchorAxes($modelVersion, $embeddedAt);
    $this->state->set('world_signature.last_embed', [
      'at' => $embeddedAt,
      'modelVersion' => $modelVersion,
      'dimensions' => $dimensions,
      'embedded' => $written,
    ]);
    if ($axesByAtmosphere !== []) {
      $this->state->set(self::STATE_INTERPRETATION_AXES, $axesByAtmosphere);
    }
    Cache::invalidateTags(['world_signature:embed']);
    return [
      'embedded' => $written,
      'errors' => $errors,
      'modelVersion' => $modelVersion,
      'dimensions' => $dimensions,
      'embeddedAt' => $embeddedAt,
    ];
  }

  /**
   * For every atmosphere whose interpretation profile uses
   * `anchors` (or `hybrid`), embed each axis's two prose poles,
   * compute the axis direction, Gram–Schmidt orthogonalize.
   *
   * Returns a per-atmosphere bundle the snapshot ships under
   * `world.interpretationAxes`. Empty array when no profile uses
   * anchors (the inner-mind POC is the only one today).
   *
   * @return array<string, array{
   *   modelVersion: string,
   *   embeddedAt: int,
   *   dimensions: int,
   *   axes: array<int, array{name: string, vector: float[]}>,
   * }>
   */
  private function embedAnchorAxes(string $modelVersion, int $embeddedAt): array {
    $profiles = $this->configFactory
      ->get('world_signature.interpretation')
      ->get('profiles') ?? [];
    if (!is_array($profiles) || $profiles === []) {
      return [];
    }

    // Collect every pole prose across every anchors atmosphere into
    // one batch so the embedding provider is called once. The keys
    // namespace by atmosphere so the lookup is unambiguous.
    $docs = [];
    $axisMeta = [];
    foreach ($profiles as $atmosphere => $profile) {
      if (!is_array($profile)) {
        continue;
      }
      $mode = (string) ($profile['frame_mode'] ?? 'mds');
      if ($mode !== 'anchors' && $mode !== 'hybrid') {
        continue;
      }
      $axes = $profile['axes'] ?? [];
      if (!is_array($axes)) {
        continue;
      }
      foreach ($axes as $idx => $axis) {
        if (!is_array($axis)) {
          continue;
        }
        $name = (string) ($axis['name'] ?? '');
        $a = trim((string) ($axis['pole_a'] ?? ''));
        $b = trim((string) ($axis['pole_b'] ?? ''));
        if ($a === '' || $b === '') {
          continue;
        }
        $keyA = sprintf('%s:%d:a', $atmosphere, $idx);
        $keyB = sprintf('%s:%d:b', $atmosphere, $idx);
        $docs[$keyA] = $a;
        $docs[$keyB] = $b;
        $axisMeta[$atmosphere][$idx] = ['name' => $name, 'keyA' => $keyA, 'keyB' => $keyB];
      }
    }

    if ($docs === []) {
      return [];
    }

    try {
      $result = $this->embeddingManager->embedCorpus($docs);
    }
    catch (\Throwable $e) {
      $this->logger->error('Anchor pole embedding failed: ' . $e->getMessage());
      return [];
    }
    $vectors = $result['vectors'] ?? [];
    if (!is_array($vectors)) {
      return [];
    }

    $bundle = [];
    foreach ($axisMeta as $atmosphere => $axes) {
      $directions = [];
      $names = [];
      foreach ($axes as $axis) {
        $a = $vectors[$axis['keyA']] ?? NULL;
        $b = $vectors[$axis['keyB']] ?? NULL;
        if (!is_array($a) || !is_array($b)) {
          continue;
        }
        $direction = $this->normalize($this->subtract($a, $b));
        if ($direction === NULL) {
          continue;
        }
        $directions[] = $direction;
        $names[] = $axis['name'];
      }
      if ($directions === []) {
        continue;
      }
      // Gram–Schmidt: orthogonalize each successive axis against the
      // accumulated basis so correlated poles don't collapse into
      // one direction (INTERPRETATION_ENGINE.md §3 step 4).
      $basis = [];
      $finalAxes = [];
      foreach ($directions as $i => $v) {
        $r = $v;
        foreach ($basis as $b) {
          $r = $this->orthogonalize($r, $b);
        }
        $u = $this->normalize($r);
        if ($u === NULL) {
          continue;
        }
        $basis[] = $u;
        $finalAxes[] = ['name' => $names[$i], 'vector' => $u];
      }
      if ($finalAxes === []) {
        continue;
      }
      $bundle[$atmosphere] = [
        'modelVersion' => $result['modelVersion'] ?? $modelVersion,
        'embeddedAt' => $embeddedAt,
        'dimensions' => (int) ($result['dimensions'] ?? count($finalAxes[0]['vector'])),
        'axes' => $finalAxes,
      ];
    }

    return $bundle;
  }

  /** Element-wise vector subtraction; returns [] if lengths mismatch. */
  private function subtract(array $a, array $b): array {
    $n = min(count($a), count($b));
    $out = [];
    for ($i = 0; $i < $n; $i++) {
      $out[] = ((float) $a[$i]) - ((float) $b[$i]);
    }
    return $out;
  }

  /** Unit-normalize; NULL if zero-length. */
  private function normalize(array $v): ?array {
    $sumSq = 0.0;
    foreach ($v as $x) {
      $sumSq += $x * $x;
    }
    if ($sumSq < 1e-24) {
      return NULL;
    }
    $norm = sqrt($sumSq);
    return array_map(static fn(float $x) => $x / $norm, array_map('floatval', $v));
  }

  /** Remove component of $v along (unit) $basis. */
  private function orthogonalize(array $v, array $basis): array {
    $proj = 0.0;
    $n = min(count($v), count($basis));
    for ($i = 0; $i < $n; $i++) {
      $proj += ((float) $v[$i]) * ((float) $basis[$i]);
    }
    $out = [];
    for ($i = 0; $i < $n; $i++) {
      $out[] = ((float) $v[$i]) - $proj * ((float) $basis[$i]);
    }
    return $out;
  }

  /**
   * Map of entity_type → bundles[] that have a Metaphor plugin registered.
   *
   * @return array<string, string[]>
   */
  private function collectParticipatingBundles(): array {
    $map = [];
    foreach ($this->metaphorManager->getDefinitions() as $def) {
      $type = $def['entity_type'] ?? NULL;
      $bundle = $def['bundle'] ?? NULL;
      if ($type && $bundle) {
        $map[$type][$bundle] = TRUE;
      }
    }
    return array_map(static fn(array $bundles) => array_keys($bundles), $map);
  }

}
