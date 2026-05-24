<?php

declare(strict_types=1);

namespace Drupal\world_signature\Ingest\Adapter;

use Drupal\Core\Logger\LoggerChannelInterface;
use Drupal\world_signature\Ingest\License;
use Drupal\world_signature\Ingest\SourceAdapterInterface;
use Drupal\world_signature\Ingest\SourceAsset;
use GuzzleHttp\ClientInterface;

/**
 * open-source-3D-assets (ToxSam) — a GitHub-hosted CC0 GLB registry.
 *
 * Researched contract:
 *   data/projects.json            — collections + their licences
 *   data/assets/<project>.json    — [ {
 *       id, name, project_id, model_file_url (direct .glb),
 *       format ("GLB"), thumbnail_url, metadata: { file_size, … }
 *   }, … ]
 *
 * The registry IS the catalog API — pure JSON over raw.githubusercontent.
 * Reference forms:
 *   toxsam:<project_id>            — every asset in the collection
 *   toxsam:<project_id>/<asset_id> — a single asset
 */
final class ToxSamRegistryAdapter implements SourceAdapterInterface {

  private const string RAW = 'https://raw.githubusercontent.com/toxsam/open-source-3D-assets/main/data';

  public function __construct(
    private readonly ClientInterface $httpClient,
    private readonly LoggerChannelInterface $logger,
  ) {}

  public function id(): string {
    return 'toxsam';
  }

  public function supports(string $ref): bool {
    return str_starts_with($ref, 'toxsam:')
      || str_contains($ref, 'toxsam/open-source-3D-assets');
  }

  public function resolve(string $ref): array {
    [$projectId, $assetId] = $this->parse($ref);
    if ($projectId === '') {
      throw new \RuntimeException(sprintf('Could not parse a ToxSam project id from "%s".', $ref));
    }

    $projectLicense = $this->projectLicense($projectId);
    $assets = $this->get(self::RAW . '/assets/' . rawurlencode($projectId) . '.json');
    if (!is_array($assets) || !array_is_list($assets)) {
      throw new \RuntimeException(sprintf('ToxSam project "%s" has no asset list.', $projectId));
    }

    $out = [];
    foreach ($assets as $a) {
      if (!is_array($a) || empty($a['model_file_url'])) {
        continue;
      }
      if ($assetId !== '' && (string) ($a['id'] ?? '') !== $assetId) {
        continue;
      }
      if (($a['is_public'] ?? TRUE) === FALSE || ($a['is_draft'] ?? FALSE) === TRUE) {
        continue;
      }
      $out[] = new SourceAsset(
        downloadUrl: (string) $a['model_file_url'],
        format: strtolower((string) ($a['format'] ?? 'glb')),
        title: (string) ($a['name'] ?? ($a['id'] ?? 'asset')),
        license: $projectLicense,
        attribution: $projectLicense->requiresAttribution() ? ('ToxSam registry — ' . $projectId) : '',
        author: (string) ($a['creator'] ?? 'Polygonal Mind'),
        sourceUrl: 'https://github.com/toxsam/open-source-3D-assets',
        packTitle: $projectId,
        polycount: NULL,
        previewUrl: isset($a['thumbnail_url']) ? (string) $a['thumbnail_url'] : NULL,
      );
    }
    if ($out === []) {
      throw new \RuntimeException(sprintf('ToxSam: no matching assets for "%s".', $ref));
    }
    return $out;
  }

  /** @return array{0: string, 1: string} [projectId, assetId] */
  private function parse(string $ref): array {
    $body = str_starts_with($ref, 'toxsam:') ? substr($ref, strlen('toxsam:')) : '';
    $body = trim($body, " /");
    if ($body === '') {
      return ['', ''];
    }
    $parts = explode('/', $body, 2);
    return [$parts[0], $parts[1] ?? ''];
  }

  /** Read the project's licence from projects.json; default CC0. */
  private function projectLicense(string $projectId): License {
    try {
      $projects = $this->get(self::RAW . '/projects.json');
    }
    catch (\Throwable) {
      return new License(License::CC0, 'CC0');
    }
    $entries = is_array($projects['projects'] ?? NULL) ? $projects['projects'] : $projects;
    foreach ((array) $entries as $p) {
      if (!is_array($p)) {
        continue;
      }
      $pid = (string) ($p['id'] ?? $p['project_id'] ?? '');
      if ($pid === $projectId) {
        $raw = (string) ($p['license'] ?? $p['License'] ?? 'CC0');
        return License::fromRaw($raw);
      }
    }
    // Registry is a CC0 registry; default when the project row is absent.
    return new License(License::CC0, 'CC0');
  }

  private function get(string $url): mixed {
    try {
      $res = $this->httpClient->request('GET', $url, ['timeout' => 20]);
      return json_decode((string) $res->getBody(), TRUE);
    }
    catch (\Throwable $e) {
      $this->logger->error('ToxSam registry error for @url: @msg', ['@url' => $url, '@msg' => $e->getMessage()]);
      throw new \RuntimeException('ToxSam registry request failed: ' . $e->getMessage(), 0, $e);
    }
  }

}
