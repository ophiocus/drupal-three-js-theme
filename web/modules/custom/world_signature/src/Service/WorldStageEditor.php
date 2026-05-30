<?php

declare(strict_types=1);

namespace Drupal\world_signature\Service;

use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Logger\LoggerChannelInterface;

/**
 * Phase 4 — in-canvas stage-fixture writer.
 *
 * Persists the Stage panel's placement edits (today: inner-mind's
 * zodiac) to `world_signature.stage` config. The snapshot ships the
 * active atmosphere's slice, so clients hydrate from the server
 * instead of relying on per-device localStorage.
 *
 * Per docs/TOOLBOX_AND_STAGE.md §2.1, "stage fixtures" is the
 * far-reaching background layer. Future layers (scenery rings,
 * monuments, ambient fixtures) add new {@see ALLOWED_LAYERS} entries
 * + per-layer validate branches.
 *
 * Snapshot cache busts automatically via the
 * `config:world_signature.stage` tag (added in SnapshotPublisher).
 */
final class WorldStageEditor {

  /**
   * Atmospheres a patch may target. Mirrors the allowed atmospheres
   * everywhere else — keep in sync when a skin is added.
   */
  public const array PROFILE_ATMOSPHERES = ['forest', 'inner-mind'];

  /**
   * Fixture layers an editor may patch. v0 ships only `zodiac`;
   * `scenery_rings`, `monuments`, etc. are future slices.
   */
  private const array ALLOWED_LAYERS = ['zodiac'];

  /** Sanity bound — guards against runaway clients. */
  private const int MAX_PLACEMENTS_PER_LAYER = 256;

  public function __construct(
    private readonly ConfigFactoryInterface $configFactory,
    private readonly LoggerChannelInterface $logger,
  ) {}

  /**
   * Replace the full placement list for one (atmosphere, layer).
   *
   * Placements are replace-all rather than merge: it's the natural
   * shape for a "12 signs all at once" UI, and the server doesn't
   * have to reconcile sparse index updates.
   *
   * @param string $atmosphere
   *   Target atmosphere.
   * @param string $layer
   *   Target layer (today: `zodiac`).
   * @param array<int, array<string, mixed>> $placements
   *   Indexed list of placements. Each entry is a partial map of
   *   {angle, height, scale} — all floats. Extra keys are stripped;
   *   missing keys default to 0.0.
   *
   * @return array{
   *   updated: bool,
   *   count: int,
   *   placements: array<int, array{angle: float, height: float, scale: float}>,
   * }
   *
   * @throws \InvalidArgumentException
   *   When the atmosphere/layer isn't allowed, or a placement entry
   *   is malformed.
   */
  public function applyPlacements(string $atmosphere, string $layer, array $placements): array {
    if (!in_array($atmosphere, self::PROFILE_ATMOSPHERES, TRUE)) {
      throw new \InvalidArgumentException(sprintf(
        'Unknown atmosphere "%s". Allowed: %s.',
        $atmosphere, implode(', ', self::PROFILE_ATMOSPHERES),
      ));
    }
    if (!in_array($layer, self::ALLOWED_LAYERS, TRUE)) {
      throw new \InvalidArgumentException(sprintf(
        'Unknown layer "%s". Allowed: %s.',
        $layer, implode(', ', self::ALLOWED_LAYERS),
      ));
    }
    if (count($placements) > self::MAX_PLACEMENTS_PER_LAYER) {
      throw new \InvalidArgumentException(sprintf(
        'Too many placements: %d > %d.',
        count($placements), self::MAX_PLACEMENTS_PER_LAYER,
      ));
    }

    $clean = [];
    foreach ($placements as $idx => $p) {
      if (!is_array($p)) {
        throw new \InvalidArgumentException(sprintf('Placement %d must be an object.', $idx));
      }
      $clean[] = [
        'angle' => $this->validateFloat($p, 'angle', $idx),
        'height' => $this->validateFloat($p, 'height', $idx),
        'scale' => $this->validateFloat($p, 'scale', $idx, min: 0.0),
      ];
    }

    $config = $this->configFactory->getEditable('world_signature.stage');
    $key = sprintf('placements.%s.%s', $atmosphere, $layer);
    $prior = $config->get($key);
    $updated = !is_array($prior) || $prior !== $clean;
    if ($updated) {
      $config->set($key, $clean)->save();
      $this->logger->info(sprintf(
        'world_signature.stage updated: atmosphere=%s layer=%s count=%d',
        $atmosphere, $layer, count($clean),
      ));
    }

    return [
      'updated' => $updated,
      'count' => count($clean),
      'placements' => $clean,
    ];
  }

  /**
   * Pull the (possibly numeric-string) value out of a placement,
   * coerce to float, optionally clamp to a minimum.
   */
  private function validateFloat(array $p, string $field, int $idx, ?float $min = NULL): float {
    if (!array_key_exists($field, $p)) {
      throw new \InvalidArgumentException(sprintf(
        'Placement %d: %s is missing.', $idx, $field,
      ));
    }
    $raw = $p[$field];
    if (!is_int($raw) && !is_float($raw) && !(is_string($raw) && is_numeric($raw))) {
      throw new \InvalidArgumentException(sprintf(
        'Placement %d: %s must be numeric.', $idx, $field,
      ));
    }
    $value = (float) $raw;
    if (!is_finite($value)) {
      throw new \InvalidArgumentException(sprintf(
        'Placement %d: %s must be finite.', $idx, $field,
      ));
    }
    if ($min !== NULL && $value < $min) {
      throw new \InvalidArgumentException(sprintf(
        'Placement %d: %s must be >= %.2f.', $idx, $field, $min,
      ));
    }
    return $value;
  }

}
