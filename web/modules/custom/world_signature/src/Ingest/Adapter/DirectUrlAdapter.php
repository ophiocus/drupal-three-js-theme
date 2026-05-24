<?php

declare(strict_types=1);

namespace Drupal\world_signature\Ingest\Adapter;

use Drupal\world_signature\Ingest\License;
use Drupal\world_signature\Ingest\SourceAdapterInterface;
use Drupal\world_signature\Ingest\SourceAsset;

/**
 * Catch-all adapter: any direct http(s) URL to a file/archive.
 *
 * Lowest priority — it runs only when no catalog adapter claimed
 * the reference. Because a bare URL carries no licence information,
 * the resolved asset's licence is UNKNOWN: the human who supplied
 * the URL must confirm the licence before it can be promoted to
 * `live` (the SourceAsset::isPublishable gate enforces this).
 *
 * This is the adapter behind "feed the leecher a direct URL by
 * hand" for Quaternius / Kenney / OpenGameArt / itch / glTF-Sample-
 * Assets — sources that are leechable but expose no metadata API.
 */
final class DirectUrlAdapter implements SourceAdapterInterface {

  public function id(): string {
    return 'direct';
  }

  public function supports(string $ref): bool {
    return (bool) preg_match('#^https?://#i', $ref);
  }

  public function resolve(string $ref): array {
    $path = (string) parse_url($ref, PHP_URL_PATH);
    $base = $path !== '' ? basename($path) : 'download';
    $format = $this->formatFromName($base);
    $title = $this->titleFromName($base);
    return [
      new SourceAsset(
        downloadUrl: $ref,
        format: $format,
        title: $title,
        // No metadata on a bare URL — licence must be confirmed by a
        // human. UNKNOWN blocks live-promotion by construction.
        license: new License(License::UNKNOWN, ''),
        attribution: '',
        author: '',
        sourceUrl: $ref,
        packTitle: '',
      ),
    ];
  }

  private function formatFromName(string $name): string {
    $lower = strtolower($name);
    foreach (['tar.gz', 'tar.bz2'] as $compound) {
      if (str_ends_with($lower, '.' . $compound)) {
        return $compound;
      }
    }
    $ext = pathinfo($lower, PATHINFO_EXTENSION);
    return $ext !== '' ? $ext : 'bin';
  }

  private function titleFromName(string $name): string {
    $stem = pathinfo($name, PATHINFO_FILENAME);
    $stem = str_replace(['_', '-'], ' ', $stem);
    return ucwords(trim($stem)) ?: 'Imported asset';
  }

}
