<?php

declare(strict_types=1);

namespace Drupal\world_signature\Plugin\Metaphor\Node;

/**
 * Metaphor plugin for `node:event`.
 *
 * An event is a *temporal happening* — harvest, cup competition,
 * workshop, cupping week. Forest atmosphere renders them as
 * clearings with standing-stone totems via EventAsTotem; the
 * default atmosphere renders the UE5-meta cube fallback.
 *
 * Future signature work adds `temporal.eventDate` so the
 * atmosphere can modulate visual urgency around the date
 * (pre-event glow, post-event patina). For now the cypher
 * treats events identically to articles, and the renderer
 * differentiates purely via the builder.
 *
 * @Metaphor(
 *   id = "node:event",
 *   entity_type = "node",
 *   bundle = "event",
 *   label = @Translation("Event"),
 * )
 */
final class Event extends NodeMetaphorBase {
}
