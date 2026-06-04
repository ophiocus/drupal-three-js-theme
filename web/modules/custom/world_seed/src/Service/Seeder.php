<?php

declare(strict_types=1);

namespace Drupal\world_seed\Service;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Extension\ExtensionPathResolver;
use Drupal\Core\Logger\LoggerChannelInterface;
use Drupal\Core\Password\PasswordGeneratorInterface;
use Drupal\node\Entity\Node;
use Drupal\taxonomy\Entity\Term;
use Drupal\taxonomy\Entity\Vocabulary;
use Drupal\user\Entity\User;

/**
 * One-stop bring-up: admin user, authors with bios + themes, sector
 * taxonomy, 100 articles, 15 events, 15 biographies — with Spanish
 * translations where the parallel `*_es.json` files supply them.
 *
 * Contract:
 * - Single entry point: {@see run()}.
 * - Idempotent: re-running clears previously-seeded entities (UUIDs
 *   tracked in Drupal state) and recreates them. Manually-authored
 *   content with overlapping titles is untouched.
 * - Fail-fast on missing English data; silent fallback when Spanish
 *   data or content_translation isn't available.
 */
final class Seeder {

  private const STATE_KEY = 'world_seed.seed_state';
  private const ADMIN_NAME = 'admin';

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly PasswordGeneratorInterface $passwordGenerator,
    private readonly ExtensionPathResolver $pathResolver,
    private readonly LoggerChannelInterface $logger,
  ) {}

  /**
   * Run a full seed pass. Always returns the same shape; the caller
   * (hook_install / drush command) formats it for output.
   *
   * @return array{
   *   users:    int,
   *   sectors:  int,
   *   articles: int,
   *   events:   int,
   *   profiles: int,
   *   admin_password: ?string,
   * }
   */
  public function run(): array {
    $this->purge();
    $dir = $this->pathResolver->getPath('module', 'world_seed') . '/data';

    // Load every data source up-front so a missing English file fails
    // before any partial state lands.
    $data = [
      'authors'   => $this->loadJson($dir . '/authors.json'),
      'sectors'   => $this->loadJson($dir . '/sectors.json'),
      'articles'  => $this->loadJson($dir . '/articles.json'),
      'events'    => $this->loadJson($dir . '/events.json'),
      'profiles'  => $this->loadJson($dir . '/profiles.json'),
      'authors_es'  => $this->loadJsonOptional($dir . '/authors_es.json'),
      'sectors_es'  => $this->loadJsonOptional($dir . '/sectors_es.json'),
      'articles_es' => $this->loadJsonOptional($dir . '/articles_es.json'),
      'events_es'   => $this->loadJsonOptional($dir . '/events_es.json'),
      'profiles_es' => $this->loadJsonOptional($dir . '/profiles_es.json'),
    ];

    $admin = $this->ensureAdmin();
    $authors = $this->seedAuthors($data['authors'], $data['authors_es']);
    $sectors = $this->seedSectors($data['sectors'], $data['sectors_es']);

    $articleCount = $this->seedNodes(
      bundle: 'article',
      records: $data['articles'],
      esRecords: $data['articles_es'],
      uidResolver: fn(array $r) => $authors[$r['author']] ?? $admin['uid'],
      sectors: $sectors,
    );
    $eventCount = $this->seedNodes(
      bundle: 'event',
      records: $data['events'],
      esRecords: $data['events_es'],
      uidResolver: fn() => $admin['uid'],
      sectors: $sectors,
    );
    $profileCount = $this->seedNodes(
      bundle: 'profile',
      records: $data['profiles'],
      esRecords: $data['profiles_es'],
      uidResolver: fn() => $admin['uid'],
      sectors: $sectors,
    );

    return [
      'users'    => count($authors),
      'sectors'  => count($sectors),
      'articles' => $articleCount,
      'events'   => $eventCount,
      'profiles' => $profileCount,
      'admin_password' => $admin['password'],
    ];
  }

  /**
   * Delete previously-seeded entities by UUID. Manually-authored
   * content (different UUIDs) is untouched.
   */
  public function purge(): void {
    $state = \Drupal::state()->get(self::STATE_KEY, []);
    foreach (['node', 'taxonomy_term', 'user'] as $type) {
      $uuids = $state[$type] ?? [];
      if ($uuids === []) {
        continue;
      }
      $storage = $this->entityTypeManager->getStorage($type);
      $ids = $storage->getQuery()
        ->accessCheck(FALSE)
        ->condition('uuid', $uuids, 'IN')
        ->execute();
      if ($ids !== []) {
        $storage->delete($storage->loadMultiple($ids));
      }
    }
    \Drupal::state()->delete(self::STATE_KEY);
  }

  // ─── pipeline steps ────────────────────────────────────────────────────────

  /** Ensure uid=1 exists. Returns {uid, password?} — password is set only
   *  on a fresh create. */
  private function ensureAdmin(): array {
    $existing = $this->entityTypeManager->getStorage('user')->load(1);
    if ($existing instanceof User) {
      return ['uid' => 1, 'password' => NULL];
    }
    $password = $this->passwordGenerator->generate(20);
    $admin = User::create([
      'name'   => self::ADMIN_NAME,
      'mail'   => 'admin@example.test',
      'pass'   => $password,
      'status' => 1,
    ]);
    $admin->save();
    return ['uid' => (int) $admin->id(), 'password' => $password];
  }

  /** Create author User entities; field_user_bio + field_user_themes.
   *  Spanish bio added when present and user.user is translatable. */
  private function seedAuthors(array $records, array $esRecords): array {
    $handleToUid = [];
    $uuids = [];
    foreach ($records as $idx => $r) {
      $user = User::create([
        'name'   => $r['handle'],
        'mail'   => $r['email'],
        'pass'   => $this->passwordGenerator->generate(20),
        'status' => 1,
      ]);
      $user->set('field_user_bio', ['value' => $r['bio'], 'format' => 'basic_html']);
      $user->set('field_user_themes', $r['themes']);
      $user->save();

      $this->addEsTranslation(
        $user,
        bio: $esRecords[$idx]['bio'] ?? '',
        fields: ['field_user_bio' => ['value' => $esRecords[$idx]['bio'] ?? '', 'format' => 'basic_html']],
      );

      $handleToUid[$r['handle']] = (int) $user->id();
      $uuids[] = $user->uuid();
    }
    $this->stampUuids('user', $uuids);
    return $handleToUid;
  }

  /** Create sector terms in the `topics` vocabulary. Spanish name
   *  added when present and taxonomy is translatable. */
  private function seedSectors(array $records, array $esRecords): array {
    if (!Vocabulary::load('topics')) {
      // world_signature ships the vocab; if it's missing we're in a
      // very broken install — surface the misconfiguration, don't paper.
      throw new \RuntimeException(
        'taxonomy.vocabulary.topics is missing. Did world_signature install cleanly?'
      );
    }
    $esBySlug = [];
    foreach ($esRecords as $er) {
      if (isset($er['slug'], $er['name'])) {
        $esBySlug[$er['slug']] = (string) $er['name'];
      }
    }
    $termStorage = $this->entityTypeManager->getStorage('taxonomy_term');
    $slugToTid = [];
    $uuids = [];
    foreach ($records as $r) {
      // Reuse an existing term with the same name if one is already
      // present in the topics vocab — different bring-up paths
      // (this module, the legacy scaffold script, manual editorial
      // creation) can all reasonably have minted "Antigua, Guatemala"
      // once already. Without this guard the renderer would draw a
      // duplicate sector ring slice per duplicate term.
      $existing = $termStorage->loadByProperties([
        'vid' => 'topics',
        'name' => $r['name'],
      ]);
      $term = $existing ? reset($existing) : Term::create(['vid' => 'topics', 'name' => $r['name']]);
      if (!$existing) {
        $term->save();
      }
      $this->addEsTranslation(
        $term,
        bio: $esBySlug[$r['slug']] ?? '',
        fields: ['name' => $esBySlug[$r['slug']] ?? ''],
      );
      $slugToTid[$r['slug']] = (int) $term->id();
      $uuids[] = $term->uuid();
    }
    $this->stampUuids('taxonomy_term', $uuids);
    return $slugToTid;
  }

  /**
   * Create nodes of a given bundle from a records array, with Spanish
   * translations when the parallel array supplies them.
   *
   * @param string $bundle
   *   Content-type machine name (article / event / profile).
   * @param array<int, array{title: string, body: string, region?: string}> $records
   * @param array<int, array{title: string, body: string}> $esRecords
   * @param callable(array): int $uidResolver
   *   Decides who owns each created node — articles use their author,
   *   events + profiles use uid=1 (the editorial principle: bylines
   *   for opinion writing, system author for factual descriptions).
   * @param array<string, int> $sectors
   *   slug → tid map for field_world_sector.
   */
  private function seedNodes(
    string $bundle,
    array $records,
    array $esRecords,
    callable $uidResolver,
    array $sectors,
  ): int {
    $uuids = [];
    foreach ($records as $idx => $r) {
      $tid = $sectors[$r['region'] ?? ''] ?? NULL;
      $node = Node::create([
        'type'   => $bundle,
        'title'  => $r['title'],
        'uid'    => $uidResolver($r),
        'status' => 1,
        'body'   => ['value' => $r['body'], 'format' => 'basic_html'],
        'field_world_sector' => $tid ? [['target_id' => $tid]] : [],
      ]);
      $node->save();

      $es = $esRecords[$idx] ?? NULL;
      if (is_array($es) && !empty($es['title']) && !empty($es['body'])) {
        $this->addEsTranslation(
          $node,
          bio: $es['title'],   // marker — non-empty triggers the add
          fields: [
            'title' => $es['title'],
            'body'  => ['value' => $es['body'], 'format' => 'basic_html'],
          ],
        );
      }
      $uuids[] = $node->uuid();
    }
    $this->stampUuids('node', $uuids);
    return count($records);
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  /**
   * Add a Spanish translation to a freshly-saved content entity.
   * Silent fallback when the entity's bundle isn't translatable or
   * the `bio` marker is empty (no ES data for this record).
   *
   * Uses ContentTranslationManager directly rather than
   * $entity->isTranslatable() — the entity-cache view of translatability
   * lags fresh `config/optional/language.content_settings.*.yml`
   * imports during hook_install, so a brand-new install would otherwise
   * skip translations on the first seed pass. The manager reads the
   * config directly and is correct at install time.
   *
   * @param ContentEntityInterface $entity
   * @param string $bio
   *   Non-empty signal that an ES record exists. Empty → skip.
   * @param array<string, mixed> $fields
   *   Drupal field setter map applied to the new translation revision.
   */
  private function addEsTranslation(ContentEntityInterface $entity, string $bio, array $fields): void {
    if ($bio === '' || $entity->hasTranslation('es')) {
      return;
    }
    $mgr = \Drupal::service('content_translation.manager');
    if (!$mgr->isEnabled($entity->getEntityTypeId(), $entity->bundle())) {
      return;
    }
    try {
      $tr = $entity->addTranslation('es', $entity->toArray());
      foreach ($fields as $field => $value) {
        if ($tr->hasField($field)) {
          $tr->set($field, $value);
        }
      }
      $tr->save();
    }
    catch (\Throwable $e) {
      $this->logger->warning(
        'ES translation skipped for @t=@id: @m',
        ['@t' => $entity->getEntityTypeId(), '@id' => $entity->id(), '@m' => $e->getMessage()],
      );
    }
  }

  /** Load required JSON; fail loudly when the file is missing
   *  (this is data the module ships — its absence means a broken install). */
  private function loadJson(string $path): array {
    if (!is_readable($path)) {
      throw new \RuntimeException(sprintf('Seed file missing: %s', $path));
    }
    return $this->decode($path);
  }

  /** Load optional JSON; return [] when missing. */
  private function loadJsonOptional(string $path): array {
    return is_readable($path) ? $this->decode($path) : [];
  }

  private function decode(string $path): array {
    try {
      $data = json_decode(file_get_contents($path) ?: '', TRUE, 16, JSON_THROW_ON_ERROR);
    }
    catch (\JsonException $e) {
      throw new \RuntimeException("Invalid JSON in $path: " . $e->getMessage(), 0, $e);
    }
    if (!is_array($data)) {
      throw new \RuntimeException("Expected JSON array in $path");
    }
    return $data;
  }

  /** Append UUIDs to the marker state for a given entity type. */
  private function stampUuids(string $type, array $uuids): void {
    $state = \Drupal::state()->get(self::STATE_KEY, []);
    $state[$type] = array_values(array_unique(array_merge($state[$type] ?? [], $uuids)));
    \Drupal::state()->set(self::STATE_KEY, $state);
  }

}
