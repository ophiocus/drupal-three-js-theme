<?php

declare(strict_types=1);

namespace Drupal\world_signature\Plugin\AdvancedQueue\JobType;

use Drupal\advancedqueue\Job;
use Drupal\advancedqueue\JobResult;
use Drupal\advancedqueue\Plugin\AdvancedQueue\JobType\JobTypeBase;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Entity\FieldableEntityInterface;
use Drupal\Core\Logger\LoggerChannelInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\world_signature\Service\EntityFactsReader;
use Drupal\world_signature\Service\SignatureWriter;
use Drupal\world_signature\Signature\SignatureExtractor;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Job that extracts and persists the signature for one entity.
 *
 * Payload: ['entity_type' => string, 'entity_id' => string|int,
 *           'op' => 'insert'|'update'|'delete'].
 *
 * Pipeline (matching scaffold/verify-3a.php's manual run, but
 * automated here on every entity save):
 *
 *   load(entity)
 *     → EntityFactsReader::read()        (NULL = skip; not in world)
 *     → SignatureExtractor::extract()
 *     → SignatureWriter::write()         (JSON onto field_world_signature)
 *     → JobResult::success()
 *
 * Atlas write path is added in Sprint 3b-2 between extract and
 * write — descriptor → WorldSearchClient → App Services Function.
 *
 * @AdvancedQueueJobType(
 *   id = "world_signature_extract",
 *   label = @Translation("World Signature: extract"),
 *   max_retries = 3,
 *   retry_delay = 60,
 * )
 */
final class ExtractSignature extends JobTypeBase implements ContainerFactoryPluginInterface {

  public function __construct(
    array $configuration,
    string $plugin_id,
    array $plugin_definition,
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly EntityFactsReader $factsReader,
    private readonly SignatureExtractor $extractor,
    private readonly SignatureWriter $writer,
    private readonly LoggerChannelInterface $logger,
  ) {
    parent::__construct($configuration, $plugin_id, $plugin_definition);
  }

  public static function create(
    ContainerInterface $container,
    array $configuration,
    $plugin_id,
    $plugin_definition,
  ): self {
    return new self(
      $configuration,
      $plugin_id,
      $plugin_definition,
      $container->get('entity_type.manager'),
      $container->get('world_signature.entity_facts_reader'),
      $container->get('world_signature.signature_extractor'),
      $container->get('world_signature.signature_writer'),
      $container->get('logger.channel.world_signature'),
    );
  }

  public function process(Job $job): JobResult {
    $payload = $job->getPayload();
    $entityType = (string) ($payload['entity_type'] ?? '');
    $entityId = $payload['entity_id'] ?? NULL;
    $op = (string) ($payload['op'] ?? 'update');

    if ($entityType === '' || $entityId === NULL) {
      return JobResult::failure(sprintf(
        'Invalid payload: entity_type=%s entity_id=%s',
        $entityType,
        var_export($entityId, TRUE),
      ));
    }

    // Delete: nothing to extract; downstream Atlas-side cleanup
    // happens in 3b-2.
    if ($op === 'delete') {
      $this->logger->info(
        'Delete op for @type/@id (no extraction; Atlas cleanup deferred to 3b-2).',
        ['@type' => $entityType, '@id' => $entityId],
      );
      return JobResult::success('delete: noop in 3b-1');
    }

    try {
      $entity = $this->entityTypeManager->getStorage($entityType)->load($entityId);
    }
    catch (\Throwable $e) {
      return JobResult::failure(sprintf(
        'Could not load @%s/%s: %s',
        $entityType,
        $entityId,
        $e->getMessage(),
      ));
    }

    if ($entity === NULL) {
      // Entity was deleted between enqueue and processing; not an error.
      $this->logger->info(
        '@type/@id no longer exists; skipping.',
        ['@type' => $entityType, '@id' => $entityId],
      );
      return JobResult::success('entity gone');
    }

    if (!$entity instanceof FieldableEntityInterface) {
      return JobResult::success('entity not fieldable; out of world');
    }

    $facts = $this->factsReader->read($entity);
    if ($facts === NULL) {
      return JobResult::success(sprintf(
        'no metaphor for %s:%s',
        $entityType,
        $entity->bundle(),
      ));
    }

    $signature = $this->extractor->extract($facts);
    $written = $this->writer->write($entity, $signature);

    return JobResult::success(sprintf(
      'extracted signature for %s/%s (%s)',
      $entityType,
      $entityId,
      $written ? 'persisted' : 'no field; not persisted',
    ));
  }

}
