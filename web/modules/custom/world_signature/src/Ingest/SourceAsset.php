<?php

declare(strict_types=1);

namespace Drupal\world_signature\Ingest;

/**
 * A leechable asset resolved from a source reference — a download
 * URL plus the copyright metadata the ingestion pipeline needs to
 * create a faithful, legally-safe asset card.
 *
 * Adapters return one or more of these from resolve(). The provider
 * layer's job ends here: it has located the binary and captured its
 * provenance. The (future) leech → decompress → extract → card
 * pipeline consumes them.
 */
final class SourceAsset {

  /**
   * @param string $downloadUrl
   *   Direct URL to the binary or archive to leech.
   * @param string $format
   *   'glb' | 'gltf' | 'zip' | 'tar.gz' | … (lowercase, no dot).
   * @param string $title
   *   Human title for the asset card.
   * @param \Drupal\world_signature\Ingest\License $license
   *   Normalised licence — drives the live-promotion gate.
   * @param string $attribution
   *   Ready-to-display credit line (empty for CC0/PD).
   * @param string $author
   *   Author/creator name (may be empty).
   * @param string $sourceUrl
   *   Provenance: the page the asset came from.
   * @param string $packTitle
   *   Title of the pack/collection this asset belongs to.
   * @param array<int, array{url: string, name: string}> $extraFiles
   *   Companion files that must travel with $downloadUrl — e.g. a
   *   glTF's .bin + textures (Poly Haven). Empty for self-contained
   *   .glb. `name` is the path to preserve relative to the main file.
   * @param int|null $polycount
   *   Source polycount if the catalog reports it.
   * @param string|null $previewUrl
   *   Thumbnail/preview image URL if available.
   */
  public function __construct(
    public readonly string $downloadUrl,
    public readonly string $format,
    public readonly string $title,
    public readonly License $license,
    public readonly string $attribution = '',
    public readonly string $author = '',
    public readonly string $sourceUrl = '',
    public readonly string $packTitle = '',
    public readonly array $extraFiles = [],
    public readonly ?int $polycount = NULL,
    public readonly ?string $previewUrl = NULL,
  ) {}

  /**
   * Whether this asset, as resolved, could be auto-promoted to
   * `live` — i.e. its licence permits it AND, when attribution is
   * required, we actually captured a credit line. A missing credit
   * on a CC-BY asset is a publish blocker, not a silent omission.
   */
  public function isPublishable(): bool {
    if (!$this->license->permitsLivePromotion()) {
      return FALSE;
    }
    if ($this->license->requiresAttribution() && $this->attribution === '') {
      return FALSE;
    }
    return TRUE;
  }

}
