<?php

/**
 * @file
 * One-shot scaffold: minimal Drupal install -> article + topics + body
 * + field_tags + field_world_signature.
 *
 *   ddev drush php:script scaffold/setup-sandbox.php
 *
 * Idempotent: re-running will skip what already exists.
 */

declare(strict_types=1);

use Drupal\field\Entity\FieldConfig;
use Drupal\field\Entity\FieldStorageConfig;
use Drupal\node\Entity\NodeType;
use Drupal\taxonomy\Entity\Vocabulary;

function out(string $msg): void {
  print " · $msg\n";
}

print "=== sandbox scaffold ===\n";

// ─── 1. topics vocabulary ────────────────────────────────────────────────
if (!Vocabulary::load('topics')) {
  Vocabulary::create([
    'vid' => 'topics',
    'name' => 'Topics',
    'description' => 'Top-level topical taxonomy for the world\'s sectors.',
  ])->save();
  out('created vocabulary: topics');
}
else {
  out('vocabulary topics already exists, skipping');
}

// ─── 2. article content type ─────────────────────────────────────────────
if (!NodeType::load('article')) {
  NodeType::create([
    'type' => 'article',
    'name' => 'Article',
    'description' => 'A piece of writing — the canonical species in the world.',
    'new_revision' => TRUE,
  ])->save();
  out('created content type: article');
}
else {
  out('content type article already exists, skipping');
}

// ─── 3. body field on article (text_with_summary; created by hand
// instead of node_add_body_field() which is finicky in D11) ─────────────
if (!FieldStorageConfig::loadByName('node', 'body')) {
  FieldStorageConfig::create([
    'field_name' => 'body',
    'entity_type' => 'node',
    'type' => 'text_with_summary',
    'cardinality' => 1,
  ])->save();
  out('created field storage: body');
}
if (!FieldConfig::loadByName('node', 'article', 'body')) {
  FieldConfig::create([
    'field_name' => 'body',
    'entity_type' => 'node',
    'bundle' => 'article',
    'label' => 'Body',
    'settings' => ['display_summary' => TRUE],
  ])->save();
  out('created field instance: node.article.body');
}

// ─── 4. field_tags on article (entity reference to topics) ───────────────
if (!FieldStorageConfig::loadByName('node', 'field_tags')) {
  FieldStorageConfig::create([
    'field_name' => 'field_tags',
    'entity_type' => 'node',
    'type' => 'entity_reference',
    'cardinality' => -1,
    'settings' => ['target_type' => 'taxonomy_term'],
  ])->save();
  out('created field storage: field_tags');
}
if (!FieldConfig::loadByName('node', 'article', 'field_tags')) {
  FieldConfig::create([
    'field_name' => 'field_tags',
    'entity_type' => 'node',
    'bundle' => 'article',
    'label' => 'Tags',
    'description' => 'Taxonomy terms placing this article in a sector.',
    'settings' => [
      'handler' => 'default:taxonomy_term',
      'handler_settings' => [
        'target_bundles' => ['topics' => 'topics'],
        'auto_create' => TRUE,
      ],
    ],
  ])->save();
  out('created field instance: node.article.field_tags');
}

// ─── 5. field_world_signature on article (string_long, JSON-serialized) ──
if (!FieldStorageConfig::loadByName('node', 'field_world_signature')) {
  FieldStorageConfig::create([
    'field_name' => 'field_world_signature',
    'entity_type' => 'node',
    'type' => 'string_long',
    'cardinality' => 1,
    'translatable' => FALSE,
    'persist_with_no_fields' => TRUE,
  ])->save();
  out('created field storage: field_world_signature');
}
if (!FieldConfig::loadByName('node', 'article', 'field_world_signature')) {
  FieldConfig::create([
    'field_name' => 'field_world_signature',
    'entity_type' => 'node',
    'bundle' => 'article',
    'label' => 'World Signature',
    'description' => 'JSON-serialized cypher signature. Written by the queue worker; read by the snapshot publisher. Hidden from the editor.',
    'translatable' => FALSE,
  ])->save();
  out('created field instance: node.article.field_world_signature');
}

// ─── 6. cache rebuild so form/view modes pick up the new fields ──────────
drupal_flush_all_caches();
out('caches rebuilt');

print "=== done ===\n";
