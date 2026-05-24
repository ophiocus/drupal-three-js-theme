<?php
// Install field_asset_turntable + the asset teaser view-display on an
// already-running site (config/install covers fresh installs only).
// Idempotent. Run: ddev exec "drush scr scaffold/install-turntable-field.php"

use Drupal\Core\Entity\Entity\EntityViewDisplay;
use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;

if (!FieldStorageConfig::loadByName('node', 'field_asset_turntable')) {
  FieldStorageConfig::create([
    'field_name' => 'field_asset_turntable',
    'entity_type' => 'node',
    'type' => 'file',
    'cardinality' => 1,
    'settings' => [
      'uri_scheme' => 'public',
      'target_type' => 'file',
      'display_field' => FALSE,
      'display_default' => FALSE,
    ],
  ])->save();
  echo "Created field storage node.field_asset_turntable\n";
}
else {
  echo "Field storage already exists\n";
}

$instance = FieldConfig::loadByName('node', 'asset', 'field_asset_turntable');
if (!$instance) {
  $instance = FieldConfig::create([
    'field_name' => 'field_asset_turntable',
    'entity_type' => 'node',
    'bundle' => 'asset',
    'label' => 'Turntable preview',
    'required' => FALSE,
    'settings' => [
      'file_directory' => 'assets/turntable/[date:custom:Y-m]',
      'file_extensions' => 'mp4',
      'max_filesize' => '',
      'description_field' => FALSE,
      'handler' => 'default:file',
      'handler_settings' => [],
    ],
  ]);
  echo "Created field instance node.asset.field_asset_turntable\n";
}
else {
  echo "Field instance exists — syncing extensions to mp4\n";
}
// All media is MP4 — enforce on create AND on an existing field.
$instance->setSetting('file_extensions', 'mp4');
$instance->setDescription('Short looping turntable clip (mp4) of the model, autoplayed on hover in listings. Produced by the external asset_workshop render platform — this module only hosts and plays it.');
$instance->save();

// Asset teaser display: render the turntable with the core Video
// formatter (controls off, autoplay off, loop + muted on).
$display = EntityViewDisplay::load('node.asset.teaser');
if (!$display) {
  $display = EntityViewDisplay::create([
    'targetEntityType' => 'node',
    'bundle' => 'asset',
    'mode' => 'teaser',
    'status' => TRUE,
  ]);
}
$display->setComponent('field_asset_turntable', [
  'type' => 'file_video',
  'label' => 'hidden',
  'weight' => 0,
  'region' => 'content',
  'settings' => [
    'controls' => FALSE,
    'autoplay' => FALSE,
    'loop' => TRUE,
    'muted' => TRUE,
    'width' => 320,
    'height' => 320,
    'multiple_file_display_type' => 'tags',
  ],
]);
// Keep the rest of the (verbose) asset fields out of the teaser card.
foreach ([
  'field_asset_atmospheres', 'field_asset_curated_file', 'field_asset_curated_pivot',
  'field_asset_curated_polycount', 'field_asset_curation_notes', 'field_asset_pack',
  'field_asset_raw_file', 'field_asset_raw_polycount', 'field_asset_raw_preview',
  'field_asset_slot', 'field_asset_status',
] as $hidden) {
  $display->removeComponent($hidden);
}
$display->save();
echo "Configured asset teaser display (node.asset.teaser)\n";

echo "Done.\n";
