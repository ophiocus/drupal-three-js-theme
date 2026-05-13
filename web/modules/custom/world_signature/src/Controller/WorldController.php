<?php

declare(strict_types=1);

namespace Drupal\world_signature\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\world_signature\Service\SnapshotPublisher;
use Drupal\world_signature\Service\WorldSearchClient;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * The cypher's HTTP surface. Four endpoints:
 *
 *   GET /world/health                                  -> status JSON
 *   GET /world/snapshot/full                           -> corpus snapshot JSON
 *   GET /world/descriptor/{id}                          -> one descriptor JSON
 *   GET /world/card/{entity_type}/{id}/{view_mode}      -> Drupal-rendered HTML
 *
 * The renderer's only contract with Drupal lives at these URLs.
 * The first three return JSON consumed by the JS-side runtime.
 * The fourth returns rendered HTML and is what the FullView card
 * mounts into the DOM overlay (per ARCHITECTURE.md §4.3).
 */
final class WorldController extends ControllerBase {

  public function __construct(
    private readonly WorldSearchClient $client,
    private readonly SnapshotPublisher $publisher,
  ) {}

  public static function create(ContainerInterface $container): self {
    return new self(
      $container->get('world_signature.world_search_client'),
      $container->get('world_signature.snapshot_publisher'),
    );
  }

  /**
   * GET /world/health
   *
   * Returns:
   *   { status: "ok" | "degraded" | "down",
   *     gateway: "reachable" | "unreachable",
   *     timestamp: <unix-ts> }
   */
  public function health(): JsonResponse {
    $gatewayOk = $this->client->ping();
    $payload = [
      'status' => $gatewayOk ? 'ok' : 'degraded',
      'gateway' => $gatewayOk ? 'reachable' : 'unreachable',
      'timestamp' => time(),
    ];
    return new JsonResponse($payload, $gatewayOk ? 200 : 503);
  }

  /**
   * GET /world/snapshot/full
   *
   * Full corpus snapshot per ARCHITECTURE §5. Cheap to compute at
   * ALPHA-corpus sizes; v0.0.2 will cache a static artifact.
   */
  public function snapshot(): JsonResponse {
    try {
      $snapshot = $this->publisher->buildSnapshot();
    }
    catch (\RuntimeException $e) {
      return new JsonResponse([
        'error' => 'snapshot_failed',
        'message' => $e->getMessage(),
      ], 502);
    }
    $response = new JsonResponse($snapshot);
    // Light client cache; the renderer fetches once per page load.
    $response->setMaxAge(60);
    return $response;
  }

  /**
   * GET /world/descriptor/{id}
   *
   * Single descriptor lookup. Used for Bloom-without-FullView
   * preview content and as a debugging surface.
   */
  public function descriptor(string $id): JsonResponse {
    try {
      $doc = $this->client->find($id);
    }
    catch (\RuntimeException $e) {
      return new JsonResponse([
        'error' => 'gateway_error',
        'message' => $e->getMessage(),
      ], 502);
    }
    if ($doc === NULL) {
      throw new NotFoundHttpException(sprintf('No descriptor "%s".', $id));
    }
    unset($doc['_etag']);
    return new JsonResponse($doc);
  }

  /**
   * GET /world/card/{entity_type}/{id}/{view_mode}
   *
   * Drupal-rendered HTML for the requested entity in the requested
   * view mode. The FullView card mounts this into the DOM overlay.
   * Respects entity access — unpublished/restricted entities 404.
   */
  public function card(string $entity_type, string $id, string $view_mode): Response {
    try {
      $storage = $this->entityTypeManager()->getStorage($entity_type);
    }
    catch (\Throwable) {
      throw new NotFoundHttpException(sprintf('Unknown entity type "%s".', $entity_type));
    }

    $entity = $storage->load($id);
    if ($entity === NULL || !$entity->access('view')) {
      throw new NotFoundHttpException(sprintf('No %s/%s.', $entity_type, $id));
    }

    try {
      $view_builder = $this->entityTypeManager()->getViewBuilder($entity_type);
    }
    catch (\Throwable) {
      throw new NotFoundHttpException(
        sprintf('No view builder for %s.', $entity_type),
      );
    }

    $build = $view_builder->view($entity, $view_mode);
    $html = (string) \Drupal::service('renderer')->renderRoot($build);

    $response = new Response($html, 200, ['Content-Type' => 'text/html; charset=utf-8']);
    // Cards are publishable content; allow short caching.
    $response->setMaxAge(300);
    return $response;
  }

  /**
   * GET /sector/{termId}
   *
   * v0.1.1: a deep-linkable world-coordinate URL. The controller
   * returns an empty render array — the theme's `page.html.twig`
   * provides the canvas, the JS bundle boots, and CameraController
   * reads the URL to derive the right Vantage. No server-side
   * rendering of the sector contents here — that's the renderer's
   * job, and `/world/snapshot/full` is its source.
   *
   * Returns 404 if the term doesn't exist OR isn't currently used
   * as a sector — keeps stale bookmarks from booting into nothing.
   */
  public function sector(string $termId): array {
    /** @var \Drupal\taxonomy\TermStorageInterface $storage */
    $storage = $this->entityTypeManager()->getStorage('taxonomy_term');
    $term = $storage->load($termId);
    if ($term === NULL || !$term->access('view')) {
      throw new NotFoundHttpException(sprintf('No sector for term %s.', $termId));
    }

    // Empty render with strict cache contexts: every URL gets the
    // same payload (the canvas), but the page title varies per
    // sector. Cache tag on the term so editorial rename invalidates.
    return [
      '#cache' => [
        'contexts' => ['url.path'],
        'tags' => $term->getCacheTags(),
        'max-age' => 3600,
      ],
      // Empty body — the world canvas is provided by page.html.twig.
      '#markup' => '',
    ];
  }

  /**
   * Title callback for /sector/{termId} — friendly browser tab and
   * crawler signal. Falls through to the route's defined title if
   * the term load fails.
   */
  public function sectorTitle(string $termId): string {
    /** @var \Drupal\taxonomy\TermStorageInterface $storage */
    $storage = $this->entityTypeManager()->getStorage('taxonomy_term');
    $term = $storage->load($termId);
    if ($term === NULL) {
      return sprintf('Sector %s', $termId);
    }
    return (string) $term->label();
  }

}
