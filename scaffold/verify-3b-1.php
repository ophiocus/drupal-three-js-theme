<?php

/**
 * @file
 * End-to-end manual verify for Sprint 3b-1: editor save -> queue ->
 * extractor -> field_world_signature.
 *
 *   ddev drush php:script scaffold/verify-3b-1.php
 *
 * Re-runnable. Deliberately bypasses cron: enqueues, then runs the
 * queue worker synchronously, then loads the entity fresh and dumps
 * field_world_signature. Quicker feedback than waiting for cron.
 */

declare(strict_types=1);

use Drupal\advancedqueue\Entity\Queue;
use Drupal\advancedqueue\ProcessorInterface;
use Drupal\node\Entity\Node;

function ws_log(string $msg): void {
  print " · $msg\n";
}

print "═══ verify Sprint 3b-1: enqueue → process → field_world_signature ═══\n\n";

// ─── 1. ensure the article from 3a exists ────────────────────────────────
$node_storage = \Drupal::entityTypeManager()->getStorage('node');
$existing = $node_storage->loadByProperties([
  'type' => 'article',
  'title' => 'Catching trout in cold weather',
]);

if (!$existing) {
  print "── no sample article found; run scaffold/verify-3a.php first.\n";
  exit(1);
}

/** @var \Drupal\node\NodeInterface $article */
$article = reset($existing);
ws_log("article: '{$article->getTitle()}' #{$article->id()}");

// ─── 2. clear the field so we can see it get populated ──────────────────
$article->set('field_world_signature', NULL);
\Drupal\world_signature\Service\SignatureWriter::$writing = TRUE;
$article->save();
\Drupal\world_signature\Service\SignatureWriter::$writing = FALSE;
ws_log('cleared field_world_signature');

// ─── 3. trigger the hook by saving the entity (mimics editor save) ───────
$article = $node_storage->loadUnchanged($article->id());
$article->setNewRevision(FALSE);
$article->save();
ws_log('saved article (hook_entity_update fires → enqueue)');

// ─── 4. confirm the queue has a job ──────────────────────────────────────
$queue = Queue::load('world_signature_extract');
if (!$queue) {
  print "── queue world_signature_extract is missing! re-enable the module.\n";
  exit(1);
}
$backend = $queue->getBackend();
$count = $backend->countJobs()['queued'] ?? 0;
ws_log("queue has $count queued job(s)");
if ($count === 0) {
  print "── expected at least 1 queued job after save; something's off.\n";
  exit(1);
}

// ─── 5. process the queue synchronously ──────────────────────────────────
/** @var \Drupal\advancedqueue\ProcessorInterface $processor */
$processor = \Drupal::service('advancedqueue.processor');
$processed = $processor->processQueue($queue);
ws_log("processed: " . json_encode($processed));

// ─── 6. reload entity and dump field_world_signature ─────────────────────
$article = $node_storage->loadUnchanged($article->id());
$json = $article->get('field_world_signature')->value;

if ($json === NULL || $json === '') {
  print "── field_world_signature is empty after processing!\n";
  exit(1);
}

print "\n── field_world_signature (JSON, " . strlen($json) . " bytes):\n";
$decoded = json_decode($json, TRUE);
print json_encode($decoded, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n\n";

// ─── 7. round-trip via Signature::fromArray ──────────────────────────────
$sig = \Drupal\world_signature\Signature\Signature::fromArray($decoded);
print '── round-trip via Signature::fromArray: ' . ($sig->equals($sig) ? 'OK' : 'FAILED') . "\n";

print "\n═══ Sprint 3b-1 verify done ═══\n";
