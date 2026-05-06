<?php

declare(strict_types=1);

namespace Drupal\world_signature\Annotation;

use Drupal\Component\Annotation\Plugin;

/**
 * Annotation for a Metaphor plugin.
 *
 * Each Metaphor plugin owns the translation from a single
 * Drupal entity bundle into a world descriptor — its sector
 * assignment, its physical characteristics, its card deck. The
 * plugin manager discovers these by scanning
 * `src/Plugin/Metaphor/<EntityType>/<Bundle>.php` files.
 *
 * @Annotation
 */
final class Metaphor extends Plugin {

  /**
   * The plugin id (usually `<entity_type>:<bundle>`, kebab-cased).
   */
  public string $id;

  /**
   * The Drupal entity type this metaphor applies to (e.g. `node`,
   * `paragraph`, `taxonomy_term`).
   */
  public string $entity_type;

  /**
   * The bundle this metaphor applies to (e.g. `article`, `event`).
   */
  public string $bundle;

  /**
   * Human-readable label.
   *
   * @var \Drupal\Core\Annotation\Translation
   *
   * @ingroup plugin_translatable
   */
  public $label;

}
