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
 *   WORLD_EMBED_URL      e.g. http://<host>:11434/v1/embeddings (Ollama)
 *                        or https://api.voyageai.com/v1/embeddings
 *   WORLD_EMBED_KEY      bearer token (unset for a local Ollama)
 *   WORLD_EMBED_MODEL    e.g. qwen3-embedding:4b, voyage-3
 *   WORLD_EMBED_DIM      vector width to request and store (e.g. 1024)
 *
 * When WORLD_EMBED_DIM is set it is sent as the OpenAI-style
 * `dimensions` field, which Ollama and OpenAI honour for Matryoshka
 * models (qwen3-embedding: 2560 native, 1024 requested). Leave it
 * unset for a provider that rejects the field; the width then
 * defaults to 1024. Either way every returned vector must have that
 * width — a mismatch throws (and the manager falls back to local)
 * rather than storing a mixed-width corpus. The width is part of
 * modelVersion(), so changing it flags every vector as stale.
 *
 * When WORLD_EMBED_URL is unset the provider reports itself
 * unconfigured (isConfigured() === FALSE); the EmbeddingManager
 * falls back to LocalTfIdfEmbeddingProvider. This keeps DDEV
 * working with zero setup while leaving production a one-env-var
 * switch to real semantics.
 *
 * The request/response shape targets the common
 * {input: [...], model: ..., dimensions?: n} → {data: [{embedding: [...]}]}
 * contract; adjust mapResponse() for a provider that differs. The dev
 * sandbox can run it against a local Ollama (qwen3-embedding:4b at
 * 1024 won the 2026-10 bake-off); see docs/SHIP.md §A2.
 */
final class RemoteEmbeddingProvider implements EmbeddingProviderInterface {

  /** Conservative batch size — most embedding APIs cap inputs per call. */
  private const int BATCH = 64;

  /**
   * Per-call timeout in seconds.
   *
   * Generous because a local model loads on its first call
   * (qwen3-embedding:4b takes ~20 s cold on a 16 GB GPU).
   */
  private const int TIMEOUT = 120;

  public function __construct(
    private readonly ClientInterface $httpClient,
    private readonly LoggerChannelInterface $logger,
  ) {}

  public function isConfigured(): bool {
    return is_string(getenv('WORLD_EMBED_URL') ?: NULL)
      && (getenv('WORLD_EMBED_URL') !== '');
  }

  public function modelVersion(): string {
    return 'remote:' . $this->model() . '@' . $this->dimensions();
  }

  public function dimensions(): int {
    return $this->requestedDimensions() ?? 1024;
  }

  /** The configured model name. */
  private function model(): string {
    return (string) (getenv('WORLD_EMBED_MODEL') ?: 'voyage-3');
  }

  /** WORLD_EMBED_DIM when explicitly set, else NULL (nothing to request). */
  private function requestedDimensions(): ?int {
    $dim = getenv('WORLD_EMBED_DIM');
    return $dim !== FALSE && $dim !== '' ? (int) $dim : NULL;
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
    $model = $this->model();
    $width = $this->dimensions();

    $ids = array_keys($documents);
    $texts = array_values($documents);
    $out = [];

    foreach (array_chunk($texts, self::BATCH, TRUE) as $chunk) {
      $chunkIds = array_map(static fn($i) => $ids[$i], array_keys($chunk));
      $vectors = $this->callApi($url, $key, $model, array_values($chunk));
      if (count($vectors) !== count($chunkIds)) {
        throw new \RuntimeException(sprintf(
          'Embedding API returned %d vectors for %d inputs.',
          count($vectors), count($chunkIds),
        ));
      }
      foreach ($vectors as $i => $vec) {
        if (count($vec) !== $width) {
          throw new \RuntimeException(sprintf(
            'Embedding API returned %d-dim vectors; expected %d (WORLD_EMBED_DIM).',
            count($vec), $width,
          ));
        }
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
    $payload = ['input' => $texts, 'model' => $model];
    if (($dim = $this->requestedDimensions()) !== NULL) {
      $payload['dimensions'] = $dim;
    }
    $response = $this->httpClient->request('POST', $url, [
      'headers' => $headers,
      'json' => $payload,
      'timeout' => self::TIMEOUT,
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
