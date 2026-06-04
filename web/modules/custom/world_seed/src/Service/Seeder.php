<?php

declare(strict_types=1);

namespace Drupal\world_seed\Service;

use Drupal\Core\Extension\ExtensionPathResolver;
use Drupal\Core\Extension\ModuleHandlerInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\File\FileSystemInterface;
use Drupal\Core\Logger\LoggerChannelInterface;
use Drupal\Core\Password\PasswordGeneratorInterface;
use Drupal\node\Entity\Node;
use Drupal\taxonomy\Entity\Term;
use Drupal\taxonomy\Entity\Vocabulary;
use Drupal\user\Entity\User;

/**
 * One-stop bring-up: admin user, authors with bios + themes, sectors,
 * 100 articles, 15 events, 15 biographies. Idempotent — re-running
 * wipes previously seeded entities (marked via `seed_marker`) and
 * recreates them, so `drush world:seed` always lands in the same end
 * state.
 *
 * Marker strategy: every seeded entity gets a title-side handle
 * recorded against its UUID in the `world_seed.seed_state` Drupal
 * state. Purge reads that state and deletes by uuid, never by title
 * heuristic — so manually-authored content with overlapping titles
 * is safe.
 */
final class Seeder {

  private const STATE_KEY = 'world_seed.seed_state';

  /** Default admin username. */
  private const ADMIN_NAME = 'admin';

  public function __construct(
    private readonly EntityTypeManagerInterface $entityTypeManager,
    private readonly PasswordGeneratorInterface $passwordGenerator,
    private readonly ModuleHandlerInterface $moduleHandler,
    private readonly ExtensionPathResolver $pathResolver,
    private readonly FileSystemInterface $fileSystem,
    private readonly LoggerChannelInterface $logger,
  ) {}

  /**
   * Run a full seed pass. Idempotent — clears previously-seeded
   * entities first, then recreates from data/*.json.
   *
   * @return array{
   *   users: int,
   *   articles: int,
   *   events: int,
   *   profiles: int,
   *   sectors: int,
   *   admin_password: ?string,
   * }
   */
  public function run(): array {
    $this->purge();

    $modulePath = $this->pathResolver->getPath('module', 'world_seed');
    $dataDir = $modulePath . '/data';

    $admin = $this->ensureAdmin();
    // Spanish translations are loaded as parallel arrays (same index =
    // same entity, ES title/body). When the file is absent the seeder
    // falls back to English-only — never errors.
    $authorsEs = $this->maybeLoadJson($dataDir . '/authors_es.json');
    $articlesEs = $this->maybeLoadJson($dataDir . '/articles_es.json');
    $eventsEs = $this->maybeLoadJson($dataDir . '/events_es.json');
    $profilesEs = $this->maybeLoadJson($dataDir . '/profiles_es.json');

    $authors = $this->seedAuthors(
      $this->loadJson($dataDir . '/authors.json'),
      $authorsEs,
    );
    $sectorsEs = $this->maybeLoadJson($dataDir . '/sectors_es.json');
    $sectors = $this->seedSectors(
      $this->loadJson($dataDir . '/sectors.json'),
      $sectorsEs,
    );
    $articleCount = $this->seedArticles(
      $this->loadJson($dataDir . '/articles.json'),
      $articlesEs,
      $authors,
      $sectors,
    );
    $eventCount = $this->seedEvents(
      $this->loadJson($dataDir . '/events.json'),
      $eventsEs,
      $admin['uid'],
      $sectors,
    );
    $profileCount = $this->seedProfiles(
      $this->loadJson($dataDir . '/profiles.json'),
      $profilesEs,
      $admin['uid'],
      $sectors,
    );

    return [
      'users' => count($authors),
      'articles' => $articleCount,
      'events' => $eventCount,
      'profiles' => $profileCount,
      'sectors' => count($sectors),
      'admin_password' => $admin['password'],
    ];
  }

  /**
   * Purge previously-seeded entities. Reads {@see STATE_KEY} for the
   * list of UUIDs we created; deletes only those. Manually-authored
   * content is left intact.
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
        $entities = $storage->loadMultiple($ids);
        $storage->delete($entities);
      }
    }
    \Drupal::state()->delete(self::STATE_KEY);
  }

  // ─── pipeline steps ───────────────────────────────────────────────────────

  /**
   * Ensure an admin (uid=1) user. Creates if absent; leaves password
   * untouched if present. Returns {uid, password} where password is
   * NULL when the user already existed (we didn't reset it).
   */
  private function ensureAdmin(): array {
    $existing = $this->entityTypeManager
      ->getStorage('user')
      ->load(1);
    if ($existing instanceof User && $existing->id() == 1) {
      return ['uid' => 1, 'password' => NULL];
    }
    // Fresh-site path: create uid=1 with a generated password.
    $password = $this->passwordGenerator->generate(20);
    /** @var \Drupal\user\Entity\User $admin */
    $admin = User::create([
      'name' => self::ADMIN_NAME,
      'mail' => 'admin@example.test',
      'pass' => $password,
      'status' => 1,
    ]);
    $admin->save();
    return ['uid' => (int) $admin->id(), 'password' => $password];
  }

