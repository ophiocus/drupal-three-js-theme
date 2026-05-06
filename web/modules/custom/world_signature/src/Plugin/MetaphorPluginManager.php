<?php

declare(strict_types=1);

namespace Drupal\world_signature\Plugin;

use Drupal\Core\Plugin\DefaultPluginManager;
use Drupal\Core\Cache\CacheBackendInterface;
use Drupal\Core\Extension\ModuleHandlerInterface;
use Drupal\world_signature\Annotation\Metaphor;

/**
 * Discovers and instantiates Metaphor plugins.
 *
 * Looks under `src/Plugin/Metaphor/` of any module that ships
 * metaphors. The annotation declares each plugin's entity type +
 * bundle, which the cypher uses to dispatch from an entity to its
 * metaphor at extraction time.
 */
final class MetaphorPluginManager extends DefaultPluginManager {

  public function __construct(
    \Traversable $namespaces,
    CacheBackendInterface $cache_backend,
    ModuleHandlerInterface $module_handler,
  ) {
    parent::__construct(
      'Plugin/Metaphor',
      $namespaces,
      $module_handler,
      MetaphorPluginInterface::class,
      Metaphor::class,
    );

    $this->alterInfo('world_signature_metaphor_info');
    $this->setCacheBackend($cache_backend, 'world_signature_metaphor_plugins');
  }

}
