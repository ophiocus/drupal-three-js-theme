<?php
declare(strict_types=1);
$samples = [];
foreach (['article', 'profile', 'event'] as $bundle) {
  $nids = \Drupal::entityQuery('node')->accessCheck(FALSE)->condition('type', $bundle)->range(0, 1)->execute();
  $samples[$bundle] = (int) reset($nids);
}
$base = 'http://localhost'; // internal — DDEV maps web container localhost back
$client = \Drupal::httpClient();
foreach ($samples as $bundle => $nid) {
  foreach (['default', 'full'] as $mode) {
    $url = "/world/card/node/$nid/$mode";
    try {
      $r = $client->request('GET', "https://drupal-three-js-theme.ddev.site$url", ['verify' => false, 'http_errors' => false]);
      printf("%-8s nid=%-3d %-7s %s → %d\n", $bundle, $nid, $mode, $url, $r->getStatusCode());
    } catch (\Throwable $e) {
      printf("%-8s nid=%-3d %-7s ERROR %s\n", $bundle, $nid, $mode, $e->getMessage());
    }
  }
}