  /** Create author User entities, populate bio + themes, with Spanish
   *  bio translation when provided. */
  private function seedAuthors(array $records, array $esRecords = []): array {
    $handleToUid = [];
    $uuids = [];
    foreach ($records as $idx => $r) {
      $existing = user_load_by_name($r['handle']);
      if ($existing) {
        // Re-purpose the existing user (rare — purge should have cleaned).
        $existing->setEmail($r['email']);
        $user = $existing;
      }
      else {
        $user = User::create([
          'name' => $r['handle'],
          'mail' => $r['email'],
          'pass' => $this->passwordGenerator->generate(20),
          'status' => 1,
        ]);
      }
      // Populate display name + the bio/themes fields the module installs.
      // The user.user form has a "Full name" field via Drupal core's
      // "field_user_*" pattern — we go directly to the entity fields
      // we installed.
      if ($user->hasField('field_user_bio')) {
        $user->set('field_user_bio', [
          'value' => $r['bio'],
          'format' => 'basic_html',
        ]);
      }
      if ($user->hasField('field_user_themes')) {
        $user->set('field_user_themes', $r['themes']);
      }
      $user->save();

      // Spanish translation of the bio (themes don't translate — they're
      // semantic tags). User entity must be translatable; if it isn't
      // (no language module yet), the addTranslation call is silently
      // skipped by Drupal.
      $esBio = ($esRecords[$idx]['bio'] ?? '') ?: '';
      if ($esBio !== '' && $user->isTranslatable() && !$user->hasTranslation('es')) {
        try {
          $tr = $user->addTranslation('es', $user->toArray());
          if ($tr->hasField('field_user_bio')) {
            $tr->set('field_user_bio', ['value' => $esBio, 'format' => 'basic_html']);
          }
          $tr->save();
        }
        catch (\Throwable $e) {
          $this->logger->warning('User translation skipped for @h: @m', ['@h' => $r['handle'], '@m' => $e->getMessage()]);
        }
      }
      $handleToUid[$r['handle']] = (int) $user->id();
      $uuids[] = $user->uuid();
    }
    $this->stampUuids('user', $uuids);
    return $handleToUid;
  }

  /** Create sector terms in the topics vocabulary, with Spanish
   *  translations when available + the taxonomy is translatable. */
  private function seedSectors(array $records, array $esRecords = []): array {
    // Topics vocab is shipped by world_signature; create if missing.
    $vocab = Vocabulary::load('topics');
    if (!$vocab) {
      $vocab = Vocabulary::create([
        'vid' => 'topics',
        'name' => 'Regions',
        'description' => 'Sectors / regions of the world.',
      ]);
      $vocab->save();
    }
    // Build a slug → es-name map so a missing or reordered ES file
    // still matches by slug (not by index).
    $esBySlug = [];
    foreach ($esRecords as $er) {
      if (isset($er['slug'], $er['name'])) {
        $esBySlug[$er['slug']] = (string) $er['name'];
      }
    }
    $slugToTid = [];
    $uuids = [];
    foreach ($records as $r) {
      $term = Term::create([
        'vid' => 'topics',
        'name' => $r['name'],
      ]);
      $term->save();
      // Spanish translation of the term name. If the taxonomy isn't
      // translatable (config/optional didn't land for some reason),
      // addTranslation throws and we skip silently.
      $esName = $esBySlug[$r['slug']] ?? '';
      if ($esName !== '' && $term->isTranslatable() && !$term->hasTranslation('es')) {
        try {
          $tr = $term->addTranslation('es', $term->toArray());
          $tr->set('name', $esName);
          $tr->save();
        }
        catch (\Throwable $e) {
          $this->logger->warning('Term translation skipped for @s: @m', [
            '@s' => $r['slug'], '@m' => $e->getMessage(),
          ]);
        }
      }
      $slugToTid[$r['slug']] = (int) $term->id();
      $uuids[] = $term->uuid();
    }
    $this->stampUuids('taxonomy_term', $uuids);
    return $slugToTid;
  }

