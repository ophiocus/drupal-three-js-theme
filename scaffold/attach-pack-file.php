<?php

/**
 * Attach a downloaded pack file to its pack node.
 *
 * Usage:
 *   ddev drush scr scaffold/attach-pack-file.php -- <pack-nid> <local-path>
 *
 * Example:
 *   ddev drush scr scaffold/attach-pack-file.php -- 7 /tmp/quaternius-trees.zip
 *
 * Reads the local file, copies it into Drupal's public://assets/packs/YYYY-MM/
 * directory, creates a File entity, attaches it to the pack node's
 * field_pack_raw_file, and infers field_pack_raw_format from the
 * file extension.
 *
 * Idempotent: if the pack already has a raw_file, it gets replaced.
 *
 * Why this exists: every major asset source (Sketchfab, itch.io,
 * Quaternius, poly.pizza, OpenGameArt) gates downloads behind a
 * JavaScript-driven click flow that we can't drive from a script.
 * You click → save the file locally → run this script to ingest
 * it into Drupal. The provenance + license stays on the pack node;
 * only the binary moves.
 */

declare(strict_types=1);

use Drupal\file\Entity\File;
use Drupal\node\Entity\Node;

[$_, $packNid, $localPath] = $extra + [NULL, NULL, NULL];

if (!$packNid || !$localPath) {
  echo "Usage: drush scr scaffold/attach-pack-file.php -- <pack-nid> <local-path>\n";
  return;
}

$packNid = (int) $packNid;

// ─── Validate inputs ───────────────────────────────────────────────────────

$node = Node::load($packNid);
if (!$node || $node->bundle() !== 'pack') {
  echo sprintf("[attach-pack-file] FATAL: nid=%d is not a pack node.\n", $packNid);
  return;
}

if (!file_exists($localPath) || !is_readable($localPath)) {
  echo sprintf("[attach-pack-file] FATAL: '%s' not readable from the container.\n", $localPath);
  echo "  Note: DDEV's web container mounts the project root. Files outside\n";
  echo "  /var/www/html aren't visible. Drop the .zip somewhere inside the\n";
  echo "  project (e.g. ./scaffold/pack-downloads/) and re-run with that path.\n";
  return;
}

// ─── Infer format from extension ───────────────────────────────────────────

$ext = strtolower(pathinfo($localPath, PATHINFO_EXTENSION));
$validFormats = ['glb', 'gltf', 'fbx', 'obj', 'blend', 'zip'];
if (!in_array($ext, $validFormats, TRUE)) {
  echo sprintf("[attach-pack-file] FATAL: unsupported extension '.%s'.\n", $ext);
  echo "  Supported: " . implode(', ', $validFormats) . "\n";
  return;
}

// ─── Copy into Drupal's public files dir ───────────────────────────────────

$fileSystem = \Drupal::service('file_system');
$yearMonth = date('Y-m');
$targetDir = "public://assets/packs/$yearMonth";
if (!$fileSystem->prepareDirectory($targetDir, \Drupal\Core\File\FileSystemInterface::CREATE_DIRECTORY | \Drupal\Core\File\FileSystemInterface::MODIFY_PERMISSIONS)) {
  echo sprintf("[attach-pack-file] FATAL: cannot prepare directory %s.\n", $targetDir);
  return;
}

$basename = basename($localPath);
$destination = $targetDir . '/' . $basename;

// Use FileExists::Replace so re-runs overwrite. Cleaner than leaving
// duplicate-suffix files lying around.
try {
  $copiedUri = $fileSystem->copy(
    $localPath,
    $destination,
    \Drupal\Core\File\FileExists::Replace,
  );
} catch (\Throwable $e) {
  echo sprintf("[attach-pack-file] FATAL: copy failed: %s\n", $e->getMessage());
  return;
}

echo sprintf("  copied: %s → %s\n", $localPath, $copiedUri);

// ─── Wrap as a File entity ─────────────────────────────────────────────────

$file = File::create([
  'uri' => $copiedUri,
  'status' => 1,
  'uid' => 1,
]);
$file->save();
echo sprintf("  file entity: fid=%d\n", $file->id());

// ─── Replace any prior raw_file on the pack ────────────────────────────────

$priorFid = $node->get('field_pack_raw_file')->target_id;
if ($priorFid && $priorFid !== (int) $file->id()) {
  $prior = File::load((int) $priorFid);
  if ($prior) {
    echo sprintf("  superseding prior file fid=%d\n", $prior->id());
    // Don't physically delete the old file — let usage tracking
    // clean it up. Just unreference.
  }
}

$node->set('field_pack_raw_file', ['target_id' => $file->id()]);
$node->set('field_pack_raw_format', $ext);
$node->save();

echo sprintf(
  "\n[attach-pack-file] done\n  pack nid=%d (%s) now has raw_file=%s (.%s)\n",
  $node->id(),
  $node->label(),
  $basename,
  $ext,
);
