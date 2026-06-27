<?php

declare(strict_types=1);

namespace Drupal\world_signature\Form;

use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\State\StateInterface;
use Drupal\Core\Url;
use Drupal\world_signature\Service\DemoContentInstaller;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * `/admin/world/onboarding` — the first-run wizard.
 *
 * Two visible steps + a hand-off to Drupal's Batch UI:
 *
 *   1. Welcome + scene picker (Forest vs Inner-mind, with a custom
 *      escape hatch).
 *   2. Demo-content offer (install for Day-0 layout vs bring own).
 *   3. (transparent) batch import of the demo corpus + embed pass,
 *      via Drupal's batch progress UI.
 *   4. Redirect to / with the first-visit flag set.
 *
 * After successful run, sets `world_signature.onboarding_completed_at`
 * in State so subsequent /admin/world visits skip the wizard.
 *
 * The voice is formal-product across every label and message.
 */
final class OnboardingForm extends FormBase {

  public const string STATE_COMPLETED_AT = 'world_signature.onboarding_completed_at';
  public const string STATE_FIRST_VISIT_PENDING = 'world_signature.first_visit_pending';

  public function __construct(
    private readonly StateInterface $worldState,
    private readonly ConfigFactoryInterface $worldConfigFactory,
    private readonly DemoContentInstaller $demoInstaller,
  ) {}

  public static function create(ContainerInterface $container): self {
    return new self(
      $container->get('state'),
      $container->get('config.factory'),
      $container->get('world_signature.demo_content_installer'),
    );
  }

  public function getFormId(): string {
    return 'world_signature_onboarding';
  }

  public function buildForm(array $form, FormStateInterface $form_state): array {
    $step = (int) ($form_state->get('step') ?? 1);
    $form['#cache'] = ['max-age' => 0];

    return match ($step) {
      1 => $this->buildStepScene($form, $form_state),
      2 => $this->buildStepContent($form, $form_state),
      default => $this->buildStepScene($form, $form_state),
    };
  }

  public function submitForm(array &$form, FormStateInterface $form_state): void {
    // Per-step submit handlers; this base is unused.
  }

  // ─── Step 1: scene picker ───────────────────────────────────────────

  private function buildStepScene(array $form, FormStateInterface $form_state): array {
    $form['#attributes']['style'] = 'max-width:64rem;margin:0 auto;';
    $form['intro'] = [
      '#markup' => '<h2 style="margin-top:0;">' . $this->t('Welcome to World Signature') . '</h2>'
        . '<p style="opacity:0.75;max-width:42rem;line-height:1.5;">'
        . $this->t('This three-step setup will configure your renderer and, if you wish, land a starter corpus so the world is populated on first view. The choices below can all be changed later from the Scenes and Content tabs.')
        . '</p>'
        . '<h3 style="margin-top:1.5rem;">' . $this->t('Step 1 of 3 — Choose a scene') . '</h3>'
        . '<p style="opacity:0.7;font-size:0.9rem;margin-bottom:1rem;">'
        . $this->t('A scene is a rendering style — the metaphor by which your content becomes 3D form. Two are included; additional scenes can be added by site administrators.')
        . '</p>',
    ];

    $form['scene'] = [
      '#type' => 'radios',
      '#title' => $this->t('Scene'),
      '#title_display' => 'invisible',
      '#options' => [
        'forest' => $this->renderSceneCard(
          'Forest',
          'A ground-plane world. Articles render as trees, profiles as standing spirits, events as carved totems. Content lays out on a sector ring; the camera orbits at eye level. Familiar, navigable, suitable for editorial sites and portfolios.',
        ),
        'inner-mind' => $this->renderSceneCard(
          'Inner-mind',
          'A floating constellation. Articles render as thought-crystals, profiles as psyche-orbs, events as ripple-rings. Content positions in 3D semantic space using the embedding pipeline. Suited to sites where conceptual proximity matters more than category structure.',
        ),
        'none' => $this->renderSceneCard(
          'No scene (advanced)',
          'Leaves the world at its default: a ground plane with primitive geometry. Choose this if you intend to author a custom scene module before going live.',
        ),
      ],
      '#default_value' => $form_state->get('scene') ?? 'forest',
      '#required' => TRUE,
    ];

    $form['actions'] = ['#type' => 'actions'];
    $form['actions']['next'] = [
      '#type' => 'submit',
      '#value' => $this->t('Continue'),
      '#button_type' => 'primary',
      '#submit' => ['::submitStepScene'],
    ];
    return $form;
  }

  public function submitStepScene(array &$form, FormStateInterface $form_state): void {
    $form_state->set('scene', (string) $form_state->getValue('scene'));
    $form_state->set('step', 2);
    $form_state->setRebuild();
  }

  // ─── Step 2: demo content question ──────────────────────────────────

