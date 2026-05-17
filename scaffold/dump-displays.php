<?php
declare(strict_types=1);
$storage = \Drupal::entityTypeManager()->getStorage('entity_view_display');
foreach ($storage->loadMultiple() as $id => $display) {
  if (str_contains($id, 'node.')) {
    echo $id . "\n";
  }
}
