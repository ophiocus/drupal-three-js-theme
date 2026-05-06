<?php

declare(strict_types=1);

namespace Drupal\world_signature\Signature;

/**
 * Temporal layer of the signature.
 *
 * When the entity was created, when last changed. Drives weathering,
 * patina, glow. The extractor enforces monotonicity (changedAt is
 * never less than createdAt) at construction.
 */
final class SignatureTemporal {

  public function __construct(
    public readonly int $createdAt,
    public readonly int $changedAt,
  ) {
    if ($this->changedAt < $this->createdAt) {
      throw new \InvalidArgumentException(
        sprintf(
          'Temporal monotonicity violated: changedAt (%d) < createdAt (%d).',
          $this->changedAt,
          $this->createdAt,
        ),
      );
    }
  }

  public function toArray(): array {
    return [
      'createdAt' => $this->createdAt,
      'changedAt' => $this->changedAt,
    ];
  }

  public static function fromArray(array $data): self {
    return new self(
      createdAt: (int) ($data['createdAt'] ?? 0),
      changedAt: (int) ($data['changedAt'] ?? 0),
    );
  }

}
