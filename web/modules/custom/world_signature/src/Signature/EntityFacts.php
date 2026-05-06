<?php

declare(strict_types=1);

namespace Drupal\world_signature\Signature;

/**
 * Plain DTO carrying everything the SignatureExtractor needs to know
 * about an entity, isolated from Drupal's entity API.
 *
 * The Drupal-coupled half (reading EntityInterface and producing
 * EntityFacts) lives in DrupalEntityFactsReader (Sprint 3). This DTO
 * is the seam: the extractor takes it; tests construct it directly
 * without bootstrapping Drupal.
 */
final class EntityFacts {

  /**
   * @param string[] $taxonomyTerms
   *   Top-level taxonomy term ids; first entry is the primary sector.
   *   Multi-tagged entities carry multiple terms here, which lets the
   *   renderer place them at sector borderlands.
   */
  public function __construct(
    public readonly string $entityType,
    public readonly string $bundle,
    public readonly string $uuid,
    public readonly array $taxonomyTerms,
    public readonly string $bodyText,
    public readonly int $paragraphCount,
    public readonly int $imageCount,
    public readonly int $cardCount,
    public readonly int $bloomTriggerCount,
    public readonly int $totalCardWordCount,
    public readonly int $createdAt,
    public readonly int $changedAt,
    public readonly int $inDegree,
    public readonly int $outDegree,
  ) {}

}
