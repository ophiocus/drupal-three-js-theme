<?php
declare(strict_types=1);
foreach (['article', 'profile', 'event'] as $bundle) {
  $nids = \Drupal::entityQuery('node')
    ->accessCheck(FALSE)
    ->condition('type', $bundle)
    ->range(0, 1)
    ->execute();
  $nid = reset($nids);
  echo "$bundle: $nid\n";
}
