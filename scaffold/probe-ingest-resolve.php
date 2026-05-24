<?php
// Live-resolve probe: hit the open catalog APIs and print the
// resolved SourceAsset metadata. Confirms the researched API shapes
// are correct end-to-end. Needs outbound internet from the web
// container. Run: ddev exec "drush scr scaffold/probe-ingest-resolve.php"

$mgr = \Drupal::service('world_signature.source_adapter_manager');

$refs = [
  'polyhaven:ArmChair_01',
  'toxsam:pm-momuspark/momuspark-001',
  'ambientcg:3DApple001',
];

foreach ($refs as $ref) {
  echo "── $ref\n";
  try {
    $assets = $mgr->resolve($ref);
    foreach ($assets as $a) {
      printf(
        "   title=%s\n   format=%s license=%s publishable=%s\n   url=%s\n   author=%s attribution=%s\n   extraFiles=%d source=%s\n",
        $a->title,
        $a->format,
        $a->license->code,
        $a->isPublishable() ? 'yes' : 'no',
        substr($a->downloadUrl, 0, 90),
        $a->author ?: '-',
        $a->attribution ?: '-',
        count($a->extraFiles),
        $a->sourceUrl,
      );
    }
  }
  catch (\Throwable $e) {
    echo "   ERROR: " . $e->getMessage() . "\n";
  }
  echo "\n";
}
