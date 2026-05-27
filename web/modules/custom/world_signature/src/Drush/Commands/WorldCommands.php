<?php

declare(strict_types=1);

namespace Drupal\world_signature\Drush\Commands;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Logger\LoggerChannelInterface;
use Drupal\Core\State\StateInterface;
use Drupal\world_signature\Embedding\EmbeddingManager;
use Drupal\world_signature\Embedding\SemanticLayoutProjector;
use Drupal\world_signature\Plugin\MetaphorPluginManager;
use Drupal\world_signature\Service\AssetSnapshotBuilder;
use Drupal\world_signature\Service\DescriptorBuilder;
use Drupal\world_signature\Service\EntityFactsReader;
use Drupal\world_signature\Service\SignatureWriter;
use Drupal\world_signature\Service\SnapshotPublisher;
use Drupal\world_signature\Service\WorldSearchClient;
use Drupal\world_signature\Signature\Signature;
use Drupal\world_signature\Signature\SignatureExtractor;
use Drupal\world_signature\Signature\SignatureSemantic;
use Drush\Attributes\Command;
use Drush\Commands\DrushCommands;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Drush commands for the cypher.
 *
 *   drush world:publish    Force-rebuild every descriptor and push
 *                          to the gateway. Cron-equivalent on demand.
 *   drush world:validate   Health-check the cypher (gateway reachable,
 *                          metaphors registered, queue config in place,
 *                          field installed on participating bundles).
 *   drush world:test       Run the pipeline end-to-end on one entity
 *                          and dump the resulting descriptor for
 *                          visual inspection.
 */
