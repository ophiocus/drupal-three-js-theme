<?php

declare(strict_types=1);

namespace Drupal\world_signature\Store;

/**
 * Where world descriptors (and their embedding vectors) live.
 *
 * A descriptor is the search-side projection of one participating
 * entity, built by DescriptorBuilder; its vector sits at
 * signature.semantic.embedding. Callers depend on this interface via
 * the `world_signature.descriptor_store` service, which points at one
 * implementation:
 *
 *   - DatabaseDescriptorStore (default): a table in Drupal's own
 *     database; nearest() is exact cosine in PHP.
 *   - WorldSearchClient: the RESTHeart → MongoDB gateway, with
 *     $vectorSearch (needs a MongoDB 8.2+ deployment with mongot).
 *
 * Swapping is a one-line alias change in world_signature.services.yml.
 *
 * Failure contract: writes and single reads throw \RuntimeException
 * when the store fails; nearest() logs and returns [] so callers can
 * fall back to a non-vector path.
 */
interface DescriptorStoreInterface {

  /**
   * Insert or replace a descriptor by its `_id`.
   *
   * @param array<string, mixed> $descriptor
   *   The descriptor; must include '_id'.
   *
   * @throws \RuntimeException
   */
  public function upsert(array $descriptor): void;

  /**
   * Delete a descriptor. Deleting a missing id is not an error.
   *
   * @throws \RuntimeException
   */
  public function delete(string $id): void;

  /**
   * One descriptor by id, or NULL when absent.
   *
   * @return array<string, mixed>|null
   *   The descriptor, embedding included.
   *
   * @throws \RuntimeException
   */
  public function find(string $id): ?array;

  /**
   * Every descriptor, up to $hardLimit.
   *
   * @return array<int, array<string, mixed>>
   *   Descriptors, embeddings included.
   *
   * @throws \RuntimeException
   */
  public function findAll(int $hardLimit = 5000): array;

  /**
   * Nearest neighbours of a vector by cosine similarity.
   *
   * @param float[] $vector
   *   Query vector (an entity's own embedding, a pole vector, …).
   * @param int $k
   *   Neighbours to return; implementations cap it at 200.
   * @param array<string, scalar|array<int, scalar>> $filter
   *   Equality filters on top-level descriptor fields; an array value
   *   means "any of". Supported keys depend on the implementation.
   *
   * @return array<int, array{_id: string, score: float, descriptor: array<string, mixed>}>
   *   Best first. Empty on failure (logged, not thrown).
   */
  public function nearest(array $vector, int $k = 12, array $filter = []): array;

  /**
   * TRUE when the store can serve requests.
   */
  public function ping(): bool;

}
