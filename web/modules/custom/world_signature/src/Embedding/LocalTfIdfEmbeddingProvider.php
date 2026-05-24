<?php

declare(strict_types=1);

namespace Drupal\world_signature\Embedding;

/**
 * Dependency-free, deterministic embedding provider — DEV / PoC ONLY.
 *
 * Per docs/BOUNDARY.md, embedding *processing* is an external-service
 * concern, not the module's. This provider exists so DDEV and demos
 * work with zero setup; it is NOT the production embedder. Production
 * sets WORLD_EMBED_URL and uses RemoteEmbeddingProvider — the module
 * then only *consumes* the vectors (and projects them, which is the
 * internal "spatial referencing" half).
 *
 * Computes TF-IDF over the corpus, then feature-hashes each
 * document's weighted terms into a fixed-width dense vector
 * (the "hashing trick"), L2-normalized. No external API, no keys,
 * no network — the whole semantic-layout pipeline runs in DDEV
 * with this provider, and a real neural provider
 * (RemoteEmbeddingProvider) is a config swap.
 *
 * The semantics are lexical, not deep: documents sharing
 * vocabulary land near each other. That's a real, visible signal
 * on a coherent corpus (coffee articles cluster by topic +
 * region), enough to demonstrate "syntactic proximity in 3D"
 * end-to-end. Swap in Voyage/Anthropic for true semantic depth.
 *
 * Determinism: PHP's crc32 is stable across platforms; no RNG;
 * same corpus → same vectors. Critical for the URI-is-a-coordinate
 * invariant — re-embedding an unchanged corpus must not move the
 * world.
 */
final class LocalTfIdfEmbeddingProvider implements EmbeddingProviderInterface {

  /** Fixed embedding width. Power of two for clean modulo bucketing. */
  private const int DIM = 256;

  private const string MODEL_VERSION = 'local-tfidf-fh256-v1';

  /**
   * English stopwords — high-frequency function words that carry
   * no topical signal. Trimming them sharpens the clustering. Kept
   * deliberately short (the IDF weighting already suppresses
   * ubiquitous terms); this just removes the most useless ones.
   */
  private const array STOPWORDS = [
    'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on',
    'at', 'for', 'with', 'by', 'from', 'as', 'is', 'are', 'was',
    'were', 'be', 'been', 'being', 'this', 'that', 'these', 'those',
    'it', 'its', 'they', 'them', 'their', 'has', 'have', 'had',
    'not', 'no', 'so', 'if', 'than', 'then', 'when', 'which', 'who',
    'what', 'how', 'where', 'all', 'can', 'will', 'would', 'there',
    'here', 'we', 'you', 'he', 'she', 'his', 'her', 'our', 'your',
  ];

  public function modelVersion(): string {
    return self::MODEL_VERSION;
  }

  public function dimensions(): int {
    return self::DIM;
  }

  public function embedCorpus(array $documents): array {
    if ($documents === []) {
      return [];
    }

    // Pass 1: tokenize every document, accumulate term frequencies
    // per doc + document frequencies across the corpus.
    $tokensByDoc = [];
    $docFreq = [];
    foreach ($documents as $id => $text) {
      $tokens = $this->tokenize($text);
      $tokensByDoc[$id] = $tokens;
      // Document frequency counts each term once per document.
      foreach (array_unique(array_keys($tokens)) as $term) {
        $docFreq[$term] = ($docFreq[$term] ?? 0) + 1;
      }
    }

    $n = count($documents);

    // Pass 2: TF-IDF → feature-hashed dense vector per doc.
    $vectors = [];
    foreach ($tokensByDoc as $id => $termCounts) {
      $vec = array_fill(0, self::DIM, 0.0);
      $maxTf = max($termCounts ?: [1]);
      foreach ($termCounts as $term => $count) {
        // Sub-linear TF (1 + log) dampens long documents; IDF
        // (log of inverse doc frequency) suppresses ubiquitous
        // terms. +1 smoothing on both keeps weights finite.
        $tf = 0.5 + 0.5 * ($count / $maxTf);
        $idf = log(($n + 1) / (($docFreq[$term] ?? 0) + 1)) + 1.0;
        $weight = $tf * $idf;

        // Feature hashing: term → bucket, with a sign hash to
        // make collisions cancel rather than accumulate bias.
        $bucket = $this->bucket($term);
        $sign = $this->signHash($term);
        $vec[$bucket] += $sign * $weight;
      }
      $vectors[$id] = $this->l2normalize($vec);
    }

    return $vectors;
  }

  /**
   * Tokenize: lowercase, split on non-letters, drop stopwords +
   * very short tokens, count occurrences.
   *
   * @return array<string, int> term => count
   */
  private function tokenize(string $text): array {
    $text = mb_strtolower($text);
    // Split on anything that isn't a unicode letter. preg with /u
    // handles accented coffee-region vocabulary (Tarrazú, Inzá).
    $parts = preg_split('/[^\p{L}]+/u', $text, -1, PREG_SPLIT_NO_EMPTY) ?: [];
    $counts = [];
    $stop = array_flip(self::STOPWORDS);
    foreach ($parts as $word) {
      if (mb_strlen($word) < 3) {
        continue;
      }
      if (isset($stop[$word])) {
        continue;
      }
      $counts[$word] = ($counts[$word] ?? 0) + 1;
    }
    return $counts;
  }

  /** Stable term → bucket index in [0, DIM). */
  private function bucket(string $term): int {
    return crc32($term) % self::DIM;
  }

  /** Stable term → ±1 sign (separate hash so it's independent of bucket). */
  private function signHash(string $term): int {
    return (crc32('sign:' . $term) % 2) === 0 ? 1 : -1;
  }

  /**
   * L2-normalize so cosine similarity reduces to a dot product and
   * the projector's distance metric is well-behaved. A zero vector
   * (document with no signal) stays zero — not a division by zero.
   *
   * @param float[] $vec
   * @return float[]
   */
  private function l2normalize(array $vec): array {
    $sumSq = 0.0;
    foreach ($vec as $v) {
      $sumSq += $v * $v;
    }
    $mag = sqrt($sumSq);
    if ($mag < 1e-12) {
      return $vec;
    }
    foreach ($vec as $i => $v) {
      $vec[$i] = $v / $mag;
    }
    return $vec;
  }

}
