<?php

declare(strict_types=1);

namespace Drupal\Tests\world_signature\Unit;

use Drupal\world_signature\Signature\EntityFacts;
use Drupal\world_signature\Signature\Signature;
use Drupal\world_signature\Signature\SignatureExtractor;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\TestCase;

/**
 * Seven invariants of the SignatureExtractor — pure-PHP unit suite.
 *
 * Mirrors the JS-side vantage suite in shape: a small number of
 * focused tests asserting the core promises the extractor must keep.
 * No Drupal bootstrap; runs on bare PHPUnit.
 *
 * The extractor is the cypher's signature math. If these stay green,
 * the cypher's contract with the renderer is intact.
 */
#[CoversClass(SignatureExtractor::class)]
#[Group('world_signature')]
final class SignatureExtractorTest extends TestCase {

  private SignatureExtractor $extractor;

  protected function setUp(): void {
    $this->extractor = new SignatureExtractor();
  }

  // ─────────────────────────────────────────────────────────────────
  // Invariant 1 — determinism
  // ─────────────────────────────────────────────────────────────────

  public function testSameFactsProduceIdenticalSignatures(): void {
    $facts = $this->facts();
    $a = $this->extractor->extract($facts);
    $b = $this->extractor->extract($facts);
    $this->assertTrue(
      $a->equals($b),
      'Same facts must produce equal signatures.',
    );
  }

