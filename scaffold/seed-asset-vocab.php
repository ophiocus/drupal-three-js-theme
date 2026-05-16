<?php

/**
 * Asset taxonomy seeder.
 *
 * Same split as the regions seeder: world_signature ships the
 * vocabularies (asset_licenses, asset_slots, asset_status) as
 * config; this script seeds the canonical terms inside them.
 *
 * Idempotent — re-running cleans existing terms in those vocabs
 * first. Re-run after schema changes; safe to run at any time.
 *
 * Run via:
 *   ddev drush scr scaffold/seed-asset-vocab.php
 *
 * Asset *nodes* (the catalog content) are seeded separately by
 * scaffold/seed-asset-catalog.php once the field schema is stable.
 * This script seeds only the taxonomy.
 */

declare(strict_types=1);

use Drupal\taxonomy\Entity\Term;
use Drupal\taxonomy\Entity\Vocabulary;

// ─── Canonical terms per vocabulary ────────────────────────────────────────

$vocabTerms = [
  'asset_licenses' => [
    // Order matters — drives the term weight, which drives display
    // ordering in the field widget.
    ['name' => 'CC0', 'description' => 'Public domain. No attribution required. Default preferred tier.'],
    ['name' => 'CC-BY', 'description' => 'Attribution required. Runtime credits surface must list the author.'],
    ['name' => 'CC-BY-SA', 'description' => 'Share-alike. Avoid — share-alike infects derived works.'],
    ['name' => 'CC-BY-NC', 'description' => 'Non-commercial. Forbidden for this project.'],
    ['name' => 'Sketchfab Standard', 'description' => 'Per-asset commercial license from Sketchfab. Case-by-case purchase.'],
    ['name' => 'itch.io paid', 'description' => 'Per-asset paid license from itch.io. Case-by-case purchase.'],
    ['name' => 'Custom (in-house)', 'description' => 'Modeled in-house. License is whatever this repository declares.'],
  ],
  'asset_slots' => [
    ['name' => 'standing-stone', 'description' => 'Date-anchored marker prop. Bound to bundle.event via forest atmosphere mappings.yml.'],
    ['name' => 'sapling-figure', 'description' => 'Bipedal humanoid silhouette. Bound to bundle.profile via forest atmosphere mappings.yml.'],
    ['name' => 'oak-stylized', 'description' => 'Stylized deciduous tree. Bound to bundle.article via forest atmosphere mappings.yml.'],
    ['name' => 'forest-scenery-mushroom', 'description' => 'Decorative ground prop — mushroom cluster.'],
    ['name' => 'forest-scenery-fern', 'description' => 'Decorative ground prop — fern.'],
    ['name' => 'forest-scenery-stone', 'description' => 'Decorative ground prop — small stone or boulder.'],
  ],
  'asset_status' => [
    ['name' => 'shortlisted', 'description' => 'Candidate sourced — URL + license + preview recorded; raw file not yet uploaded.'],
    ['name' => 'acquired', 'description' => 'Raw file downloaded and uploaded. Provenance complete.'],
    ['name' => 'curated', 'description' => 'Normalized .glb produced. Ready for wiring into mappings.yml.'],
    ['name' => 'live', 'description' => 'Renderer is actively loading this asset at runtime.'],
    ['name' => 'deprecated', 'description' => 'Superseded by a newer asset. Retained for provenance and rollback.'],
  ],
];

// ─── Execution ─────────────────────────────────────────────────────────────

echo "[seed-asset-vocab] phase 1: validate vocabularies present\n";
foreach (array_keys($vocabTerms) as $vid) {
  if (!Vocabulary::load($vid)) {
    echo sprintf("  ! FATAL: vocabulary '%s' missing. Reinstall world_signature.\n", $vid);
    return;
  }
  echo sprintf("  + %s present\n", $vid);
}

echo "\n[seed-asset-vocab] phase 2: clean existing terms\n";
$termStorage = \Drupal::entityTypeManager()->getStorage('taxonomy_term');
foreach (array_keys($vocabTerms) as $vid) {
  $existing = $termStorage->loadByProperties(['vid' => $vid]);
  foreach ($existing as $t) {
    echo sprintf("  - deleting %s/%d: %s\n", $vid, $t->id(), $t->label());
    $t->delete();
  }
}

echo "\n[seed-asset-vocab] phase 3: create canonical terms\n";
$created = 0;
foreach ($vocabTerms as $vid => $terms) {
  foreach ($terms as $weight => $spec) {
    $term = Term::create([
      'vid' => $vid,
      'name' => $spec['name'],
      'description' => $spec['description'],
      'weight' => $weight,
    ]);
    $term->save();
    $created++;
    echo sprintf("  + %s/%d %s\n", $vid, $term->id(), $spec['name']);
  }
}

echo "\n[seed-asset-vocab] done\n";
echo sprintf(
  "  vocabularies: %d, terms created: %d\n",
  count($vocabTerms),
  $created,
);
echo "\nNext: edit asset nodes via /node/add/asset or run\n";
echo "      scaffold/seed-asset-catalog.php (when present) to bulk-import\n";
echo "      the candidates from assets/props/CANDIDATES.md.\n";
