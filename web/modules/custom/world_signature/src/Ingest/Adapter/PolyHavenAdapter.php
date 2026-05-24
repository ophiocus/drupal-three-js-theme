<?php

declare(strict_types=1);

namespace Drupal\world_signature\Ingest\Adapter;

use Drupal\Core\Logger\LoggerChannelInterface;
use Drupal\world_signature\Ingest\License;
use Drupal\world_signature\Ingest\SourceAdapterInterface;
use Drupal\world_signature\Ingest\SourceAsset;
use GuzzleHttp\ClientInterface;

/**
 * Poly Haven — open REST API, all assets CC0.
 *
 * Researched contract (docs/feature-requests/asset-ingestion-sources.md):
 *   GET https://api.polyhaven.com/info/{slug}
 *     → { name, type (2=model), authors: {"<name>": "<role>"}, ... }
 *   GET https://api.polyhaven.com/files/{slug}
 *     → { gltf: { "<res>": { ...gltf node with url, md5, size,
 *                            include: { "<relpath>": { url, ... } } } },
 *         blend: {...}, fbx: {...} }
 * All requests must send a unique User-Agent.
 *
 * We take the lowest available resolution (smallest download) and
 * return the glTF as the main file plus its texture `include`s as
 * extraFiles, so the leech step preserves the multi-file set.
 */
final class PolyHavenAdapter implements SourceAdapterInterface {

  private const string API = 'https://api.polyhaven.com';
  private const string UA = 'drupal-three-js-theme asset-ingestor (+world_signature)';

  public function __construct(
    private readonly ClientInterface $httpClient,
    private readonly LoggerChannelInterface $logger,
  ) {}

  public function id(): string {
    return 'polyhaven';
  }

  public function supports(string $ref): bool {
    return str_starts_with($ref, 'polyhaven:')
      || str_contains($ref, 'polyhaven.com');
  }

  public function resolve(string $ref): array {
    $slug = $this->slug($ref);
    if ($slug === '') {
      throw new \RuntimeException(sprintf('Could not parse a Poly Haven slug from "%s".', $ref));
    }

    $info = $this->get(self::API . '/info/' . rawurlencode($slug));
    $files = $this->get(self::API . '/files/' . rawurlencode($slug));

    $gltf = $files['gltf'] ?? NULL;
    if (!is_array($gltf) || $gltf === []) {
      throw new \RuntimeException(sprintf('Poly Haven asset "%s" has no glTF files.', $slug));
    }
    $resNode = $this->lowestResolution($gltf);
    $main = $this->mainGltfFile($resNode);
    if ($main === NULL) {
      throw new \RuntimeException(sprintf('Poly Haven asset "%s": no glTF url found.', $slug));
    }

    $authors = is_array($info['authors'] ?? NULL) ? array_keys($info['authors']) : [];
    $name = (string) ($info['name'] ?? $slug);

    return [
      new SourceAsset(
        downloadUrl: (string) $main['url'],
        format: 'gltf',
        title: $name,
        // Poly Haven assets are CC0 (the AGPL in the API docs is the
        // API *software*, not the assets).
        license: new License(License::CC0, 'CC0'),
        // CC0 needs no attribution, but we record the credit anyway.
        attribution: $authors === [] ? '' : ('Poly Haven — ' . implode(', ', $authors)),
        author: $authors[0] ?? '',
        sourceUrl: 'https://polyhaven.com/a/' . $slug,
        packTitle: 'Poly Haven',
        extraFiles: $this->includes($resNode),
        polycount: isset($info['polycount']) ? (int) $info['polycount'] : NULL,
        previewUrl: isset($info['thumbnail_url']) ? (string) $info['thumbnail_url'] : NULL,
      ),
    ];
  }

  private function slug(string $ref): string {
    if (str_starts_with($ref, 'polyhaven:')) {
      return trim(substr($ref, strlen('polyhaven:')));
    }
    // …/a/<slug> on polyhaven.com
    if (preg_match('#polyhaven\.com/a/([^/?#]+)#', $ref, $m)) {
      return $m[1];
    }
    return '';
  }

  /** Choose the resolution key with the smallest "Nk" number. */
  private function lowestResolution(array $gltf): array {
    $best = NULL;
    $bestN = PHP_INT_MAX;
    foreach ($gltf as $res => $node) {
      if (!is_array($node)) {
        continue;
      }
      $n = (int) preg_replace('/[^0-9]/', '', (string) $res) ?: PHP_INT_MAX;
      if ($n < $bestN) {
        $bestN = $n;
        $best = $node;
      }
    }
    return $best ?? reset($gltf) ?: [];
  }

  /**
   * Within a resolution node, find the glTF file entry. Poly Haven
   * nests it as either the node itself (has 'url') or under a 'gltf'
   * sub-key — handle both defensively.
   *
   * @return array{url: string, include?: array}|null
   */
  private function mainGltfFile(array $resNode): ?array {
    if (isset($resNode['url'])) {
      return $resNode;
    }
    if (isset($resNode['gltf']['url'])) {
      return $resNode['gltf'];
    }
    // Last resort: first descendant with a url ending in .gltf/.glb.
    foreach ($resNode as $v) {
      if (is_array($v) && isset($v['url']) && preg_match('/\.(gltf|glb)$/i', (string) $v['url'])) {
        return $v;
      }
    }
    return NULL;
  }

  /**
   * Map the glTF's `include` (textures + .bin) to extraFiles. The
   * include key is the path to preserve relative to the glTF.
   *
   * @return array<int, array{url: string, name: string}>
   */
  private function includes(array $resNode): array {
    $main = $this->mainGltfFile($resNode) ?? [];
    $include = $main['include'] ?? [];
    $out = [];
    if (is_array($include)) {
      foreach ($include as $relPath => $entry) {
        if (is_array($entry) && isset($entry['url'])) {
          $out[] = ['url' => (string) $entry['url'], 'name' => (string) $relPath];
        }
      }
    }
    return $out;
  }

  /** GET + decode JSON with the required User-Agent. */
  private function get(string $url): array {
    try {
      $res = $this->httpClient->request('GET', $url, [
        'headers' => ['User-Agent' => self::UA],
        'timeout' => 20,
      ]);
      $data = json_decode((string) $res->getBody(), TRUE);
      if (!is_array($data)) {
        throw new \RuntimeException('non-JSON response');
      }
      return $data;
    }
    catch (\Throwable $e) {
      $this->logger->error('Poly Haven API error for @url: @msg', ['@url' => $url, '@msg' => $e->getMessage()]);
      throw new \RuntimeException('Poly Haven API request failed: ' . $e->getMessage(), 0, $e);
    }
  }

}
