<?php

/**
 * @file
 * Verify the drupal_threejs theme renders the canvas + outlet on /.
 *
 *   ddev drush php:script scaffold/verify-4c.php
 */

declare(strict_types=1);

use Symfony\Component\HttpFoundation\Request;

function ws_check(string $label, bool $ok, ?string $detail = NULL): void {
  print ($ok ? ' ✓ ' : ' ✗ ') . $label;
  if ($detail !== NULL) {
    print "  → $detail";
  }
  print "\n";
  if (!$ok) {
    exit(1);
  }
}

print "═══ verify Sprint 4c: drupal_threejs theme renders the canvas ═══\n\n";

$default = (string) \Drupal::config('system.theme')->get('default');
print " · default theme: $default\n";
ws_check('default is drupal_threejs', $default === 'drupal_threejs');

$kernel = \Drupal::service('http_kernel');
$request = Request::create('/', 'GET');
$response = $kernel->handle($request);
$html = (string) $response->getContent();

print sprintf(" · GET / → HTTP %d, %d bytes\n", $response->getStatusCode(), strlen($html));
ws_check('homepage 200', $response->getStatusCode() === 200);
ws_check('html non-trivial', strlen($html) > 1000);

ws_check(
  'canvas[data-world-canvas] in markup',
  str_contains($html, 'data-world-canvas'),
);
ws_check(
  'world.bundle.js library reference in markup',
  str_contains($html, 'world.bundle.js'),
);
ws_check(
  'at least one aggregated stylesheet linked',
  preg_match('/<link[^>]+\.css/', $html) === 1,
);
ws_check(
  'world__seo-outlet present (a11y/SEO fallback DOM)',
  str_contains($html, 'world__seo-outlet'),
);
ws_check(
  'world-shell class on html element',
  str_contains($html, 'world-shell'),
);

print "\n══ Sprint 4c verify done — canvas mounts, bundle loaded, SEO outlet present ══\n";
