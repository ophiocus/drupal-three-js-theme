<?php
// Push the inner-mind (acid-trip) palette overlay into the active
// world_signature.palette config. config/install only applies on
// module install; this updates a running site. Idempotent.
// Run: ddev exec "drush scr scaffold/install-inner-mind-palette.php"

$config = \Drupal::configFactory()->getEditable('world_signature.palette');
$overrides = $config->get('atmosphere_overrides') ?: [];
$overrides['inner-mind'] = [
  'background' => '#12002e',
  'fog' => ['color' => '#5a0a44', 'near' => 60, 'far' => 460],
  'ambient' => ['color' => '#ff66cc', 'intensity' => 1.1],
  'sun' => ['color' => '#aaff00', 'intensity' => 1.6, 'position' => [60, 140, 40]],
  'fill' => ['color' => '#00e5ff', 'intensity' => 0.8, 'position' => [-80, 60, -60]],
  'ground' => ['color' => '#1a0636'],
  'sectorPad' => ['color' => '#3a0a5a'],
  'compassPost' => ['color' => '#ff2fb0'],
  'bundleColors' => [
    'article' => '#ff2bd6',
    'profile' => '#22e0ff',
    'event' => '#b6ff2b',
    'default' => '#d050ff',
  ],
];
$config->set('atmosphere_overrides', $overrides)->save();
echo "inner-mind palette overlay written to active config\n";
