<?php

declare(strict_types=1);

namespace Drupal\world_signature\Signature;

/**
 * Pure function: EntityFacts -> Signature.
 *
 * The extractor is the cypher's signature math, isolated from Drupal
 * for pure-unit testability. Mirrors the JS-side `vantage()` shape:
 * one externally-relevant function, deterministic output, pure.
 *
 * The seven invariants enforced here are mirrored in
 * SignatureExtractorTest:
 *
 *   1. Determinism                  — same facts -> same signature
 *   2. Structural completeness      — counts/word-count derive from facts
 *   3. Temporal monotonicity        — changedAt >= createdAt (enforced by SignatureTemporal)
 *   4. Relational consistency       — degrees non-negative (enforced by SignatureRelational)
 *   5. Semantic placeholder         — same body -> same semanticHash
 *   6. Serialization round-trip     — toArray/fromArray preserves equality
 *   7. Card-metric propagation      — card{Count,BloomTriggerCount,TotalWordCount} pass through
 */
final class SignatureExtractor {

  /**
   * Extract a Signature from EntityFacts.
   */
  public function extract(EntityFacts $facts): Signature {
    return new Signature(
      structural: new SignatureStructural(
        wordCount: $this->countWords($facts->bodyText),
        paragraphCount: $facts->paragraphCount,
        imageCount: $facts->imageCount,
        cardCount: $facts->cardCount,
        bloomTriggerCount: $facts->bloomTriggerCount,
        totalCardWordCount: $facts->totalCardWordCount,
      ),
      temporal: new SignatureTemporal(
        createdAt: $facts->createdAt,
        // Enforce monotonicity at the source: even if the source data
        // claims changedAt < createdAt (clock skew, faulty migration),
        // the signature reports max() of the two.
        changedAt: max($facts->createdAt, $facts->changedAt),
      ),
      relational: new SignatureRelational(
        inDegree: max(0, $facts->inDegree),
        outDegree: max(0, $facts->outDegree),
      ),
      semantic: new SignatureSemantic(
        embedding: NULL,
        modelVersion: NULL,
        embeddedAt: NULL,
        semanticHash: $this->hashBody($facts->bodyText),
      ),
    );
  }

  /**
   * Count words in a body of text. Whitespace-delimited; deterministic;
   * locale-independent.
   */
  private function countWords(string $text): int {
    $trimmed = trim($text);
    if ($trimmed === '') {
      return 0;
    }
    return count(preg_split('/\s+/', $trimmed));
  }

  /**
   * Deterministic semantic-layer placeholder for ALPHA. SHA-256 of
   * the body text gives us a stable, collision-resistant identifier
   * we can use to detect content changes for the staleness check.
   * Replaced by Atlas-managed embeddings once the cypher writes to
   * Atlas (Sprint 3+).
   */
  private function hashBody(string $text): string {
    return hash('sha256', $text);
  }

}
