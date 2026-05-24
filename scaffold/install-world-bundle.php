<?php
// Install the `world` content type's fields on a running site + seed
// one active World node with the current baked-in constants. The
// node.type.world bundle ships via config/install; this adds the
// fields (entity API) and the default world. Idempotent.
// Run: ddev exec "drush scr scaffold/install-world-bundle.php"

use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;
use Drupal\node\Entity\Node;
use Drupal\node\Entity\NodeType;

// 0. Ensure the bundle exists (fresh installs get it from config/install;
//    a running site may need it created).
if (!NodeType::load('world')) {
  NodeType::create([
    'type' => 'world',
    'name' => 'World',
    'description' => "The world's characteristics — vantage geometry, atmosphere, scale.",
    'new_revision' => TRUE,
  ])->save();
  echo "Created node type: world\n";
}

// 1. Decimal geometry fields — each a learned-lesson constant made editable.
$decimals = [
  'field_world_radius' => ['World radius', 'World bounds.'],
  'field_world_overview_height' => ['Overview height', 'Camera altitude at the overview vantage.'],
  'field_world_section_height' => ['Sector vantage height', 'Camera altitude at a sector vantage.'],
  'field_world_closeup_distance' => ['Close-up distance', 'Camera distance at the detail vantage. Bumped for SmartObjects (trees + card surface).'],
  'field_world_closeup_height' => ['Close-up height', 'Camera aim height at the detail vantage so the card is framed.'],
  'field_world_sector_ring_radius' => ['Sector ring radius', 'Distance from origin to each sector centroid.'],
  'field_world_sector_local_radius' => ['Sector local radius', 'Within-sector entity bounds.'],
  'field_world_semantic_radius' => ['Semantic layout radius', 'Target radius the BETA-2 embedding projection is scaled to fit.'],
];
foreach ($decimals as $name => [$label, $desc]) {
  if (!FieldStorageConfig::loadByName('node', $name)) {
    FieldStorageConfig::create([
      'field_name' => $name,
      'entity_type' => 'node',
      'type' => 'decimal',
      'cardinality' => 1,
      'settings' => ['precision' => 10, 'scale' => 2],
    ])->save();
  }
  if (!FieldConfig::loadByName('node', 'world', $name)) {
    FieldConfig::create([
      'field_name' => $name,
      'entity_type' => 'node',
      'bundle' => 'world',
      'label' => $label,
      'description' => $desc,
      'required' => FALSE,
    ])->save();
  }
}
echo "Decimal geometry fields ready (" . count($decimals) . ")\n";

// 2. Atmosphere (enum) + active (boolean).
if (!FieldStorageConfig::loadByName('node', 'field_world_atmosphere')) {
  FieldStorageConfig::create([
    'field_name' => 'field_world_atmosphere',
    'entity_type' => 'node',
    'type' => 'list_string',
    'cardinality' => 1,
    'settings' => ['allowed_values' => [
      'none' => 'None (defaults only)',
      'forest' => 'Forest',
      'inner-mind' => 'Inner mind',
    ]],
  ])->save();
}
if (!FieldConfig::loadByName('node', 'world', 'field_world_atmosphere')) {
  FieldConfig::create([
    'field_name' => 'field_world_atmosphere',
    'entity_type' => 'node',
    'bundle' => 'world',
    'label' => 'Atmosphere',
    'description' => 'Which skin the world renders in. Overrides the palette config\'s active_atmosphere.',
    'required' => FALSE,
  ])->save();
}
if (!FieldStorageConfig::loadByName('node', 'field_world_active')) {
  FieldStorageConfig::create([
    'field_name' => 'field_world_active',
    'entity_type' => 'node',
    'type' => 'boolean',
    'cardinality' => 1,
  ])->save();
}
if (!FieldConfig::loadByName('node', 'world', 'field_world_active')) {
  FieldConfig::create([
    'field_name' => 'field_world_active',
    'entity_type' => 'node',
    'bundle' => 'world',
    'label' => 'Active',
    'description' => 'The one world the snapshot publishes. If several are flagged, the lowest node id wins.',
    'required' => FALSE,
  ])->save();
}
echo "Atmosphere + active fields ready\n";

// 3. Seed one active World node with the current baked-in constants,
//    so there's an authored world out of the box (publisher still
//    falls back to the same numbers if this is deleted).
$existing = \Drupal::entityTypeManager()->getStorage('node')
  ->loadByProperties(['type' => 'world']);
if (!$existing) {
  Node::create([
    'type' => 'world',
    'title' => 'Atlas Coffee — forest world',
    'status' => 1,
    'field_world_radius' => 200,
    'field_world_overview_height' => 200,
    'field_world_section_vantage_height' => 30,
    'field_world_closeup_distance' => 32,
    'field_world_closeup_height' => 14,
    'field_world_sector_ring_radius' => 100,
    'field_world_sector_local_radius' => 30,
    'field_world_semantic_radius' => 120,
    'field_world_atmosphere' => 'forest',
    'field_world_active' => TRUE,
  ])->save();
  echo "Seeded active World node from current constants\n";
}
else {
  echo "World node(s) already present (" . count($existing) . ")\n";
}

echo "Done.\n";
