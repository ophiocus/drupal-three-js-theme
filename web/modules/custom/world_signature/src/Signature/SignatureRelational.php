<?php

declare(strict_types=1);

namespace Drupal\world_signature\Signature;

/**
 * Relational layer of the signature.
 *
 * Position in the entity graph: how many things reference this, how
 * many it references. Feeds gravitational pull, "reach" filaments,
 * centrality.
 */
final class SignatureRelational {

  public function __construct(
    public readonly int $inDegree = 0,
    public readonly int $outDegree = 0,
  ) {
    if ($this->inDegree < 0 || $this->outDegree < 0) {
      throw new \InvalidArgumentException(
        sprintf(
          'Relational degrees must be non-negative: inDegree=%d, outDegree=%d.',
          $this->inDegree,
          $this->outDegree,
        ),
      );
    }
  }

  public function toArray(): array {
    return [
      'inDegree' => $this->inDegree,
      'outDegree' => $this->outDegree,
    ];
  }

  public static function fromArray(array $data): self {
    return new self(
      inDegree: (int) ($data['inDegree'] ?? 0),
      outDegree: (int) ($data['outDegree'] ?? 0),
    );
  }

}
