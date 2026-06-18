<?php

declare(strict_types=1);

namespace Drupal\world_signature\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\Core\Url;

/**
 * `/admin/world` — the operator landing for the four role-targeted tabs.
 *
 * The contrib UX is structured as one admin route prefix with four
 * sibling tabs. Each tab targets one operator role:
 *
 *   - Scenes   — the scene creator (atmosphere authoring; palette,
 *                interpretation, stage placements, transition options).
 *   - Content  — the content maintainer (one-button embedding refresh,
 *                transparency drawer with per-node inspector).
 *   - Assets   — the asset manager (mesh / material / animation catalog
 *                across slots and atmospheres).
 *   - Rules    — the rule definer (bundle×atmosphere → builder mapping,
 *                positioning rule per scene).
 *
 * Today (arc 1): every tab returns a stub; Content gets its real form
 * + transparency drawer next. The landing route returns a 3-link
 * orientation card for users who land on /admin/world directly.
 */
final class AdminWorldController extends ControllerBase {

  /** Landing — one-line orientation + a card per tab. */
  public function landing(): array {
    return [
      '#theme' => 'world_admin_landing',
      '#tabs' => self::tabSummaries(),
      '#cache' => ['max-age' => 0],
    ];
  }

  public function scenes(): array {
    return $this->stub('Scenes', 'Atmosphere authoring — palette, interpretation poles, stage placements, transition options. Coming in arc 2.');
  }

  public function content(): array {
    // Arc 1 — the real Content tab fleshes this out next.
    return $this->stub('Content', 'Embedding refresh + transparency. Coming in this arc.');
  }

  public function assets(): array {
    return $this->stub('Assets', 'Mesh / material / animation catalog. Coming in arc 2.');
  }

  public function rules(): array {
    return $this->stub('Rules', 'Bundle×atmosphere → builder mapping, positioning rule per scene. Coming in arc 3.');
  }

  /** Tab summary structure consumed by the landing template. */
  private static function tabSummaries(): array {
    return [
      [
        'key' => 'scenes',
        'label' => 'Scenes',
        'description' => 'Author atmospheres — palette, interpretation, stage placements, transition options.',
        'url' => Url::fromRoute('world_signature.admin.scenes'),
      ],
      [
        'key' => 'content',
        'label' => 'Content',
        'description' => 'Refresh embeddings + inspect what the model sees.',
        'url' => Url::fromRoute('world_signature.admin.content'),
      ],
      [
        'key' => 'assets',
        'label' => 'Assets',
        'description' => 'Catalog of meshes, materials and animations across slots and atmospheres.',
        'url' => Url::fromRoute('world_signature.admin.assets'),
      ],
      [
        'key' => 'rules',
        'label' => 'Rules',
        'description' => 'Bundle×atmosphere → builder mapping, positioning rule per scene.',
        'url' => Url::fromRoute('world_signature.admin.rules'),
      ],
    ];
  }

  /** Shared placeholder until each tab lands its real implementation. */
  private function stub(string $title, string $message): array {
    return [
      '#type' => 'container',
      '#attributes' => ['class' => ['world-admin-stub']],
      'message' => [
        '#markup' => sprintf(
          '<h2>%s</h2><p style="opacity:0.7;max-width:48rem;">%s</p>',
          $title,
          $message,
        ),
      ],
      '#cache' => ['max-age' => 0],
    ];
  }

}
