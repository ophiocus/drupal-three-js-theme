<?php

/**
 * @file
 * End-to-end verify for Sprint 3b-2: gateway write path.
 *
 *   ddev drush php:script scaffold/verify-3b-2.php
 *
 * Runs the same plumbing as 3b-1 (entity save -> queue -> worker)
 * and additionally asserts that the descriptor lands in Atlas via
 * the RESTHeart gateway. Re-runnable.
 */

declare(strict_types=1);

use Drupal\advancedqueue\Entity\Queue;

function ws_log(string $msg): void {
  print " · $msg\n";
}

print "═══ verify Sprint 3b-2: queue → extract → field + gateway ═══\n\n";

/** @var \Drupal\world_signature\Service\WorldSearchClient $client */
$client = \Drupal::service('world_signature.world_search_client');

// ─── 0. gateway reachable? ────────────────────────────────────────────────
if (!$client->ping()) {
  print "── gateway not reachable; check RESTHeart container.\n";
  exit(1);
}
ws_log('gateway ping: OK');

// ─── 1. ensure the article ────────────────────────────────────────────────
$node_storage = \Drupal::entityTypeManager()->getStorage('node');
$existing = $node_storage->loadByProperties([
  'type' => 'article',
  'title' => 'Catching trout in cold weather',
]);
if (!$existing) {
  print "── no sample article; run scaffold/verify-3a.php first.\n";
  exit(1);
}
/** @var \Drupal\node\NodeInterface $article */
$article = reset($existing);
ws_log("article: '{$article->getTitle()}' #{$article->id()}");

// ─── 2. clear local field + force a fresh save ──────────────────────────
$article->set('field_world_signature', NULL);
\Drupal\world_signature\Service\SignatureWriter::$writing = TRUE;
$article->save();
\Drupal\world_signature\Service\SignatureWriter::$writing = FALSE;
ws_log('cleared field_world_signature');

$article = $node_storage->loadUnchanged($article->id());
$article->setNewRevision(FALSE);
$article->save();
ws_log('saved article (hook_entity_update fires → enqueue)');

// ─── 3. process queue synchronously ──────────────────────────────────────
$queue = Queue::load('world_signature_extract');
/** @var \Drupal\advancedqueue\ProcessorInterface $processor */
$processor = \Drupal::service('advancedqueue.processor');
$result = $processor->processQueue($queue);
ws_log('queue processed: ' . json_encode($result));

// ─── 4. confirm Drupal-side field populated ──────────────────────────────
$article = $node_storage->loadUnchanged($article->id());
$json = $article->get('field_world_signature')->value;
if (!$json) {
  print "── field_world_signature still empty after success!\n";
  exit(1);
}
ws_log('field_world_signature: ' . strlen($json) . ' bytes');

// ─── 5. confirm descriptor at the gateway ────────────────────────────────
$descriptorId = 'node-' . $article->id();
$db = getenv('WORLD_SIGNATURE_DATABASE');
$gateway = getenv('WORLD_GATEWAY_URL');
$user = getenv('WORLD_GATEWAY_USER');
$pwd = getenv('WORLD_GATEWAY_PASSWORD');

$ch = curl_init(sprintf('%s/%s/descriptors/%s', $gateway, rawurlencode($db), rawurlencode($descriptorId)));
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => TRUE,
  CURLOPT_USERPWD => "$user:$pwd",
  CURLOPT_HTTPHEADER => ['Accept: application/json'],
]);
$body = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($status !== 200) {
  print sprintf("── gateway returned HTTP %d for descriptor %s\n", $status, $descriptorId);
  print '   body: ' . substr((string) $body, 0, 300) . "\n";
  exit(1);
}

$descriptor = json_decode((string) $body, TRUE);
ws_log("gateway descriptor: HTTP 200, _id=" . ($descriptor['_id'] ?? '(null)'));

print "\n── descriptor at gateway:\n";
print json_encode($descriptor, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n\n";

print "═══ Sprint 3b-2 verify done — Drupal write + gateway upsert green ═══\n";
