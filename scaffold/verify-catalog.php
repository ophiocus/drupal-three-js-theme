<?php

/**
 * Verify the catalog seeder's output — pack ↔ asset references
 * resolve, license + slot + status taxonomy refs hydrate, and the
 * "pack of many" case (one pack with multiple asset children) is
 * traversable in both directions.
 */

declare(strict_types=1);

use Drupal\node\Entity\Node;

$packs = \Drupal::entityTypeManager()->getStorage('node')->loadByProperties(['type' => 'pack']);
$assets = \Drupal::entityTypeManager()->getStorage('node')->loadByProperties(['type' => 'asset']);

echo "Catalog summary\n";
echo sprintf("  %d packs, %d assets\n\n", count($packs), count($assets));

// Group assets by pack, count multi-slot packs.
$assetsByPack = [];
foreach ($assets as $a) {
  $packRef = $a->get('field_asset_pack')->target_id;
  $assetsByPack[$packRef][] = $a;
}

echo "Per-pack asset counts (packs with >1 child highlighted):\n";
foreach ($packs as $p) {
  $children = $assetsByPack[$p->id()] ?? [];
  $marker = count($children) > 1 ? '  ★ ' : '    ';
  $licenseTerm = $p->get('field_pack_license')->entity;
  $licenseName = $licenseTerm ? $licenseTerm->label() : '?';
  echo sprintf(
    "%s pack nid=%-3d [%s] %-50s → %d assets\n",
    $marker,
    $p->id(),
    $licenseName,
    mb_strimwidth($p->label(), 0, 50, '…'),
    count($children),
  );
  foreach ($children as $a) {
    $slotTerm = $a->get('field_asset_slot')->entity;
    $statusTerm = $a->get('field_asset_status')->entity;
    echo sprintf(
      "         └─ asset nid=%-3d slot=%s status=%s\n",
      $a->id(),
      $slotTerm ? $slotTerm->label() : '?',
      $statusTerm ? $statusTerm->label() : '?',
    );
  }
}
