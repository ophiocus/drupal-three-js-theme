<?php

declare(strict_types=1);

namespace Drupal\world_signature\Embedding;

use Drupal\Core\Logger\LoggerChannelInterface;

/**
 * Selects the active embedding provider and exposes a single
 * embed-the-corpus entry point.
 *
 * Policy: use the neural RemoteEmbeddingProvider when it's
 * configured (WORLD_EMBED_URL set); otherwise fall back to the
 * dependency-free LocalTfIdfEmbeddingProvider. This keeps DDEV
 * working with zero setup and makes production a one-env-var
 * switch — no code change to go from lexical-demo to real
 * semantic embeddings.
 */
final class EmbeddingManager {

  public function __construct(
    private readonly LocalTfIdfEmbeddingProvider $local,
    private readonly RemoteEmbeddingProvider $remote,
    private readonly LoggerChannelInterface $logger,
  ) {}

  /**
   * The provider that will be used for the next embed pass. Remote
   * if configured, else local.
   */
  public function activeProvider(): EmbeddingProviderInterface {
    if ($this->remote->isConfigured()) {
      return $this->remote;
    }
    return $this->local;
  }

  /**
   * Embed a corpus with the active provider. On a remote failure,
   * falls back to local rather than leaving the world un-embedded —
   * a degraded (lexical) layout beats no layout.
   *
   * @param array<string, string> $documents
   * @return array{
   *   vectors: array<string, float[]>,
   *   modelVersion: string,
   *   dimensions: int,
   * }
   */
  public function embedCorpus(array $documents): array {
    $provider = $this->activeProvider();
    try {
      $vectors = $provider->embedCorpus($documents);
      return [
        'vectors' => $vectors,
        'modelVersion' => $provider->modelVersion(),
        'dimensions' => $provider->dimensions(),
      ];
    }
    catch (\Throwable $e) {
      if ($provider === $this->remote) {
        $this->logger->warning(
          'Remote embedding failed (@msg); falling back to local TF-IDF.',
          ['@msg' => $e->getMessage()],
        );
        $vectors = $this->local->embedCorpus($documents);
        return [
          'vectors' => $vectors,
          'modelVersion' => $this->local->modelVersion(),
          'dimensions' => $this->local->dimensions(),
        ];
      }
      throw $e;
    }
  }

}
