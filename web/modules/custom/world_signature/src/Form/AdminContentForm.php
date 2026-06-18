<?php

declare(strict_types=1);

namespace Drupal\world_signature\Form;

use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Url;
use Drupal\world_signature\Service\EmbeddingFreshness;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * `/admin/world/content` — the content maintainer surface.
 *
 * Freshness banner + one big button. The button kicks off Drupal's
 * Batch API so the embed pipeline runs in chunked HTTP requests with
 * a progress bar (and a Stop link for free). No nginx/PHP timeout
 * risk like the synchronous drush path that was killed by the WSL
 * shutdown earlier in development.
 *
 * Modes:
 *   - `full`  — embed every participating entity.
 *   - `delta` — embed only entities currently missing/stale/dirty.
 *
 * Delta still embeds the FULL corpus during prepare (TF-IDF needs
 * the whole bag for consistent IDF), but only WRITES BACK the
 * pending subset. The wall-clock saving is in the per-entity
 * entity-save (N hook invocations + DB writes), which is the bulk
 * of the prior overnight runtime.
 */
final class AdminContentForm extends FormBase {

  public function __construct(
    private readonly EmbeddingFreshness $freshness,
  ) {}

  public static function create(ContainerInterface $container): self {
    return new self(
      $container->get('world_signature.embedding_freshness'),
    );
  }

  public function getFormId(): string {
    return 'world_signature_admin_content';
  }

  public function buildForm(array $form, FormStateInterface $form_state): array {
    $summary = $this->freshness->summary();
    $pending = $summary['missing'] + $summary['stale'] + $summary['dirty'];
    $modelLine = $summary['modelVersion'] === NULL
      ? $this->t('No embed has ever run.')
      : $this->t('Current model: @v · last run @at', [
          '@v' => $summary['modelVersion'],
          '@at' => $summary['lastEmbedAt'] === NULL
            ? '—'
            : \Drupal::service('date.formatter')->formatTimeDiffSince($summary['lastEmbedAt']) . ' ago',
        ]);

    $form['banner'] = [
      '#type' => 'container',
      '#attributes' => ['style' => 'max-width:64rem;display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1.5rem;'],
    ];
    foreach (self::bannerCards($summary) as $card) {
      $form['banner'][$card['key']] = [
        '#markup' => sprintf(
          '<div style="padding:1rem 1.25rem;border:1px solid var(--color--gray-20,#d0d5dd);border-radius:0.5rem;background:var(--color--white,#fff);">
            <div style="font-size:0.75rem;letter-spacing:0.06em;text-transform:uppercase;opacity:0.6;">%s</div>
            <div style="font-size:2rem;font-weight:600;color:%s;">%s</div>
          </div>',
          $card['label'], $card['color'], $card['value'],
        ),
      ];
    }

    $form['model'] = [
      '#markup' => sprintf('<p style="max-width:64rem;opacity:0.7;font-size:0.875rem;">%s</p>', $modelLine),
    ];

    $form['actions'] = ['#type' => 'actions'];
    $form['actions']['refresh'] = [
      '#type' => 'submit',
      '#value' => $pending > 0
        ? $this->t('Refresh embeddings (@n pending)', ['@n' => $pending])
        : $this->t('Re-embed everything'),
      '#button_type' => 'primary',
      '#submit' => ['::submitRefresh'],
      '#name' => 'refresh',
    ];
    $form['actions']['full'] = [
      '#type' => 'submit',
      '#value' => $this->t('Force full re-embed'),
      '#submit' => ['::submitForceFull'],
      '#name' => 'force_full',
      '#attributes' => ['style' => 'opacity:0.7;'],
    ];

    $form['#cache'] = ['max-age' => 0];
    return $form;
  }

  public function submitForm(array &$form, FormStateInterface $form_state): void {
    // Per-action submit handlers; this is unreached but required by
    // FormBase's abstract contract.
  }

  /** Refresh pending only (delta). */
  public function submitRefresh(array &$form, FormStateInterface $form_state): void {
    $this->startBatch(deltaOnly: TRUE);
  }

  /** Force a full re-embed regardless of pending count. */
  public function submitForceFull(array &$form, FormStateInterface $form_state): void {
    $this->startBatch(deltaOnly: FALSE);
  }

  /**
   * Push a batch onto the Batch API. Drupal renders its standard
   * progress page on redirect — progress bar, current operation, Stop
   * link to cancel between operations.
   */
  private function startBatch(bool $deltaOnly): void {
    $batch = [
      'title' => $this->t('Refreshing embeddings'),
      'init_message' => $this->t('Gathering corpus and computing vectors…'),
      'progress_message' => $this->t('@current of @total batches processed.'),
      'error_message' => $this->t('Refresh hit an error. Logs have the details.'),
      'finished' => '\Drupal\world_signature\Form\AdminContentForm::batchFinished',
      'operations' => [
        ['\Drupal\world_signature\Form\AdminContentForm::batchPrepare', [$deltaOnly]],
        // The write op is added BY batchPrepare once it knows the
        // descriptor count — we can't predict chunk count up-front.
        // batchPrepare uses `batch_set` on a child batch to add the
        // write/finalize ops dynamically.
      ],
    ];
    batch_set($batch);
  }

  // ─── Batch operations ────────────────────────────────────────────

