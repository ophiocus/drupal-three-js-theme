<?php

/**
 * Wipe every descriptor from the RESTHeart gateway.
 *
 * Why this exists: `drush si standard` drops the Drupal DB, but the
 * RESTHeart sidecar container persists across installs. Entity
 * delete hooks never fire during a DB drop, so orphan descriptors
 * accumulate in the gateway over time. The snapshot endpoint reads
 * straight from RESTHeart, so the world ends up showing 2× / 3× /
 * Nx the actual current corpus.
 *
 * Battle-scar: noticed when the scene rendered 40 entities + 10
 * sectors after a fresh install + re-seed — twice the actual count.
 *
 * Run before `drush world:publish` after a fresh install:
 *   ddev drush scr scaffold/wipe-gateway.php
 *   ddev drush world:publish
 *
 * A future v0.3.x followup adds a `--clean` flag to `world:publish`
 * that wipes orphans before pushing. Until then, this script is the
 * manual cleanup.
 */

declare(strict_types=1);

/** @var \Drupal\world_signature\Service\WorldSearchClient $client */
$client = \Drupal::service('world_signature.world_search_client');

$descriptors = $client->findAll();
echo sprintf("[wipe-gateway] %d descriptors found in RESTHeart.\n", count($descriptors));

$deleted = 0;
$errors = 0;
foreach ($descriptors as $d) {
  $id = $d['_id'] ?? NULL;
  if ($id === NULL) {
    continue;
  }
  try {
    $client->delete($id);
    $deleted++;
    if ($deleted % 10 === 0) {
      echo sprintf("  ... %d deleted\n", $deleted);
    }
  } catch (\Throwable $e) {
    $errors++;
    echo sprintf("  ! delete %s failed: %s\n", $id, $e->getMessage());
  }
}

echo sprintf("\n[wipe-gateway] done: %d deleted, %d errors.\n", $deleted, $errors);
echo "\nNext: ddev drush world:publish\n";
