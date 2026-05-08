<?php

/**
 * @file
 * Smoke-test the world manifesto: load via service, query the API.
 *
 *   ddev drush php:script scaffold/verify-manifesto.php
 */

declare(strict_types=1);

use Drupal\world_signature\Service\WorldManifesto;

function ws_check(string $label, bool $ok, ?string $detail = NULL): void {
  print ($ok ? ' ✓ ' : ' ✗ ') . $label;
  if ($detail !== NULL) {
    print "  → $detail";
  }
  print "\n";
  if (!$ok) exit(1);
}

print "═══ verify world manifesto ═══\n\n";

/** @var WorldManifesto $m */
$m = \Drupal::service('world_signature.manifesto');

print sprintf(" · manifesto version: %d\n", $m->version());
ws_check('version >= 1', $m->version() >= 1);

$componentTypes = $m->getComponentTypes();
print sprintf(" · component types: %d\n", count($componentTypes));
foreach (array_keys($componentTypes) as $id) {
  print "    • $id\n";
}
ws_check('all 8 component types declared', count($componentTypes) === 8);
ws_check('color_slot known', $m->knowsComponentType('color_slot'));
ws_check('hitbox known', $m->knowsComponentType('hitbox'));
ws_check('trigger_event known', $m->knowsComponentType('trigger_event'));
ws_check('made-up component unknown', !$m->knowsComponentType('made_up_widget'));

print "\n";

$itemTypes = $m->getItemTypes();
print sprintf(" · item types: %d\n", count($itemTypes));
foreach ($itemTypes as $id => $def) {
  printf("    • %-30s status=%s, components=%d, config=%s\n",
    $id,
    $def['status'] ?? '?',
    count($def['components'] ?? []),
    $def['config_object'] ?? '?',
  );
}

ws_check('5 item types declared', count($itemTypes) === 5);
ws_check('world.global is implemented', ($itemTypes['world.global']['status'] ?? '') === WorldManifesto::STATUS_IMPLEMENTED);
ws_check('chatvatar.barista is planned', ($itemTypes['chatvatar.barista']['status'] ?? '') === WorldManifesto::STATUS_PLANNED);

print "\n";

// Cross-vocabulary query
$withHitbox = $m->itemTypesWithComponentType('hitbox');
print " · item types with hitbox: " . implode(', ', $withHitbox) . "\n";
ws_check('hitbox-bearing items found', count($withHitbox) >= 2);

// Lifecycle filter
$ready = $m->getItemTypesByStatus([WorldManifesto::STATUS_IMPLEMENTED, WorldManifesto::STATUS_PARTIAL]);
print " · ready-to-consider item types: " . implode(', ', array_keys($ready)) . "\n";
ws_check('at least one ready', count($ready) >= 1);

// Component lookup on a known item
$worldComponents = $m->componentsOf('world.global');
ws_check('world.global has color_slots', !empty(array_filter($worldComponents, fn($c) => $c['type'] === 'color_slot')));

// Config-path lookup
ws_check(
  'world.global config_object is world_signature.palette',
  $m->configObjectFor('world.global') === 'world_signature.palette',
);

print "\n══ manifesto verify done — registry loaded, API answers correctly ══\n";
