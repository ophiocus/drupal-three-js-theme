<?php

declare(strict_types=1);

namespace Drupal\world_signature\Controller;

use Drupal\Core\Cache\CacheableJsonResponse;
use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Controller\ControllerBase;
use Drupal\world_signature\Service\AssetSnapshotBuilder;
use Drupal\world_signature\Service\EmbedRunner;
use Drupal\world_signature\Service\SnapshotPublisher;
use Drupal\world_signature\Service\WorldConfigEditor;
use Drupal\world_signature\Service\WorldInterpretationEditor;
use Drupal\world_signature\Service\WorldSearchClient;
use Drupal\world_signature\Service\WorldStageEditor;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
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

  /**
   * Atmospheres a `?atmosphere=` preview hint may request. Mirrors
   * field_world_atmosphere's allowed_values — keep in sync if a skin
   * is added. Anything outside this set is ignored (no override).
   */
  private const array ATMOSPHERE_HINTS = ['none', 'forest', 'inner-mind'];

  /** Languages a `?lang=` hint may select. Mirrors the configured
   *  Drupal languages; keep in sync when a new language is enabled. */
  private const array LANGUAGE_HINTS = ['en', 'es'];

  public function __construct(
    private readonly WorldSearchClient $client,
    private readonly SnapshotPublisher $publisher,
    private readonly AssetSnapshotBuilder $assetBuilder,
    private readonly EmbedRunner $embedRunner,
    private readonly WorldConfigEditor $configEditor,
    private readonly WorldInterpretationEditor $interpretationEditor,
    private readonly WorldStageEditor $stageEditor,
  ) {}

  public static function create(ContainerInterface $container): self {
    return new self(
      $container->get('world_signature.world_search_client'),
      $container->get('world_signature.snapshot_publisher'),
      $container->get('world_signature.asset_snapshot_builder'),
      $container->get('world_signature.embed_runner'),
      $container->get('world_signature.world_config_editor'),
      $container->get('world_signature.world_interpretation_editor'),
      $container->get('world_signature.world_stage_editor'),
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
   * ALPHA-corpus sizes; static-file caching lands later.
   *
   * v0.4 / ALPHA 1: response now includes assets[] (per ROADMAP §A.2)
   * and propagates cache tags from asset+pack nodes so editorial
   * edits invalidate within the 60s max-age window.
   */
  public function snapshot(Request $request): JsonResponse {
    // v1.5 world switcher: optional read-only atmosphere preview hint.
    // GET ?atmosphere=<none|forest|inner-mind> overrides the active World
    // node's atmosphere for THIS response only — no node write, so the
    // client (switchAtmosphere) can preview a skin without drush and
    // without mutating global state for everyone. Validated against the
    // known set; anything else is ignored (the node's atmosphere stands).
    $hint = $request->query->get('atmosphere');
    $override = (is_string($hint) && in_array($hint, self::ATMOSPHERE_HINTS, TRUE))
      ? $hint
      : NULL;
    $langHint = $request->query->get('lang');
    $lang = (is_string($langHint) && in_array($langHint, self::LANGUAGE_HINTS, TRUE))
      ? $langHint
      : NULL;
    try {
      $result = $this->publisher->buildSnapshot($override, $lang);
    }
    catch (\RuntimeException $e) {
      return new JsonResponse([
        'error' => 'snapshot_failed',
        'message' => $e->getMessage(),
      ], 502);
    }
    $response = new CacheableJsonResponse($result['payload']);
    $response->addCacheableDependency($result['cacheability']);
    // Vary the cache by the hint so a forest preview can't be served
    // from an inner-mind-cached entry (or vice versa).
    $hintMeta = new CacheableMetadata();
    $hintMeta->addCacheContexts(['url.query_args:atmosphere', 'url.query_args:lang']);
    $response->addCacheableDependency($hintMeta);
    // Light client cache; the renderer fetches once per page load.
    $response->setMaxAge(60);
    return $response;
  }

  /**
   * GET /world/snapshot/assets
   *
   * Sidecar diagnostic — same `assets[]` block as /world/snapshot/full,
   * served in isolation without the entity/sector corpus around it.
   * Cheap to curl, useful for verifying which asset is `live` per
   * (atmosphere, slot) cell without parsing a full snapshot.
   *
   * Returns: { version: "v1", generatedAt: <ts>, assets: [...] }
   */
  public function assetsSnapshot(): JsonResponse {
    $result = $this->assetBuilder->build();
    $payload = [
      'version' => 'v1',
      'generatedAt' => time(),
      'assets' => $result['assets'],
    ];
    $response = new CacheableJsonResponse($payload);
    $response->addCacheableDependency($result['cacheability']);
    $response->setMaxAge(60);
    return $response;
  }

  /**
   * POST /world/admin/embed
   *
   * Phase 3 v1 (docs/TOOLBOX_AND_STAGE.md §4): the admin re-embed
   * trigger the in-canvas Stage editor's "Re-embed corpus" button
   * calls. Role-gated at the route via the `edit world signature`
   * permission; embedding *compute* still happens externally per
   * BOUNDARY.md (this just orchestrates the EmbedRunner). Returns
   * a JSON status the panel uses to refresh the freshness display.
   *
   * (CSRF: same-origin authenticated session is the gate today;
   * formal CSRF token handling is a v1.x addition.)
   */
  public function embedAction(): JsonResponse {
    try {
      $result = $this->embedRunner->run();
    }
    catch (\RuntimeException $e) {
      return new JsonResponse([
        'error' => 'embed_failed',
        'message' => $e->getMessage(),
      ], 400);
    }
    catch (\Throwable $e) {
      return new JsonResponse([
        'error' => 'embed_error',
        'message' => $e->getMessage(),
      ], 500);
    }
    return new JsonResponse([
      'status' => 'ok',
      'embedded' => $result['embedded'],
      'errors' => $result['errors'],
      'modelVersion' => $result['modelVersion'],
      'dimensions' => $result['dimensions'],
      'embeddedAt' => $result['embeddedAt'],
    ]);
  }

  /**
   * PATCH /world/edit/config
   *
   * Phase 3 v2 (docs/TOOLBOX_AND_STAGE.md §2.3): in-canvas
   * world-config patcher. The Stage editor's "World defaults"
   * section calls this with a JSON body whose keys are a subset
   * of {@see WorldConfigEditor::ALLOWED_KEYS} (today:
   * `active_atmosphere`). Same `edit world signature` permission
   * as the v1 embed trigger. The snapshot already carries the
   * `config:world_signature.palette` cache tag, so Drupal busts
   * the snapshot cache automatically when the config saves —
   * no manual invalidation needed here.
   *
   * Request body (JSON):
   *   { "active_atmosphere": "forest" | "inner-mind" | "none" }
   *
   * Response:
   *   200 { status: "ok", updated: ["active_atmosphere"], palette: {...} }
   *   400 { error, message }    — invalid patch
   *   500 { error, message }    — unexpected
   */
  public function editConfigAction(Request $request): JsonResponse {
    $body = (string) $request->getContent();
    if ($body === '') {
      return new JsonResponse([
        'error' => 'empty_body',
        'message' => 'Request body is empty; expected JSON object.',
      ], 400);
    }
    try {
      $patch = json_decode($body, TRUE, 8, JSON_THROW_ON_ERROR);
    }
    catch (\JsonException $e) {
      return new JsonResponse([
        'error' => 'invalid_json',
        'message' => $e->getMessage(),
      ], 400);
    }
    if (!is_array($patch)) {
      return new JsonResponse([
        'error' => 'invalid_payload',
        'message' => 'Body must be a JSON object.',
      ], 400);
    }

    try {
      $result = $this->configEditor->apply($patch);
    }
    catch (\InvalidArgumentException $e) {
      return new JsonResponse([
        'error' => 'invalid_patch',
        'message' => $e->getMessage(),
      ], 400);
    }
    catch (\Throwable $e) {
      return new JsonResponse([
        'error' => 'config_error',
        'message' => $e->getMessage(),
      ], 500);
    }

    return new JsonResponse([
      'status' => 'ok',
      'updated' => $result['updated'],
      'palette' => $result['palette'],
    ]);
  }

  /**
   * PATCH /world/edit/stage
   *
   * Phase 4 (docs/TOOLBOX_AND_STAGE.md §2.1 layer 1) — the in-canvas
   * stage-fixture patcher. Body:
   *
   *   { "atmosphere": "inner-mind",
   *     "layer": "zodiac",
   *     "placements": [{ "angle": 0.0, "height": 5.0, "scale": 1.2 }, ...] }
   *
   * Replace-all semantics: the placements array is the full new
   * list. Same `edit world signature` permission. Snapshot busts
   * automatically via the `config:world_signature.stage` cache tag.
   */
  public function editStageAction(Request $request): JsonResponse {
    $body = (string) $request->getContent();
    if ($body === '') {
      return new JsonResponse([
        'error' => 'empty_body',
        'message' => 'Request body is empty; expected JSON object.',
      ], 400);
    }
    try {
      $payload = json_decode($body, TRUE, 16, JSON_THROW_ON_ERROR);
    }
    catch (\JsonException $e) {
      return new JsonResponse([
        'error' => 'invalid_json',
        'message' => $e->getMessage(),
      ], 400);
    }
    if (!is_array($payload)) {
      return new JsonResponse([
        'error' => 'invalid_payload',
        'message' => 'Body must be a JSON object.',
      ], 400);
    }
    $atmosphere = $payload['atmosphere'] ?? NULL;
    $layer = $payload['layer'] ?? NULL;
    $placements = $payload['placements'] ?? NULL;
    if (!is_string($atmosphere) || !is_string($layer) || !is_array($placements)) {
      return new JsonResponse([
        'error' => 'invalid_payload',
        'message' => 'Body must include "atmosphere" (string), "layer" (string), "placements" (array).',
      ], 400);
    }

    try {
      $result = $this->stageEditor->applyPlacements($atmosphere, $layer, array_values($placements));
    }
    catch (\InvalidArgumentException $e) {
      return new JsonResponse([
        'error' => 'invalid_patch',
        'message' => $e->getMessage(),
      ], 400);
    }
    catch (\Throwable $e) {
      return new JsonResponse([
        'error' => 'stage_error',
        'message' => $e->getMessage(),
      ], 500);
    }
    return new JsonResponse([
      'status' => 'ok',
      'updated' => $result['updated'],
      'count' => $result['count'],
    ]);
  }

  /**
   * PATCH /world/edit/interpretation
   *
   * Phase 3 v3 (docs/INTERPRETATION_ENGINE.md §3): the in-canvas
   * interpretation-rules patcher. Body shape:
   *
   *   { "atmosphere": "inner-mind",
   *     "axes": { "0": { "name": "...", "pole_a": "...", "pole_b": "..." },
   *               "1": { "pole_b": "..." }, ... } }
   *
   * `axes` is a sparse map keyed by string-int axis index (JSON
   * objects can't have integer keys, so the wire format stores them
   * as strings; the editor parses them back). Each entry is a
   * partial axis patch — fields not present are left alone.
   *
   * Same `edit world signature` permission as the v1/v2 endpoints.
   * The snapshot's `config:world_signature.interpretation` tag busts
   * automatically when the config saves.
   *
   * Response:
   *   200 { status: "ok", updated: {<axisIdx>: [fields...]}, axes: [...] }
   *   400 { error, message }   — invalid patch
   *   500 { error, message }   — unexpected
   */
  public function editInterpretationAction(Request $request): JsonResponse {
    $body = (string) $request->getContent();
    if ($body === '') {
      return new JsonResponse([
        'error' => 'empty_body',
        'message' => 'Request body is empty; expected JSON object.',
      ], 400);
    }
    try {
      $payload = json_decode($body, TRUE, 16, JSON_THROW_ON_ERROR);
    }
    catch (\JsonException $e) {
      return new JsonResponse([
        'error' => 'invalid_json',
        'message' => $e->getMessage(),
      ], 400);
    }
    if (!is_array($payload)) {
      return new JsonResponse([
        'error' => 'invalid_payload',
        'message' => 'Body must be a JSON object.',
      ], 400);
    }
    $atmosphere = $payload['atmosphere'] ?? NULL;
    $axesRaw = $payload['axes'] ?? NULL;
    if (!is_string($atmosphere) || !is_array($axesRaw)) {
      return new JsonResponse([
        'error' => 'invalid_payload',
        'message' => 'Body must include "atmosphere" (string) and "axes" (object).',
      ], 400);
    }

    // The wire format keys axis patches as strings ("0","1",...);
    // the service expects integer indices. Convert + reject non-numeric.
    $axisPatches = [];
    foreach ($axesRaw as $key => $value) {
      if (!is_string($key) && !is_int($key)) {
        return new JsonResponse([
          'error' => 'invalid_payload',
          'message' => 'axes keys must be integer-strings.',
        ], 400);
      }
      $strKey = (string) $key;
      if (!ctype_digit($strKey)) {
        return new JsonResponse([
          'error' => 'invalid_payload',
          'message' => sprintf('Axis key "%s" is not a non-negative integer.', $strKey),
        ], 400);
      }
      $axisPatches[(int) $strKey] = $value;
    }

    try {
      $result = $this->interpretationEditor->apply($atmosphere, $axisPatches);
    }
    catch (\InvalidArgumentException $e) {
      return new JsonResponse([
        'error' => 'invalid_patch',
        'message' => $e->getMessage(),
      ], 400);
    }
    catch (\Throwable $e) {
      return new JsonResponse([
        'error' => 'interpretation_error',
        'message' => $e->getMessage(),
      ], 500);
    }

    return new JsonResponse([
      'status' => 'ok',
      'updated' => $result['updated'],
      'axes' => $result['axes'],
    ]);
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
