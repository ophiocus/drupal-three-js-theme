<?php
declare(strict_types=1);
foreach (['article', 'profile', 'event', 'pack', 'asset'] as $b) {
  $count = \Drupal::entityQuery('node')->accessCheck(FALSE)->condition('type', $b)->count()->execute();
  echo "  $b: $count\n";
}
