<?php

declare(strict_types=1);

namespace Drupal\world_signature\Ingest\Adapter;

use Drupal\Core\Logger\LoggerChannelInterface;
use Drupal\world_signature\Ingest\License;
use Drupal\world_signature\Ingest\SourceAdapterInterface;
use Drupal\world_signature\Ingest\SourceAsset;
use GuzzleHttp\ClientInterface;

/**
 * ambientCG — open API, all assets CC0. Primarily PBR materials, but
 * exposes `type=3DModel` assets too.
 *
 * Researched contract:
 *   GET https://ambientcg.com/api/v2/full_json?id={id}&include=downloadData
 *     → { foundAssets: [ {
 *           assetId, displayName, dataType,
 *           downloadFolders: { default: { downloadFiletypeCategories: {
 *             "<filetype>": { downloads: [ {
 *               fileName, downloadLink, rawLink, size, filetype, attribute
 *             } ] } } } }
 *         } ] }
 * `rawLink` is the direct file; `downloadLink` is a counted redirect.
 */
final class AmbientCgAdapter implements SourceAdapterInterface {

  private const string API = 'https://ambientcg.com/api/v2/full_json';
  private const string SITE = 'https://ambientcg.com';

  public function __construct(
    private readonly ClientInterface $httpClient,
    private readonly LoggerChannelInterface $logger,
  ) {}

  public function id(): string {
    return 'ambientcg';
  }

  public function supports(string $ref): bool {
    return str_starts_with($ref, 'ambientcg:')
      || str_contains($ref, 'ambientcg.com');
  }

  public function resolve(string $ref): array {
    $id = $this->assetId($ref);
    if ($id === '') {
      throw new \RuntimeException(sprintf('Could not parse an ambientCG id from "%s".', $ref));
    }

    $data = $this->get(self::API . '?' . http_build_query([
      'id' => $id,
      'include' => 'downloadData',
    ]));
    $asset = $data['foundAssets'][0] ?? NULL;
    if (!is_array($asset)) {
      throw new \RuntimeException(sprintf('ambientCG asset "%s" not found.', $id));
    }

    $download = $this->pickDownload($asset);
    if ($download === NULL) {
      throw new \RuntimeException(sprintf('ambientCG asset "%s": no downloadable file.', $id));
    }
    $url = $this->absolute((string) ($download['rawLink'] ?? $download['downloadLink'] ?? ''));
    if ($url === '') {
      throw new \RuntimeException(sprintf('ambientCG asset "%s": empty download link.', $id));
    }

    return [
      new SourceAsset(
        downloadUrl: $url,
        format: strtolower((string) ($download['filetype'] ?? 'zip')),
        title: (string) ($asset['displayName'] ?? $id),
        license: new License(License::CC0, 'CC0'),
        attribution: 'ambientCG (CC0)',
        author: 'ambientCG',
        sourceUrl: self::SITE . '/view?id=' . rawurlencode($id),
        packTitle: 'ambientCG',
      ),
    ];
  }

  private function assetId(string $ref): string {
    if (str_starts_with($ref, 'ambientcg:')) {
      return trim(substr($ref, strlen('ambientcg:')));
    }
    if (preg_match('#[?&]id=([^&]+)#', $ref, $m)) {
      return urldecode($m[1]);
    }
    return '';
  }

  /**
   * Choose a download entry — prefer the smallest archive so we
   * leech the lightest variant.
   *
   * @return array<string, mixed>|null
   */
  private function pickDownload(array $asset): ?array {
    $cats = $asset['downloadFolders']['default']['downloadFiletypeCategories'] ?? [];
    if (!is_array($cats)) {
      return NULL;
    }
    $best = NULL;
    $bestSize = PHP_INT_MAX;
    foreach ($cats as $cat) {
      foreach (($cat['downloads'] ?? []) as $dl) {
        if (!is_array($dl) || empty($dl['rawLink']) && empty($dl['downloadLink'])) {
          continue;
        }
        $size = (int) ($dl['size'] ?? PHP_INT_MAX);
        if ($size < $bestSize) {
          $bestSize = $size;
          $best = $dl;
        }
      }
    }
    return $best;
  }

  private function absolute(string $link): string {
    if ($link === '') {
      return '';
    }
    return str_starts_with($link, 'http') ? $link : (self::SITE . '/' . ltrim($link, '/'));
  }

  private function get(string $url): array {
    try {
      $res = $this->httpClient->request('GET', $url, ['timeout' => 20]);
      $data = json_decode((string) $res->getBody(), TRUE);
      if (!is_array($data)) {
        throw new \RuntimeException('non-JSON response');
      }
      return $data;
    }
    catch (\Throwable $e) {
      $this->logger->error('ambientCG API error for @url: @msg', ['@url' => $url, '@msg' => $e->getMessage()]);
      throw new \RuntimeException('ambientCG API request failed: ' . $e->getMessage(), 0, $e);
    }
  }

}
