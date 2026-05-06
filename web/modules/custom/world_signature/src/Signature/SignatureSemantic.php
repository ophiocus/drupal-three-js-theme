<?php

declare(strict_types=1);

namespace Drupal\world_signature\Signature;

/**
 * Semantic layer of the signature.
 *
 * The slot for the topic embedding. In ALPHA the embedding is null —
 * Atlas Vector Search computes the real vector at index time once the
 * descriptor lands in MongoDB. Until then a deterministic
 * `semanticHash` of the body text exercises the layer's plumbing
 * (round-trip, snapshot diffing) without committing to a real vector.
 *
 * `modelVersion` is recorded alongside the vector so the lazy
 * on-retrieval staleness check (PROTOCOL.md decision E6) can mark
 * vectors for reembed when the model is upgraded.
 */
final class SignatureSemantic {

  public function __construct(
    public readonly ?array $embedding = NULL,
    public readonly ?string $modelVersion = NULL,
    public readonly ?int $embeddedAt = NULL,
    public readonly string $semanticHash = '',
  ) {}

  public function toArray(): array {
    return [
      'embedding' => $this->embedding,
      'modelVersion' => $this->modelVersion,
      'embeddedAt' => $this->embeddedAt,
      'semanticHash' => $this->semanticHash,
    ];
  }

  public static function fromArray(array $data): self {
    return new self(
      embedding: $data['embedding'] ?? NULL,
      modelVersion: $data['modelVersion'] ?? NULL,
      embeddedAt: isset($data['embeddedAt']) ? (int) $data['embeddedAt'] : NULL,
      semanticHash: (string) ($data['semanticHash'] ?? ''),
    );
  }

}
