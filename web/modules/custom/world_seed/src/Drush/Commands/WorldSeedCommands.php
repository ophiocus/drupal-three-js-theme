<?php

declare(strict_types=1);

namespace Drupal\world_seed\Drush\Commands;

use Drupal\world_seed\Service\Seeder;
use Drupal\world_signature\Service\EmbedRunner;
use Drush\Commands\DrushCommands;

/**
 * Drush commands for the world_seed module.
 *
 * `drush world:seed`        — full bring-up (admin + authors + content + embed)
 * `drush world:seed:purge`  — wipe only the marker-stamped seed entities
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
   * pass at the end (skipped on gateway error with a warning).
   *
   * @command world:seed
   * @aliases ws
   *
   * @option skip-embed
   *   Skip the embed pass after seeding (useful in CI where the
   *   gateway isn't up yet).
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

    if ($options['skip-embed']) {
      $this->output()->writeln('Embed pass skipped (--skip-embed).');
      return DrushCommands::EXIT_SUCCESS;
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
    return DrushCommands::EXIT_SUCCESS;
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
