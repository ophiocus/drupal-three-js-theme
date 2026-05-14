<?php

declare(strict_types=1);

namespace Drupal\world_signature\Plugin\Metaphor\Node;

/**
 * Metaphor plugin for `node:article`.
 *
 * The first concrete metaphor: an Article becomes a *room* in the
 * world (per THESIS.md's article→room mapping). Its sector is
 * derived from `field_world_sector`; its single ALPHA card is the `full`
 * view mode. NodeMetaphorBase covers all of this with sane defaults
 * so this plugin contains only its annotation.
 *
 * Subsequent bundles (Profile, Event, Product) follow the same
 * pattern: declare the annotation, override helpers only where the
 * bundle's schema diverges.
 *
 * @Metaphor(
 *   id = "node:article",
 *   entity_type = "node",
 *   bundle = "article",
 *   label = @Translation("Article"),
 * )
 */
final class Article extends NodeMetaphorBase {
}
