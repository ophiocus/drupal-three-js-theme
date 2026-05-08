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
use Drupal\world_signature\Plugin\MetaphorPluginInterface;
use Drupal\world_signature\Plugin\MetaphorPluginManager;
use Drupal\world_signature\Service\DescriptorBuilder;
use Drupal\world_signature\Service\EntityFactsReader;
use Drupal\world_signature\Service\SignatureWriter;
use Drupal\world_signature\Service\WorldSearchClient;
use Drupal\world_signature\Signature\SignatureExtractor;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Job that extracts a signature, persists it to MariaDB, and pushes
 * the skinny descriptor to the RESTHeart gateway.
 *
 * Payload: ['entity_type' => string, 'entity_id' => string|int,
 *           'op' => 'insert'|'update'|'delete'].
 *
 * Pipeline (insert / update):
 *
 *   load(entity)
 *     → EntityFactsReader::read()         (NULL = skip; not in world)
 *     → SignatureExtractor::extract()
 *     → SignatureWriter::write()           (JSON onto field_world_signature, MariaDB)
 *     → DescriptorBuilder::build()         (skinny shape)
 *     → WorldSearchClient::upsert()        (HTTPS PUT to gateway → Atlas)
 *     → JobResult::success()
 *
 * Pipeline (delete):
 *
 *   WorldSearchClient::delete(<descriptorId>)
 *     → JobResult::success()
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
    private readonly DescriptorBuilder $descriptorBuilder,
    private readonly WorldSearchClient $searchClient,
    private readonly MetaphorPluginManager $metaphorManager,
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
      $container->get('world_signature.descriptor_builder'),
      $container->get('world_signature.world_search_client'),
      $container->get('plugin.manager.world_signature.metaphor'),
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

    // Delete: drop the descriptor from the gateway. No facts/extractor
    // needed — the gateway-side _id is recoverable from (type, id).
    if ($op === 'delete') {
      $descriptorId = $this->descriptorBuilder->descriptorId($entityType, $entityId);
      try {
        $this->searchClient->delete($descriptorId);
      }
      catch (\RuntimeException $e) {
        return JobResult::failure(sprintf(
          'Gateway delete failed for %s: %s',
          $descriptorId,
          $e->getMessage(),
        ));
      }
      return JobResult::success(sprintf('deleted %s', $descriptorId));
    }

    try {
      $entity = $this->entityTypeManager->getStorage($entityType)->load($entityId);
    }
    catch (\Throwable $e) {
      return JobResult::failure(sprintf(
        'Could not load %s/%s: %s',
        $entityType,
        $entityId,
        $e->getMessage(),
      ));
    }

    if ($entity === NULL) {
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

    // Build descriptor and push to the gateway. Persisting locally
    // (above) is the system of record; gateway is a cache. If the
    // gateway write fails, the local field is still correct and a
    // retry will republish.
    $pluginId = sprintf('%s:%s', $entityType, $entity->bundle());
    /** @var \Drupal\world_signature\Plugin\MetaphorPluginInterface $metaphor */
    $metaphor = $this->metaphorManager->createInstance($pluginId);
    assert($metaphor instanceof MetaphorPluginInterface);

    $descriptor = $this->descriptorBuilder->build($entity, $facts, $signature, $metaphor);

    try {
      $this->searchClient->upsert($descriptor);
    }
    catch (\RuntimeException $e) {
      // Local persist already happened; only the gateway is stale.
      // Failing the job lets advancedqueue retry against the gateway.
      return JobResult::failure(sprintf(
        'gateway upsert failed for %s/%s: %s',
        $entityType,
        $entityId,
        $e->getMessage(),
      ));
    }

    return JobResult::success(sprintf(
      'extracted + upserted %s/%s (%s)',
      $entityType,
      $entityId,
      $written ? 'persisted' : 'no field; not persisted',
    ));
  }

}
