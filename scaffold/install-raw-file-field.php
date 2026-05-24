<?php
// Install field_asset_raw_file on the asset bundle of an already-
// running site. The config/install YAML covers fresh installs; this
// applies the same field to an existing install via the entity API.
// Idempotent. Run: ddev exec "drush scr scaffold/install-raw-file-field.php"

use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;

if (!FieldStorageConfig::loadByName('node', 'field_asset_raw_file')) {
  FieldStorageConfig::create([
    'field_name' => 'field_asset_raw_file',
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
  echo "Created field storage node.field_asset_raw_file\n";
}
else {
  echo "Field storage already exists\n";
}

if (!FieldConfig::loadByName('node', 'asset', 'field_asset_raw_file')) {
  FieldConfig::create([
    'field_name' => 'field_asset_raw_file',
    'entity_type' => 'node',
    'bundle' => 'asset',
    'label' => 'Raw file',
    'description' => 'The mesh binary as extracted from its source pack, untransformed. Filled by asset ingestion; curation produces the world-ready curated file from it.',
    'required' => FALSE,
    'settings' => [
      'file_directory' => 'assets/raw/[date:custom:Y-m]',
      'file_extensions' => 'glb gltf',
      'max_filesize' => '',
      'description_field' => FALSE,
      'handler' => 'default:file',
      'handler_settings' => [],
    ],
  ])->save();
  echo "Created field instance node.asset.field_asset_raw_file\n";
}
else {
  echo "Field instance already exists\n";
}

echo "Done.\n";
