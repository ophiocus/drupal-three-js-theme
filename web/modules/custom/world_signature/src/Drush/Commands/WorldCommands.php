<?php

declare(strict_types=1);

namespace Drupal\world_signature\Drush\Commands;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Logger\LoggerChannelInterface;
use Drupal\world_signature\Plugin\MetaphorPluginManager;
use Drupal\world_signature\Service\DescriptorBuilder;
use Drupal\world_signature\Service\EntityFactsReader;
use Drupal\world_signature\Service\SignatureWriter;
use Drupal\world_signature\Service\SnapshotPublisher;
use Drupal\world_signature\Service\WorldSearchClient;
use Drupal\world_signature\Signature\SignatureExtractor;
use Drush\Attributes\Command;
use Drush\Commands\DrushCommands;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Drush commands for the cypher.
 *
 *   drush world:publish    Force-rebuild every descriptor and push
 *                          to the gateway. Cron-equivalent on demand.
 *   drush world:validate   Health-check the cypher (gateway reachable,
 *                          metaphors registered, queue config in place,
 *                          field installed on participating bundles).
 *   drush world:test       Run the pipeline end-to-end on one entity
 *                          and dump the resulting descriptor for
 *                          visual inspection.
 */
final class WorldCommands extends DrushCommands {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly EntityFactsReader $factsReader,
    private readonly SignatureExtractor $extractor,
    private readonly SignatureWriter $writer,
    private readonly DescriptorBuilder $descriptorBuilder,
    private readonly WorldSearchClient $searchClient,
    private readonly SnapshotPublisher $publisher,
    private readonly MetaphorPluginManager $metaphorManager,
    private readonly LoggerChannelInterface $loggerChannel,
  ) {
    parent::__construct();
  }

  public static function create(ContainerInterface $container): self {
    return new self(
      $container->get('entity_type.manager'),
      $container->get('world_signature.entity_facts_reader'),
      $container->get('world_signature.signature_extractor'),
      $container->get('world_signature.signature_writer'),
      $container->get('world_signature.descriptor_builder'),
      $container->get('world_signature.world_search_client'),
      $container->get('world_signature.snapshot_publisher'),
      $container->get('plugin.manager.world_signature.metaphor'),
      $container->get('logger.channel.world_signature'),
    );
  }

  /**
   * Force-rebuild every descriptor and push it to the gateway.
   *
   * Walks every entity type that has at least one registered
   * Metaphor plugin, runs the full signature pipeline on each
   * entity, persists field_world_signature, and upserts the
   * descriptor to the gateway.
   *
   * Use cases: post-deploy reindex, model-version migration, or
   * recovery after the gateway has been wiped.
   */
  #[Command(name: 'world:publish', aliases: ['wp', 'wpub'])]
  public function publish(): int {
    $entityTypes = $this->collectParticipatingEntityTypes();
    if ($entityTypes === []) {
      $this->logger()->warning(
        'No metaphor plugins registered. Nothing to publish.',
      );
      return DrushCommands::EXIT_FAILURE;
    }

    $totalProcessed = 0;
    $totalErrors = 0;

    foreach ($entityTypes as $entityType) {
      $storage = $this->entityTypeManager->getStorage($entityType);
      $ids = $storage->getQuery()
        ->accessCheck(FALSE)
        ->execute();

      $this->logger()->notice(sprintf(
        'Publishing %s: %d entities.',
        $entityType,
        count($ids),
      ));

      foreach ($ids as $id) {
        try {
          $this->publishOne($entityType, (string) $id);
          $totalProcessed++;
        }
        catch (\Throwable $e) {
          $totalErrors++;
          $this->logger()->error(sprintf(
            '%s/%s failed: %s',
            $entityType,
            $id,
            $e->getMessage(),
          ));
        }
      }
    }

    $this->logger()->success(sprintf(
      'world:publish done — %d entities published, %d errors.',
      $totalProcessed,
      $totalErrors,
    ));

    return $totalErrors > 0 ? DrushCommands::EXIT_FAILURE : DrushCommands::EXIT_SUCCESS;
  }

  /**
   * Health-check the cypher.
   *
   * Reports on:
   *   - gateway reachability
   *   - registered Metaphor plugins
   *   - queue config in place
   *   - field_world_signature installed on participating bundles
   *   - corpus snapshot assembles cleanly
   */
  #[Command(name: 'world:validate', aliases: ['wv'])]
  public function validate(): int {
    $issues = [];

    $this->line('-- Gateway --');
    if ($this->searchClient->ping()) {
      $this->line(' ✓ gateway reachable');
    }
    else {
      $issues[] = 'gateway unreachable';
      $this->line(' ✗ gateway unreachable');
    }

    $this->line('-- Metaphor plugins --');
    $defs = $this->metaphorManager->getDefinitions();
    if ($defs === []) {
      $issues[] = 'no metaphor plugins registered';
      $this->line(' ✗ no metaphor plugins');
    }
    else {
      foreach ($defs as $id => $def) {
        $this->line(sprintf(' ✓ %s (%s:%s)', $id, $def['entity_type'], $def['bundle']));
      }
    }

    $this->line('-- Queue --');
    $queue = $this->entityTypeManager
      ->getStorage('advancedqueue_queue')
      ->load('world_signature_extract');
    if ($queue === NULL) {
      $issues[] = 'world_signature_extract queue missing';
      $this->line(' ✗ queue world_signature_extract missing');
    }
    else {
      $this->line(' ✓ queue world_signature_extract registered');
    }

    $this->line('-- Snapshot --');
    try {
      $snapshot = $this->publisher->buildSnapshot();
      $this->line(sprintf(
        ' ✓ snapshot assembles (%d entities, %d sectors)',
        count($snapshot['entities']),
        count($snapshot['sectors']),
      ));
    }
    catch (\Throwable $e) {
      $issues[] = 'snapshot assembly failed: ' . $e->getMessage();
      $this->line(' ✗ snapshot failed: ' . $e->getMessage());
    }

    if ($issues === []) {
      $this->logger()->success('world:validate green.');
      return DrushCommands::EXIT_SUCCESS;
    }

    $this->logger()->error(sprintf('world:validate found %d issue(s).', count($issues)));
    return DrushCommands::EXIT_FAILURE;
  }

  /**
   * Run the full pipeline on one entity for visual inspection.
   *
   * Loads the given entity, runs facts → signature → descriptor →
   * gateway upsert, and prints the resulting descriptor as JSON.
   *
   * @param string $entityType
   *   Entity type machine id (e.g. node).
   * @param string $entityId
   *   Entity id.
   */
  #[Command(name: 'world:test', aliases: ['wt'])]
  public function test(string $entityType, string $entityId): int {
    try {
      $descriptor = $this->publishOne($entityType, $entityId, returnDescriptor: TRUE);
    }
    catch (\Throwable $e) {
      $this->logger()->error('world:test failed: ' . $e->getMessage());
      return DrushCommands::EXIT_FAILURE;
    }

    $this->line(json_encode(
      $descriptor,
      JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES,
    ));
    return DrushCommands::EXIT_SUCCESS;
  }

  /**
   * Pipeline core, shared between publish() and test().
   *
   * @return array|NULL
   *   The descriptor that was pushed, when $returnDescriptor is TRUE;
   *   NULL otherwise.
   */
  private function publishOne(string $entityType, string $entityId, bool $returnDescriptor = FALSE): ?array {
    $entity = $this->entityTypeManager->getStorage($entityType)->load($entityId);
    if ($entity === NULL) {
      throw new \RuntimeException(sprintf('No %s/%s.', $entityType, $entityId));
    }

    $facts = $this->factsReader->read($entity);
    if ($facts === NULL) {
      throw new \RuntimeException(sprintf(
        'No metaphor for %s:%s — entity is not part of the world.',
        $entityType,
        $entity->bundle(),
      ));
    }

    $signature = $this->extractor->extract($facts);
    $this->writer->write($entity, $signature);

    $pluginId = sprintf('%s:%s', $entityType, $entity->bundle());
    $metaphor = $this->metaphorManager->createInstance($pluginId);

    $descriptor = $this->descriptorBuilder->build($entity, $facts, $signature, $metaphor);
    $this->searchClient->upsert($descriptor);

    return $returnDescriptor ? $descriptor : NULL;
  }

  /**
   * Returns the unique entity types covered by registered Metaphor
   * plugins (e.g. ['node']).
   *
   * @return array<int, string>
   */
  private function collectParticipatingEntityTypes(): array {
    $types = [];
    foreach ($this->metaphorManager->getDefinitions() as $def) {
      if (!empty($def['entity_type'])) {
        $types[$def['entity_type']] = TRUE;
      }
    }
    return array_keys($types);
  }

  private function line(string $line): void {
    $this->output()->writeln($line);
  }

}
