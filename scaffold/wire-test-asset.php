<?php
// Wire one asset for end-to-end snapshot verification before real
// .glb files are uploaded. Picks the first oak-stylized candidate
// (nid varies by seeder run), attaches a small placeholder file as
// curated_file, marks status=live.
//
// The renderer will try to load the placeholder, AssetCache will
// surface a load error (placeholder isn't a real .glb), and
// tryLoadProp will return null → primitive fallback path. That's
// the documented graceful-failure behaviour. The point of this
// scaffold is verifying the SERVER side end-to-end:
//   1. Asset appears in /world/snapshot/assets.
//   2. Asset appears in /world/snapshot/full's assets[] key.
//   3. drush world:assets-status shows it as the live pick for
//      (atmosphere=forest, slot=oak-stylized).
//
// Idempotent — re-running unwires + re-wires the same asset cleanly.
// Run via: ddev exec "drush scr scaffold/wire-test-asset.php"

use Drupal\file\Entity\File;

$nodeStorage = \Drupal::entityTypeManager()->getStorage('node');
$termStorage = \Drupal::entityTypeManager()->getStorage('taxonomy_term');

// Find the first oak-stylized asset.
$oakSlotTerms = $termStorage->loadByProperties([
  'vid' => 'asset_slots',
  'name' => 'oak-stylized',
]);
$oakSlot = reset($oakSlotTerms);
if (!$oakSlot) {
  echo "ERROR: no oak-stylized term in asset_slots vocab.\n";
  return;
}
$candidates = $nodeStorage->loadByProperties([
  'type' => 'asset',
  'field_asset_slot' => $oakSlot->id(),
]);
if (empty($candidates)) {
  echo "ERROR: no asset with slot oak-stylized.\n";
  return;
}
$asset = reset($candidates);
echo sprintf("Wiring asset nid=%d (%s)\n", $asset->id(), $asset->label());

// Find the `live` status term.
$liveTerms = $termStorage->loadByProperties([
  'vid' => 'asset_status',
  'name' => 'live',
]);
$liveTerm = reset($liveTerms);
if (!$liveTerm) {
  echo "ERROR: no 'live' term in asset_status vocab.\n";
  return;
}

// Create a placeholder file. A 1-byte file isn't a valid .glb,
// but the snapshot publisher doesn't check file contents — only
// presence. The renderer will fail-and-fall-back gracefully.
$dir = 'public://assets/curated/' . date('Y-m');
\Drupal::service('file_system')->prepareDirectory(
  $dir,
  \Drupal\Core\File\FileSystemInterface::CREATE_DIRECTORY,
);
$placeholderUri = $dir . '/oak-stylized-placeholder.glb';
file_put_contents(\Drupal::service('file_system')->realpath($placeholderUri), "PLACEHOLDER\n");

$file = File::create([
  'uri' => $placeholderUri,
  'status' => 1,
  'uid' => 1,
]);
$file->save();

// Wire the asset: attach the file, set status to live, set atmospheres.
$asset->set('field_asset_curated_file', ['target_id' => $file->id()]);
$asset->set('field_asset_status', ['target_id' => $liveTerm->id()]);
// Atmosphere binding — forest, since the active atmosphere defaults
// to "forest" per the palette config.
$asset->set('field_asset_atmospheres', ['forest']);
// Curation hints.
if ($asset->hasField('field_asset_curated_polycount')) {
  $asset->set('field_asset_curated_polycount', 3200);
}
if ($asset->hasField('field_asset_curated_pivot')) {
  $asset->set('field_asset_curated_pivot', 'base');
}
$asset->save();

echo sprintf(
  "OK: nid=%d wired live for slot oak-stylized, atmosphere forest.\n",
  $asset->id(),
);
echo "Verify: curl https://drupal-three-js-theme.ddev.site/world/snapshot/assets\n";
echo "Or:     drush world:assets-status\n";
