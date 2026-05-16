<?php

/**
 * Verify the pack + asset content types, vocabularies, and fields
 * are present after `drush en world_signature`. Smoke test used
 * during v0.3.x asset-schema work; safe to keep around.
 */

declare(strict_types=1);

$bundles = array_keys(\Drupal::service('entity_type.bundle.info')->getBundleInfo('node'));
echo "node bundles: " . implode(', ', $bundles) . "\n";

$vocabs = array_keys(\Drupal::entityTypeManager()->getStorage('taxonomy_vocabulary')->loadMultiple());
echo "vocabularies: " . implode(', ', $vocabs) . "\n";

foreach (['pack', 'asset'] as $bundle) {
  $fields = \Drupal::service('entity_field.manager')->getFieldDefinitions('node', $bundle);
  $prefix = 'field_' . $bundle . '_';
  $bundleFields = array_filter(
    array_keys($fields),
    fn($k) => str_starts_with($k, $prefix) || $k === 'body',
  );
  sort($bundleFields);
  echo "\n" . $bundle . " fields (" . count($bundleFields) . "):\n";
  foreach ($bundleFields as $f) {
    $def = $fields[$f];
    $extra = '';
    if ($def->getType() === 'entity_reference') {
      $handler = $def->getSetting('handler_settings') ?? [];
      $targets = array_keys($handler['target_bundles'] ?? []);
      $extra = ' → ' . implode(',', $targets);
    }
    echo sprintf("  %-32s %s%s\n", $f, $def->getType(), $extra);
  }
}
