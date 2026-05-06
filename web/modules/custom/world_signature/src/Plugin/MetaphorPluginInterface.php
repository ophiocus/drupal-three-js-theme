<?php

declare(strict_types=1);

namespace Drupal\world_signature\Plugin;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Component\Plugin\PluginInspectionInterface;
use Drupal\world_signature\Signature\EntityFacts;

/**
 * The contract every Metaphor plugin honors.
 *
 * A Metaphor knows how to turn a specific entity bundle into the
 * inputs the cypher needs:
 *
 *   1. EntityFacts        — what the SignatureExtractor consumes.
 *   2. Sector membership  — which top-level taxonomy term(s) it lives in.
 *   3. Card enumeration   — which view modes are activatable surfaces.
 *
 * Metaphors are pure mappers from the editorial schema onto the
 * world's grammar. They do not render. They do not compute the
 * signature themselves — they hand facts to the extractor. The
 * extractor + the metaphor together produce the descriptor the
 * renderer consumes.
 */
interface MetaphorPluginInterface extends PluginInspectionInterface {

  /**
   * Pull the EntityFacts for this entity. Implementations read the
   * entity's fields, paragraphs, taxonomy refs, timestamps, and
   * compose them into the DTO without doing any computation the
   * extractor will redo.
   */
  public function extractFacts(EntityInterface $entity): EntityFacts;

  /**
   * Return the top-level taxonomy term ids for the entity's sector
   * membership. Multi-tagged entities return multiple terms; the
   * renderer uses these for borderland placement.
   *
   * @return string[]
   */
  public function sectorTermIds(EntityInterface $entity): array;

  /**
   * Return the card descriptors (id, viewMode, label, contentRef,
   * triggers) the entity exposes. The world's three-state card
   * model consumes these.
   *
   * @return array<int, array<string, mixed>>
   */
  public function cards(EntityInterface $entity): array;

}
