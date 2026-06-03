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
   *   summary: string,
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
      // v0.4 hover subtitle: first sentence of body as a one-line
      // teaser. Surfaced by the renderer when the entity is
      // hovered. Generated server-side so the renderer doesn't
      // have to parse / truncate per pointermove.
      'summary' => $this->extractSummary($facts->bodyText, 140),
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
   * First-sentence summary of the body, truncated to ~$maxLen
   * characters. Picks the last sentence terminator within the
   * window; falls back to a hard truncation with ellipsis when
   * no sentence break exists in range.
   *
   * Used by the renderer's hover subtitle on entity title labels.
   */
  private function extractSummary(string $bodyText, int $maxLen): string {
    $text = trim($bodyText);
    if ($text === '') {
      return '';
    }
    // Collapse internal whitespace (newlines + tabs) to single
    // spaces — the subtitle is a one-line teaser.
    $text = (string) preg_replace('/\s+/', ' ', $text);
    if (mb_strlen($text) <= $maxLen) {
      return $text;
    }
    $window = mb_substr($text, 0, $maxLen);
    // Last sentence terminator inside the window.
    $candidates = [];
    foreach (['.', '!', '?'] as $term) {
      $pos = mb_strrpos($window, $term);
      if ($pos !== FALSE) {
        $candidates[] = $pos;
      }
    }
    if ($candidates !== [] && max($candidates) > $maxLen * 0.4) {
      return mb_substr($text, 0, max($candidates) + 1);
    }
    // No sentence break in range — hard cut at last word boundary.
    $lastSpace = mb_strrpos($window, ' ');
    $cut = ($lastSpace !== FALSE && $lastSpace > $maxLen * 0.4)
      ? $lastSpace
      : $maxLen;
    return mb_substr($text, 0, $cut) . '…';
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
   * The text that embeddings vectorise. Title + body is the v1
   * default; richer entities (paragraphs, etc.) can override by
   * giving their metaphor plugin a richer body extractor.
   *
   * Public so the BETA 2 embedding pass (drush world:embed) builds
   * the corpus from the SAME text the descriptor advertises — one
   * definition of "what this entity says," shared by the embedder
   * and the (future Atlas-managed) index.
   */
  public function embeddingText(EntityInterface $entity, EntityFacts $facts): string {
    $title = (string) ($entity->label() ?? '');
    $body = trim($facts->bodyText);
    if ($title === '') {
      return $body;
    }
    if ($body === '') {
      return $title;
    }
    // Weighted title: repeat the title three times so the embedder
    // gives the title's vocabulary three times the weight of any
    // single body sentence. Titles tend to carry the editorial
    // intent of the entity more sharply than body prose, and
    // weighting them improves the signal-to-noise ratio of the
    // resulting embedding noticeably for short-body corpora.
    // (Cheap; the embedder runs once per node.)
    return $title . ". " . $title . ". " . $title . ".\n\n" . $body;
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
