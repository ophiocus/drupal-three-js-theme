<?php

declare(strict_types=1);

namespace Drupal\world_signature\Ingest;

/**
 * Picks the right adapter for a source reference and delegates
 * resolution.
 *
 * Adapters arrive via the `world_signature.source_adapter` service
 * tag, priority-ordered (highest first). The first adapter whose
 * supports() returns TRUE wins — so domain/scheme-specific catalog
 * adapters claim their references and DirectUrlAdapter (lowest
 * priority) catches everything else.
 */
final class SourceAdapterManager {

  /** @var \Drupal\world_signature\Ingest\SourceAdapterInterface[] */
  private readonly array $adapters;

  /**
   * @param iterable<\Drupal\world_signature\Ingest\SourceAdapterInterface> $adapters
   *   Tagged adapters, already priority-ordered by the container.
   */
  public function __construct(iterable $adapters) {
    $this->adapters = $adapters instanceof \Traversable
      ? iterator_to_array($adapters)
      : $adapters;
  }

  /** First adapter that handles $ref, or NULL if none do. */
  public function adapterFor(string $ref): ?SourceAdapterInterface {
    foreach ($this->adapters as $adapter) {
      if ($adapter->supports($ref)) {
        return $adapter;
      }
    }
    return NULL;
  }

  /**
   * Resolve a reference to leechable SourceAssets via the matching
   * adapter.
   *
   * @return \Drupal\world_signature\Ingest\SourceAsset[]
   *
   * @throws \RuntimeException
   *   When no adapter handles the reference (the adapter itself
   *   throws on resolution failures).
   */
  public function resolve(string $ref): array {
    $adapter = $this->adapterFor($ref);
    if ($adapter === NULL) {
      throw new \RuntimeException(sprintf('No source adapter handles "%s".', $ref));
    }
    return $adapter->resolve($ref);
  }

  /** Adapter ids in priority order — for diagnostics + drush listing. */
  public function adapterIds(): array {
    return array_map(static fn(SourceAdapterInterface $a) => $a->id(), $this->adapters);
  }

}
