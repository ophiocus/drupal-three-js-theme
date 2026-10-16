<?php

declare(strict_types=1);

namespace Drupal\Tests\world_signature\Unit;

use Drupal\Core\Logger\LoggerChannelInterface;
use Drupal\world_signature\Embedding\RemoteEmbeddingProvider;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Response;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\TestCase;

/**
 * Remote embedding seam — request shape, width contract, versioning.
 *
 * Guzzle runs against a MockHandler; no network. The provider reads
 * its config from the environment, so each test sets WORLD_EMBED_*
 * with putenv() and tearDown() clears them.
 */
#[CoversClass(RemoteEmbeddingProvider::class)]
#[Group('world_signature')]
final class RemoteEmbeddingProviderTest extends TestCase {

  private const array ENV = ['WORLD_EMBED_URL', 'WORLD_EMBED_KEY', 'WORLD_EMBED_MODEL', 'WORLD_EMBED_DIM'];

  /** @var array<int, array{request: \Psr\Http\Message\RequestInterface}> */
  private array $history = [];

  protected function setUp(): void {
    parent::setUp();
    putenv('WORLD_EMBED_URL=http://ollama.test/v1/embeddings');
    putenv('WORLD_EMBED_MODEL=qwen3-embedding:4b');
  }

  protected function tearDown(): void {
    foreach (self::ENV as $name) {
      putenv($name);
    }
    parent::tearDown();
  }

  public function testSendsDimensionsAndVersionsByWidth(): void {
    putenv('WORLD_EMBED_DIM=3');
    $provider = $this->provider([$this->body([[3.0, 0.0, 4.0], [0.0, 2.0, 0.0]])]);

    $vectors = $provider->embedCorpus(['a' => 'first', 'b' => 'second']);

    $sent = json_decode((string) $this->history[0]['request']->getBody(), TRUE);
    $this->assertSame(3, $sent['dimensions']);
    $this->assertSame('qwen3-embedding:4b', $sent['model']);
    $this->assertSame('remote:qwen3-embedding:4b@3', $provider->modelVersion());
    $this->assertSame(3, $provider->dimensions());
    // L2-normalised, keyed by the caller's ids.
    $this->assertEqualsWithDelta([0.6, 0.0, 0.8], $vectors['a'], 1e-9);
    $this->assertEqualsWithDelta([0.0, 1.0, 0.0], $vectors['b'], 1e-9);
  }

  public function testOmitsDimensionsWhenUnset(): void {
    $provider = $this->provider([$this->body([array_fill(0, 1024, 0.5)])]);

    $provider->embedCorpus(['a' => 'only']);

    $sent = json_decode((string) $this->history[0]['request']->getBody(), TRUE);
    $this->assertArrayNotHasKey('dimensions', $sent);
    $this->assertSame('remote:qwen3-embedding:4b@1024', $provider->modelVersion());
  }

  public function testHonoursIndexOrder(): void {
    putenv('WORLD_EMBED_DIM=2');
    $reordered = [
      'data' => [
        ['index' => 1, 'embedding' => [0.0, 1.0]],
        ['index' => 0, 'embedding' => [1.0, 0.0]],
      ],
    ];
    $provider = $this->provider([new Response(200, [], json_encode($reordered))]);

    $vectors = $provider->embedCorpus(['x' => 'first', 'y' => 'second']);

    $this->assertSame([1.0, 0.0], $vectors['x']);
    $this->assertSame([0.0, 1.0], $vectors['y']);
  }

  public function testRejectsWidthMismatch(): void {
    // A provider that ignores `dimensions` and answers at native width.
    putenv('WORLD_EMBED_DIM=1024');
    $provider = $this->provider([$this->body([array_fill(0, 2560, 0.1)])]);

    $this->expectException(\RuntimeException::class);
    $this->expectExceptionMessage('2560-dim vectors; expected 1024');
    $provider->embedCorpus(['a' => 'only']);
  }

  public function testRejectsMissingVectors(): void {
    putenv('WORLD_EMBED_DIM=2');
    $provider = $this->provider([$this->body([[1.0, 0.0]])]);

    $this->expectException(\RuntimeException::class);
    $this->expectExceptionMessage('1 vectors for 2 inputs');
    $provider->embedCorpus(['a' => 'one', 'b' => 'two']);
  }

  /**
   * A provider whose HTTP client answers with the given responses.
   *
   * @param \GuzzleHttp\Psr7\Response[] $responses
   */
  private function provider(array $responses): RemoteEmbeddingProvider {
    $stack = HandlerStack::create(new MockHandler($responses));
    $stack->push(Middleware::history($this->history));
    return new RemoteEmbeddingProvider(
      new Client(['handler' => $stack]),
      $this->createMock(LoggerChannelInterface::class),
    );
  }

  /**
   * An OpenAI-style embeddings response body.
   *
   * @param float[][] $vectors
   */
  private function body(array $vectors): Response {
    $data = [];
    foreach ($vectors as $i => $v) {
      $data[] = ['index' => $i, 'embedding' => $v];
    }
    return new Response(200, [], json_encode(['data' => $data]));
  }

}
