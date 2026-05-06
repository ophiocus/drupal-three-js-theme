<?php

/**
 * @file
 * End-to-end manual verify for Sprint 3a:
 *
 *   1. ensure a topics term ("fishing") exists
 *   2. ensure an article tagged with it exists
 *   3. run EntityFactsReader on it
 *   4. run SignatureExtractor on the facts
 *   5. dump both as JSON for visual inspection
 *
 *   ddev drush php:script scaffold/verify-3a.php
 *
 * Re-runnable; idempotent on the term and article.
 */

declare(strict_types=1);

use Drupal\node\Entity\Node;
use Drupal\taxonomy\Entity\Term;

function dump_section(string $label, mixed $value): void { // collide-safe (Drupal core defines show())
  print "── $label\n";
  print json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n\n";
}

print "═══ verify Sprint 3a: EntityFactsReader + SignatureExtractor ═══\n\n";

// ─── 1. ensure topics:fishing term ────────────────────────────────────────
$term_storage = \Drupal::entityTypeManager()->getStorage('taxonomy_term');
$existing = $term_storage->loadByProperties([
  'vid' => 'topics',
  'name' => 'fishing',
]);
if ($existing) {
  $fishing = reset($existing);
}
else {
  $fishing = Term::create(['vid' => 'topics', 'name' => 'fishing']);
  $fishing->save();
}
print "── term: fishing #{$fishing->id()}\n\n";

// ─── 2. ensure a sample article ───────────────────────────────────────────
$node_storage = \Drupal::entityTypeManager()->getStorage('node');
$existing = $node_storage->loadByProperties([
  'type' => 'article',
  'title' => 'Catching trout in cold weather',
]);

$article = $existing ? reset($existing) : Node::create([
  'type' => 'article',
  'title' => 'Catching trout in cold weather',
  'body' => [
    'value' => 'Cold-water trout fishing rewards patience. Start with a slow drift through deeper pools, then work the seams where current meets stillwater. The fish are sluggish; your offering must be too.',
    'format' => 'plain_text',
  ],
  'field_tags' => [['target_id' => $fishing->id()]],
  'status' => 1,
  'uid' => 1,
]);
if (!$existing) {
  $article->save();
}

print "── article: '{$article->getTitle()}' #{$article->id()}\n\n";

// ─── 3. run EntityFactsReader ─────────────────────────────────────────────
/** @var \Drupal\world_signature\Service\EntityFactsReader $reader */
$reader = \Drupal::service('world_signature.entity_facts_reader');
$facts = $reader->read($article);

if ($facts === NULL) {
  print "── reader returned NULL — no metaphor registered for node:article?\n";
  exit(1);
}

dump_section('EntityFacts (from Article metaphor plugin)', [
  'entityType' => $facts->entityType,
  'bundle' => $facts->bundle,
  'uuid' => $facts->uuid,
  'taxonomyTerms' => $facts->taxonomyTerms,
  'bodyText' => substr($facts->bodyText, 0, 80) . (strlen($facts->bodyText) > 80 ? '…' : ''),
  'paragraphCount' => $facts->paragraphCount,
  'imageCount' => $facts->imageCount,
  'cardCount' => $facts->cardCount,
  'bloomTriggerCount' => $facts->bloomTriggerCount,
  'totalCardWordCount' => $facts->totalCardWordCount,
  'createdAt' => $facts->createdAt,
  'changedAt' => $facts->changedAt,
  'inDegree' => $facts->inDegree,
  'outDegree' => $facts->outDegree,
]);

// ─── 4. run SignatureExtractor ────────────────────────────────────────────
/** @var \Drupal\world_signature\Signature\SignatureExtractor $extractor */
$extractor = \Drupal::service('world_signature.signature_extractor');
$signature = $extractor->extract($facts);

dump_section('Signature (from SignatureExtractor)', $signature->toArray());

// ─── 5. round-trip check ──────────────────────────────────────────────────
$rehydrated = \Drupal\world_signature\Signature\Signature::fromArray($signature->toArray());
print '── round-trip: ' . ($signature->equals($rehydrated) ? 'OK' : 'FAILED') . "\n";

print "\n═══ Sprint 3a verify done ═══\n";