  /** Op 1: prepare context (gather + corpus embed). Stashed in `$context['results']['ctx']`. */
  public static function batchPrepare(bool $deltaOnly, array &$context): void {
    /** @var \Drupal\world_signature\Service\EmbedRunner $runner */
    $runner = \Drupal::service('world_signature.embed_runner');
    try {
      $ctx = $runner->prepareBatchContext();
    }
    catch (\Throwable $e) {
      $context['results']['error'] = $e->getMessage();
      $context['finished'] = 1;
      return;
    }
    if ($deltaOnly) {
      /** @var \Drupal\world_signature\Service\EmbeddingFreshness $freshness */
      $freshness = \Drupal::service('world_signature.embedding_freshness');
      $pending = $freshness->listPending();
      $pendingIds = [];
      foreach ($pending as $entityType => $ids) {
        foreach ($ids as $id) {
          $pendingIds[$entityType . '-' . $id] = TRUE;
        }
      }
      // Filter descriptors to the pending subset.
      $ctx['descriptors'] = array_values(array_filter(
        $ctx['descriptors'],
        static fn (string $d) => isset($pendingIds[$d]),
      ));
    }
    $context['results']['ctx'] = $ctx;
    $context['results']['written'] = 0;
    $context['results']['errors'] = 0;
    $context['results']['deltaOnly'] = $deltaOnly;
    // Schedule the write + finalize ops now that we know the workload.
    $chunkSize = 8;
    $chunks = array_chunk($ctx['descriptors'], $chunkSize);
    $writeBatch = [
      'operations' => [],
    ];
    foreach ($chunks as $i => $chunk) {
      $writeBatch['operations'][] = [
        '\Drupal\world_signature\Form\AdminContentForm::batchWriteChunk',
        [$chunk, $i + 1, count($chunks)],
      ];
    }
    $writeBatch['operations'][] = ['\Drupal\world_signature\Form\AdminContentForm::batchFinalize', []];
    batch_set($writeBatch);
    $context['message'] = t('Corpus embedded (@n descriptors). Writing back…', ['@n' => count($ctx['descriptors'])]);
  }

  /** Op 2..N-1: write a chunk of descriptors. */
  public static function batchWriteChunk(array $descriptorIds, int $chunkNumber, int $totalChunks, array &$context): void {
    $ctx = $context['results']['ctx'] ?? NULL;
    if (!is_array($ctx)) {
      return;
    }
    /** @var \Drupal\world_signature\Service\EmbedRunner $runner */
    $runner = \Drupal::service('world_signature.embed_runner');
    /** @var \Drupal\world_signature\Service\EmbeddingFreshness $freshness */
    $freshness = \Drupal::service('world_signature.embedding_freshness');
    foreach ($descriptorIds as $descriptorId) {
      if ($runner->writeOneFromContext($ctx, $descriptorId)) {
        $context['results']['written']++;
        // Clear the dirty flag in passing — the bookkeeping the
        // banner reads stays accurate without a separate sweep.
        if (preg_match('/^(\w+)-(\d+)$/', $descriptorId, $m)) {
          $freshness->clearDirty($m[1], $m[2]);
        }
      }
      else {
        $context['results']['errors']++;
      }
    }
    $context['message'] = t('Chunk @c / @t', ['@c' => $chunkNumber, '@t' => $totalChunks]);
  }

  /** Op N: finalize — anchor axes + State + cache invalidate. */
  public static function batchFinalize(array &$context): void {
    $ctx = $context['results']['ctx'] ?? NULL;
    if (!is_array($ctx)) {
      return;
    }
    /** @var \Drupal\world_signature\Service\EmbedRunner $runner */
    $runner = \Drupal::service('world_signature.embed_runner');
    $context['results']['summary'] = $runner->finalizeBatch(
      $ctx,
      (int) ($context['results']['written'] ?? 0),
      (int) ($context['results']['errors'] ?? 0),
    );
  }

  /** Final callback — flash + redirect back to /admin/world/content. */
  public static function batchFinished(bool $success, array $results, array $operations): \Drupal\Core\Url|null {
    $messenger = \Drupal::messenger();
    if (!empty($results['error'])) {
      $messenger->addError(t('Refresh failed: @m', ['@m' => $results['error']]));
      return Url::fromRoute('world_signature.admin.content');
    }
    $written = (int) ($results['written'] ?? 0);
    $errors = (int) ($results['errors'] ?? 0);
    $summary = $results['summary'] ?? NULL;
    if ($success && is_array($summary)) {
      $messenger->addStatus(t('Embedded @n entities (@e errors) with @m.', [
        '@n' => $written,
        '@e' => $errors,
        '@m' => $summary['modelVersion'] ?? 'unknown',
      ]));
    }
    else {
      $messenger->addWarning(t('Refresh interrupted — @n written, @e errors.', [
        '@n' => $written,
        '@e' => $errors,
      ]));
    }
    return Url::fromRoute('world_signature.admin.content');
  }

  /** @return array<int, array{key:string,label:string,value:int,color:string}> */
  private static function bannerCards(array $summary): array {
    return [
      ['key' => 'total',    'label' => 'Total',    'value' => $summary['total'],    'color' => 'var(--color--text,#1d2230)'],
      ['key' => 'embedded', 'label' => 'Embedded', 'value' => $summary['embedded'], 'color' => 'var(--color--success-50,#10764e)'],
      ['key' => 'pending',  'label' => 'Pending',  'value' => $summary['missing'] + $summary['stale'] + $summary['dirty'], 'color' => 'var(--color--warning-50,#a8741a)'],
      ['key' => 'stale',    'label' => 'Stale',    'value' => $summary['stale'],    'color' => 'var(--color--error-50,#a02e2e)'],
    ];
  }

}
