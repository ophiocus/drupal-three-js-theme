<?php

declare(strict_types=1);

namespace Drupal\world_signature\Store;

use Drupal\Core\Database\Connection;
use Drupal\Core\Logger\LoggerChannelInterface;

/**
 * Descriptor store in Drupal's own database (the default backend).
 *
 * One row per descriptor in `world_signature_descriptor`: the
 * descriptor JSON (minus its vector), the vector packed as float32,
 * and the fields nearest() filters on as plain indexed columns. It is
 * written in the same database and request as the entity it mirrors,
 * so there is no network hop to fail and no second system to back up.
 *
 * nearest() is exact cosine in PHP over the candidate rows — a few
 * milliseconds at hundreds of entities, a few hundred at ~10k. Past
 * that, a MariaDB 11.8 VECTOR column with an HNSW index (or the
 * MongoDB backend) can take over behind the same interface.
 */
final class DatabaseDescriptorStore implements DescriptorStoreInterface {

  public const string TABLE = 'world_signature_descriptor';

  /** Filter keys nearest() accepts, each an indexed column. */
  private const array FILTER_COLUMNS = ['bundle', 'sector', 'type', 'status', 'lang'];

  private const int MAX_K = 200;

  public function __construct(
    private readonly Connection $database,
    private readonly LoggerChannelInterface $logger,
  ) {}

  /**
   * {@inheritdoc}
   */
  public function upsert(array $descriptor): void {
    $id = (string) ($descriptor['_id'] ?? '');
    if ($id === '') {
      throw new \InvalidArgumentException('Descriptor missing _id.');
    }
    $semantic = $descriptor['signature']['semantic'] ?? [];
    $vector = is_array($semantic['embedding'] ?? NULL) ? $semantic['embedding'] : [];
    if (isset($descriptor['signature']['semantic'])) {
      // The vector lives in the packed column; storing it twice as JSON
      // would quintuple the row.
      unset($descriptor['signature']['semantic']['embedding']);
    }
    $type = (string) ($descriptor['type'] ?? '');
    $bundle = str_contains($type, ':') ? substr($type, strpos($type, ':') + 1) : '';

    try {
      $this->database->merge(self::TABLE)
        ->key('id', $id)
        ->fields([
          'type' => $type,
          'bundle' => $bundle,
          'sector' => isset($descriptor['sector']) ? (string) $descriptor['sector'] : NULL,
          'status' => (string) ($descriptor['status'] ?? ''),
          'lang' => (string) ($descriptor['lang'] ?? ''),
          'model_version' => (string) ($semantic['modelVersion'] ?? ''),
          'dimensions' => count($vector),
          'embedding' => Vectors::pack($vector),
          'descriptor' => json_encode($descriptor, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE),
          'changed' => time(),
        ])
        ->execute();
    }
    catch (\Exception $e) {
      throw new \RuntimeException(sprintf('Descriptor store upsert failed for %s: %s', $id, $e->getMessage()), previous: $e);
    }
  }

  /**
   * {@inheritdoc}
   */
  public function delete(string $id): void {
    try {
      $this->database->delete(self::TABLE)->condition('id', $id)->execute();
    }
    catch (\Exception $e) {
      throw new \RuntimeException(sprintf('Descriptor store delete failed for %s: %s', $id, $e->getMessage()), previous: $e);
    }
  }

  /**
   * {@inheritdoc}
   */
  public function find(string $id): ?array {
    try {
      $row = $this->database->select(self::TABLE, 'd')
        ->fields('d', ['descriptor', 'embedding'])
        ->condition('id', $id)
        ->execute()
        ->fetchAssoc();
    }
    catch (\Exception $e) {
      throw new \RuntimeException(sprintf('Descriptor store find failed for %s: %s', $id, $e->getMessage()), previous: $e);
    }
    return $row ? $this->hydrate($row['descriptor'], $row['embedding']) : NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function findAll(int $hardLimit = 5000): array {
    try {
      $rows = $this->database->select(self::TABLE, 'd')
        ->fields('d', ['descriptor', 'embedding'])
        ->orderBy('id')
        ->range(0, max(0, $hardLimit))
        ->execute();
      $out = [];
      foreach ($rows as $row) {
        $out[] = $this->hydrate($row->descriptor, $row->embedding);
      }
      return $out;
    }
    catch (\Exception $e) {
      throw new \RuntimeException('Descriptor store findAll failed: ' . $e->getMessage(), previous: $e);
    }
  }

  /**
   * {@inheritdoc}
   *
   * Filters: `bundle`, `sector` (primary sector term id), `type`
   * (`node:article`), `status`, `lang`. Scores are cosine similarity.
   *
   * @throws \InvalidArgumentException
   *   On an unsupported filter key (a caller bug, not a store failure).
   */
  public function nearest(array $vector, int $k = 12, array $filter = []): array {
    if ($vector === [] || $k <= 0) {
      return [];
    }
    $unknown = array_diff(array_keys($filter), self::FILTER_COLUMNS);
    if ($unknown !== []) {
      throw new \InvalidArgumentException(sprintf(
        'Unsupported nearest() filter key(s): %s. Supported: %s.',
        implode(', ', $unknown),
        implode(', ', self::FILTER_COLUMNS),
      ));
    }
    if (in_array([], $filter, TRUE)) {
      // "Any of nothing" matches nothing.
      return [];
    }

    try {
      $query = $this->database->select(self::TABLE, 'd')
        ->fields('d', ['id', 'embedding'])
        ->condition('dimensions', count($vector))
        ->orderBy('id');
      foreach ($filter as $column => $value) {
        is_array($value)
          ? $query->condition($column, array_values($value), 'IN')
          : $query->condition($column, $value);
      }
      $candidates = static function () use ($query): \Generator {
        foreach ($query->execute() as $row) {
          yield $row->id => Vectors::unpack((string) $row->embedding);
        }
      };
      $scores = Vectors::rank($vector, $candidates(), min(self::MAX_K, $k));
      if ($scores === []) {
        return [];
      }

      $rows = $this->database->select(self::TABLE, 'd')
        ->fields('d', ['id', 'descriptor', 'embedding'])
        ->condition('id', array_keys($scores), 'IN')
        ->execute()
        ->fetchAllAssoc('id');
    }
    catch (\Exception $e) {
      $this->logger->warning('Vector search failed: @msg', ['@msg' => $e->getMessage()]);
      return [];
    }

    $out = [];
    foreach ($scores as $id => $score) {
      if (isset($rows[$id])) {
        $out[] = [
          '_id' => (string) $id,
          'score' => $score,
          'descriptor' => $this->hydrate($rows[$id]->descriptor, $rows[$id]->embedding),
        ];
      }
    }
    return $out;
  }

  /**
   * {@inheritdoc}
   */
  public function ping(): bool {
    try {
      return $this->database->schema()->tableExists(self::TABLE);
    }
    catch (\Exception) {
      return FALSE;
    }
  }

  /**
   * Rebuild a descriptor from its stored JSON and packed vector.
   *
   * @return array<string, mixed>
   *   The descriptor with signature.semantic.embedding restored.
   */
  private function hydrate(string $json, ?string $blob): array {
    $descriptor = json_decode($json, TRUE) ?: [];
    if (isset($descriptor['signature']['semantic'])) {
      $vector = Vectors::unpack((string) $blob);
      $descriptor['signature']['semantic']['embedding'] = $vector !== [] ? $vector : NULL;
    }
    return $descriptor;
  }

}
