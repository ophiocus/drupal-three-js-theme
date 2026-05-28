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
 * Scope (v2.1):
 *   - `active_atmosphere` — top-level config write.
 *   - Tint keys (background, fog.color, ground.color) — *scope-aware*:
 *     when the active atmosphere is non-default, they write to
 *     `atmosphere_overrides.<active>.<key>` so an editor tuning "the
 *     forest's colors" updates the forest overlay, not the base; when
 *     the active atmosphere is `none`, they write to the base palette.
 *     The patch wire format stays flat (no `scope` field) — the server
 *     resolves the right destination per `active_atmosphere`.
 *
 * Add new keys (more tints, fog distances, world constants) by
 * extending {@see ALLOWED_KEYS} + {@see TINT_KEYS} and the
 * matching {@see validate()} branch.
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
  private const array ALLOWED_KEYS = [
    'active_atmosphere',
    'background',
    'fog.color',
    'ground.color',
  ];

  /**
   * Subset of {@see ALLOWED_KEYS} that are "tints" — scope-aware
   * color writes that target the active atmosphere's overlay (when
   * one is active) or the base palette (when 'none').
   */
  private const array TINT_KEYS = ['background', 'fog.color', 'ground.color'];

  /**
   * CSS hex color regex. Accepts #RGB or #RRGGBB, case-insensitive.
   * Deliberately strict — anything else gets rejected before it can
   * land in config (THREE.Color will silently coerce malformed values,
   * which makes "why is the world black?" a future debugging trap).
   */
  private const string HEX_COLOR_REGEX = '/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/';

  public function __construct(
    private readonly ConfigFactoryInterface $configFactory,
    private readonly LoggerChannelInterface $logger,
  ) {}

  /**
   * Apply a validated patch to `world_signature.palette`.
   *
   * Tint keys are scope-aware: their actual config path depends on
   * the *resulting* active atmosphere (i.e. the patch's
   * active_atmosphere if present, otherwise the current config
   * value). This makes "I'm editing the forest's background" do the
   * right thing without exposing the atmosphere_overrides path in
   * the wire format.
   *
   * @param array<string, mixed> $patch
   *   Map of patch keys → new values. Only keys in
   *   {@see ALLOWED_KEYS} are accepted; unknown keys throw.
   *
   * @return array{
   *   updated: string[],
   *   scope: string,
   *   palette: array<string, mixed>,
   * }
   *   - `updated`: the *config paths* (not patch keys) that actually
   *     changed value. Useful for clients to know what they
   *     produced.
   *   - `scope`: `'base'` when active is none, `'atmosphere:<name>'`
   *     otherwise — the layer the tints landed on.
   *   - `palette`: a small snapshot of the resulting palette keys
   *     the editor cares about.
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

    // The *resulting* active atmosphere drives where tints land. If
    // the patch changes it, use the new value; otherwise read the
    // current config. A patch that changes active_atmosphere AND
    // includes tints will land its tints on the NEW atmosphere's
    // overlay — which matches editorial intent ("switch to forest
    // and tune its background in one save").
    $resultingActive = isset($patch['active_atmosphere'])
      ? (string) $patch['active_atmosphere']
      : ((string) ($config->get('active_atmosphere') ?? 'none'));

    $updated = [];
    foreach ($patch as $key => $value) {
      $path = $this->resolveConfigPath($key, $resultingActive);
      if ($config->get($path) !== $value) {
        $config->set($path, $value);
        $updated[] = $path;
      }
    }
    if ($updated !== []) {
      $config->save();
      $this->logger->info(sprintf(
        'world_signature.palette updated: %s',
        implode(', ', $updated),
      ));
    }

    // Re-read for the post-save canonical view.
    $palette = $this->configFactory->get('world_signature.palette');
    $scope = $resultingActive === 'none' ? 'base' : ('atmosphere:' . $resultingActive);
    return [
      'updated' => $updated,
      'scope' => $scope,
      'palette' => $this->effectivePaletteSnapshot($palette, $resultingActive),
    ];
  }

  /**
   * Compute the config path for a patch key, given the resulting
   * active atmosphere. Top-level keys (`active_atmosphere`) go to
   * themselves; tints go to the overlay path when an atmosphere is
   * active, base otherwise.
   */
  private function resolveConfigPath(string $patchKey, string $active): string {
    if ($patchKey === 'active_atmosphere') {
      return $patchKey;
    }
    if (in_array($patchKey, self::TINT_KEYS, TRUE)) {
      if ($active === 'none' || $active === '') {
        return $patchKey;
      }
      return sprintf('atmosphere_overrides.%s.%s', $active, $patchKey);
    }
    // Should be unreachable — validate() and ALLOWED_KEYS guard this.
    throw new \LogicException("Unhandled patch key '{$patchKey}'.");
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
    foreach (self::TINT_KEYS as $key) {
      if (!array_key_exists($key, $patch)) {
        continue;
      }
      $value = $patch[$key];
      if (!is_string($value) || preg_match(self::HEX_COLOR_REGEX, $value) !== 1) {
        throw new \InvalidArgumentException(sprintf(
          '%s must be a CSS hex color (#rgb or #rrggbb).',
          $key,
        ));
      }
    }
  }

  /**
   * Read the effective palette values the editor cares about
   * (post-overlay) so the client can confirm what landed.
   *
   * @return array<string, mixed>
   */
  private function effectivePaletteSnapshot($palette, string $active): array {
    $get = static function (string $base) use ($palette, $active) {
      if ($active !== 'none' && $active !== '') {
        $overlay = $palette->get("atmosphere_overrides.{$active}.{$base}");
        if ($overlay !== NULL) {
          return $overlay;
        }
      }
      return $palette->get($base);
    };
    return [
      'active_atmosphere' => $palette->get('active_atmosphere'),
      'background' => $get('background'),
      'fog.color' => $get('fog.color'),
      'ground.color' => $get('ground.color'),
    ];
  }

}
