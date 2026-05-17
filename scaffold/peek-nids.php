<?php
declare(strict_types=1);

$nids = \Drupal::entityQuery('node')
  ->accessCheck(FALSE)
  ->condition('type', ['article', 'profile', 'event'], 'IN')
  ->sort('nid', 'ASC')
  ->execute();
echo "world content nids: " . implode(', ', $nids) . "\n";
$first = reset($nids);
echo "first article nid: $first\n";
