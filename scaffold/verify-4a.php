<?php

/**
 * @file
 * End-to-end verify for Sprint 4a — the four cypher REST routes.
 *
 *   ddev drush php:script scaffold/verify-4a.php
 *
 * Hits each endpoint via Drupal's HTTP kernel (no external curl).
 * Asserts shape + status. Does not require Atlas changes.
 */

declare(strict_types=1);

use Symfony\Component\HttpFoundation\Request;

function ws_log(string $msg): void {
  print " · $msg\n";
}

function ws_check(string $label, bool $ok, ?string $detail = NULL): void {
  $marker = $ok ? '✓' : '✗';
  print " $marker $label";
  if ($detail !== NULL) {
    print "  → $detail";
  }
  print "\n";
  if (!$ok) {
    exit(1);
  }
}

print "═══ verify Sprint 4a: /world/health, /world/snapshot/full, /world/descriptor, /world/card ═══\n\n";

$kernel = \Drupal::service('http_kernel');

// ─── /world/health ───────────────────────────────────────────────────────
$request = Request::create('/world/health', 'GET');
$response = $kernel->handle($request);
$payload = json_decode($response->getContent(), TRUE);
ws_log(sprintf('GET /world/health → HTTP %d', $response->getStatusCode()));
ws_check('health 200', $response->getStatusCode() === 200);
ws_check('health.status present', isset($payload['status']));
ws_check('health.gateway present', isset($payload['gateway']));
ws_check('gateway reachable', ($payload['gateway'] ?? NULL) === 'reachable');

print "\n";

// ─── /world/snapshot/full ────────────────────────────────────────────────
$request = Request::create('/world/snapshot/full', 'GET');
$response = $kernel->handle($request);
$snapshot = json_decode($response->getContent(), TRUE);
ws_log(sprintf('GET /world/snapshot/full → HTTP %d, %d bytes', $response->getStatusCode(), strlen($response->getContent())));
ws_check('snapshot 200', $response->getStatusCode() === 200);
ws_check('snapshot.version', ($snapshot['version'] ?? NULL) === 'v1');
ws_check('snapshot.world (renderer constants)', isset($snapshot['world']['radius']));
ws_check('snapshot.sectors map', is_array($snapshot['sectors'] ?? NULL));
ws_check('snapshot.entities map', is_array($snapshot['entities'] ?? NULL));
ws_check(
  'at least one entity in snapshot (the trout article)',
  count($snapshot['entities'] ?? []) >= 1,
  'count=' . count($snapshot['entities'] ?? []),
);

$entityCount = count($snapshot['entities']);
$sectorCount = count($snapshot['sectors']);
ws_log("snapshot has $entityCount entities across $sectorCount sectors");

print "\n";

// ─── /world/descriptor/node-1 ────────────────────────────────────────────
$request = Request::create('/world/descriptor/node-1', 'GET');
$response = $kernel->handle($request);
$descriptor = json_decode($response->getContent(), TRUE);
ws_log(sprintf('GET /world/descriptor/node-1 → HTTP %d', $response->getStatusCode()));
ws_check('descriptor 200', $response->getStatusCode() === 200);
ws_check('descriptor._id', ($descriptor['_id'] ?? NULL) === 'node-1');
ws_check('descriptor.signature present', isset($descriptor['signature']));
ws_check('no _etag leakage', !isset($descriptor['_etag']));

print "\n";

// ─── /world/descriptor/does-not-exist (404) ─────────────────────────────
$request = Request::create('/world/descriptor/does-not-exist', 'GET');
$response = $kernel->handle($request);
ws_log(sprintf('GET /world/descriptor/does-not-exist → HTTP %d', $response->getStatusCode()));
ws_check('descriptor 404 on miss', $response->getStatusCode() === 404);

print "\n";

// ─── /world/card/node/1/default ─────────────────────────────────────────────
$request = Request::create('/world/card/node/1/default', 'GET');
$response = $kernel->handle($request);
ws_log(sprintf('GET /world/card/node/1/default → HTTP %d, %d bytes', $response->getStatusCode(), strlen($response->getContent())));
ws_check('card 200', $response->getStatusCode() === 200);
ws_check('card content-type html', str_starts_with($response->headers->get('Content-Type', ''), 'text/html'));
ws_check('card body non-empty', strlen($response->getContent()) > 100);
ws_check('card body contains article title', str_contains($response->getContent(), 'Catching trout in cold weather'));

print "\n══ Sprint 4a verify done — all four endpoints green ══\n";
