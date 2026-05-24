<?php

declare(strict_types=1);

namespace Drupal\Tests\world_signature\Unit;

use Drupal\world_signature\Embedding\LocalTfIdfEmbeddingProvider;
use Drupal\world_signature\Embedding\SemanticLayoutProjector;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\TestCase;

/**
 * BETA 2 semantic-layout invariants — pure-PHP unit suite.
 *
 * Covers the two load-bearing pieces of the embedding pipeline:
 * the local TF-IDF provider and the MDS projector. Both are pure
 * math with no Drupal bootstrap, so they run on bare PHPUnit.
 *
 * The promises under test:
 *   - embedding is deterministic (URI-is-a-coordinate depends on it)
 *   - similar documents embed closer than dissimilar ones
 *   - projection is deterministic + frames to the target radius
 *   - similar documents project nearer in 2D than dissimilar ones
 */
#[CoversClass(LocalTfIdfEmbeddingProvider::class)]
#[CoversClass(SemanticLayoutProjector::class)]
#[Group('world_signature')]
final class SemanticLayoutTest extends TestCase {

  private LocalTfIdfEmbeddingProvider $provider;
  private SemanticLayoutProjector $projector;

  protected function setUp(): void {
    $this->provider = new LocalTfIdfEmbeddingProvider();
    $this->projector = new SemanticLayoutProjector();
  }

  /** A small corpus with two clear topical clusters. */
  private function corpus(): array {
    return [
      // Cluster A — harvest / mill / processing.
      'a1' => 'The harvest arrives at the dry mill where parchment coffee is graded and milled to green.',
      'a2' => 'Dry mill processing grades the harvest; parchment is milled to green coffee for export.',
      // Cluster B — climate / altitude.
      'b1' => 'Climate change at high altitude shifts the growing season for mountain producers.',
      'b2' => 'At altitude the changing climate alters when mountain coffee flowers and ripens.',
    ];
  }

  // ── Embedding: determinism ──────────────────────────────────────

  public function testEmbeddingIsDeterministic(): void {
    $first = $this->provider->embedCorpus($this->corpus());
    $second = $this->provider->embedCorpus($this->corpus());
    $this->assertSame(
      $first,
      $second,
      'Same corpus must produce identical embeddings (URI-is-a-coordinate).',
    );
  }

  public function testEmbeddingHasFixedDimensions(): void {
    $vectors = $this->provider->embedCorpus($this->corpus());
    foreach ($vectors as $id => $vec) {
      $this->assertCount(
        $this->provider->dimensions(),
        $vec,
        "Vector {$id} must have the provider's fixed dimension.",
      );
    }
  }

  public function testEmbeddingIsL2Normalized(): void {
    $vectors = $this->provider->embedCorpus($this->corpus());
    foreach ($vectors as $id => $vec) {
      $mag = sqrt(array_sum(array_map(static fn($v) => $v * $v, $vec)));
      $this->assertEqualsWithDelta(
        1.0, $mag, 1e-9,
        "Vector {$id} must be unit length.",
      );
    }
  }

  // ── Embedding: similar > dissimilar ─────────────────────────────

  public function testSimilarDocumentsEmbedCloser(): void {
    $v = $this->provider->embedCorpus($this->corpus());
    // Cosine similarity = dot product (vectors are unit length).
    $withinCluster = $this->dot($v['a1'], $v['a2']);
    $acrossCluster = $this->dot($v['a1'], $v['b1']);
    $this->assertGreaterThan(
      $acrossCluster,
      $withinCluster,
      'Two harvest/mill docs must be more similar to each other than to a climate doc.',
    );
  }

  // ── Projection: determinism + framing ───────────────────────────

  public function testProjectionIsDeterministic(): void {
    $v = $this->provider->embedCorpus($this->corpus());
    $first = $this->projector->project($v, 100.0);
    $second = $this->projector->project($v, 100.0);
    $this->assertEquals(
      $first,
      $second,
      'Projection must be deterministic for a fixed embedding set.',
    );
  }

  public function testProjectionFitsTargetRadius(): void {
    $v = $this->provider->embedCorpus($this->corpus());
    $radius = 120.0;
    $pos = $this->projector->project($v, $radius);
    // Centroid of the projected cloud.
    $cx = array_sum(array_column($pos, 'x')) / count($pos);
    $cz = array_sum(array_column($pos, 'z')) / count($pos);
    $maxR = 0.0;
    foreach ($pos as $p) {
      $r = sqrt(($p['x'] - $cx) ** 2 + ($p['z'] - $cz) ** 2);
      $maxR = max($maxR, $r);
    }
    $this->assertEqualsWithDelta(
      $radius, $maxR, 1.0,
      'Farthest projected point should sit at ~targetRadius from centre.',
    );
  }

  public function testProjectionKeepsClustersNearer(): void {
    $v = $this->provider->embedCorpus($this->corpus());
    $pos = $this->projector->project($v, 100.0);
    $within = $this->dist2d($pos['a1'], $pos['a2']);
    $across = $this->dist2d($pos['a1'], $pos['b1']);
    $this->assertLessThan(
      $across,
      $within,
      'Same-cluster docs must project closer than cross-cluster docs.',
    );
  }

  // ── Edge cases ──────────────────────────────────────────────────

  public function testEmptyCorpusYieldsEmptyResults(): void {
    $this->assertSame([], $this->provider->embedCorpus([]));
    $this->assertSame([], $this->projector->project([], 100.0));
  }

  public function testSingleEntityProjectsToOrigin(): void {
    $v = $this->provider->embedCorpus(['only' => 'a single lonely document']);
    $pos = $this->projector->project($v, 100.0);
    $this->assertSame(['only' => ['x' => 0.0, 'z' => 0.0]], $pos);
  }

  // ── Helpers ─────────────────────────────────────────────────────

  /** @param float[] $a @param float[] $b */
  private function dot(array $a, array $b): float {
    $s = 0.0;
    foreach ($a as $i => $v) {
      $s += $v * $b[$i];
    }
    return $s;
  }

  /** @param array{x: float, z: float} $a @param array{x: float, z: float} $b */
  private function dist2d(array $a, array $b): float {
    return sqrt(($a['x'] - $b['x']) ** 2 + ($a['z'] - $b['z']) ** 2);
  }

}
