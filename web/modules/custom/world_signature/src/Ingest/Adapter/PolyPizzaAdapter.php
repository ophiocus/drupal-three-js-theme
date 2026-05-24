<?php

declare(strict_types=1);

namespace Drupal\world_signature\Ingest\Adapter;

use Drupal\Core\Logger\LoggerChannelInterface;
use Drupal\world_signature\Ingest\License;
use Drupal\world_signature\Ingest\SourceAdapterInterface;
use Drupal\world_signature\Ingest\SourceAsset;
use GuzzleHttp\ClientInterface;

/**
 * Poly Pizza — CC0 / CC-BY (per model). Requires a free API key.
 *
 * Researched contract (key required; the docs page is JS-rendered so
 * the exact response field names are confirmed loosely and read
 * defensively below — verify against a live key, see @todo):
 *   Base:  https://api.poly.pizza/v1.1
 *   Auth:  header `x-auth-token: <WORLD_POLYPIZZA_KEY>`
 *   GET /model/{id}  → model with a GLB download URL, title,
 *                      creator, and per-model licence (CC0 or CC-BY).
 *
 * Licence is PER MODEL here (unlike the CC0-blanket sources), so the
 * adapter reads it from the response and lets the live-promotion gate
 * enforce attribution on CC-BY items.
 */
final class PolyPizzaAdapter implements SourceAdapterInterface {

  private const string API = 'https://api.poly.pizza/v1.1';
  private const string ENV_KEY = 'WORLD_POLYPIZZA_KEY';

  public function __construct(
    private readonly ClientInterface $httpClient,
    private readonly LoggerChannelInterface $logger,
  ) {}

  public function id(): string {
    return 'polypizza';
  }

  public function supports(string $ref): bool {
    return str_starts_with($ref, 'polypizza:')
      || str_contains($ref, 'poly.pizza');
  }

  public function resolve(string $ref): array {
    $key = getenv(self::ENV_KEY) ?: '';
    if ($key === '') {
      throw new \RuntimeException(
        'Poly Pizza requires an API key. Set the ' . self::ENV_KEY . ' environment variable.'
      );
    }
    $modelId = $this->modelId($ref);
    if ($modelId === '') {
      throw new \RuntimeException(sprintf('Could not parse a Poly Pizza model id from "%s".', $ref));
    }

    $m = $this->get(self::API . '/model/' . rawurlencode($modelId), $key);

    // Defensive field reads — Poly Pizza's JSON keys are confirmed
    // loosely; tolerate a few spellings.
    // @todo Verify exact field names against a live API key and tighten.
    $downloadUrl = (string) ($m['Download'] ?? $m['download'] ?? $m['glbUrl'] ?? '');
    if ($downloadUrl === '') {
      throw new \RuntimeException(sprintf('Poly Pizza model "%s": no download URL in response.', $modelId));
    }
    $title = (string) ($m['Title'] ?? $m['title'] ?? $modelId);
    $creator = $m['Creator'] ?? $m['creator'] ?? [];
    $author = is_array($creator)
      ? (string) ($creator['Username'] ?? $creator['Name'] ?? $creator['username'] ?? '')
      : (string) $creator;
    $licenseRaw = (string) ($m['Licence'] ?? $m['License'] ?? $m['licence'] ?? '');
    $license = License::fromRaw($licenseRaw !== '' ? $licenseRaw : 'CC0');

    return [
      new SourceAsset(
        downloadUrl: $downloadUrl,
        format: 'glb',
        title: $title,
        license: $license,
        attribution: $license->requiresAttribution() && $author !== ''
          ? ('Poly Pizza — ' . $author)
          : '',
        author: $author,
        sourceUrl: 'https://poly.pizza/m/' . $modelId,
        packTitle: 'Poly Pizza',
        previewUrl: isset($m['Thumbnail']) ? (string) $m['Thumbnail'] : NULL,
      ),
    ];
  }

  private function modelId(string $ref): string {
    if (str_starts_with($ref, 'polypizza:')) {
      return trim(substr($ref, strlen('polypizza:')));
    }
    if (preg_match('#poly\.pizza/m/([^/?#]+)#', $ref, $m)) {
      return $m[1];
    }
    return '';
  }

  private function get(string $url, string $key): array {
    try {
      $res = $this->httpClient->request('GET', $url, [
        'headers' => ['x-auth-token' => $key],
        'timeout' => 20,
      ]);
      $data = json_decode((string) $res->getBody(), TRUE);
      if (!is_array($data)) {
        throw new \RuntimeException('non-JSON response');
      }
      return $data;
    }
    catch (\Throwable $e) {
      $this->logger->error('Poly Pizza API error for @url: @msg', ['@url' => $url, '@msg' => $e->getMessage()]);
      throw new \RuntimeException('Poly Pizza API request failed: ' . $e->getMessage(), 0, $e);
    }
  }

}
