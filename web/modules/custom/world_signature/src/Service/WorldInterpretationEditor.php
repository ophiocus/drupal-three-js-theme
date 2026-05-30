<?php

declare(strict_types=1);

namespace Drupal\world_signature\Service;

use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Logger\LoggerChannelInterface;

/**
 * Phase 3 v3 — in-canvas interpretation-rules writer.
 *
 * The Stage panel's "Interpretation" section calls
 * `PATCH /world/edit/interpretation` to persist edits to the anchor
 * axes (per docs/INTERPRETATION_ENGINE.md §3, §4).
 *
 * Why a separate editor from {@see WorldConfigEditor}: the
 * interpretation patch shape is structured (an indexed array of
 * axes, each with name/pole_a/pole_b prose), not the flat
 * key→scalar shape palette uses. Conflating them would mean either
 * exposing internal config paths in the wire format or one editor
 * holding two protocols. Cleaner to keep one editor per layer.
 *
 * Snapshot cache invariant: the snapshot carries
 * `config:world_signature.interpretation` (added in
 * SnapshotPublisher), so editing this config busts the snapshot
 * automatically — same pattern as palette.
 *
 * Activation note: as of v3.0 the client doesn't yet *project*
 * against authored poles (the dev TF-IDF embedding makes anchored
 * axes weak; see INTERPRETATION_ENGINE.md §3 "Honest limits"). The
 * editor stores authorial intent; activation lands when the server-
 * side anchored projector + pole embedding are wired up. A POST to
 * /world/admin/embed regenerates the corpus embeddings, but pole
 * embeddings are a separate slice.
 */
final class WorldInterpretationEditor {

  /**
   * Atmospheres a patch may target. Mirrors
   * {@see WorldConfigEditor::ALLOWED_ATMOSPHERES}, minus 'none' —
   * the `none` atmosphere has no interpretation profile by design
   * (it's the "configure me" blockout state).
   */
  public const array PROFILE_ATMOSPHERES = ['forest', 'inner-mind'];

  /**
   * Field keys an axis carries. Patches must target one of these.
   */
  private const array AXIS_FIELDS = ['name', 'pole_a', 'pole_b'];

  /** Soft limit on prose-pole length; the editor truncates UX-side. */
  private const int POLE_MAX_LEN = 280;

  /** Soft limit on axis-name length. */
  private const int NAME_MAX_LEN = 80;

  public function __construct(
    private readonly ConfigFactoryInterface $configFactory,
    private readonly LoggerChannelInterface $logger,
  ) {}