final class WorldCommands extends DrushCommands {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly EntityFactsReader $factsReader,
    private readonly SignatureExtractor $extractor,
    private readonly SignatureWriter $writer,
    private readonly DescriptorBuilder $descriptorBuilder,
    private readonly WorldSearchClient $searchClient,
    private readonly SnapshotPublisher $publisher,
    private readonly AssetSnapshotBuilder $assetBuilder,
    private readonly MetaphorPluginManager $metaphorManager,
    private readonly EmbeddingManager $embeddingManager,
    private readonly SemanticLayoutProjector $projector,
    private readonly StateInterface $state,
    private readonly LoggerChannelInterface $loggerChannel,
  ) {
    parent::__construct();
  }

  public static function create(ContainerInterface $container): self {
    return new self(
      $container->get('entity_type.manager'),
      $container->get('world_signature.entity_facts_reader'),
      $container->get('world_signature.signature_extractor'),
      $container->get('world_signature.signature_writer'),
      $container->get('world_signature.descriptor_builder'),
      $container->get('world_signature.world_search_client'),
      $container->get('world_signature.snapshot_publisher'),
      $container->get('world_signature.asset_snapshot_builder'),
      $container->get('plugin.manager.world_signature.metaphor'),
      $container->get('world_signature.embedding.manager'),
      $container->get('world_signature.embedding.projector'),
      $container->get('state'),
      $container->get('logger.channel.world_signature'),
    );
  }

  /**
   * Force-rebuild every descriptor and push it to the gateway.
   *
   * Walks every entity type that has at least one registered
   * Metaphor plugin, runs the full signature pipeline on each
   * entity, persists field_world_signature, and upserts the
   * descriptor to the gateway.
   *
   * Use cases: post-deploy reindex, model-version migration, or
   * recovery after the gateway has been wiped.
   */
  #[Command(name: 'world:publish', aliases: ['wp', 'wpub'])]
  public function publish(): int {
    $participating = $this->collectParticipatingBundles();
    if ($participating === []) {
      $this->logger()->warning(
        'No metaphor plugins registered. Nothing to publish.',
      );
      return DrushCommands::EXIT_FAILURE;
    }

    $totalProcessed = 0;
    $totalErrors = 0;

    foreach ($participating as $entityType => $bundles) {
      $storage = $this->entityTypeManager->getStorage($entityType);
      $query = $storage->getQuery()->accessCheck(FALSE);

      // Scope to bundles that have a Metaphor plugin. Without this,
      // publish() walked every node (including pack/asset catalog
      // content from v0.3.x) and reported "No metaphor for node:asset"
      // as an error 32 times per run. Catalog content is intentionally
      // not part of the world; the bundle filter encodes that.
      $bundleKey = $this->entityTypeManager
        ->getDefinition($entityType)
        ->getKey('bundle');
      if ($bundleKey) {
        $query->condition($bundleKey, $bundles, 'IN');
      }
      $ids = $query->execute();

      $this->logger()->notice(sprintf(
        'Publishing %s (%s): %d entities.',
        $entityType,
        implode(',', $bundles),
        count($ids),
      ));

      foreach ($ids as $id) {
        try {
          $this->publishOne($entityType, (string) $id);
          $totalProcessed++;
        }
        catch (\Throwable $e) {
          $totalErrors++;
          $this->logger()->error(sprintf(
            '%s/%s failed: %s',
            $entityType,
            $id,
            $e->getMessage(),
          ));
        }
      }
    }

    $this->logger()->success(sprintf(
      'world:publish done — %d entities published, %d errors.',
      $totalProcessed,
      $totalErrors,
    ));

    return $totalErrors > 0 ? DrushCommands::EXIT_FAILURE : DrushCommands::EXIT_SUCCESS;
  }

  /**
   * Health-check the cypher.
   *
   * Reports on:
   *   - gateway reachability
   *   - registered Metaphor plugins
   *   - queue config in place
   *   - field_world_signature installed on participating bundles
   *   - corpus snapshot assembles cleanly
   */
  #[Command(name: 'world:validate', aliases: ['wv'])]
  public function validate(): int {
    $issues = [];

    $this->line('-- Gateway --');
    if ($this->searchClient->ping()) {
      $this->line(' ✓ gateway reachable');
    }
    else {
      $issues[] = 'gateway unreachable';
      $this->line(' ✗ gateway unreachable');
    }

    $this->line('-- Metaphor plugins --');
    $defs = $this->metaphorManager->getDefinitions();
    if ($defs === []) {
      $issues[] = 'no metaphor plugins registered';
      $this->line(' ✗ no metaphor plugins');
    }
    else {
      foreach ($defs as $id => $def) {
        $this->line(sprintf(' ✓ %s (%s:%s)', $id, $def['entity_type'], $def['bundle']));
      }
    }

    $this->line('-- Queue --');
    $queue = $this->entityTypeManager
      ->getStorage('advancedqueue_queue')
      ->load('world_signature_extract');
    if ($queue === NULL) {
      $issues[] = 'world_signature_extract queue missing';
      $this->line(' ✗ queue world_signature_extract missing');
    }
    else {
      $this->line(' ✓ queue world_signature_extract registered');
    }

    $this->line('-- Snapshot --');
    try {
      $snapshot = $this->publisher->buildSnapshot();
      $this->line(sprintf(
        ' ✓ snapshot assembles (%d entities, %d sectors)',
        count($snapshot['entities']),
        count($snapshot['sectors']),
      ));
    }
    catch (\Throwable $e) {
      $issues[] = 'snapshot assembly failed: ' . $e->getMessage();
      $this->line(' ✗ snapshot failed: ' . $e->getMessage());
    }

    if ($issues === []) {
      $this->logger()->success('world:validate green.');
      return DrushCommands::EXIT_SUCCESS;
    }

    $this->logger()->error(sprintf('world:validate found %d issue(s).', count($issues)));
    return DrushCommands::EXIT_FAILURE;
  }

  /**
   * Run the full pipeline on one entity for visual inspection.
   *
   * Loads the given entity, runs facts → signature → descriptor →
   * gateway upsert, and prints the resulting descriptor as JSON.
   *
   * @param string $entityType
   *   Entity type machine id (e.g. node).
   * @param string $entityId
   *   Entity id.
   */
  #[Command(name: 'world:test', aliases: ['wt'])]
  public function test(string $entityType, string $entityId): int {
    try {
      $descriptor = $this->publishOne($entityType, $entityId, returnDescriptor: TRUE);
    }
    catch (\Throwable $e) {
      $this->logger()->error('world:test failed: ' . $e->getMessage());
      return DrushCommands::EXIT_FAILURE;
    }

    $this->line(json_encode(
      $descriptor,
      JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES,
    ));
    return DrushCommands::EXIT_SUCCESS;
  }

  /**
   * Pipeline core, shared between publish() and test().
   *
   * @return array|NULL
   *   The descriptor that was pushed, when $returnDescriptor is TRUE;
   *   NULL otherwise.
   */
  private function publishOne(string $entityType, string $entityId, bool $returnDescriptor = FALSE): ?array {
    $entity = $this->entityTypeManager->getStorage($entityType)->load($entityId);
    if ($entity === NULL) {
      throw new \RuntimeException(sprintf('No %s/%s.', $entityType, $entityId));
    }

    $facts = $this->factsReader->read($entity);
    if ($facts === NULL) {
      throw new \RuntimeException(sprintf(
        'No metaphor for %s:%s — entity is not part of the world.',
        $entityType,
        $entity->bundle(),
      ));
    }

    $signature = $this->extractor->extract($facts);
    $this->writer->write($entity, $signature);

    $pluginId = sprintf('%s:%s', $entityType, $entity->bundle());
    $metaphor = $this->metaphorManager->createInstance($pluginId);

    $descriptor = $this->descriptorBuilder->build($entity, $facts, $signature, $metaphor);
    $this->searchClient->upsert($descriptor);

    return $returnDescriptor ? $descriptor : NULL;
  }

  /**
   * `drush world:embed` — compute semantic embeddings for the whole
   * corpus and write them into each entity's signature, then
   * re-publish so the gateway descriptors carry the vectors.
   *
   * BETA 2 stage. Embedding *processing* is external (docs/BOUNDARY.md):
   * with WORLD_EMBED_URL set this calls the configured embedding
   * service and stores the result; unset, it falls back to the
   * dev-only local TF-IDF embedder so DDEV works without a service.
   * Either way the module only stores + later projects the vectors.
   * Corpus-level batch (IDF needs the whole corpus), not part of the
   * per-node ExtractSignature job.
   *
   * Flow:
   *   1. Gather embeddingText for every participating entity.
   *   2. EmbeddingManager.embedCorpus → one vector per entity
   *      (remote neural model if WORLD_EMBED_URL is set, else the
   *      local TF-IDF fallback).
   *   3. For each entity: re-extract its signature, inject the
   *      embedding into the semantic layer, write the field, and
   *      re-upsert the descriptor to the gateway.
   *
   * After this, `drush world:relayout` (or the next snapshot build
   * in semantic mode) projects the vectors to 2D positions.
   */
  #[Command(name: 'world:embed', aliases: ['we'])]
  public function embed(): int {
    $participating = $this->collectParticipatingBundles();
    if ($participating === []) {
      $this->logger()->warning('No metaphor plugins registered. Nothing to embed.');
      return DrushCommands::EXIT_FAILURE;
    }

    // Pass 1: gather corpus text keyed by descriptorId, holding on
    // to the entity + facts + base signature for the write-back.
    $corpus = [];
    $work = [];
    foreach ($participating as $entityType => $bundles) {
      $storage = $this->entityTypeManager->getStorage($entityType);
      $query = $storage->getQuery()->accessCheck(FALSE);
      $bundleKey = $this->entityTypeManager->getDefinition($entityType)->getKey('bundle');
      if ($bundleKey) {
        $query->condition($bundleKey, $bundles, 'IN');
      }
      foreach ($query->execute() as $id) {
        $entity = $storage->load($id);
        if ($entity === NULL) {
          continue;
        }
        $facts = $this->factsReader->read($entity);
        if ($facts === NULL) {
          continue;
        }
        $descriptorId = $this->descriptorBuilder->descriptorId($entityType, (string) $id);
        $text = $this->descriptorBuilder->embeddingText($entity, $facts);
        $corpus[$descriptorId] = $text;
        $work[$descriptorId] = [
          'entityType' => $entityType,
          'entityId' => (string) $id,
          'entity' => $entity,
          'facts' => $facts,
        ];
      }
    }

    if ($corpus === []) {
      $this->logger()->warning('Corpus is empty. Nothing to embed.');
      return DrushCommands::EXIT_FAILURE;
    }

    // Pass 2: embed the whole corpus at once.
    $result = $this->embeddingManager->embedCorpus($corpus);
    $vectors = $result['vectors'];
    $modelVersion = $result['modelVersion'];
    $embeddedAt = time();
    $this->logger()->notice(sprintf(
      'Embedded %d documents with %s (%d dims).',
      count($vectors),
      $modelVersion,
      $result['dimensions'],
    ));

    // Pass 3: inject the embedding into each signature, write back,
    // re-upsert the descriptor so the gateway carries the vector.
    $written = 0;
    $errors = 0;
    foreach ($work as $descriptorId => $w) {
      $vector = $vectors[$descriptorId] ?? NULL;
      if ($vector === NULL) {
        continue;
      }
      try {
        $base = $this->extractor->extract($w['facts']);
        $semantic = new SignatureSemantic(
          embedding: $vector,
          modelVersion: $modelVersion,
          embeddedAt: $embeddedAt,
          semanticHash: $base->semantic->semanticHash,
        );
        $signature = new Signature(
          $base->structural,
          $base->temporal,
          $base->relational,
          $semantic,
        );
        $this->writer->write($w['entity'], $signature);

        $pluginId = sprintf('%s:%s', $w['entityType'], $w['entity']->bundle());
        $metaphor = $this->metaphorManager->createInstance($pluginId);
        $descriptor = $this->descriptorBuilder->build(
          $w['entity'], $w['facts'], $signature, $metaphor,
        );
        $this->searchClient->upsert($descriptor);
        $written++;
      }
      catch (\Throwable $e) {
        $errors++;
        $this->logger()->error(sprintf('%s embed failed: %s', $descriptorId, $e->getMessage()));
      }
    }

    // Phase 3 freshness signal (docs/TOOLBOX_AND_STAGE.md): the
    // snapshot stamps this as world.lastEmbed so editors can see how
    // stale their world's semantics are without holding a drush shell
    // open on the side. Also records the model so a model swap shows
    // as a separate freshness event.
    $this->state->set('world_signature.last_embed', [
      'at' => $embeddedAt,
      'modelVersion' => $modelVersion,
      'dimensions' => $result['dimensions'],
      'embedded' => $written,
    ]);

    $this->logger()->success(sprintf(
      'world:embed done — %d embedded, %d errors. Run `drush world:relayout` to project.',
      $written,
      $errors,
    ));
    return $errors > 0 ? DrushCommands::EXIT_FAILURE : DrushCommands::EXIT_SUCCESS;
  }

  /** Target radius the projected semantic cloud is scaled to fit. */
  private const float SEMANTIC_LAYOUT_RADIUS = 120.0;
  /** Floor for an emergent sector's radius so tiny clusters still
   *  get a readable pad + vantage framing. */
  private const float SEMANTIC_SECTOR_MIN_RADIUS = 18.0;

  /**
   * `drush world:relayout` — project the corpus embeddings to 2D
   * world positions and store the layout, then activate semantic
   * mode.
   *
   * BETA 2 stage. Reads embeddings from the gateway descriptors
   * (written by `drush world:embed`), runs classical MDS to get a
   * deterministic (x, z) per entity, derives EMERGENT sector
   * centroids + radii from where each region's members landed, and
   * freezes the result in state. The snapshot reads this frozen
   * layout — recompute only by re-running this command, which keeps
   * the world stable (URI-is-a-coordinate) as the corpus grows.
   */
  #[Command(name: 'world:relayout', aliases: ['wrl'])]
  public function relayout(): int {
    $descriptors = $this->searchClient->findAll();
    if ($descriptors === []) {
      $this->logger()->warning('No descriptors in the gateway. Run world:publish first.');
      return DrushCommands::EXIT_FAILURE;
    }

    // Gather embeddings + each entity's primary sector.
    $embeddings = [];
    $primarySector = [];
    foreach ($descriptors as $d) {
      $id = $d['_id'] ?? NULL;
      if ($id === NULL) {
        continue;
      }
      $vec = $d['signature']['semantic']['embedding'] ?? NULL;
      if (!is_array($vec) || $vec === []) {
        continue;
      }
      $embeddings[$id] = array_map('floatval', $vec);
      $sector = $d['sector'] ?? ($d['sectorTermIds'][0] ?? NULL);
      if ($sector !== NULL) {
        $primarySector[$id] = (string) $sector;
      }
    }

    if ($embeddings === []) {
      $this->logger()->error(
        'No embeddings found on descriptors. Run `drush world:embed` first.'
      );
      return DrushCommands::EXIT_FAILURE;
    }

    // Project to 2D.
    $positions = $this->projector->project($embeddings, self::SEMANTIC_LAYOUT_RADIUS);

    // Derive emergent sector centroids + radii from member positions.
    $byCentroid = [];
    foreach ($positions as $id => $pos) {
      $sector = $primarySector[$id] ?? NULL;
      if ($sector === NULL) {
        continue;
      }
      $byCentroid[$sector][] = $pos;
    }
    $sectors = [];
    foreach ($byCentroid as $sector => $members) {
      $cx = 0.0;
      $cz = 0.0;
      foreach ($members as $m) {
        $cx += $m['x'];
        $cz += $m['z'];
      }
      $cx /= count($members);
      $cz /= count($members);
      $maxR = 0.0;
      foreach ($members as $m) {
        $r = sqrt(($m['x'] - $cx) ** 2 + ($m['z'] - $cz) ** 2);
        if ($r > $maxR) {
          $maxR = $r;
        }
      }
      $sectors[$sector] = [
        'x' => $cx,
        'z' => $cz,
        'radius' => max($maxR * 1.15, self::SEMANTIC_SECTOR_MIN_RADIUS),
      ];
    }

    $this->state->set(SnapshotPublisher::STATE_SEMANTIC_LAYOUT, [
      'entities' => $positions,
      'sectors' => $sectors,
      'generatedAt' => time(),
      'count' => count($positions),
    ]);
    $this->state->set(SnapshotPublisher::STATE_LAYOUT_MODE, 'semantic');

    $this->logger()->success(sprintf(
      'world:relayout done — projected %d entities into %d emergent sectors. Layout mode: semantic.',
      count($positions),
      count($sectors),
    ));
    return DrushCommands::EXIT_SUCCESS;
  }

  /**
   * `drush world:layout-mode <mode>` — switch between taxonomy and
   * semantic layout without recomputing.
   *
   * @param string $mode
   *   'taxonomy' (sector ring + hash scatter) or 'semantic'
   *   (frozen embedding projection from world:relayout).
   */
  #[Command(name: 'world:layout-mode', aliases: ['wlm'])]
  public function layoutMode(string $mode): int {
    $mode = strtolower(trim($mode));
    if (!in_array($mode, ['taxonomy', 'semantic'], TRUE)) {
      $this->logger()->error('Mode must be "taxonomy" or "semantic".');
      return DrushCommands::EXIT_FAILURE;
    }
    if ($mode === 'semantic'
      && !is_array($this->state->get(SnapshotPublisher::STATE_SEMANTIC_LAYOUT))) {
      $this->logger()->error(
        'No stored semantic layout. Run `drush world:embed` then `drush world:relayout` first.'
      );
      return DrushCommands::EXIT_FAILURE;
    }
    $this->state->set(SnapshotPublisher::STATE_LAYOUT_MODE, $mode);
    $this->logger()->success(sprintf('Layout mode set to %s.', $mode));
    return DrushCommands::EXIT_SUCCESS;
  }

  /**
   * `drush world:switch <atmosphere>` — flip the active World node's
   * atmosphere (none|forest|inner-mind). The snapshot serves the new
   * skin on next fetch (node save invalidates node_list:world); a
   * page reload shows it. Live in-place switching is the v1.5
   * SceneManager.switchAtmosphere path (docs/feature-requests/world-switcher.md).
   */
  #[Command(name: 'world:switch', aliases: ['ws'])]
  public function switchAtmosphere(string $atmosphere): int {
    $atmosphere = strtolower(trim($atmosphere));
    if (!in_array($atmosphere, ['none', 'forest', 'inner-mind'], TRUE)) {
      $this->logger()->error('Atmosphere must be none | forest | inner-mind.');
      return DrushCommands::EXIT_FAILURE;
    }
    $world = $this->activeWorldNode();
    if ($world === NULL) {
      $this->logger()->error(
        'No active World node. Run `drush scr scaffold/install-world-bundle.php` first.'
      );
      return DrushCommands::EXIT_FAILURE;
    }
    $world->set('field_world_atmosphere', $atmosphere);
    $world->save();
    $this->logger()->success(sprintf(
      'World "%s" → atmosphere "%s". Reload the world to see it.',
      $world->label(),
      $atmosphere,
    ));
    return DrushCommands::EXIT_SUCCESS;
  }

  /**
   * The active World node — published `world` node with
   * field_world_active set, else the lowest node id, else NULL.
   * Mirrors SnapshotPublisher::activeWorld() selection.
   */
  private function activeWorldNode(): ?\Drupal\node\NodeInterface {
    $worlds = $this->entityTypeManager->getStorage('node')
      ->loadByProperties(['type' => 'world', 'status' => 1]);
    if ($worlds === []) {
      return NULL;
    }
    ksort($worlds);
    foreach ($worlds as $world) {
      if ($world->hasField('field_world_active')
        && !$world->get('field_world_active')->isEmpty()
        && (bool) $world->get('field_world_active')->value) {
        return $world;
      }
    }
    return reset($worlds);
  }

  /**
   * Returns the unique entity types covered by registered Metaphor
   * plugins (e.g. ['node']).
   *
   * @return array<int, string>
   */
  private function collectParticipatingEntityTypes(): array {
    return array_keys($this->collectParticipatingBundles());
  }

  /**
   * `drush world:assets-status` — print the live asset matrix.
   *
   * Groups by atmosphere → slot → asset, marking the one the
   * snapshot would emit for each (atmosphere, slot) cell. Reads
   * the same AssetSnapshotBuilder the snapshot endpoints do, so
   * what this prints IS what the renderer would receive.
   *
   * Useful in CI ("is the catalog actually wired?") and after a
   * "mark live" edit ("did the right asset win the cell?").
   */
  #[Command(name: 'world:assets-status', aliases: ['world:as'])]
  public function assetsStatus(): int {
    $result = $this->assetBuilder->build();
    $assets = $result['assets'];

    if (empty($assets)) {
      $this->line('No live assets. Mark at least one asset live via /admin/content?type=asset.');
      return DrushCommands::EXIT_SUCCESS;
    }

    // Re-group for display: atmosphere → slot → [asset].
    $matrix = [];
    foreach ($assets as $entry) {
      $atmospheres = $entry['atmospheres'];
      if (empty($atmospheres)) {
        $matrix['(no atmosphere)'][$entry['slot']][] = $entry;
        continue;
      }
      foreach ($atmospheres as $atmo) {
        $matrix[$atmo][$entry['slot']][] = $entry;
      }
    }
    ksort($matrix);
    foreach ($matrix as &$slots) {
      ksort($slots);
    }
    unset($slots);

    foreach ($matrix as $atmo => $slots) {
      $this->line(sprintf('[atmosphere] %s', $atmo));
      foreach ($slots as $slot => $entries) {
        foreach ($entries as $entry) {
          $packTitle = $entry['pack']['title'] ?? '(no pack)';
          $this->line(sprintf(
            '  %s ← nid:%d  %s  (%s, %d polys)',
            $slot,
            $entry['nid'],
            $entry['curatedFileUrl'],
            $packTitle,
            $entry['polycount'] ?? 0,
          ));
        }
      }
    }
    return DrushCommands::EXIT_SUCCESS;
  }

  /**
   * Map of entity_type → list of bundles that have a Metaphor plugin
   * registered. Drives the publish() query so we only iterate
   * entities the cypher actually recognises.
   *
   * @return array<string, string[]>
   */
  private function collectParticipatingBundles(): array {
    $map = [];
    foreach ($this->metaphorManager->getDefinitions() as $def) {
      $type = $def['entity_type'] ?? NULL;
      $bundle = $def['bundle'] ?? NULL;
      if ($type && $bundle) {
        $map[$type][$bundle] = TRUE;
      }
    }
    return array_map(static fn(array $bundles) => array_keys($bundles), $map);
  }

  private function line(string $line): void {
    $this->output()->writeln($line);
  }

}
