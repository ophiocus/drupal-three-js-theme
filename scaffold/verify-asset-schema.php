<?php

/**
 * Verify the asset content type, vocabularies, and fields are
 * present after `drush en world_signature`. One-off check used
 * during v0.3.x; safe to keep around as a smoke test.
 */

declare(strict_types=1);

$bundles = array_keys(\Drupal::service('entity_type.bundle.info')->getBundleInfo('node'));
echo "node bundles: " . implode(', ', $bundles) . "\n";

$vocabs = array_keys(\Drupal::entityTypeManager()->getStorage('taxonomy_vocabulary')->loadMultiple());
echo "vocabularies: " . implode(', ', $vocabs) . "\n";

$fields = \Drupal::service('entity_field.manager')->getFieldDefinitions('node', 'asset');
$assetFields = array_filter(
  array_keys($fields),
  fn($k) => str_starts_with($k, 'field_asset_') || $k === 'body',
);
sort($assetFields);
echo "asset fields (" . count($assetFields) . "):\n";
foreach ($assetFields as $f) {
  $def = $fields[$f];
  echo sprintf("  %-32s %s\n", $f, $def->getType());
}
