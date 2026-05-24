<?php

declare(strict_types=1);

namespace Drupal\Tests\world_signature\Unit;

use Drupal\world_signature\Ingest\Adapter\DirectUrlAdapter;
use Drupal\world_signature\Ingest\License;
use Drupal\world_signature\Ingest\SourceAdapterInterface;
use Drupal\world_signature\Ingest\SourceAdapterManager;
use Drupal\world_signature\Ingest\SourceAsset;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\TestCase;

/**
 * Asset-ingestion provider layer — pure-PHP unit suite.
 *
 * Covers the copyright gate (License + SourceAsset::isPublishable),
 * the catch-all DirectUrlAdapter, and the manager's priority-ordered
 * adapter selection. No Drupal bootstrap, no network.
 */
#[CoversClass(License::class)]
#[CoversClass(SourceAsset::class)]
#[CoversClass(DirectUrlAdapter::class)]
#[CoversClass(SourceAdapterManager::class)]
#[Group('world_signature')]
final class IngestProviderTest extends TestCase {

  // ── Licence normalisation ───────────────────────────────────────

  public function testNormalisesCommonSpellings(): void {
    $this->assertSame(License::CC0, License::fromRaw('CC0')->code);
    $this->assertSame(License::CC0, License::fromRaw('cc0 1.0 universal')->code);
    $this->assertSame(License::CC0, License::fromRaw('Public Domain')->code);
    $this->assertSame(License::CC_BY, License::fromRaw('CC-BY 4.0')->code);
    $this->assertSame(License::CC_BY_SA, License::fromRaw('cc by sa')->code);
    $this->assertSame(License::CC_BY_NC, License::fromRaw('CC-BY-NC')->code);
    $this->assertSame(License::CC_BY_NC_SA, License::fromRaw('cc-by-nc-sa')->code);
    $this->assertSame(License::CC_BY_ND, License::fromRaw('CC BY ND')->code);
    $this->assertSame(License::OGA_BY, License::fromRaw('OGA-BY 3.0')->code);
    $this->assertSame(License::UNKNOWN, License::fromRaw('')->code);
    $this->assertSame(License::UNKNOWN, License::fromRaw('some custom EULA')->code);
  }

  // ── The live-promotion gate ─────────────────────────────────────

  public function testCc0IsFullyPublishable(): void {
    $l = License::fromRaw('CC0');
    $this->assertTrue($l->permitsLivePromotion());
    $this->assertFalse($l->requiresAttribution());
  }

  public function testNonCommercialIsBlocked(): void {
    $this->assertFalse(License::fromRaw('CC-BY-NC')->permitsLivePromotion());
    $this->assertFalse(License::fromRaw('CC-BY-NC-SA')->isCommercialSafe());
  }

  public function testNoDerivativesIsBlocked(): void {
    // We transform/curate, so ND can't be promoted.
    $this->assertFalse(License::fromRaw('CC-BY-ND')->permitsLivePromotion());
  }

  public function testUnknownIsNeverPublishable(): void {
    $this->assertFalse(License::fromRaw('')->permitsLivePromotion());
    $this->assertFalse(License::fromRaw('weird license')->isKnown());
  }

  public function testCcByRequiresAttribution(): void {
    $l = License::fromRaw('CC-BY');
    $this->assertTrue($l->permitsLivePromotion());
    $this->assertTrue($l->requiresAttribution());
  }

  // ── SourceAsset publish gate ────────────────────────────────────

  public function testCcByAssetWithoutCreditIsNotPublishable(): void {
    $asset = new SourceAsset(
      downloadUrl: 'https://x/y.glb',
      format: 'glb',
      title: 'Y',
      license: License::fromRaw('CC-BY'),
      attribution: '', // missing credit on a CC-BY asset
    );
    $this->assertFalse($asset->isPublishable(), 'CC-BY without attribution must be blocked.');
  }

  public function testCcByAssetWithCreditIsPublishable(): void {
    $asset = new SourceAsset(
      downloadUrl: 'https://x/y.glb',
      format: 'glb',
      title: 'Y',
      license: License::fromRaw('CC-BY'),
      attribution: 'Some Author',
    );
    $this->assertTrue($asset->isPublishable());
  }

  // ── DirectUrlAdapter ────────────────────────────────────────────

  public function testDirectAdapterParsesFormatAndTitle(): void {
    $adapter = new DirectUrlAdapter();
    $this->assertTrue($adapter->supports('https://example.com/trees/oak_stylized.glb'));
    $this->assertFalse($adapter->supports('polyhaven:ArmChair_01'));

    $assets = $adapter->resolve('https://example.com/trees/oak_stylized.glb');
    $this->assertCount(1, $assets);
    $this->assertSame('glb', $assets[0]->format);
    $this->assertSame('Oak Stylized', $assets[0]->title);
    // A bare URL has no licence → unknown → not publishable.
    $this->assertSame(License::UNKNOWN, $assets[0]->license->code);
    $this->assertFalse($assets[0]->isPublishable());
  }

  public function testDirectAdapterHandlesCompoundExtension(): void {
    $assets = (new DirectUrlAdapter())->resolve('https://example.com/pack.tar.gz');
    $this->assertSame('tar.gz', $assets[0]->format);
  }

  // ── Manager priority selection ──────────────────────────────────

  public function testManagerPicksHighestPriorityMatch(): void {
    $catalog = $this->fakeAdapter('catalog', static fn(string $r) => str_starts_with($r, 'cat:'));
    $direct = $this->fakeAdapter('direct', static fn(string $r) => str_starts_with($r, 'http'));
    // Priority order is the container's job; here catalog precedes direct.
    $manager = new SourceAdapterManager([$catalog, $direct]);

    $this->assertSame('catalog', $manager->adapterFor('cat:123')?->id());
    $this->assertSame('direct', $manager->adapterFor('https://x/y.glb')?->id());
    $this->assertNull($manager->adapterFor('ftp://nope'));
    $this->assertSame(['catalog', 'direct'], $manager->adapterIds());
  }

  public function testManagerThrowsWhenNoAdapterMatches(): void {
    $manager = new SourceAdapterManager([]);
    $this->expectException(\RuntimeException::class);
    $manager->resolve('mailto:nope');
  }

  /** A minimal in-test adapter — supports() driven by a predicate. */
  private function fakeAdapter(string $id, callable $supports): SourceAdapterInterface {
    return new class($id, $supports) implements SourceAdapterInterface {
      public function __construct(private string $id, private $supports) {}
      public function id(): string {
        return $this->id;
      }
      public function supports(string $ref): bool {
        return (bool) ($this->supports)($ref);
      }
      public function resolve(string $ref): array {
        return [];
      }
    };
  }

}
