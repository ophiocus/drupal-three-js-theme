<?php

declare(strict_types=1);

namespace Drupal\world_signature\Store;

/**
 * Pure vector helpers for the database descriptor store.
 *
 * Compact storage and exact cosine ranking; no Drupal dependencies, so
 * it unit-tests.
 *
 * Vectors are stored as packed little-endian float32 (4 bytes per
 * dimension: 4 KiB at 1024-d instead of ~20 KiB of JSON). Embedding
 * models emit float32, so the round trip loses nothing that mattered.
 */
final class Vectors {

  /**
   * Pack floats into a little-endian float32 byte string.
   *
   * @param float[] $vector
   */
  public static function pack(array $vector): string {
    return $vector === [] ? '' : pack('g*', ...array_map('floatval', array_values($vector)));
  }

  /**
   * Unpack a little-endian float32 byte string.
   *
   * @return float[]
   */
  public static function unpack(string $blob): array {
    if ($blob === '') {
      return [];
    }
    $values = unpack('g*', $blob);
    return $values === FALSE ? [] : array_values($values);
  }

  /**
   * Rank candidates by cosine similarity to $query, best first.
   *
   * Candidates whose width differs from the query (a corpus caught
   * mid re-embed) and zero vectors are skipped, not scored.
   *
   * @param float[] $query
   * @param iterable<string, float[]> $candidates
   *   id => vector.
   * @param int $k
   *   How many to return.
   *
   * @return array<string, float>
   *   id => cosine similarity in [-1, 1], highest first, at most $k.
   */
  public static function rank(array $query, iterable $candidates, int $k): array {
    $query = array_values($query);
    $width = count($query);
    $queryNorm = self::norm($query);
    if ($width === 0 || $k <= 0 || $queryNorm < 1e-12) {
      return [];
    }
    $scores = [];
    foreach ($candidates as $id => $vector) {
      if (count($vector) !== $width) {
        continue;
      }
      $dot = 0.0;
      $sumSq = 0.0;
      foreach ($vector as $i => $value) {
        $dot += $value * $query[$i];
        $sumSq += $value * $value;
      }
      if ($sumSq < 1e-24) {
        continue;
      }
      $scores[(string) $id] = $dot / ($queryNorm * sqrt($sumSq));
    }
    arsort($scores);
    return array_slice($scores, 0, $k, TRUE);
  }

  /** @param float[] $vector */
  private static function norm(array $vector): float {
    $sumSq = 0.0;
    foreach ($vector as $value) {
      $sumSq += $value * $value;
    }
    return sqrt($sumSq);
  }

}
