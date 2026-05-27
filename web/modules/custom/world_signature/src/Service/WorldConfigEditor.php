<?php

declare(strict_types=1);

namespace Drupal\world_signature\Service;

use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Logger\LoggerChannelInterface;

/**
 * Phase 3 v2 — in-canvas world-config writer.
 *
 * The Stage panel's "World defaults" section calls
 * `PATCH /world/edit/config` to persist editorial choices the HUD
 * pill can only preview (per docs/TOOLBOX_AND_STAGE.md §2.3:
 * preview = in-memory; save = canonical Drupal sink).
 *
 * This service is the canonical-sink half: validates the patch and
 * writes the surviving keys to the `world_signature.palette`
 * config. The snapshot already carries the
 * `config:world_signature.palette` cache tag, so Drupal busts the
 * snapshot cache automatically when the config saves — no manual
 * invalidation needed (contrast EmbedRunner, which writes State
 * and must invalidate by hand).
 *
 * v2 scope: just `active_atmosphere`. Add new keys (palette tints,
 * fog, world constants) by extending {@see ALLOWED_KEYS} and
 * {@see validate()} — same template; no shape changes elsewhere.
 */
final class WorldConfigEditor {

  /**
   * Atmospheres a patch may select. Mirrors
   * WorldController::ATMOSPHERE_HINTS and
   * field_world_atmosphere's allowed_values. Keep in sync when
   * a skin is added.
   */
  public const array ALLOWED_ATMOSPHERES = ['none', 'forest', 'inner-mind'];

  /**
   * Whitelist of patch keys this service knows how to write. Any
   * key outside this set is rejected — patches are explicit; no
   * silent ignores.
   */
  private const array ALLOWED_KEYS = ['active_atmosphere'];

  public function __construct(
    private readonly ConfigFactoryInterface $configFactory,
    private readonly LoggerChannelInterface $logger,
  ) {}

  /**
   * Apply a validated patch to `world_signature.palette`.
   *
   * @param array<string, mixed> $patch
   *   Map of config keys → new values. Only keys in
   *   {@see ALLOWED_KEYS} are accepted; unknown keys throw.
   *
   * @return array{
   *   updated: string[],
   *   palette: array<string, mixed>,
   * }
   *   The list of keys that actually changed value, plus the
   *   resulting (partial) palette snapshot for the keys the
   *   editor cares about.
   *
   * @throws \InvalidArgumentException
   *   When the patch contains unknown keys or invalid values.
   */
  public function apply(array $patch): array {
    if ($patch === []) {
      throw new \InvalidArgumentException('Empty patch.');
    }

    $unknown = array_diff(array_keys($patch), self::ALLOWED_KEYS);
    if ($unknown !== []) {
      throw new \InvalidArgumentException(sprintf(
        'Unknown config key(s): %s. Allowed: %s.',
        implode(', ', $unknown),
        implode(', ', self::ALLOWED_KEYS),
      ));
    }

    $this->validate($patch);

    $config = $this->configFactory->getEditable('world_signature.palette');
    $updated = [];
    foreach ($patch as $key => $value) {
      if ($config->get($key) !== $value) {
        $config->set($key, $value);
        $updated[] = $key;
      }
    }
    if ($updated !== []) {
      $config->save();
      $this->logger->info(sprintf(
        'world_signature.palette updated: %s',
        implode(', ', $updated),
      ));
    }

    // Re-read to get the post-save canonical view.
    $palette = $this->configFactory->get('world_signature.palette');
    return [
      'updated' => $updated,
      'palette' => [
        'active_atmosphere' => $palette->get('active_atmosphere'),
      ],
    ];
  }

  /**
   * Type/range checks per key. Keep additions narrow — patches go
   * straight to a live config object.
   *
   * @throws \InvalidArgumentException
   */
  private function validate(array $patch): void {
    if (array_key_exists('active_atmosphere', $patch)) {
      $value = $patch['active_atmosphere'];
      if (!is_string($value) || !in_array($value, self::ALLOWED_ATMOSPHERES, TRUE)) {
        throw new \InvalidArgumentException(sprintf(
          'active_atmosphere must be one of: %s.',
          implode(', ', self::ALLOWED_ATMOSPHERES),
        ));
      }
    }
  }

}
