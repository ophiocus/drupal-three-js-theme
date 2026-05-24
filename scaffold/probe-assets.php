<?php
// Probe utility — list seeded asset nodes + their wiring state.
// Run via: ddev exec "drush scr scaffold/probe-assets.php"

$nodeStorage = \Drupal::entityTypeManager()->getStorage('node');
$assets = $nodeStorage->loadByProperties(['type' => 'asset']);
echo 'Loaded ' . count($assets) . " asset nodes\n";
$i = 0;
foreach ($assets as $a) {
  $status = $a->get('field_asset_status')->entity?->getName() ?? 'NULL';
  $slot = $a->get('field_asset_slot')->entity?->getName() ?? 'NULL';
  $hasFile = $a->get('field_asset_curated_file')->isEmpty() ? 'EMPTY' : 'present';
  echo sprintf(
    "  nid=%d  status=%-10s  slot=%-20s  file=%s  title=%s\n",
    $a->id(),
    $status,
    $slot,
    $hasFile,
    $a->label(),
  );
  if (++$i >= 20) break;
}
