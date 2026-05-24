<?php
// Reverse the wire-test-asset.php wiring. Marks the test asset
// back to `shortlisted` and clears the placeholder curated_file.
// Run via: ddev exec "drush scr scaffold/unwire-test-asset.php"

use Drupal\file\Entity\File;

$nodeStorage = \Drupal::entityTypeManager()->getStorage('node');
$termStorage = \Drupal::entityTypeManager()->getStorage('taxonomy_term');

$shortlistedTerms = $termStorage->loadByProperties([
  'vid' => 'asset_status',
  'name' => 'shortlisted',
]);
$shortlistedTerm = reset($shortlistedTerms);
if (!$shortlistedTerm) {
  echo "ERROR: no 'shortlisted' term in asset_status vocab.\n";
  return;
}

$liveTerms = $termStorage->loadByProperties([
  'vid' => 'asset_status',
  'name' => 'live',
]);
$liveTerm = reset($liveTerms);
if (!$liveTerm) {
  echo "ERROR: no 'live' term — nothing to unwire.\n";
  return;
}

$liveAssets = $nodeStorage->loadByProperties([
  'type' => 'asset',
  'field_asset_status' => $liveTerm->id(),
]);
foreach ($liveAssets as $asset) {
  $fileField = $asset->get('field_asset_curated_file');
  $fileId = $fileField->isEmpty() ? NULL : (int) $fileField->target_id;
  $asset->set('field_asset_status', ['target_id' => $shortlistedTerm->id()]);
  $asset->set('field_asset_curated_file', []);
  $asset->save();
  if ($fileId) {
    $file = File::load($fileId);
    if ($file) {
      $file->delete();
    }
  }
  echo sprintf(
    "Unwired nid=%d (%s)\n",
    $asset->id(),
    $asset->label(),
  );
}
echo "Catalog reset to baseline (all shortlisted, no curated files).\n";
