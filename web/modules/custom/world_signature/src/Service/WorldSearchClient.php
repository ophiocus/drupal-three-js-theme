<?php

declare(strict_types=1);

namespace Drupal\world_signature\Service;

use Drupal\Core\Logger\LoggerChannelInterface;
use GuzzleHttp\ClientInterface;
use GuzzleHttp\Exception\GuzzleException;

/**
 * Guzzle client to the RESTHeart gateway.
 *
 * The cypher's only direct contact with Atlas. Drupal speaks HTTP
 * to RESTHeart; RESTHeart speaks the MongoDB wire protocol to the
 * cluster. See ARCHITECTURE.md §9 for the full pattern.
 *
 * Three operations the cypher needs:
 *
 *   - upsert(descriptor)   PUT  /<db>/descriptors/<_id>
 *   - delete(id)           DELETE /<db>/descriptors/<_id>
 *   - search(query, ...)   POST /<db>/_search/descriptors  (Sprint 4)
 *
 * Auth: HTTP Basic against RESTHeart's user. Sandbox uses the
 * upstream-image default `admin/secret`; production injects real
 * credentials via WORLD_GATEWAY_USER / WORLD_GATEWAY_PASSWORD.
 *
 * Failure modes:
 * - 5xx / network → throw \RuntimeException; the queue worker
 *   converts to JobResult::failure() so advancedqueue retries.
 * - 4xx → throw, but with a marker that the worker can skip-retry
 *   on (bad payload won't fix itself).
 */
final class WorldSearchClient {

  private readonly string $gatewayUrl;
  private readonly string $database;
  private readonly string $authUser;
  private readonly string $authPassword;
  private readonly string $collection;

  public function __construct(
    private readonly ClientInterface $http,
    private readonly LoggerChannelInterface $logger,
  ) {
    // Drupal's container doesn't expand %env()% placeholders, so the
    // service reads its env vars directly. Defaults match the
    // sandbox DDEV setup.
    $this->gatewayUrl = getenv('WORLD_GATEWAY_URL') ?: 'http://restheart:8080';
    $this->database = getenv('WORLD_SIGNATURE_DATABASE') ?: 'drupal_three_js_theme_world';
    $this->authUser = getenv('WORLD_GATEWAY_USER') ?: 'admin';
    $this->authPassword = getenv('WORLD_GATEWAY_PASSWORD') ?: 'secret';
    $this->collection = 'descriptors';
  }

  /**
   * Upsert a descriptor by its `_id` field. RESTHeart's PUT-by-id
   * semantics: replace the document if present, insert otherwise.
   * Atlas-managed embeddings then fire on the resulting document.
   *
   * @param array $descriptor
   *   The skinny descriptor; must include '_id'.
   *
   * @throws \RuntimeException on transport / 5xx / 4xx.
   */
  public function upsert(array $descriptor): void {
    if (empty($descriptor['_id'])) {
      throw new \InvalidArgumentException('Descriptor missing _id.');
    }

    $id = (string) $descriptor['_id'];
    // ?wm=upsert switches RESTHeart's PUT semantic from "update only"
    // to "create-or-replace." Without it RESTHeart returns 404 when
    // the document does not yet exist.
    $url = $this->collectionUrl() . '/' . rawurlencode($id) . '?wm=upsert';

    $response = $this->putDescriptor($url, $descriptor);

    if ($response->getStatusCode() === 404) {
      // Database or collection doesn't exist yet — first write of
      // any descriptor for this tenant. RESTHeart doesn't
      // auto-create on PUT-by-id, so we ensure the parents exist
      // and retry once. Self-healing; happens at most once per
      // cluster lifetime.
      $this->logger->info('Gateway 404 on first upsert; ensuring db/collection.');
      $this->ensureDatabaseAndCollection();
      $response = $this->putDescriptor($url, $descriptor);
    }

    $status = $response->getStatusCode();
    if ($status < 200 || $status >= 300) {
      $body = (string) $response->getBody();
      $this->logger->error(
        'Gateway returned HTTP @status for upsert @id: @body',
        ['@status' => $status, '@id' => $id, '@body' => substr($body, 0, 500)],
      );
      throw new \RuntimeException(
        sprintf('Gateway HTTP %d on upsert %s', $status, $id),
      );
    }

    $this->logger->debug(
      'Upserted descriptor @id (HTTP @status, @bytes bytes).',
      [
        '@id' => $id,
        '@status' => $status,
        '@bytes' => strlen(json_encode($descriptor)),
      ],
    );
  }

  /**
   * Single PUT attempt. http_errors=FALSE so we can react to
   * 404 (parent missing) without exception-noise.
   */
  private function putDescriptor(string $url, array $descriptor): \Psr\Http\Message\ResponseInterface {
    try {
      return $this->http->request('PUT', $url, [
        'auth' => [$this->authUser, $this->authPassword],
        'json' => $descriptor,
        'headers' => ['Accept' => 'application/json'],
        'timeout' => 10,
        'connect_timeout' => 5,
        'http_errors' => FALSE,
      ]);
    }
    catch (GuzzleException $e) {
      $this->logger->error(
        'Gateway upsert transport error: @msg',
        ['@msg' => $e->getMessage()],
      );
      throw new \RuntimeException(
        sprintf('Gateway transport error: %s', $e->getMessage()),
        previous: $e,
      );
    }
  }

