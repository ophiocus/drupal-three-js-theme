<?php

declare(strict_types=1);

namespace Drupal\world_signature\Service;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Logger\LoggerChannelInterface;
use Drupal\world_signature\Plugin\MetaphorPluginInterface;
use Drupal\world_signature\Plugin\MetaphorPluginManager;
use Drupal\world_signature\Signature\EntityFacts;

/**
 * Drupal-coupled half of the cypher's read path.
 *
 * Given an EntityInterface, finds the matching Metaphor plugin (by
 * entity_type:bundle id), and returns the EntityFacts the plugin
 * extracts. The pure SignatureExtractor consumes those facts to
 * produce a Signature without ever touching Drupal.
 *
 * Returns NULL when no metaphor is registered for the bundle —
 * that's not an error; the entity is simply not part of the world.
 * The queue worker (Sprint 3b) handles the NULL case by skipping.
 */
final class EntityFactsReader {

  public function __construct(
    private readonly MetaphorPluginManager $metaphorManager,
    private readonly LoggerChannelInterface $logger,
  ) {}

  /**
   * Read EntityFacts for an entity, or NULL if no metaphor is
   * registered for its bundle.
   */
  public function read(EntityInterface $entity): ?EntityFacts {
    $pluginId = sprintf(
      '%s:%s',
      $entity->getEntityTypeId(),
      $entity->bundle(),
    );

    if (!$this->metaphorManager->hasDefinition($pluginId)) {
      $this->logger->debug(
        'No metaphor for @id; entity is not part of the world.',
        ['@id' => $pluginId],
      );
      return NULL;
    }

    /** @var \Drupal\world_signature\Plugin\MetaphorPluginInterface $plugin */
    $plugin = $this->metaphorManager->createInstance($pluginId);
    assert($plugin instanceof MetaphorPluginInterface);

    return $plugin->extractFacts($entity);
  }

}
