<?php

declare(strict_types=1);

namespace Drupal\world_signature\Plugin\Metaphor\Node;

/**
 * Metaphor plugin for `node:profile`.
 *
 * A profile is a *person in the world* — producer, cooperative
 * lead, micro-mill operator, roaster. Forest atmosphere renders
 * them as bipedal forest spirits via ProfileAsSpirit; the default
 * atmosphere renders the UE5-meta cube fallback. Sector is
 * derived from `field_world_sector` like article; the single
 * ALPHA card is the `full` view mode. NodeMetaphorBase covers
 * the rest with sane defaults.
 *
 * @Metaphor(
 *   id = "node:profile",
 *   entity_type = "node",
 *   bundle = "profile",
 *   label = @Translation("Profile"),
 * )
 */
final class Profile extends NodeMetaphorBase {
}
