<?php

/**
 * Read-only inspection of the current corpus shape.
 *
 * Run via: ddev drush php:script scaffold/inspect-corpus.php
 */

declare(strict_types=1);

use Drupal\node\Entity\Node;
use Drupal\taxonomy\Entity\Vocabulary;
use Drupal\taxonomy\Entity\Term;

echo "=== Vocabularies ===\n";
foreach (Vocabulary::loadMultiple() as $v) {
  echo sprintf("  %s => %s\n", $v->id(), $v->label());
}

echo "\n=== Terms ===\n";
foreach (Vocabulary::loadMultiple() as $v) {
  $terms = \Drupal::entityTypeManager()
    ->getStorage('taxonomy_term')
    ->loadByProperties(['vid' => $v->id()]);
  foreach ($terms as $t) {
    echo sprintf("  [%s] %s (tid=%d)\n", $v->id(), $t->label(), $t->id());
  }
}

echo "\n=== Content types ===\n";
$nodeTypes = \Drupal::entityTypeManager()->getStorage('node_type')->loadMultiple();
foreach ($nodeTypes as $nt) {
  echo sprintf("  %s => %s\n", $nt->id(), $nt->label());
}

echo "\n=== Nodes ===\n";
$nids = \Drupal::entityQuery('node')->accessCheck(FALSE)->execute();
foreach (Node::loadMultiple($nids) as $node) {
  $sectors = [];
  foreach ($node->getFields() as $name => $field) {
    if (str_starts_with($name, 'field_') && $field->getFieldDefinition()->getType() === 'entity_reference') {
      $target = $field->getFieldDefinition()->getSetting('target_type');
      if ($target === 'taxonomy_term') {
        foreach ($field->referencedEntities() as $ref) {
          $sectors[] = sprintf('%s:%s', $name, $ref->label());
        }
      }
    }
  }
  echo sprintf(
    "  nid=%d bundle=%s title=%s refs=[%s]\n",
    $node->id(),
    $node->bundle(),
    $node->label(),
    implode(', ', $sectors),
  );
}

echo "\n=== Article fields with taxonomy_term targets ===\n";
$bundleFields = \Drupal::service('entity_field.manager')->getFieldDefinitions('node', 'article');
foreach ($bundleFields as $name => $def) {
  if ($def->getType() === 'entity_reference'
      && $def->getSetting('target_type') === 'taxonomy_term') {
    $handlerSettings = $def->getSetting('handler_settings') ?? [];
    $vids = $handlerSettings['target_bundles'] ?? [];
    echo sprintf("  %s targets vocabularies: [%s]\n", $name, implode(', ', array_keys($vids)));
  }
}
