<?php

declare(strict_types=1);

namespace Drupal\world_signature\Service;

use Drupal\Core\Config\ConfigFactoryInterface;

/**
 * Read-only API over the world manifesto.
 *
 * The manifesto (see docs/MANIFESTO.md) is the registry of every
 * kind of thing the world contains and every kind of property a
 * thing can expose. This service loads the registry from
 * `world_signature.manifesto` config and exposes inspection
 * methods code can use without parsing the YAML by hand.
 *
 * Read-only by policy: the manifesto evolves through commits to
 * `config/install/world_signature.manifesto.yml`, not through
 * runtime mutation. Properties don't override the manifesto;
 * they author *instances* of its declared item types.
 */
final class WorldManifesto {

  /**
   * Allowed lifecycle markers, matching docs/MANIFESTO.md.
   */
  public const string STATUS_IMPLEMENTED = 'implemented';
  public const string STATUS_PARTIAL = 'partially_implemented';
  public const string STATUS_PLANNED = 'planned';

  public function __construct(
    private readonly ConfigFactoryInterface $configFactory,
  ) {}

  /**
   * Manifesto schema version this property has installed.
   */
  public function version(): int {
    return (int) ($this->raw()['version'] ?? 0);
  }

  /**
   * The whole component-type vocabulary, keyed by component-type id.
   *
   * @return array<string, array{label: string, description: string, value_schema: mixed, examples?: array}>
   */
  public function getComponentTypes(): array {
    return (array) ($this->raw()['component_types'] ?? []);
  }

  /**
   * The whole item-type registry, keyed by item-type id.
   *
   * Storage is a sequence (Drupal config rejects dots in keys), but
   * the API exposes an id-keyed map for ergonomic lookup.
   *
   * @return array<string, array{id: string, label: string, description: string, components: array, config_object: string, status: string, instance_cardinality?: string}>
   */
  public function getItemTypes(): array {
    $sequence = (array) ($this->raw()['item_types'] ?? []);
    $byId = [];
    foreach ($sequence as $entry) {
      $id = $entry['id'] ?? NULL;
      if ($id !== NULL) {
        $byId[(string) $id] = $entry;
      }
    }
    return $byId;
  }

  /**
   * Item types filtered by lifecycle status. Defaults to
   * implemented + partially_implemented (i.e. "ready to consider").
   *
   * @param string[] $statuses
   *
   * @return array<string, array>
   */
  public function getItemTypesByStatus(array $statuses = [self::STATUS_IMPLEMENTED, self::STATUS_PARTIAL]): array {
    $allowed = array_flip($statuses);
    return array_filter(
      $this->getItemTypes(),
      static fn(array $def) => isset($allowed[$def['status'] ?? '']),
    );
  }

  /**
   * The component slots a single item type declares.
   *
   * @return array<int, array{type: string, name: string}>
   */
  public function componentsOf(string $itemTypeId): array {
    $items = $this->getItemTypes();
    return (array) ($items[$itemTypeId]['components'] ?? []);
  }

  /**
   * The Drupal config object path for an item type's instances.
   * May contain `{placeholder}` segments (e.g.
   * `world_signature.sector.{termId}`); callers substitute.
   */
  public function configObjectFor(string $itemTypeId): ?string {
    $items = $this->getItemTypes();
    return $items[$itemTypeId]['config_object'] ?? NULL;
  }

  /**
   * TRUE iff the named component type is in the manifesto's
   * vocabulary. Useful for runtime sanity-checks before the
   * renderer attempts to honor a component slot.
   */
  public function knowsComponentType(string $componentTypeId): bool {
    return isset($this->getComponentTypes()[$componentTypeId]);
  }

  /**
   * TRUE iff the named item type is registered. status-agnostic.
   */
  public function knowsItemType(string $itemTypeId): bool {
    return isset($this->getItemTypes()[$itemTypeId]);
  }

  /**
   * Item types that declare a particular component type. Useful for
   * "every item that has a hitbox" style queries.
   *
   * @return array<int, string>
   *   Item type ids.
   */
  public function itemTypesWithComponentType(string $componentTypeId): array {
    $hits = [];
    foreach ($this->getItemTypes() as $id => $def) {
      foreach (($def['components'] ?? []) as $slot) {
        if (($slot['type'] ?? NULL) === $componentTypeId) {
          $hits[] = $id;
          break;
        }
      }
    }
    return $hits;
  }

  // ─── Internal ─────────────────────────────────────────────────────

  /**
   * @return array<string, mixed>
   */
  private function raw(): array {
    return (array) $this->configFactory
      ->get('world_signature.manifesto')
      ->getRawData();
  }

}
