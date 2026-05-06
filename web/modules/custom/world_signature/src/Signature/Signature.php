<?php

declare(strict_types=1);

namespace Drupal\world_signature\Signature;

/**
 * The four-layer signature.
 *
 * Composed of structural, temporal, relational, and semantic layers
 * — see ARCHITECTURE.md §3 for the canonical schema. Round-trips
 * losslessly through toArray() / fromArray().
 */
final class Signature {

  public function __construct(
    public readonly SignatureStructural $structural,
    public readonly SignatureTemporal $temporal,
    public readonly SignatureRelational $relational,
    public readonly SignatureSemantic $semantic,
  ) {}

  public function toArray(): array {
    return [
      'structural' => $this->structural->toArray(),
      'temporal' => $this->temporal->toArray(),
      'relational' => $this->relational->toArray(),
      'semantic' => $this->semantic->toArray(),
    ];
  }

  public static function fromArray(array $data): self {
    return new self(
      structural: SignatureStructural::fromArray($data['structural'] ?? []),
      temporal: SignatureTemporal::fromArray($data['temporal'] ?? []),
      relational: SignatureRelational::fromArray($data['relational'] ?? []),
      semantic: SignatureSemantic::fromArray($data['semantic'] ?? []),
    );
  }

  /**
   * Equality on serialized form. Useful for assertEquals in tests
   * without having to compare object graphs.
   */
  public function equals(Signature $other): bool {
    return $this->toArray() === $other->toArray();
  }

}
