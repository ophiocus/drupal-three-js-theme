<?php

declare(strict_types=1);

namespace Drupal\world_signature\Signature;

/**
 * Structural layer of the signature.
 *
 * Counts, dimensions, completeness — what an entity *is* by shape.
 * Card metrics live here too; rich card decks become physically denser
 * objects in the world.
 */
final class SignatureStructural {

  public function __construct(
    public readonly int $wordCount = 0,
    public readonly int $paragraphCount = 0,
    public readonly int $imageCount = 0,
    public readonly int $cardCount = 0,
    public readonly int $bloomTriggerCount = 0,
    public readonly int $totalCardWordCount = 0,
  ) {}

  public function toArray(): array {
    return [
      'wordCount' => $this->wordCount,
      'paragraphCount' => $this->paragraphCount,
      'imageCount' => $this->imageCount,
      'cardCount' => $this->cardCount,
      'bloomTriggerCount' => $this->bloomTriggerCount,
      'totalCardWordCount' => $this->totalCardWordCount,
    ];
  }

  public static function fromArray(array $data): self {
    return new self(
      wordCount: (int) ($data['wordCount'] ?? 0),
      paragraphCount: (int) ($data['paragraphCount'] ?? 0),
      imageCount: (int) ($data['imageCount'] ?? 0),
      cardCount: (int) ($data['cardCount'] ?? 0),
      bloomTriggerCount: (int) ($data['bloomTriggerCount'] ?? 0),
      totalCardWordCount: (int) ($data['totalCardWordCount'] ?? 0),
    );
  }

}
