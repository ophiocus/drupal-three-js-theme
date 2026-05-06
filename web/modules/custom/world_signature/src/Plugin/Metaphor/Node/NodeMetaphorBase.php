<?php

declare(strict_types=1);

namespace Drupal\world_signature\Plugin\Metaphor\Node;

use Drupal\Core\Entity\EntityInterface;
use Drupal\node\NodeInterface;
use Drupal\world_signature\Plugin\MetaphorPluginBase;
use Drupal\world_signature\Signature\EntityFacts;

/**
 * Base for node-shaped Metaphor plugins.
 *
 * Provides defaults that read the most common Drupal-node fields
 * (body, field_tags, field_paragraphs, field_image, etc.) so that a
 * concrete bundle plugin (e.g. Article, Profile, Event) only has to
 * declare its annotation. Subclasses override the protected helpers
 * when their bundle's schema diverges.
 *
 * The graph metrics (in/outDegree) are stubbed to zero here. The
 * queue worker in Sprint 3b computes real degrees by querying the
 * entity-reference graph after the fact.
 */
abstract class NodeMetaphorBase extends MetaphorPluginBase {

  public function extractFacts(EntityInterface $entity): EntityFacts {
    assert($entity instanceof NodeInterface);

    $cards = $this->cards($entity);

    return new EntityFacts(
      entityType: 'node',
      bundle: $entity->bundle(),
      uuid: $entity->uuid(),
      taxonomyTerms: $this->sectorTermIds($entity),
      bodyText: $this->extractBodyText($entity),
      paragraphCount: $this->extractParagraphCount($entity),
      imageCount: $this->extractImageCount($entity),
      cardCount: count($cards),
      bloomTriggerCount: $this->countBloomTriggers($cards),
      totalCardWordCount: $this->extractTotalCardWordCount($entity),
      createdAt: (int) $entity->getCreatedTime(),
      changedAt: (int) $entity->getChangedTime(),
      // Stub for ALPHA; queue worker computes real degrees.
      inDegree: 0,
      outDegree: 0,
    );
  }

  // ─── Default helpers — override per bundle when schema diverges ─────

  protected function extractBodyText(NodeInterface $entity): string {
    if ($entity->hasField('body') && !$entity->get('body')->isEmpty()) {
      $value = (string) ($entity->get('body')->value ?? '');
      // Strip HTML so wordCount is on prose, not markup.
      return trim(strip_tags($value));
    }
    return '';
  }

  protected function extractParagraphCount(NodeInterface $entity): int {
    foreach (['field_paragraphs', 'field_content', 'field_components'] as $f) {
      if ($entity->hasField($f)) {
        return $entity->get($f)->count();
      }
    }
    return 0;
  }

  protected function extractImageCount(NodeInterface $entity): int {
    $count = 0;
    foreach (['field_image', 'field_images', 'field_media', 'field_hero'] as $f) {
      if ($entity->hasField($f)) {
        $count += $entity->get($f)->count();
      }
    }
    return $count;
  }

  public function sectorTermIds(EntityInterface $entity): array {
    assert($entity instanceof NodeInterface);
    if (!$entity->hasField('field_tags')) {
      return [];
    }
    $terms = [];
    foreach ($entity->get('field_tags') as $item) {
      if (!empty($item->target_id)) {
        $terms[] = (string) $item->target_id;
      }
    }
    return $terms;
  }

  public function cards(EntityInterface $entity): array {
    assert($entity instanceof NodeInterface);

    // Default deck: one `full` view-mode card, click-activated.
    return [
      [
        'id' => 'full',
        'viewMode' => 'full',
        'label' => 'Full',
        'contentRef' => sprintf(
          '/world/card/%s/%s/full',
          $entity->getEntityTypeId(),
          $entity->id(),
        ),
        'triggers' => [['kind' => 'user_click']],
      ],
    ];
  }

  protected function countBloomTriggers(array $cards): int {
    $total = 0;
    foreach ($cards as $card) {
      $total += count($card['triggers'] ?? []);
    }
    return $total;
  }

  /**
   * For the default single-card deck, this is the body's word count.
   * Subclasses with multi-card decks override and sum across cards.
   */
  protected function extractTotalCardWordCount(NodeInterface $entity): int {
    $body = $this->extractBodyText($entity);
    if ($body === '') {
      return 0;
    }
    return count(preg_split('/\s+/', $body));
  }

}