  private function buildStepContent(array $form, FormStateInterface $form_state): array {
    $form['#attributes']['style'] = 'max-width:64rem;margin:0 auto;';
    $alreadyPopulated = $this->demoInstaller->corpusLooksPopulated();
    $form['intro'] = [
      '#markup' => '<h3 style="margin-top:0;">' . $this->t('Step 2 of 3 — Starter content') . '</h3>'
        . '<p style="opacity:0.7;font-size:0.9rem;max-width:42rem;line-height:1.5;">'
        . ($alreadyPopulated
          ? $this->t('Your site already contains world content. You can still add the demo corpus alongside it, or proceed without changes.')
          : $this->t('A fresh install has no entities to render. Installing the demo corpus lands a curated 27-entity collection across five topics so positional layout is meaningful from the first view. You can delete it once your own content is ready.'))
        . '</p>',
    ];

    $form['content'] = [
      '#type' => 'radios',
      '#title' => $this->t('Starter content'),
      '#title_display' => 'invisible',
      '#options' => [
        'install' => '<strong>' . $this->t('Install the demo corpus') . '</strong>'
          . '<br/><span style="opacity:0.7;font-size:0.9rem;">'
          . $this->t('Recommended. Imports 5 topic terms, 12 articles, 6 profiles, and 4 events; runs an embedding pass so positional layout is active immediately. Takes about a minute.')
          . '</span>',
        'skip' => '<strong>' . $this->t('Continue without demo content') . '</strong>'
          . '<br/><span style="opacity:0.7;font-size:0.9rem;">'
          . $this->t('The world will render empty until you add your own entities. You can install the demo content later from the Content tab.')
          . '</span>',
      ],
      '#default_value' => $alreadyPopulated ? 'skip' : 'install',
      '#required' => TRUE,
    ];

    $form['actions'] = ['#type' => 'actions'];
    $form['actions']['back'] = [
      '#type' => 'submit',
      '#value' => $this->t('Back'),
      '#submit' => ['::submitStepContentBack'],
      '#limit_validation_errors' => [],
    ];
    $form['actions']['finish'] = [
      '#type' => 'submit',
      '#value' => $this->t('Finish setup'),
      '#button_type' => 'primary',
      '#submit' => ['::submitStepContent'],
    ];
    return $form;
  }

  public function submitStepContentBack(array &$form, FormStateInterface $form_state): void {
    $form_state->set('step', 1);
    $form_state->setRebuild();
  }

  public function submitStepContent(array &$form, FormStateInterface $form_state): void {
    $scene = (string) ($form_state->get('scene') ?? 'forest');
    $installDemo = (string) $form_state->getValue('content') === 'install';

    // Persist the scene choice immediately.
    $config = $this->worldConfigFactory->getEditable('world_signature.palette');
    $config->set('active_atmosphere', $scene)->save();

    if ($installDemo) {
      // Batch in the installer so Drupal's progress UI takes over.
      // The installer is synchronous internally — fine for ~27
      // entities + an embed pass on a TF-IDF corpus.
      batch_set([
        'title' => $this->t('Setting up your world'),
        'init_message' => $this->t('Importing starter corpus and computing semantic positions…'),
        'progress_message' => $this->t('Almost there.'),
        'finished' => '\Drupal\world_signature\Form\OnboardingForm::batchFinished',
        'operations' => [
          ['\Drupal\world_signature\Form\OnboardingForm::batchInstall', []],
        ],
      ]);
      // batch_set + a form redirect — Drupal handles the rest.
      $form_state->setRedirectUrl(Url::fromRoute('world_signature.admin.onboarding'));
      return;
    }

    // Skip path — flag complete, redirect to / with the welcome.
    $this->markComplete();
    $form_state->setRedirectUrl(Url::fromUri('internal:/'));
  }

  // ─── Batch ──────────────────────────────────────────────────────────

  public static function batchInstall(array &$context): void {
    /** @var \Drupal\world_signature\Service\DemoContentInstaller $installer */
    $installer = \Drupal::service('world_signature.demo_content_installer');
    try {
      $context['results']['summary'] = $installer->install();
    }
    catch (\Throwable $e) {
      $context['results']['error'] = $e->getMessage();
    }
  }

  public static function batchFinished(bool $success, array $results): \Drupal\Core\Url|null {
    $messenger = \Drupal::messenger();
    if (!empty($results['error'])) {
      $messenger->addError(t('Setup encountered an error: @m', ['@m' => $results['error']]));
      return Url::fromRoute('world_signature.admin.onboarding');
    }
    if ($success && !empty($results['summary'])) {
      $s = $results['summary'];
      $messenger->addStatus(t('Setup complete. Imported @t topics, @a articles, @p profiles, @e events; embedded @em entities.', [
        '@t' => $s['topics'],
        '@a' => $s['articles'],
        '@p' => $s['profiles'],
        '@e' => $s['events'],
        '@em' => $s['embedded'],
      ]));
    }
    // Mark completed + first-visit-pending so the front-page overlay
    // fires once on the next "/" load.
    \Drupal::state()->set(self::STATE_COMPLETED_AT, time());
    \Drupal::state()->set(self::STATE_FIRST_VISIT_PENDING, TRUE);
    return Url::fromUri('internal:/');
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private function markComplete(): void {
    $this->worldState->set(self::STATE_COMPLETED_AT, time());
    $this->worldState->set(self::STATE_FIRST_VISIT_PENDING, TRUE);
  }

  /**
   * Card-shaped radio option markup. Drupal's radios render the markup
   * inline next to the input; the wrapping `<div>` plus the styled
   * `<strong>`/`<small>` give it card-affordance without a custom
   * theme template.
   */
  private function renderSceneCard(string $title, string $description): string {
    return '<div style="display:inline-block;vertical-align:top;padding:0.25rem 0 0.5rem;max-width:36rem;">'
      . '<strong style="font-size:1rem;">' . $title . '</strong>'
      . '<br/><span style="opacity:0.7;font-size:0.9rem;line-height:1.45;display:inline-block;margin-top:0.25rem;">'
      . $description
      . '</span></div>';
  }

}
