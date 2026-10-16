<?php

declare(strict_types=1);

namespace Drupal\world_seed\Drush\Commands;

use Drupal\world_seed\Service\Seeder;
use Drupal\world_signature\Service\EmbedRunner;
use Drush\Commands\DrushCommands;

/**
 * Drush commands for the world_seed module.
 *
 * - `world:seed`: full bring-up (admin + authors + content + embed).
 * - `world:seed:purge`: wipe only the marker-stamped seed entities.
 * - `world:seed:pack <name>`: add an opt-in content pack (data/packs/).
 * - `world:seed:pack-purge <name>`: remove that pack's nodes.
 */
final class WorldSeedCommands extends DrushCommands {

  public function __construct(
    private readonly Seeder $seeder,
    private readonly EmbedRunner $embedRunner,
  ) {
    parent::__construct();
  }

  /**
   * Re-seed the site. Idempotent — clears previously seeded
   * entities first, then writes them again. Triggers an embed
   * pass at the end (skipped on error with a warning).
   *
   * @command world:seed
   * @aliases ws
   *
   * @option skip-embed
   *   Skip the embed pass after seeding (useful in CI where no
   *   embedding service is available).
   *
   * @usage drush world:seed
   *   Wipe and re-seed all canonical content.
   * @usage drush world:seed --skip-embed
   *   Re-seed but don't run the embed pass.
   */
  public function seed(array $options = ['skip-embed' => FALSE]): int {
    $this->output()->writeln('Running world seed…');
    $result = $this->seeder->run();
    $this->output()->writeln(sprintf(
      ' authors:  %d',
      $result['users'],
    ));
    $this->output()->writeln(sprintf(' sectors:  %d', $result['sectors']));
    $this->output()->writeln(sprintf(' articles: %d', $result['articles']));
    $this->output()->writeln(sprintf(' events:   %d', $result['events']));
    $this->output()->writeln(sprintf(' profiles: %d', $result['profiles']));
    if ($result['admin_password']) {
      $this->output()->writeln(sprintf(
        ' admin pw: %s   (uid=1; record now — not shown again)',
        $result['admin_password'],
      ));
    }

    $this->embed((bool) $options['skip-embed']);
    return DrushCommands::EXIT_SUCCESS;
  }

  /**
   * Seed an opt-in content pack from world_seed/data/packs/<name>.json.
   *
   * Idempotent — replaces the pack's previous nodes. Packs are tracked
   * apart from the canonical seed: world:seed:purge leaves them alone.
   *
   * @param string $name
   *   Pack file name without `.json`, e.g. `bakeoff-hard`.
   * @param array $options
   *   Drush options.
   *
   * @command world:seed:pack
   * @aliases wspk
   *
   * @option skip-embed
   *   Skip the embed pass after seeding.
   *
   * @usage drush world:seed:pack bakeoff-crosscut
   *   Add (or replace) the bakeoff-crosscut pack, then embed.
   */
  public function seedPack(string $name, array $options = ['skip-embed' => FALSE]): int {
    $counts = $this->seeder->seedPack($name);
    foreach ($counts as $bundle => $n) {
      $this->output()->writeln(sprintf(' %s: %d', $bundle, $n));
    }
    $this->embed((bool) $options['skip-embed']);
    return DrushCommands::EXIT_SUCCESS;
  }

  /**
   * Delete the nodes a content pack created.
   *
   * @param string $name
   *   Pack file name without `.json`.
   *
   * @command world:seed:pack-purge
   * @aliases wspkp
   */
  public function purgePack(string $name): int {
    $this->output()->writeln(sprintf(
      'Pack %s: %d nodes purged.',
      $name, $this->seeder->purgePack($name),
    ));
    return DrushCommands::EXIT_SUCCESS;
  }

  /**
   * Shared embed step: embed the corpus unless skipped.
   *
   * A store or provider failure is reported, not fatal.
   */
  private function embed(bool $skip): void {
    if ($skip) {
      $this->output()->writeln('Embed pass skipped (--skip-embed).');
      return;
    }
    try {
      $embed = $this->embedRunner->run();
      $this->output()->writeln(sprintf(
        'Embed pass: %d entities embedded (model %s).',
        $embed['embedded'], $embed['modelVersion'],
      ));
    }
    catch (\Throwable $e) {
      $this->output()->writeln('<comment>Embed pass skipped: ' . $e->getMessage() . '</comment>');
    }
  }

  /**
   * Wipe only the marker-stamped seed entities. Manually-authored
   * content is preserved.
   *
   * @command world:seed:purge
   * @aliases wsp
   */
  public function purge(): int {
    $this->seeder->purge();
    $this->output()->writeln('Seeded entities purged.');
    return DrushCommands::EXIT_SUCCESS;
  }

}
