<?php

declare(strict_types=1);

namespace Drupal\world_signature\Ingest;

/**
 * A source adapter resolves a *reference* (a URL, or a
 * `scheme:id` shorthand like `polyhaven:ArmChair_01`) into one or
 * more leechable SourceAssets carrying download URL + copyright
 * metadata.
 *
 * The "thin provider layer": each free-asset source plugs in as one
 * of these without the ingestion pipeline knowing anything about
 * that source's API. Adapters are tagged `world_signature.source_adapter`
 * and ordered by priority; the manager picks the first that
 * supports() a given reference (DirectUrlAdapter is the lowest-
 * priority catch-all).
 *
 * See docs/feature-requests/asset-ingestion-sources.md for the
 * researched API contracts each adapter implements.
 */
interface SourceAdapterInterface {

  /** Machine id, e.g. "polyhaven". Surfaces in logs + diagnostics. */
  public function id(): string;

  /**
   * Whether this adapter handles the given reference. Catalog
   * adapters match their `scheme:` prefix and their domain; the
   * DirectUrl fallback matches any http(s) URL at lowest priority.
   */
  public function supports(string $ref): bool;

  /**
   * Resolve the reference to leechable assets + metadata. May return
   * many (a pack reference expands to its members) or one. Throws
   * \RuntimeException on a hard failure (network, missing API key,
   * malformed response) so the caller can report it per-reference.
   *
   * @return \Drupal\world_signature\Ingest\SourceAsset[]
   */
  public function resolve(string $ref): array;

}
