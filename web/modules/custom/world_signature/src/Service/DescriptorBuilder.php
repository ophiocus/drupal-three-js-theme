<?php

declare(strict_types=1);

namespace Drupal\world_signature\Service;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityInterface;
use Drupal\world_signature\Plugin\MetaphorPluginInterface;
use Drupal\world_signature\Signature\EntityFacts;
use Drupal\world_signature\Signature\Signature;

/**
 * Builds the skinny descriptor written to the gateway.
 *
 * The skinny descriptor is the minimal projection of an entity that
 * lands in Atlas — see ARCHITECTURE.md §3 for the canonical shape and
 * "minimize Mongo" in PROTOCOL for the rationale. MariaDB owns the
 * truth (full Signature on `field_world_signature`); Atlas only holds
 * what the search service needs.
 */
final class DescriptorBuilder {

  /**
   * @return array{
   *   _id: string,
   *   title: string,
   *   type: string,
   *   embeddingText: string,
   *   signature: array,
   *   sector: ?string,
   *   sectorTermIds: array<int, string>,
   *   status: string,
   *   lang: string,
   *   createdAt: int,
   *   changedAt: int,
   *   cards: array<int, array<string, mixed>>,
   * }
   */
  public function build(
    EntityInterface $entity,
    EntityFacts $facts,
    Signature $signature,
    MetaphorPluginInterface $metaphor,
  ): array {
    $sectorTermIds = $facts->taxonomyTerms;
    $primarySector = $sectorTermIds[0] ?? NULL;

    return [
      '_id' => $this->descriptorId($facts->entityType, $entity->id()),
      // v0.4 information-lod: renderer needs the title for HUD
      // labels (Activity B). Was buried inside embeddingText
      // before; exposing it as its own field is cheap and removes
      // the renderer's need to parse the concatenated text.
      'title' => (string) ($entity->label() ?? ''),
      'type' => sprintf('%s:%s', $facts->entityType, $facts->bundle),
      'embeddingText' => $this->embeddingText($entity, $facts),
      'signature' => $signature->toArray(),
      'sector' => $primarySector,
      'sectorTermIds' => $sectorTermIds,
      'status' => $this->status($entity),
      'lang' => $entity->language()->getId(),
      'createdAt' => $facts->createdAt,
      'changedAt' => max($facts->createdAt, $facts->changedAt),
      'cards' => $metaphor->cards($entity),
    ];
  }

  /**
   * Stable id derived from entity type + id. Used as the MongoDB
   * _id for upserts; also recoverable from the URL form
   * `/node/42` -> `node-42`.
   */
  public function descriptorId(string $entityType, string|int $entityId): string {
    return sprintf('%s-%s', $entityType, $entityId);
  }

  /**
   * The text that Atlas-managed embeddings will vectorise. Title +
   * body is the v1 default; richer entities (paragraphs, etc.) can
   * override by giving their metaphor plugin a richer body extractor.
   */
  private function embeddingText(EntityInterface $entity, EntityFacts $facts): string {
    $title = (string) ($entity->label() ?? '');
    $body = trim($facts->bodyText);
    if ($title === '') {
      return $body;
    }
    if ($body === '') {
      return $title;
    }
    return $title . ".\n\n" . $body;
  }

  /**
   * Map Drupal's published flag to a string status the search side
   * can filter on cheaply ("published" / "unpublished"). Workflow
   * states (draft / archived / scheduled) come in v0.0.3+ when the
   * lobby + chatvatar work needs them.
   */
  private function status(EntityInterface $entity): string {
    if ($entity instanceof ContentEntityInterface && method_exists($entity, 'isPublished')) {
      return $entity->isPublished() ? 'published' : 'unpublished';
    }
    return 'unknown';
  }

}