  /**
   * Apply a patch to one atmosphere's interpretation profile.
   *
   * @param string $atmosphere
   *   Which atmosphere's profile to edit. Must be in
   *   {@see PROFILE_ATMOSPHERES}.
   * @param array<int, array<string, mixed>> $axisPatches
   *   Indexed array; each entry is a partial axis map keyed by a
   *   subset of {@see AXIS_FIELDS}. Index 0 patches the first axis,
   *   1 the second, etc. Any axis the patch doesn't touch is left
   *   alone.
   *
   * @return array{
   *   updated: array<int, string[]>,
   *   axes: array<int, array{name: string, pole_a: string, pole_b: string}>,
   * }
   *   - `updated`: per-axis array of field names that changed.
   *   - `axes`: the resulting axis array, post-save.
   *
   * @throws \InvalidArgumentException
   *   When the atmosphere isn't allowed, the patch shape is invalid,
   *   or any individual field fails validation.
   */
  public function apply(string $atmosphere, array $axisPatches): array {
    if (!in_array($atmosphere, self::PROFILE_ATMOSPHERES, TRUE)) {
      throw new \InvalidArgumentException(sprintf(
        'Unknown atmosphere "%s". Allowed: %s.',
        $atmosphere,
        implode(', ', self::PROFILE_ATMOSPHERES),
      ));
    }
    if ($axisPatches === []) {
      throw new \InvalidArgumentException('Empty axis patch.');
    }
    foreach ($axisPatches as $idx => $patch) {
      if (!is_int($idx) || $idx < 0) {
        throw new \InvalidArgumentException('Axis patch indices must be non-negative integers.');
      }
      if (!is_array($patch)) {
        throw new \InvalidArgumentException(sprintf('Axis %d patch must be an object.', $idx));
      }
      $unknown = array_diff(array_keys($patch), self::AXIS_FIELDS);
      if ($unknown !== []) {
        throw new \InvalidArgumentException(sprintf(
          'Axis %d: unknown field(s) %s. Allowed: %s.',
          $idx,
          implode(', ', $unknown),
          implode(', ', self::AXIS_FIELDS),
        ));
      }
      foreach ($patch as $field => $value) {
        $this->validateField((string) $field, $value, $idx);
      }
    }

    $config = $this->configFactory->getEditable('world_signature.interpretation');
    $profiles = $config->get('profiles') ?? [];
    if (!is_array($profiles)) {
      $profiles = [];
    }
    $profile = $profiles[$atmosphere] ?? [];
    if (!is_array($profile)) {
      $profile = [];
    }
    $axes = is_array($profile['axes'] ?? NULL) ? $profile['axes'] : [];

    $updated = [];
    foreach ($axisPatches as $idx => $patch) {
      $current = is_array($axes[$idx] ?? NULL) ? $axes[$idx] : [
        'name' => '',
        'pole_a' => '',
        'pole_b' => '',
      ];
      $changed = [];
      foreach ($patch as $field => $value) {
        if (($current[$field] ?? NULL) !== $value) {
          $current[$field] = $value;
          $changed[] = (string) $field;
        }
      }
      $axes[$idx] = $current;
      if ($changed !== []) {
        $updated[$idx] = $changed;
      }
    }

    if ($updated !== []) {
      $profile['axes'] = array_values($axes);
      // Phase 3 v3 polish — stamp the edit time so the snapshot can
      // ship `interpretation.updatedAt` and the client can surface
      // "poles stale, re-embed needed" when this advances past
      // `interpretationAxes.embeddedAt`.
      $profile['updated_at'] = time();
      $profiles[$atmosphere] = $profile;
      $config->set('profiles', $profiles);
      $config->save();
      $this->logger->info(sprintf(
        'world_signature.interpretation updated: atmosphere=%s axes=%s',
        $atmosphere,
        implode('; ', array_map(
          static fn(int $i, array $fields) => sprintf('axis_%d:[%s]', $i, implode(',', $fields)),
          array_keys($updated),
          $updated,
        )),
      ));
    }

    // Re-read for the canonical post-save view.
    $reloaded = $this->configFactory->get('world_signature.interpretation');
    $finalProfiles = $reloaded->get('profiles') ?? [];
    $finalAxes = [];
    foreach (($finalProfiles[$atmosphere]['axes'] ?? []) as $a) {
      $finalAxes[] = [
        'name' => (string) ($a['name'] ?? ''),
        'pole_a' => (string) ($a['pole_a'] ?? ''),
        'pole_b' => (string) ($a['pole_b'] ?? ''),
      ];
    }
    return [
      'updated' => $updated,
      'axes' => $finalAxes,
    ];
  }

  private function validateField(string $field, mixed $value, int $axisIdx): void {
    if (!is_string($value)) {
      throw new \InvalidArgumentException(sprintf(
        'Axis %d: %s must be a string.', $axisIdx, $field,
      ));
    }
    $trimmed = trim($value);
    if ($trimmed === '') {
      throw new \InvalidArgumentException(sprintf(
        'Axis %d: %s must not be empty.', $axisIdx, $field,
      ));
    }
    $max = $field === 'name' ? self::NAME_MAX_LEN : self::POLE_MAX_LEN;
    if (mb_strlen($value) > $max) {
      throw new \InvalidArgumentException(sprintf(
        'Axis %d: %s exceeds %d characters.', $axisIdx, $field, $max,
      ));
    }
  }

}
