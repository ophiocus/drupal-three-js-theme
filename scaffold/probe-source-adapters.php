<?php
// Probe the asset-ingestion provider layer: confirm the tagged
// adapters are wired in priority order and that reference routing
// resolves to the right adapter.
// Run: ddev exec "drush scr scaffold/probe-source-adapters.php"

$mgr = \Drupal::service('world_signature.source_adapter_manager');

echo "Adapters (priority order): " . implode(', ', $mgr->adapterIds()) . "\n\n";

$refs = [
  'polyhaven:ArmChair_01',
  'https://polyhaven.com/a/ArmChair_01',
  'ambientcg:3DApple001',
  'toxsam:pm-momuspark/momuspark-001',
  'polypizza:0J_HflIStKl',
  'https://example.com/trees/oak_stylized.glb',
  'ftp://unsupported',
];
foreach ($refs as $ref) {
  $a = $mgr->adapterFor($ref);
  printf("  %-52s -> %s\n", $ref, $a ? $a->id() : '(none)');
}