  /**
   * Idempotent create of the database and the descriptors collection.
   * RESTHeart returns 201 on create, 304 / 200 on already-exists.
   */
  private function ensureDatabaseAndCollection(): void {
    $dbUrl = rtrim($this->gatewayUrl, '/') . '/' . rawurlencode($this->database);
    $collUrl = $this->collectionUrl();

    foreach ([$dbUrl, $collUrl] as $url) {
      try {
        $response = $this->http->request('PUT', $url, [
          'auth' => [$this->authUser, $this->authPassword],
          'headers' => ['Accept' => 'application/json'],
          'timeout' => 10,
          'connect_timeout' => 5,
          'http_errors' => FALSE,
        ]);
      }
      catch (GuzzleException $e) {
        throw new \RuntimeException(
          sprintf('Could not ensure %s: %s', $url, $e->getMessage()),
          previous: $e,
        );
      }
      $status = $response->getStatusCode();
      if ($status >= 400) {
        throw new \RuntimeException(sprintf(
          'Gateway HTTP %d ensuring %s: %s',
          $status,
          $url,
          substr((string) $response->getBody(), 0, 200),
        ));
      }
    }

    $this->logger->info('Ensured database+collection at gateway.');
  }

  /**
   * Delete a descriptor by id. Idempotent: 404 from the gateway is
   * treated as success (already gone is fine).
   */
  public function delete(string $id): void {
    $url = $this->collectionUrl() . '/' . rawurlencode($id);

    try {
      $response = $this->http->request('DELETE', $url, [
        'auth' => [$this->authUser, $this->authPassword],
        'headers' => ['Accept' => 'application/json'],
        'timeout' => 10,
        'connect_timeout' => 5,
        'http_errors' => FALSE,
      ]);
    }
    catch (GuzzleException $e) {
      $this->logger->error(
        'Gateway delete failed for @id: @msg',
        ['@id' => $id, '@msg' => $e->getMessage()],
      );
      throw new \RuntimeException(
        sprintf('Gateway delete failed for %s: %s', $id, $e->getMessage()),
        previous: $e,
      );
    }

    $status = $response->getStatusCode();
    if ($status === 404) {
      $this->logger->debug(
        'Gateway delete @id: 404 (already gone) — treating as success.',
        ['@id' => $id],
      );
      return;
    }
    if ($status < 200 || $status >= 300) {
      $body = (string) $response->getBody();
      throw new \RuntimeException(
        sprintf('Gateway HTTP %d on delete %s: %s', $status, $id, substr($body, 0, 200)),
      );
    }

    $this->logger->debug('Deleted descriptor @id (HTTP @status).', [
      '@id' => $id, '@status' => $status,
    ]);
  }

  /**
   * Fetch one descriptor by id, or NULL if not found.
   *
   * @return array|NULL
   *   The descriptor as an associative array, or NULL on 404.
   */
  public function find(string $id): ?array {
    $url = $this->collectionUrl() . '/' . rawurlencode($id);
    try {
      $response = $this->http->request('GET', $url, [
        'auth' => [$this->authUser, $this->authPassword],
        'headers' => ['Accept' => 'application/json'],
        'timeout' => 5,
        'http_errors' => FALSE,
      ]);
    }
    catch (GuzzleException $e) {
      throw new \RuntimeException(
        sprintf('Gateway find failed for %s: %s', $id, $e->getMessage()),
        previous: $e,
      );
    }
    $status = $response->getStatusCode();
    if ($status === 404) {
      return NULL;
    }
    if ($status < 200 || $status >= 300) {
      throw new \RuntimeException(
        sprintf('Gateway HTTP %d on find %s', $status, $id),
      );
    }
    return json_decode((string) $response->getBody(), TRUE) ?: NULL;
  }

  /**
   * Fetch all descriptors. RESTHeart returns paged collections;
   * we walk pages until exhausted (or until $hardLimit is hit
   * — defensive against runaway corpora).
   *
   * @return array<int, array>
   */
  public function findAll(int $hardLimit = 5000): array {
    $all = [];
    $page = 1;
    $pageSize = 200;

    while (count($all) < $hardLimit) {
      $url = $this->collectionUrl()
        . '?page=' . $page
        . '&pagesize=' . $pageSize
        . '&np=true';
      try {
        $response = $this->http->request('GET', $url, [
          'auth' => [$this->authUser, $this->authPassword],
          'headers' => ['Accept' => 'application/json'],
          'timeout' => 15,
          'http_errors' => FALSE,
        ]);
      }
      catch (GuzzleException $e) {
        throw new \RuntimeException(
          sprintf('Gateway findAll failed: %s', $e->getMessage()),
          previous: $e,
        );
      }
      $status = $response->getStatusCode();
      if ($status === 404) {
        // Empty collection — return what we have so far.
        break;
      }
      if ($status < 200 || $status >= 300) {
        throw new \RuntimeException(
          sprintf('Gateway HTTP %d on findAll page %d', $status, $page),
        );
      }
      $batch = json_decode((string) $response->getBody(), TRUE) ?: [];
      if (empty($batch)) {
        break;
      }
      foreach ($batch as $doc) {
        $all[] = $doc;
        if (count($all) >= $hardLimit) {
          break 2;
        }
      }
      if (count($batch) < $pageSize) {
        break;
      }
      $page++;
    }

    $this->logger->debug(
      'findAll returned @n descriptors (paged).',
      ['@n' => count($all)],
    );
    return $all;
  }

  /**
   * Returns TRUE when the gateway responds to /ping. Used by the
   * verify scripts and by the WorldHealthResource (Sprint 4).
   */
  public function ping(): bool {
    try {
      $response = $this->http->request('GET', $this->gatewayUrl . '/ping', [
        'auth' => [$this->authUser, $this->authPassword],
        'timeout' => 5,
        'http_errors' => FALSE,
      ]);
      return $response->getStatusCode() === 200;
    }
    catch (GuzzleException) {
      return FALSE;
    }
  }

  private function collectionUrl(): string {
    return rtrim($this->gatewayUrl, '/')
      . '/' . rawurlencode($this->database)
      . '/' . rawurlencode($this->collection);
  }

}
