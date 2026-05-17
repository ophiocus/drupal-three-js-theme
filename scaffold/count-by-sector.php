<?php
declare(strict_types=1);

$entityStorage = \Drupal::entityTypeManager()->getStorage('node');
$termStorage = \Drupal::entityTypeManager()->getStorage('taxonomy_term');

$regions = $termStorage->loadByProperties(['vid' => 'topics']);
foreach ($regions as $term) {
  $tid = (int) $term->id();
  $counts = ['article' => 0, 'profile' => 0, 'event' => 0];
  foreach (array_keys($counts) as $bundle) {
    $counts[$bundle] = (int) \Drupal::entityQuery('node')
      ->accessCheck(FALSE)
      ->condition('type', $bundle)
      ->condition('field_world_sector.target_id', $tid)
      ->count()
      ->execute();
  }
  $total = array_sum($counts);
  echo sprintf(
    "  %-22s a=%d p=%d e=%d (total %d)\n",
    $term->label(),
    $counts['article'],
    $counts['profile'],
    $counts['event'],
    $total,
  );
}
