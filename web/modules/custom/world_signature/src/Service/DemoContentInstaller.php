<?php

declare(strict_types=1);

namespace Drupal\world_signature\Service;

use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Extension\ModuleExtensionList;
use Drupal\Core\Logger\LoggerChannelInterface;
use Drupal\node\Entity\Node;
use Drupal\taxonomy\Entity\Term;
use Symfony\Component\Yaml\Yaml;

/**
 * Imports the bundled demo corpus from `demo_content/corpus.yml`.
 *
 * Idempotent — re-running with the same YAML upserts by stable key:
 *   - taxonomy terms by (vocabulary, name)
 *   - nodes by (bundle, title)
 *
 * After importing entities the installer triggers EmbedRunner's
 * batch API so signatures carry vectors from the first front-page
 * render — the user never sees an "empty world" frame.
 *
 * Called by the first-run wizard's batch step. CLI access via
 * `drush world:install-demo` (registered separately).
 */
final class DemoContentInstaller {

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly ConfigFactoryInterface $configFactory,
    private readonly EmbedRunner $embedRunner,
    private readonly ModuleExtensionList $moduleExtensionList,
    private readonly LoggerChannelInterface $logger,
  ) {}

  /**
   * Install demo content + embed pass. Returns counts.
   *
   * @return array{topics: int, articles: int, profiles: int, events: int, embedded: int}
   */
  public function install(): array {
    $corpus = $this->loadCorpus();
    if ($corpus === NULL) {
      throw new \RuntimeException('Demo corpus YAML missing or unreadable.');
    }
    $this->ensureTopicsVocabulary();
    $topicMap = $this->upsertTopics($corpus['topics'] ?? []);
    $articleCount = $this->upsertNodes(
      bundle: 'article',
      records: $corpus['articles'] ?? [],
      topicMap: $topicMap,
      themesKey: NULL,
    );
    $profileCount = $this->upsertNodes(
      bundle: 'profile',
      records: $corpus['profiles'] ?? [],
      topicMap: $topicMap,
      themesKey: 'themes',
    );
    $eventCount = $this->upsertNodes(
      bundle: 'event',
      records: $corpus['events'] ?? [],
      topicMap: $topicMap,
      themesKey: NULL,
    );

    // Embed pass — uses the batch API methods we shipped in Arc 1,
    // invoked synchronously since the corpus is tiny (~27 entities)
    // and the local TF-IDF embedder is fast.
    $embedded = $this->runFullEmbedSync();

    return [
      'topics'   => count($topicMap),
      'articles' => $articleCount,
      'profiles' => $profileCount,
      'events'   => $eventCount,
      'embedded' => $embedded,
    ];
  }

  /**
   * Truthy if there's already meaningful content in the world —
   * used by the wizard's first-run detector to skip onboarding when
   * the site builder already imported their own entities before
   * visiting /admin/world.
   */
  public function corpusLooksPopulated(): bool {
    foreach (['article', 'profile', 'event'] as $bundle) {
      $n = $this->entityTypeManager->getStorage('node')->getQuery()
        ->accessCheck(FALSE)
        ->condition('type', $bundle)
        ->condition('status', 1)
        ->count()
        ->execute();
      if ((int) $n > 0) {
        return TRUE;
      }
    }
    return FALSE;
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private function loadCorpus(): ?array {
    $modulePath = $this->moduleExtensionList->getPath('world_signature');
    $path = DRUPAL_ROOT . '/' . $modulePath . '/demo_content/corpus.yml';
    if (!is_readable($path)) {
      return NULL;
    }
    try {
      $decoded = Yaml::parseFile($path);
    }
    catch (\Throwable $e) {
      $this->logger->error('Demo corpus YAML parse failed: @m', ['@m' => $e->getMessage()]);
      return NULL;
    }
    return is_array($decoded) ? $decoded : NULL;
  }

  private function ensureTopicsVocabulary(): void {
    $vocabStorage = $this->entityTypeManager->getStorage('taxonomy_vocabulary');
    if ($vocabStorage->load('topics') !== NULL) {
      return;
    }
    $vocabStorage->create([
      'vid' => 'topics',
      'name' => 'Topics',
      'description' => 'Topic taxonomy used as the world\'s sector layout.',
    ])->save();
  }

  /**
   * @param array<int, array{slug: string, name: string}> $records
   * @return array<string, int> slug → tid
   */
  private function upsertTopics(array $records): array {
    $termStorage = $this->entityTypeManager->getStorage('taxonomy_term');
    $slugToTid = [];
    foreach ($records as $r) {
      $slug = (string) ($r['slug'] ?? '');
      $name = (string) ($r['name'] ?? '');
      if ($slug === '' || $name === '') {
        continue;
      }
      $existing = $termStorage->loadByProperties([
        'vid' => 'topics',
        'name' => $name,
      ]);
      $term = $existing ? reset($existing) : Term::create(['vid' => 'topics', 'name' => $name]);
      if (!$existing) {
        $term->save();
      }
      $slugToTid[$slug] = (int) $term->id();
    }
    return $slugToTid;
  }

  /**
   * @param array<int, array{title: string, body: string, topic?: string, themes?: string[]}> $records
   * @param array<string, int> $topicMap
   * @param string|null $themesKey  When set, read $r[$themesKey] as a list of slugs
   *                                 and write all matching tids onto field_world_sector
   *                                 (multi-value reference). NULL → single-value 'topic'.
   */
  private function upsertNodes(
    string $bundle,
    array $records,
    array $topicMap,
    ?string $themesKey,
  ): int {
    $nodeStorage = $this->entityTypeManager->getStorage('node');
    $count = 0;
    foreach ($records as $r) {
      $title = (string) ($r['title'] ?? '');
      $body  = (string) ($r['body'] ?? '');
      if ($title === '' || $body === '') {
        continue;
      }
      $existing = $nodeStorage->loadByProperties([
        'type' => $bundle,
        'title' => $title,
      ]);
      $node = $existing
        ? reset($existing)
        : Node::create([
            'type' => $bundle,
            'title' => $title,
            'uid' => 1,
            'status' => 1,
          ]);
      $node->set('body', ['value' => trim($body), 'format' => 'basic_html']);

      if ($themesKey !== NULL && isset($r[$themesKey]) && is_array($r[$themesKey])) {
        $refs = [];
        foreach ($r[$themesKey] as $slug) {
          $tid = $topicMap[(string) $slug] ?? NULL;
          if ($tid) {
            $refs[] = ['target_id' => $tid];
          }
        }
        $node->set('field_world_sector', $refs);
      }
      elseif (isset($r['topic'])) {
        $tid = $topicMap[(string) $r['topic']] ?? NULL;
        $node->set('field_world_sector', $tid ? [['target_id' => $tid]] : []);
      }
      $node->save();
      $count++;
    }
    return $count;
  }

  /**
   * Run the embed pipeline synchronously across the whole corpus.
   * Uses the Arc 1 batch-context API but iterates inline — fine for
   * a one-shot install where the corpus is ~30 entities.
   */
  private function runFullEmbedSync(): int {
    $ctx = $this->embedRunner->prepareBatchContext();
    $written = 0;
    foreach ($ctx['descriptors'] as $descriptorId) {
      if ($this->embedRunner->writeOneFromContext($ctx, $descriptorId)) {
        $written++;
      }
    }
    $this->embedRunner->finalizeBatch($ctx, $written, 0);
    return $written;
  }

}
