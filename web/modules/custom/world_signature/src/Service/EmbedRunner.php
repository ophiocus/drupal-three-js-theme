<?php

declare(strict_types=1);

namespace Drupal\world_signature\Service;

use Drupal\Core\Cache\Cache;
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

    // Phase 3 freshness signal (the Stage panel reads this via the
    // snapshot's world.lastEmbed block).
    $this->state->set('world_signature.last_embed', [
      'at' => $embeddedAt,
      'modelVersion' => $modelVersion,
      'dimensions' => $dimensions,
      'embedded' => $written,
    ]);
    // Bust the snapshot's dynamic-page-cache entry so the next fetch
    // serves the fresh lastEmbed (State has no cache tags of its own).
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
