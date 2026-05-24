<?php

declare(strict_types=1);

namespace Drupal\world_signature\Service;

use Drupal\Core\Cache\CacheableMetadata;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\File\FileUrlGeneratorInterface;
use Drupal\Core\Logger\LoggerChannelInterface;
use Drupal\file\FileInterface;
use Drupal\node\NodeInterface;
use Drupal\taxonomy\TermInterface;

/**
 * Assembles the `assets[]` block emitted into the corpus snapshot.
 *
 * The renderer consumes the same block from /world/snapshot/full
 * (embedded) and /world/snapshot/assets (sidecar diagnostic). Both
 * surfaces call this service; the service is the single read path
 * for "which asset is live for which (atmosphere, slot) cell."
 *
 * See docs/v0.4/ROADMAP.md §A.2 for the spec this implements.
 */
final class AssetSnapshotBuilder {

  /**
   * The asset_status term whose name unlocks the renderer's pick.
   * Editors can rename the human-readable label, but the term's
   * machine-name-ish `name` field stays as 'live' (seeded by
   * scaffold/seed-asset-vocab.php). Anything else means the editor
   * intended the asset NOT to render.
   */
  private const string LIVE_STATUS_NAME = 'live';

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly FileUrlGeneratorInterface $fileUrlGenerator,
    private readonly LoggerChannelInterface $logger,
  ) {}

  /**
   * Build the `assets[]` payload + matching cacheable metadata.
   *
   * Returns:
   *   - assets: array of asset entries, each shaped per the
   *     ARCHITECTURE.md §5 / ROADMAP.md §A.2.2 contract.
   *   - cacheability: CacheableMetadata to attach to the response
   *     (so editorial flips invalidate the snapshot).
   *
   * Always-array invariant: `assets` is never null. Empty array
   * means no asset is `live`; renderer falls back to primitives
   * across all slots (the v0.3 behavior).
   *
   * @return array{
   *   assets: array<int, array<string, mixed>>,
   *   cacheability: \Drupal\Core\Cache\CacheableMetadata,
   * }
   */
  public function build(): array {
    $cacheability = new CacheableMetadata();
    // Universal tags — anything added/removed at this level
    // invalidates the snapshot regardless of which specific
    // assets/packs were emitted.
    $cacheability->addCacheTags([
      'node_list:asset',
      'node_list:pack',
      'taxonomy_term_list:asset_status',
      'taxonomy_term_list:asset_slots',
    ]);

    $liveTermId = $this->findLiveStatusTermId();
    if ($liveTermId === NULL) {
      // No `live` term exists in the asset_status vocab — installation
      // hasn't run the seeder, or the term was deleted. Defensive:
      // emit empty assets[] rather than throwing.
      $this->logger->warning(
        'asset_status vocabulary has no "live" term; assets[] empty.'
      );
      return ['assets' => [], 'cacheability' => $cacheability];
    }

    /** @var \Drupal\node\NodeStorageInterface $nodeStorage */
    $nodeStorage = $this->entityTypeManager->getStorage('node');
    $assetIds = $nodeStorage->getQuery()
      ->accessCheck(TRUE)
      ->condition('type', 'asset')
      ->condition('status', 1)
      ->condition('field_asset_status.target_id', $liveTermId)
      ->execute();

    if (empty($assetIds)) {
      return ['assets' => [], 'cacheability' => $cacheability];
    }

    /** @var \Drupal\node\NodeInterface[] $assets */
    $assets = $nodeStorage->loadMultiple($assetIds);

    // Pass 1: project each asset to its payload shape, defensively
    // filtering ones that can't be rendered (no file, no slot, etc.).
    $entries = [];
    foreach ($assets as $asset) {
      $entry = $this->projectAsset($asset, $cacheability);
      if ($entry === NULL) {
        continue;
      }
      $entries[] = $entry;
    }

    // Pass 2: enforce the "one live per (atmosphere, slot) cell"
    // invariant. If two assets share the same cell, sort by nid asc
    // and emit the lowest; log a notice listing the duplicates so
    // the editor sees it. A.5's "Mark live" action prevents this at
    // the editorial layer; this is the defensive backstop.
    $deduplicated = $this->deduplicateLivePerCell($entries);

    return ['assets' => $deduplicated, 'cacheability' => $cacheability];
  }

  /**
   * Project one asset node into the renderer's payload shape.
   *
   * Returns NULL when the asset is unusable (missing curated file,
   * missing slot, etc.) — the caller filters NULLs out of the array.
   * Side effect: appends per-entity cache tags to $cacheability and
   * logs warnings for editorial fixes the editor will care about.
   */
  private function projectAsset(
    NodeInterface $asset,
    CacheableMetadata $cacheability,
  ): ?array {
    $cacheability->addCacheTags($asset->getCacheTags());

    // Defensive: missing curated file → can't load, omit. Editor
    // marked it live but hasn't uploaded the normalised .glb yet.
    $fileField = $asset->get('field_asset_curated_file');
    if ($fileField->isEmpty()) {
      $this->logger->warning(
        sprintf(
          'Asset %d (%s) is live but field_asset_curated_file is empty; omitting.',
          $asset->id(),
          $asset->label() ?? '?',
        ),
      );
      return NULL;
    }
    /** @var \Drupal\file\FileInterface|null $file */
    $file = $fileField->entity;
    if (!$file instanceof FileInterface) {
      $this->logger->warning(
        sprintf(
          'Asset %d references a missing file entity (broken ref); omitting.',
          $asset->id(),
        ),
      );
      return NULL;
    }

    // Slot — required. Term's name is the machine-name-ish handle
    // that mappings.yml joins on (e.g. "oak-stylized", "standing-stone").
    /** @var \Drupal\taxonomy\TermInterface|null $slotTerm */
    $slotTerm = $asset->get('field_asset_slot')->entity;
    if (!$slotTerm instanceof TermInterface) {
      $this->logger->warning(
        sprintf(
          'Asset %d has no slot term; omitting.',
          $asset->id(),
        ),
      );
      return NULL;
    }
    $cacheability->addCacheTags($slotTerm->getCacheTags());

    // Atmospheres — multi-value list_string. Each value is an
    // atmosphere machine-name (e.g. "forest"). Empty array means
    // the asset is wired but never selected.
    $atmospheres = [];
    foreach ($asset->get('field_asset_atmospheres') as $item) {
      $value = $item->value ?? NULL;
      if (is_string($value) && $value !== '') {
        $atmospheres[] = $value;
      }
    }

    // Curated_file as absolute path (relative to Drupal's webroot),
    // not a full URL — matches the existing relative-fetch pattern
    // in the renderer and survives both bare-host and reverse-proxy
    // deploys.
    $absolutePath = $this->fileUrlGenerator->generateString($file->getFileUri());

    $entry = [
      'nid' => (int) $asset->id(),
      'slot' => (string) $slotTerm->getName(),
      'atmospheres' => $atmospheres,
      'curatedFileUrl' => $absolutePath,
      'curatedFileSize' => (int) ($file->getSize() ?? 0),
      'polycount' => $this->intFieldOrNull($asset, 'field_asset_curated_polycount'),
      'pivot' => $this->stringFieldOrDefault($asset, 'field_asset_curated_pivot', 'base'),
    ];

    // Optional pack context: title, license, attribution, source URL.
    $pack = $this->resolvePack($asset, $cacheability);
    if ($pack !== NULL) {
      $entry['pack'] = $pack;
    }

    return $entry;
  }

  /**
   * Resolve the optional `pack` block on an asset.
   *
   * Asset has a `field_asset_pack` entity reference to a node:pack.
   * The pack carries license + attribution + source URL — repeated
   * on each asset so the renderer doesn't have to do a second
   * roundtrip to credit a model. Returns NULL if no pack reference
   * or the pack is gone (deleted between asset save and snapshot).
   */
  private function resolvePack(
    NodeInterface $asset,
    CacheableMetadata $cacheability,
  ): ?array {
    /** @var \Drupal\node\NodeInterface|null $pack */
    $pack = $asset->get('field_asset_pack')->entity;
    if (!$pack instanceof NodeInterface) {
      return NULL;
    }
    $cacheability->addCacheTags($pack->getCacheTags());

    /** @var \Drupal\taxonomy\TermInterface|null $licenseTerm */
    $licenseTerm = $pack->get('field_pack_license')->entity;
    if ($licenseTerm instanceof TermInterface) {
      $cacheability->addCacheTags($licenseTerm->getCacheTags());
    }

    return [
      'nid' => (int) $pack->id(),
      'title' => (string) ($pack->label() ?? ''),
      'license' => $licenseTerm instanceof TermInterface
        ? (string) $licenseTerm->getName()
        : '',
      'attribution' => $this->stringFieldOrDefault($pack, 'field_pack_attribution', ''),
      'sourceUrl' => $this->stringFieldOrDefault($pack, 'field_pack_source_url', ''),
    ];
  }

  /**
   * Enforce one-live-per-(atmosphere, slot)-cell.
   *
   * If two assets are live for the same cell, sort by nid asc and
   * keep the lowest. Log a notice listing the duplicates so the
   * editor sees the conflict in the watchdog.
   *
   * Assets with empty atmospheres are kept as-is — they're "wired
   * but inert" (the renderer never picks them); duplicates among
   * inert assets don't matter.
   *
   * @param array<int, array<string, mixed>> $entries
   * @return array<int, array<string, mixed>>
   */
  private function deduplicateLivePerCell(array $entries): array {
    // Group by (atmosphere, slot). One asset can appear in multiple
    // groups if it lists multiple atmospheres.
    $byCell = [];
    foreach ($entries as $i => $entry) {
      $slot = $entry['slot'];
      $atmospheres = $entry['atmospheres'];
      if (empty($atmospheres)) {
        // No cell membership — keep as-is.
        continue;
      }
      foreach ($atmospheres as $atmo) {
        $cell = $atmo . '/' . $slot;
        $byCell[$cell][] = ['index' => $i, 'nid' => $entry['nid']];
      }
    }

    // Determine winners + losers.
    $losers = [];
    foreach ($byCell as $cell => $candidates) {
      if (count($candidates) <= 1) {
        continue;
      }
      // Sort by nid asc; winner = first.
      usort($candidates, fn($a, $b) => $a['nid'] <=> $b['nid']);
      $winner = array_shift($candidates);
      $loserNids = array_map(fn($c) => $c['nid'], $candidates);
      $this->logger->notice(
        sprintf(
          'Cell %s has multiple live assets %s; emitting %d, omitting %s.',
          $cell,
          '[' . implode(', ', array_map(
            fn($c) => (string) $c['nid'],
            array_merge([$winner], $candidates),
          )) . ']',
          $winner['nid'],
          implode(', ', array_map(fn($n) => (string) $n, $loserNids)),
        ),
      );
      foreach ($candidates as $loser) {
        $losers[$loser['index']] = TRUE;
      }
    }

    // Filter the original list.
    return array_values(array_filter(
      $entries,
      fn($i) => !isset($losers[$i]),
      ARRAY_FILTER_USE_KEY,
    ));
  }

  /**
   * Look up the `live` term in the asset_status vocab. NULL if
   * not present (e.g. the seeder hasn't been run).
   */
  private function findLiveStatusTermId(): ?int {
    /** @var \Drupal\taxonomy\TermStorageInterface $termStorage */
    $termStorage = $this->entityTypeManager->getStorage('taxonomy_term');
    $terms = $termStorage->loadByProperties([
      'vid' => 'asset_status',
      'name' => self::LIVE_STATUS_NAME,
    ]);
    $term = reset($terms);
    return $term instanceof TermInterface ? (int) $term->id() : NULL;
  }

  /**
   * Read an integer field or return NULL. Used for polycount —
   * present on curated assets, absent on still-being-curated ones.
   */
  private function intFieldOrNull(NodeInterface $node, string $fieldName): ?int {
    if (!$node->hasField($fieldName)) {
      return NULL;
    }
    $field = $node->get($fieldName);
    if ($field->isEmpty()) {
      return NULL;
    }
    return (int) $field->value;
  }

  /**
   * Read a string field or return a default. Used for pivot
   * (defaults to "base"), attribution (defaults to ""), source URL.
   */
  private function stringFieldOrDefault(
    NodeInterface $node,
    string $fieldName,
    string $default,
  ): string {
    if (!$node->hasField($fieldName)) {
      return $default;
    }
    $field = $node->get($fieldName);
    if ($field->isEmpty()) {
      return $default;
    }
    $value = $field->value ?? $field->uri ?? $default;
    return (string) $value;
  }

}
