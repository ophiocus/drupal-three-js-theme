<?php

declare(strict_types=1);

namespace Drupal\world_signature\Embedding;

/**
 * Projects high-dimensional embeddings to deterministic 2D world
 * coordinates via classical multidimensional scaling (MDS).
 *
 * Why MDS (vs UMAP/t-SNE): the corpus is small (tens to low
 * hundreds of entities), MDS is closed-form + deterministic
 * (critical for URI-is-a-coordinate), and it preserves the global
 * structure of the distance matrix — "things far apart in meaning
 * stay far apart in space." UMAP/t-SNE preserve local neighborhoods
 * better but are iterative, stochastic, and overkill at this scale.
 *
 * Pipeline:
 *   embeddings → cosine distance matrix D
 *   → double-centered Gram matrix B = -½ J D² J
 *   → top-2 eigenvectors (power iteration + deflation)
 *   → coords = eigenvector · √eigenvalue
 *   → recentre + scale to fit the world radius
 *
 * Determinism: power iteration seeds from a fixed deterministic
 * vector (not RNG); fixed iteration count. Same embeddings → same
 * coordinates, every run, every machine.
 *
 * See docs/MILESTONES.md BETA 2.
 */
final class SemanticLayoutProjector {

  /** Power-iteration steps per eigenvector. 100 is ample at this N. */
  private const int POWER_ITERATIONS = 128;

  /**
   * Project embeddings to 2D positions scaled to fit within
   * `targetRadius` of the origin.
   *
   * @param array<string, float[]> $embeddings
   *   descriptorId => L2-normalized vector. Order is preserved.
   * @param float $targetRadius
   *   The projected cloud is scaled so its farthest point sits at
   *   ~this distance from the centre.
   *
   * @return array<string, array{x: float, z: float}>
   *   descriptorId => world XZ position.
   */
  public function project(array $embeddings, float $targetRadius): array {
    $ids = array_keys($embeddings);
    $n = count($ids);
    if ($n === 0) {
      return [];
    }
    if ($n === 1) {
      return [$ids[0] => ['x' => 0.0, 'z' => 0.0]];
    }

    $vectors = array_values($embeddings);

    // 1. Squared cosine-distance matrix. Vectors are L2-normalized,
    //    so cosine similarity = dot product; distance = 1 - sim,
    //    clamped to [0, 2]. We store D² directly for MDS.
    $dsq = [];
    for ($i = 0; $i < $n; $i++) {
      $dsq[$i] = array_fill(0, $n, 0.0);
    }
    for ($i = 0; $i < $n; $i++) {
      for ($j = $i + 1; $j < $n; $j++) {
        $sim = $this->dot($vectors[$i], $vectors[$j]);
        $dist = 1.0 - $sim;
        if ($dist < 0.0) {
          $dist = 0.0;
        }
        $d2 = $dist * $dist;
        $dsq[$i][$j] = $d2;
        $dsq[$j][$i] = $d2;
      }
    }

    // 2. Double centering → Gram matrix B = -½ J D² J.
    //    J = I - (1/n) 1 1ᵀ. We compute row/col/grand means and
    //    apply B_ij = -½ (D²_ij - rowMean_i - colMean_j + grandMean).
    $rowMean = array_fill(0, $n, 0.0);
    $grand = 0.0;
    for ($i = 0; $i < $n; $i++) {
      $s = 0.0;
      for ($j = 0; $j < $n; $j++) {
        $s += $dsq[$i][$j];
      }
      $rowMean[$i] = $s / $n;
      $grand += $s;
    }
    $grand /= ($n * $n);

    $b = [];
    for ($i = 0; $i < $n; $i++) {
      $b[$i] = array_fill(0, $n, 0.0);
      for ($j = 0; $j < $n; $j++) {
        // Symmetric, so colMean_j == rowMean_j.
        $b[$i][$j] = -0.5 * ($dsq[$i][$j] - $rowMean[$i] - $rowMean[$j] + $grand);
      }
    }

    // 3. Top-2 eigenvectors via power iteration + deflation.
    [$vec1, $val1] = $this->dominantEigen($b, $n, NULL);
    [$vec2, $val2] = $this->dominantEigen($b, $n, $vec1);

    // 4. Coordinates = eigenvector scaled by sqrt(eigenvalue).
    //    Cosine distance isn't perfectly Euclidean so eigenvalues
    //    can go slightly negative; clamp to 0 (those axes collapse).
    $sc1 = sqrt(max($val1, 0.0));
    $sc2 = sqrt(max($val2, 0.0));

    $coords = [];
    for ($i = 0; $i < $n; $i++) {
      $coords[$i] = [
        'x' => $vec1[$i] * $sc1,
        'z' => $vec2[$i] * $sc2,
      ];
    }

    // 5. Recentre on the centroid + scale so the farthest point
    //    sits at ~targetRadius. Keeps the cloud framed regardless
    //    of the raw eigenvalue magnitudes.
    return $this->fit($ids, $coords, $targetRadius);
  }