  public function testDeterminismAcrossManyFactShapes(): void {
    $shapes = [
      $this->facts(bodyText: 'one fish two fish'),
      $this->facts(bodyText: '', paragraphCount: 0, imageCount: 0),
      $this->facts(taxonomyTerms: ['fishing', 'climbing']),
      $this->facts(inDegree: 99, outDegree: 7),
    ];
    foreach ($shapes as $facts) {
      $this->assertTrue(
        $this->extractor->extract($facts)->equals($this->extractor->extract($facts)),
        'Determinism must hold across all fact shapes.',
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Invariant 2 — structural completeness
  // ─────────────────────────────────────────────────────────────────

  public function testWordCountDerivesFromBodyText(): void {
    $sig = $this->extractor->extract($this->facts(
      bodyText: 'The world contains the document, accessed by activation.',
    ));
    $this->assertSame(8, $sig->structural->wordCount);
  }

  public function testWordCountIsZeroForEmptyOrWhitespaceBody(): void {
    foreach (['', '   ', "\n\n\t"] as $empty) {
      $sig = $this->extractor->extract($this->facts(bodyText: $empty));
      $this->assertSame(
        0,
        $sig->structural->wordCount,
        sprintf('Whitespace-only body (%s) should yield wordCount 0.', json_encode($empty)),
      );
    }
  }

  public function testStructuralCountsPassThroughFromFacts(): void {
    $sig = $this->extractor->extract($this->facts(
      paragraphCount: 6,
      imageCount: 2,
    ));
    $this->assertSame(6, $sig->structural->paragraphCount);
    $this->assertSame(2, $sig->structural->imageCount);
  }

  // ─────────────────────────────────────────────────────────────────
  // Invariant 3 — temporal monotonicity
  // ─────────────────────────────────────────────────────────────────

  public function testChangedAtIsNeverLessThanCreatedAt(): void {
    // Even with adversarial input where changedAt < createdAt, the
    // extractor should clamp upward to satisfy monotonicity.
    $sig = $this->extractor->extract($this->facts(
      createdAt: 1700000000,
      changedAt: 1600000000,
    ));
    $this->assertGreaterThanOrEqual(
      $sig->temporal->createdAt,
      $sig->temporal->changedAt,
      'Temporal monotonicity violated.',
    );
    $this->assertSame(1700000000, $sig->temporal->changedAt);
  }

  public function testNormalTemporalOrderingPassesThrough(): void {
    $sig = $this->extractor->extract($this->facts(
      createdAt: 1700000000,
      changedAt: 1714867200,
    ));
    $this->assertSame(1700000000, $sig->temporal->createdAt);
    $this->assertSame(1714867200, $sig->temporal->changedAt);
  }

  // ─────────────────────────────────────────────────────────────────
  // Invariant 4 — relational consistency
  // ─────────────────────────────────────────────────────────────────

  public function testDegreesAreNonNegativeIntegers(): void {
    $sig = $this->extractor->extract($this->facts(
      // Adversarial: negative degrees should clamp to zero.
      inDegree: -5,
      outDegree: -1,
    ));
    $this->assertGreaterThanOrEqual(0, $sig->relational->inDegree);
    $this->assertGreaterThanOrEqual(0, $sig->relational->outDegree);
  }

  public function testNormalDegreesPassThrough(): void {
    $sig = $this->extractor->extract($this->facts(
      inDegree: 3,
      outDegree: 5,
    ));
    $this->assertSame(3, $sig->relational->inDegree);
    $this->assertSame(5, $sig->relational->outDegree);
  }

  // ─────────────────────────────────────────────────────────────────
  // Invariant 5 — semantic placeholder stability
  // ─────────────────────────────────────────────────────────────────

  public function testSameBodyProducesSameSemanticHash(): void {
    $a = $this->extractor->extract($this->facts(bodyText: 'shared text'));
    $b = $this->extractor->extract($this->facts(bodyText: 'shared text'));
    $this->assertSame($a->semantic->semanticHash, $b->semantic->semanticHash);
  }

  public function testDifferentBodyProducesDifferentSemanticHash(): void {
    $a = $this->extractor->extract($this->facts(bodyText: 'one'));
    $b = $this->extractor->extract($this->facts(bodyText: 'two'));
    $this->assertNotSame($a->semantic->semanticHash, $b->semantic->semanticHash);
  }

  public function testEmbeddingSlotIsNullInAlpha(): void {
    $sig = $this->extractor->extract($this->facts());
    $this->assertNull(
      $sig->semantic->embedding,
      'ALPHA reserves the slot but does not populate; Atlas writes the vector at index time.',
    );
    $this->assertNull($sig->semantic->modelVersion);
    $this->assertNull($sig->semantic->embeddedAt);
  }

  // ─────────────────────────────────────────────────────────────────
  // Invariant 6 — serialization round-trip
  // ─────────────────────────────────────────────────────────────────

  public function testSignatureRoundTripsThroughArray(): void {
    $original = $this->extractor->extract($this->facts(
      bodyText: 'round-trip test body',
      paragraphCount: 4,
      imageCount: 1,
      cardCount: 3,
      bloomTriggerCount: 2,
      totalCardWordCount: 1450,
      createdAt: 1700000000,
      changedAt: 1714867200,
      inDegree: 2,
      outDegree: 7,
    ));
    $rehydrated = Signature::fromArray($original->toArray());
    $this->assertTrue(
      $original->equals($rehydrated),
      'toArray() / fromArray() must preserve signature equality.',
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // Invariant 7 — card-metric propagation
  // ─────────────────────────────────────────────────────────────────

  public function testCardMetricsPropagateToStructural(): void {
    $sig = $this->extractor->extract($this->facts(
      cardCount: 3,
      bloomTriggerCount: 4,
      totalCardWordCount: 1450,
    ));
    $this->assertSame(3, $sig->structural->cardCount);
    $this->assertSame(4, $sig->structural->bloomTriggerCount);
    $this->assertSame(1450, $sig->structural->totalCardWordCount);
  }

  // ─────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────

  /**
   * Build EntityFacts with sensible defaults; named args override.
   */
  private function facts(
    string $entityType = 'node',
    string $bundle = 'article',
    string $uuid = '00000000-0000-0000-0000-000000000001',
    array $taxonomyTerms = ['fishing'],
    string $bodyText = 'hello world',
    int $paragraphCount = 1,
    int $imageCount = 0,
    int $cardCount = 1,
    int $bloomTriggerCount = 1,
    int $totalCardWordCount = 0,
    int $createdAt = 1700000000,
    int $changedAt = 1700000000,
    int $inDegree = 0,
    int $outDegree = 0,
  ): EntityFacts {
    return new EntityFacts(
      entityType: $entityType,
      bundle: $bundle,
      uuid: $uuid,
      taxonomyTerms: $taxonomyTerms,
      bodyText: $bodyText,
      paragraphCount: $paragraphCount,
      imageCount: $imageCount,
      cardCount: $cardCount,
      bloomTriggerCount: $bloomTriggerCount,
      totalCardWordCount: $totalCardWordCount,
      createdAt: $createdAt,
      changedAt: $changedAt,
      inDegree: $inDegree,
      outDegree: $outDegree,
    );
  }

}
