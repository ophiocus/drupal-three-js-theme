<?php

/**
 * Purge orphan descriptors — RESTHeart records whose Drupal entity
 * no longer exists. Sprint 6 leftover cleanup; the entity_delete
 * hook should normally handle this but the seeder ran without the
 * queue worker draining it inline.
 *
 * Run via: ddev drush scr scaffold/purge-orphans.php
 */

declare(strict_types=1);

$client = \Drupal::service('world_signature.world_search_client');
$descriptors = $client->findAll();
$entityTypeManager = \Drupal::entityTypeManager();

$kept = 0;
$purged = 0;
foreach ($descriptors as $d) {
  $id = $d['_id'] ?? NULL;
  if ($id === NULL) {
    continue;
  }
  // Descriptor id shape: "<entityType>-<entityId>", e.g. "node-1".
  // Locate the underlying Drupal entity; if absent, purge.
  $parts = explode('-', $id, 2);
  if (count($parts) !== 2) {
    echo sprintf("  ? skip %s — malformed id\n", $id);
    continue;
  }
  [$entityType, $entityId] = $parts;
  try {
    $storage = $entityTypeManager->getStorage($entityType);
    $entity = $storage->load($entityId);
    if ($entity === NULL) {
      echo sprintf("  - purge %s — entity not found\n", $id);
      $client->delete($id);
      $purged++;
    } else {
      $kept++;
    }
  } catch (\Throwable $e) {
    echo sprintf("  ! %s: %s\n", $id, $e->getMessage());
  }
}

echo sprintf("\ndone — kept: %d, purged: %d\n", $kept, $purged);