  /**
   * Dominant eigenvector/value of a symmetric matrix via power
   * iteration. If $deflate is provided, the matrix is implicitly
   * deflated against it (Hotelling deflation) so this returns the
   * SECOND eigenvector.
   *
   * @param float[][] $m
   * @param int $n
   * @param float[]|null $deflate
   * @return array{0: float[], 1: float}
   *   [eigenvector (length n), eigenvalue]
   */
  private function dominantEigen(array $m, int $n, ?array $deflate): array {
    // Deterministic seed — a fixed non-uniform vector so we don't
    // accidentally start orthogonal to the dominant eigenvector
    // (all-ones can do that on centred matrices). Index-derived.
    $v = [];
    for ($i = 0; $i < $n; $i++) {
      $v[$i] = sin($i + 1.0);
    }
    $v = $this->unit($v);

    $eigenvalue = 0.0;
    for ($iter = 0; $iter < self::POWER_ITERATIONS; $iter++) {
      // Project out the deflated component each step so numerical
      // drift doesn't reintroduce the first eigenvector.
      if ($deflate !== NULL) {
        $v = $this->orthogonalize($v, $deflate);
      }
      // w = M v
      $w = array_fill(0, $n, 0.0);
      for ($i = 0; $i < $n; $i++) {
        $row = $m[$i];
        $s = 0.0;
        for ($j = 0; $j < $n; $j++) {
          $s += $row[$j] * $v[$j];
        }
        $w[$i] = $s;
      }
      if ($deflate !== NULL) {
        $w = $this->orthogonalize($w, $deflate);
      }
      $norm = $this->norm($w);
      if ($norm < 1e-12) {
        // Degenerate (zero matrix / collapsed axis). Bail with the
        // current vector + zero eigenvalue → that coordinate axis
        // contributes nothing.
        return [$v, 0.0];
      }
      foreach ($w as $i => $val) {
        $w[$i] = $val / $norm;
      }
      $v = $w;
      $eigenvalue = $norm;
    }

    // Rayleigh quotient for the signed eigenvalue (power iteration's
    // norm is the magnitude; sign matters for clamping negatives).
    $mv = array_fill(0, $n, 0.0);
    for ($i = 0; $i < $n; $i++) {
      $s = 0.0;
      for ($j = 0; $j < $n; $j++) {
        $s += $m[$i][$j] * $v[$j];
      }
      $mv[$i] = $s;
    }
    $signed = $this->dot($v, $mv);

    return [$v, $signed];
  }

  /**
   * Recentre coords on their centroid and uniformly scale so the
   * farthest point lands near $targetRadius.
   *
   * @param string[] $ids
   * @param array<int, array{x: float, z: float}> $coords
   * @return array<string, array{x: float, z: float}>
   */
  private function fit(array $ids, array $coords, float $targetRadius): array {
    $n = count($ids);
    $cx = 0.0;
    $cz = 0.0;
    foreach ($coords as $c) {
      $cx += $c['x'];
      $cz += $c['z'];
    }
    $cx /= $n;
    $cz /= $n;

    $maxR = 0.0;
    foreach ($coords as $c) {
      $dx = $c['x'] - $cx;
      $dz = $c['z'] - $cz;
      $r = sqrt($dx * $dx + $dz * $dz);
      if ($r > $maxR) {
        $maxR = $r;
      }
    }
    $scale = $maxR > 1e-9 ? ($targetRadius / $maxR) : 1.0;

    $out = [];
    foreach ($ids as $i => $id) {
      $out[$id] = [
        'x' => ($coords[$i]['x'] - $cx) * $scale,
        'z' => ($coords[$i]['z'] - $cz) * $scale,
      ];
    }
    return $out;
  }

  /** @param float[] $a @param float[] $b */
  private function dot(array $a, array $b): float {
    $s = 0.0;
    $len = count($a);
    for ($i = 0; $i < $len; $i++) {
      $s += $a[$i] * $b[$i];
    }
    return $s;
  }

  /** @param float[] $v */
  private function norm(array $v): float {
    return sqrt($this->dot($v, $v));
  }

  /** @param float[] $v @return float[] */
  private function unit(array $v): array {
    $m = $this->norm($v);
    if ($m < 1e-12) {
      return $v;
    }
    foreach ($v as $i => $val) {
      $v[$i] = $val / $m;
    }
    return $v;
  }

  /**
   * Remove the component of $v along $basis (assumed unit length),
   * returning the orthogonal remainder.
   *
   * @param float[] $v @param float[] $basis @return float[]
   */
  private function orthogonalize(array $v, array $basis): array {
    $proj = $this->dot($v, $basis);
    foreach ($v as $i => $val) {
      $v[$i] = $val - $proj * $basis[$i];
    }
    return $v;
  }

}
