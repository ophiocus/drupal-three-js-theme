<?php

declare(strict_types=1);

namespace Drupal\Tests\world_signature\Unit;

use Drupal\world_signature\Store\Vectors;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\TestCase;

/**
 * Vector helpers behind the database descriptor store.
 *
 * Packing must round-trip at float32 precision; ranking must be exact
 * cosine, skip vectors it cannot compare, and break ties
 * deterministically (the world's coordinates must not wobble).
 */
#[CoversClass(Vectors::class)]
#[Group('world_signature')]
final class VectorsTest extends TestCase {

  public function testPackRoundTripsAtFloat32Precision(): void {
    $vector = [0.1, -2.5, 3.0, 1e-3];
    $blob = Vectors::pack($vector);

    $this->assertSame(16, strlen($blob));
    $this->assertEqualsWithDelta($vector, Vectors::unpack($blob), 1e-6);
  }

  public function testEmptyVectorPacksToEmptyString(): void {
    $this->assertSame('', Vectors::pack([]));
    $this->assertSame([], Vectors::unpack(''));
  }

  public function testRankIsCosineBestFirstAndCapped(): void {
    $scores = Vectors::rank([1.0, 0.0], [
      'same' => [3.0, 0.0],
      'orthogonal' => [0.0, 1.0],
      'opposite' => [-1.0, 0.0],
      'diagonal' => [2.0, 2.0],
    ], 2);

    $this->assertSame(['same', 'diagonal'], array_keys($scores));
    $this->assertEqualsWithDelta(1.0, $scores['same'], 1e-12);
    $this->assertEqualsWithDelta(M_SQRT1_2, $scores['diagonal'], 1e-12);
  }

  public function testRankSkipsOtherWidthsAndZeroVectors(): void {
    $scores = Vectors::rank([1.0, 0.0], [
      'wider' => [1.0, 0.0, 0.0],
      'zero' => [0.0, 0.0],
      'fine' => [0.5, 0.5],
    ], 10);

    $this->assertSame(['fine'], array_keys($scores));
  }

  public function testRankWithZeroQueryOrNoRoomIsEmpty(): void {
    $this->assertSame([], Vectors::rank([0.0, 0.0], ['a' => [1.0, 0.0]], 5));
    $this->assertSame([], Vectors::rank([1.0, 0.0], ['a' => [1.0, 0.0]], 0));
  }

  public function testTiesKeepCandidateOrder(): void {
    $scores = Vectors::rank([1.0, 0.0], [
      'b' => [1.0, 1.0],
      'a' => [1.0, -1.0],
      'c' => [2.0, 2.0],
    ], 3);

    $this->assertSame(['b', 'a', 'c'], array_keys($scores));
  }

  public function testRanksPackedCorpus(): void {
    $corpus = [
      'node-1' => Vectors::unpack(Vectors::pack([0.6, 0.8])),
      'node-2' => Vectors::unpack(Vectors::pack([0.8, 0.6])),
    ];
    $scores = Vectors::rank([0.6, 0.8], $corpus, 1);

    $this->assertSame(['node-1'], array_keys($scores));
    $this->assertEqualsWithDelta(1.0, $scores['node-1'], 1e-6);
  }

}