  /** Create article nodes, owned by their author handle, sector-tagged. */
  private function seedArticles(array $records, array $esRecords, array $authors, array $sectors): int {
    $uuids = [];
    foreach ($records as $idx => $r) {
      $uid = $authors[$r['author']] ?? 1;
      $tid = $sectors[$r['region']] ?? NULL;
      $node = Node::create([
        'type' => 'article',
        'title' => $r['title'],
        'uid' => $uid,
        'status' => 1,
        'body' => [
          'value' => $r['body'],
          'format' => 'basic_html',
        ],
        'field_world_sector' => $tid ? [['target_id' => $tid]] : [],
      ]);
      $node->save();
      $this->maybeAddSpanish($node, $esRecords[$idx] ?? NULL);
      $uuids[] = $node->uuid();
    }
    $this->stampUuids('node', $uuids);
    return count($uuids);
  }

  /** Create event nodes (system-authored). */
  private function seedEvents(array $records, array $esRecords, int $adminUid, array $sectors): int {
    $uuids = $this->stampedUuids('node');
    foreach ($records as $idx => $r) {
      $tid = $sectors[$r['region']] ?? NULL;
      $node = Node::create([
        'type' => 'event',
        'title' => $r['title'],
        'uid' => $adminUid,
        'status' => 1,
        'body' => [
          'value' => $r['body'],
          'format' => 'basic_html',
        ],
        'field_world_sector' => $tid ? [['target_id' => $tid]] : [],
      ]);
      $node->save();
      $this->maybeAddSpanish($node, $esRecords[$idx] ?? NULL);
      $uuids[] = $node->uuid();
    }
    $this->stampUuids('node', $uuids);
    return count($records);
  }

  /** Create profile nodes (biographies of real coffee people; system-authored). */
  private function seedProfiles(array $records, array $esRecords, int $adminUid, array $sectors): int {
    $uuids = $this->stampedUuids('node');
    foreach ($records as $idx => $r) {
      $tid = $sectors[$r['region']] ?? NULL;
      $node = Node::create([
        'type' => 'profile',
        'title' => $r['title'],
        'uid' => $adminUid,
        'status' => 1,
        'body' => [
          'value' => $r['body'],
          'format' => 'basic_html',
        ],
        'field_world_sector' => $tid ? [['target_id' => $tid]] : [],
      ]);
      $node->save();
      $this->maybeAddSpanish($node, $esRecords[$idx] ?? NULL);
      $uuids[] = $node->uuid();
    }
    $this->stampUuids('node', $uuids);
    return count($records);
  }

  /**
   * Add a Spanish translation to a freshly-saved node when the
   * translation record is present. Silent on failure — content
   * translation isn't a hard requirement for the seed to succeed,
   * but when language modules are enabled we get the i18n cleanly.
   */
  private function maybeAddSpanish($node, ?array $es): void {
    if (!is_array($es) || empty($es['title']) || empty($es['body'])) {
      return;
    }
    if (!$node->isTranslatable() || $node->hasTranslation('es')) {
      return;
    }
    try {
      $tr = $node->addTranslation('es', $node->toArray());
      $tr->set('title', $es['title']);
      $tr->set('body', ['value' => $es['body'], 'format' => 'basic_html']);
      $tr->save();
    }
    catch (\Throwable $e) {
      $this->logger->warning('Node translation skipped for nid=@n: @m', [
        '@n' => $node->id(), '@m' => $e->getMessage(),
      ]);
    }
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  /** Same as loadJson but returns [] when the file is missing. */
  private function maybeLoadJson(string $path): array {
    if (!is_readable($path)) {
      return [];
    }
    return $this->loadJson($path);
  }

  /** Load JSON file, decode, fail with a clear error. */
  private function loadJson(string $path): array {
    if (!is_readable($path)) {
      throw new \RuntimeException(sprintf('Seed file not readable: %s', $path));
    }
    $raw = file_get_contents($path);
    if ($raw === FALSE) {
      throw new \RuntimeException(sprintf('Seed file read failed: %s', $path));
    }
    try {
      $data = json_decode($raw, TRUE, 16, JSON_THROW_ON_ERROR);
    }
    catch (\JsonException $e) {
      throw new \RuntimeException(sprintf('Seed file %s: %s', $path, $e->getMessage()), 0, $e);
    }
    if (!is_array($data)) {
      throw new \RuntimeException(sprintf('Seed file %s: expected JSON array.', $path));
    }
    return $data;
  }

  /** Merge new UUIDs into the seed-marker state for a given entity type. */
  private function stampUuids(string $type, array $uuids): void {
    $state = \Drupal::state()->get(self::STATE_KEY, []);
    $state[$type] = array_values(array_unique(array_merge($state[$type] ?? [], $uuids)));
    \Drupal::state()->set(self::STATE_KEY, $state);
  }

  /** Read existing marker UUIDs for a type (used to append in seedEvents/Profiles). */
  private function stampedUuids(string $type): array {
    $state = \Drupal::state()->get(self::STATE_KEY, []);
    return $state[$type] ?? [];
  }

}
