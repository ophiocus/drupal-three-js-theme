<?php

declare(strict_types=1);

namespace Drupal\world_signature\Service;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\State\StateInterface;
use Drupal\world_signature\Plugin\MetaphorPluginManager;

/**
 * Read-only snapshot of the embedding pipeline's state.
 *
 * Answers the Content tab's banner questions in one call:
 *   - total participating entities
 *   - embedded (vector present, model matches the current model)
 *   - stale (vector present, model version doesn't match)
 *   - missing (no vector at all)
 *   - dirty (auto-stale: source text changed since the last embed)
 *
 * The "current model version" is whatever the last successful
 * `world:embed` recorded in State (`world_signature.last_embed.modelVersion`).
 * Until any embed runs, every existing vector counts as embedded
 * regardless of model — there's no "current" to compare against.
 */
final class EmbeddingFreshness {

  /** State key the EmbedRunner stamps after each successful run. */
  public const string STATE_LAST_EMBED = 'world_signature.last_embed';

  /** State key tracking which nodes have been flagged dirty by */
  /** hook_entity_update. Stored as { entityType: { entityId: ts } }. */
  public const string STATE_DIRTY_NODES = 'world_signature.dirty_nodes';

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly MetaphorPluginManager $metaphorManager,
    private readonly StateInterface $state,
  ) {}

  /**
   * Aggregate counts for the Content tab banner.
   *
   * @return array{
   *   total: int,
   *   embedded: int,
   *   stale: int,
   *   missing: int,
   *   dirty: int,
   *   modelVersion: ?string,
   *   lastEmbedAt: ?int,
   * }
   */
  public function summary(): array {
    $currentModel = $this->currentModelVersion();
    $dirty = $this->dirtyEntityCount();
    $counts = ['total' => 0, 'embedded' => 0, 'stale' => 0, 'missing' => 0];
    foreach ($this->participatingBundles() as $entityType => $bundles) {
      $storage = $this->entityTypeManager->getStorage($entityType);
      $bundleKey = $this->entityTypeManager->getDefinition($entityType)->getKey('bundle');
      $query = $storage->getQuery()->accessCheck(FALSE);
      if ($bundleKey) {
        $query->condition($bundleKey, $bundles, 'IN');
      }
      $ids = $query->execute();
      foreach ($storage->loadMultiple($ids) as $entity) {
        if (!$entity->hasField('field_world_signature')) {
          continue;
        }
        $counts['total']++;
        $sig = $entity->get('field_world_signature');
        if ($sig->isEmpty()) {
          $counts['missing']++;
          continue;
        }
        $decoded = json_decode((string) $sig->value, TRUE);
        $emb = $decoded['semantic']['embedding'] ?? NULL;
        if (!is_array($emb) || count($emb) === 0) {
          $counts['missing']++;
          continue;
        }
        $modelVersion = $decoded['semantic']['modelVersion'] ?? NULL;
        if ($currentModel !== NULL && $modelVersion !== $currentModel) {
          $counts['stale']++;
        }
        else {
          $counts['embedded']++;
        }
      }
    }
    $last = $this->state->get(self::STATE_LAST_EMBED);
    return [
      'total' => $counts['total'],
      'embedded' => $counts['embedded'],
      'stale' => $counts['stale'],
      'missing' => $counts['missing'],
      'dirty' => $dirty,
      'modelVersion' => $currentModel,
      'lastEmbedAt' => is_array($last) && isset($last['at']) ? (int) $last['at'] : NULL,
    ];
  }

  /**
   * Entities pending re-embedding: missing OR stale OR dirty.
   * Returned as `[entityType => [entityId, ...]]`.
   *
   * @return array<string, array<int, string>>
   */
  public function listPending(): array {
    $currentModel = $this->currentModelVersion();
    $dirty = $this->dirtyEntityIds();
    $pending = [];
    foreach ($this->participatingBundles() as $entityType => $bundles) {
      $storage = $this->entityTypeManager->getStorage($entityType);
      $bundleKey = $this->entityTypeManager->getDefinition($entityType)->getKey('bundle');
      $query = $storage->getQuery()->accessCheck(FALSE);
      if ($bundleKey) {
        $query->condition($bundleKey, $bundles, 'IN');
      }
      $ids = $query->execute();
      foreach ($storage->loadMultiple($ids) as $entity) {
        if (!$entity->hasField('field_world_signature')) {
          continue;
        }
        $sig = $entity->get('field_world_signature');
        $reason = NULL;
        if ($sig->isEmpty()) {
          $reason = 'missing';
        }
        else {
          $decoded = json_decode((string) $sig->value, TRUE);
          $emb = $decoded['semantic']['embedding'] ?? NULL;
          if (!is_array($emb) || count($emb) === 0) {
            $reason = 'missing';
          }
          elseif ($currentModel !== NULL
            && ($decoded['semantic']['modelVersion'] ?? NULL) !== $currentModel) {
            $reason = 'stale';
          }
        }
        $entityId = (string) $entity->id();
        if ($reason === NULL && isset($dirty[$entityType][$entityId])) {
          $reason = 'dirty';
        }
        if ($reason !== NULL) {
          $pending[$entityType][] = $entityId;
        }
      }
    }
    return $pending;
  }

  /**
   * Mark an entity dirty — its embeddingText changed and a re-embed
   * is needed even though the modelVersion didn't change. Called
   * from hook_entity_update.
   */
  public function markDirty(string $entityType, string $entityId): void {
    $dirty = $this->state->get(self::STATE_DIRTY_NODES);
    if (!is_array($dirty)) {
      $dirty = [];
    }
    $dirty[$entityType][$entityId] = time();
    $this->state->set(self::STATE_DIRTY_NODES, $dirty);
  }

  /**
   * Clear a dirty flag — called after the entity successfully
   * re-embeds. Silent no-op if the flag wasn't set.
   */
  public function clearDirty(string $entityType, string $entityId): void {
    $dirty = $this->state->get(self::STATE_DIRTY_NODES);
    if (!is_array($dirty) || !isset($dirty[$entityType][$entityId])) {
      return;
    }
    unset($dirty[$entityType][$entityId]);
    if ($dirty[$entityType] === []) {
      unset($dirty[$entityType]);
    }
    $this->state->set(self::STATE_DIRTY_NODES, $dirty);
  }

  /** Wipe every dirty flag — used by EmbedRunner after a full pass. */
  public function clearAllDirty(): void {
    $this->state->delete(self::STATE_DIRTY_NODES);
  }

  /**
   * @return array<string, array<int, string>> Participating
   *   bundles map: `entityType => [bundle, ...]`.
   */
  private function participatingBundles(): array {
    $byType = [];
    foreach ($this->metaphorManager->getDefinitions() as $def) {
      $entityType = (string) ($def['entity_type'] ?? '');
      $bundle = (string) ($def['bundle'] ?? '');
      if ($entityType === '' || $bundle === '') {
        continue;
      }
      $byType[$entityType][$bundle] = $bundle;
    }
    return array_map('array_values', $byType);
  }

  private function currentModelVersion(): ?string {
    $last = $this->state->get(self::STATE_LAST_EMBED);
    if (!is_array($last)) {
      return NULL;
    }
    $v = $last['modelVersion'] ?? NULL;
    return is_string($v) && $v !== '' ? $v : NULL;
  }

  private function dirtyEntityCount(): int {
    $dirty = $this->state->get(self::STATE_DIRTY_NODES);
    if (!is_array($dirty)) {
      return 0;
    }
    $n = 0;
    foreach ($dirty as $byType) {
      $n += is_array($byType) ? count($byType) : 0;
    }
    return $n;
  }

  /** @return array<string, array<string, int>> entityType -> entityId -> ts */
  private function dirtyEntityIds(): array {
    $dirty = $this->state->get(self::STATE_DIRTY_NODES);
    return is_array($dirty) ? $dirty : [];
  }

}
