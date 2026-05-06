<?php

declare(strict_types=1);

namespace Drupal\world_signature\Plugin;

use Drupal\Component\Plugin\PluginBase;

/**
 * Base implementation for Metaphor plugins.
 *
 * Concrete metaphors (e.g. `Article`, `Profile`, `Event`) extend
 * either NodeMetaphorBase or ParagraphMetaphorBase, which extend
 * this. Subclasses are responsible for the three abstract methods
 * declared on MetaphorPluginInterface.
 *
 * Designed fresh — does not inherit from or borrow names from any
 * reference module's plugin shape.
 */
abstract class MetaphorPluginBase extends PluginBase implements MetaphorPluginInterface {
}
