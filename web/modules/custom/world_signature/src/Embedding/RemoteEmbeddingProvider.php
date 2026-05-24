<?php

declare(strict_types=1);

namespace Drupal\world_signature\Embedding;

use Drupal\Core\Logger\LoggerChannelInterface;
use GuzzleHttp\ClientInterface;

/**
 * Neural embedding provider — the production upgrade path from the
 * local TF-IDF fallback.
 *
 * Speaks to an OpenAI-compatible / Voyage-style embeddings HTTP
 * endpoint via Guzzle (the same HTTPS-via-Guzzle pattern the
 * gateway client uses — avoids native-extension fights). Config
 * comes from environment, NOT code:
 *
 *   WORLD_EMBED_URL      e.g. https://api.voyageai.com/v1/embeddings
 *   WORLD_EMBED_KEY      bearer token
 *   WORLD_EMBED_MODEL    e.g. voyage-3
 *   WORLD_EMBED_DIM      vector width the model emits (e.g. 1024)
 *
 * When WORLD_EMBED_URL is unset the provider reports itself
 * unconfigured (isConfigured() === FALSE); the EmbeddingManager
 * falls back to LocalTfIdfEmbeddingProvider. This keeps DDEV
 * working with zero setup while leaving production a one-env-var
 * switch to real semantics.
 *
 * NOTE: this is the seam, deliberately not exercised in the dev
 * sandbox (no key). The request/response shape targets the common
 * {input: [...], model: ...} → {data: [{embedding: [...]}]}
 * contract; adjust mapResponse() for a provider that differs.
 */
final class RemoteEmbeddingProvider implements EmbeddingProviderInterface {

  /** Conservative batch size — most embedding APIs cap inputs per call. */
  private const int BATCH = 64;

  public function __construct(
    private readonly ClientInterface $httpClient,
    private readonly LoggerChannelInterface $logger,
  ) {}

  public function isConfigured(): bool {
    return is_string(getenv('WORLD_EMBED_URL') ?: NULL)
      && (getenv('WORLD_EMBED_URL') !== '');
  }

  public function modelVersion(): string {
    $model = getenv('WORLD_EMBED_MODEL') ?: 'unknown';
    return 'remote:' . $model;
  }

  public function dimensions(): int {
    $dim = getenv('WORLD_EMBED_DIM');
    return $dim !== FALSE && $dim !== '' ? (int) $dim : 1024;
  }

  public function embedCorpus(array $documents): array {
    if (!$this->isConfigured()) {
      throw new \RuntimeException(
        'RemoteEmbeddingProvider called but WORLD_EMBED_URL is not set.'
      );
    }
    if ($documents === []) {
      return [];
    }

    $url = (string) getenv('WORLD_EMBED_URL');
    $key = (string) (getenv('WORLD_EMBED_KEY') ?: '');
    $model = (string) (getenv('WORLD_EMBED_MODEL') ?: 'voyage-3');

    $ids = array_keys($documents);
    $texts = array_values($documents);
    $out = [];

    foreach (array_chunk($texts, self::BATCH, TRUE) as $chunk) {
      $chunkIds = array_map(static fn($i) => $ids[$i], array_keys($chunk));
      $vectors = $this->callApi($url, $key, $model, array_values($chunk));
      foreach ($vectors as $i => $vec) {
        $out[$chunkIds[$i]] = $this->l2normalize($vec);
      }
    }

    return $out;
  }

  /**
   * One API call for a batch of texts. Returns vectors in input
   * order.
   *
   * @param string[] $texts
   * @return float[][]
   */
  private function callApi(string $url, string $key, string $model, array $texts): array {
    $headers = ['Content-Type' => 'application/json'];
    if ($key !== '') {
      $headers['Authorization'] = 'Bearer ' . $key;
    }
    $response = $this->httpClient->request('POST', $url, [
      'headers' => $headers,
      'json' => ['input' => $texts, 'model' => $model],
      'timeout' => 30,
    ]);
    $body = json_decode((string) $response->getBody(), TRUE);
    if (!is_array($body) || !isset($body['data']) || !is_array($body['data'])) {
      $this->logger->error('Embedding API returned an unexpected shape.');
      throw new \RuntimeException('Embedding API response malformed.');
    }
    return $this->mapResponse($body['data']);
  }

  /**
   * Map the provider's {data: [{embedding: [...], index: n}]} array
   * to ordered float vectors. Honours an `index` field if present
   * (some providers reorder); falls back to array order.
   *
   * @param array<int, array<string, mixed>> $data
   * @return float[][]
   */
  private function mapResponse(array $data): array {
    $byIndex = [];
    foreach ($data as $pos => $item) {
      $idx = isset($item['index']) ? (int) $item['index'] : $pos;
      $embedding = $item['embedding'] ?? [];
      $byIndex[$idx] = array_map('floatval', is_array($embedding) ? $embedding : []);
    }
    ksort($byIndex);
    return array_values($byIndex);
  }

  /** @param float[] $vec @return float[] */
  private function l2normalize(array $vec): array {
    $sumSq = 0.0;
    foreach ($vec as $v) {
      $sumSq += $v * $v;
    }
    $mag = sqrt($sumSq);
    if ($mag < 1e-12) {
      return $vec;
    }
    foreach ($vec as $i => $v) {
      $vec[$i] = $v / $mag;
    }
    return $vec;
  }

}
