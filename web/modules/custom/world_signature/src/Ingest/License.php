<?php

declare(strict_types=1);

namespace Drupal\world_signature\Ingest;

/**
 * Normalised licence + the rules that decide what may happen to an
 * asset under it.
 *
 * Copyright metadata is the whole point of the ingestion provider
 * layer: every SourceAsset carries one of these so the downstream
 * "mark live" gate can refuse anything that isn't safe to publish.
 * The rule of thumb encoded here: an asset may only be promoted to
 * `live` when its licence is KNOWN, COMMERCIAL-SAFE, and permits
 * DERIVATIVES (we transform/curate, so no-derivatives is out).
 */
final class License {

  // Canonical codes.
  public const string CC0 = 'CC0';
  public const string CC_BY = 'CC-BY';
  public const string CC_BY_SA = 'CC-BY-SA';
  public const string CC_BY_ND = 'CC-BY-ND';
  public const string CC_BY_NC = 'CC-BY-NC';
  public const string CC_BY_NC_SA = 'CC-BY-NC-SA';
  public const string CC_BY_NC_ND = 'CC-BY-NC-ND';
  public const string OGA_BY = 'OGA-BY';
  public const string GPL = 'GPL';
  public const string LGPL = 'LGPL';
  public const string PD = 'PD';
  public const string UNKNOWN = 'UNKNOWN';

  public function __construct(
    public readonly string $code,
    public readonly string $raw,
  ) {}

  /**
   * Parse a free-text licence string into a canonical License.
   * Order matters: check the most-restrictive (NC/ND) spellings
   * before the looser ones, since "CC-BY-NC-SA" contains "CC-BY".
   */
  public static function fromRaw(string $raw): self {
    $s = strtolower(trim($raw));
    // Collapse separators so "cc by nc sa", "cc-by-nc-sa",
    // "ccbyncsa" all match.
    $n = preg_replace('/[\s._]+/', '-', $s) ?? $s;

    $map = static fn(string $code) => new self($code, $raw);

    if ($s === '' ) {
      return $map(self::UNKNOWN);
    }
    // Public domain / CC0 family.
    if (str_contains($n, 'cc0') || str_contains($s, 'public-domain')
      || str_contains($s, 'public domain') || str_contains($s, 'creative-commons-zero')
      || str_contains($s, 'creative commons zero') || $n === 'pd' || $n === 'cc-pd') {
      return $map(self::CC0);
    }
    if (str_contains($n, 'unlicense') || str_contains($n, 'wtfpl')) {
      return $map(self::PD);
    }
    // Creative Commons — most restrictive first.
    if (str_contains($n, 'nc') && str_contains($n, 'nd') && str_contains($n, 'by')) {
      return $map(self::CC_BY_NC_ND);
    }
    if (str_contains($n, 'nc') && str_contains($n, 'sa') && str_contains($n, 'by')) {
      return $map(self::CC_BY_NC_SA);
    }
    if (str_contains($n, 'nc') && str_contains($n, 'by')) {
      return $map(self::CC_BY_NC);
    }
    if (str_contains($n, 'nd') && str_contains($n, 'by')) {
      return $map(self::CC_BY_ND);
    }
    if (str_contains($n, 'sa') && str_contains($n, 'by')) {
      return $map(self::CC_BY_SA);
    }
    if (str_contains($n, 'oga-by') || str_contains($n, 'ogaby')) {
      return $map(self::OGA_BY);
    }
    if (str_contains($n, 'by') && str_contains($s, 'cc')) {
      return $map(self::CC_BY);
    }
    // Copyleft software licences (some asset packs ship under these).
    if (str_contains($n, 'lgpl')) {
      return $map(self::LGPL);
    }
    if (str_contains($n, 'gpl')) {
      return $map(self::GPL);
    }
    return $map(self::UNKNOWN);
  }

  public function isKnown(): bool {
    return $this->code !== self::UNKNOWN;
  }

  /** True unless the licence forbids commercial use (NC variants). */
  public function isCommercialSafe(): bool {
    return $this->isKnown() && !str_contains($this->code, 'NC');
  }

  /** True when downstream use must credit the author (anything but CC0/PD). */
  public function requiresAttribution(): bool {
    return match ($this->code) {
      self::CC0, self::PD => FALSE,
      self::UNKNOWN => FALSE,
      default => TRUE,
    };
  }

  /** True when the licence forbids derivative works (ND variants). */
  public function forbidsDerivatives(): bool {
    return str_contains($this->code, 'ND');
  }

  /**
   * The gate. An asset may be promoted to `live` only when its
   * licence is known, allows commercial use, and allows derivatives
   * (curation/transformation produces a derivative). Unknown licences
   * are never auto-promotable — a human must resolve them first.
   */
  public function permitsLivePromotion(): bool {
    return $this->isKnown()
      && $this->isCommercialSafe()
      && !$this->forbidsDerivatives();
  }

}
