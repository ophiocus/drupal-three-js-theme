# Changelog

Reverse-chronological record of substantive feature work. One section
per logical chapter, oldest at the bottom. For per-commit detail see
`git log`; this file captures *what arrived and why*.

Sections are stamped with their lead commit (newest in the chapter)
and the date range of the work.

---

## Arc 1.5 — Day-0 onboarding wizard (June 2026 — head: `6fdf1dd`)

A third-party who just `composer require`'d the module no longer sees
an empty world. Three pieces cover the "install → first render" gap.

- **`/admin/world/onboarding`** — two-step FormBase wizard with a
  batched hand-off. Step 1: pick a scene (Forest / Inner-mind /
  Custom) — three card-shaped radio options; formal-product copy.
  Step 2: install demo corpus (recommended) vs. continue empty.
  On finish, Drupal's Batch API takes over the demo import + embed
  pass with progress + Stop link.
- **`demo_content/corpus.yml` + `DemoContentInstaller` service** —
  hand-authored 27-entity corpus across 5 generic topics
  (Art / Science / Philosophy / Technology / Society): 5 taxonomy
  terms, 12 articles, 6 profiles (with one bridging two topics so
  the constellation reads as touching clusters), 4 events. Texts
  are topic-distinctive so TF-IDF produces visible inner-mind
  clusters. Installer is idempotent by (bundle, title); re-running
  upserts cleanly. After entities land the installer runs the Arc 1
  batch-API prepare → writeOne → finalize path.
- **`FirstVisitOverlay` HUD** — one-shot formal welcome shown on `/`
  after onboarding completes. Gated on
  `drupalSettings.worldSignature.firstVisit` (injected by a new
  `hook_page_attachments_alter`, consumed on first render) AND a
  `world.firstVisit.seen` localStorage flag. Modal card with three
  signposts (Scene / Language / Content) and a Got it dismiss.
  Backdrop click + Escape also dismiss.

Plus a **customization banner** on `/admin/world` post-onboarding —
"Setup complete. Tune the world from any of the surfaces below" with
CTAs to Assets / Rules / Scenes and a CSRF-protected Dismiss route.

First-run detection in `AdminWorldController::landing`: when
`world_signature.onboarding_completed_at` is unset in State, redirect
to `/admin/world/onboarding` before rendering the landing.

Verified end-to-end: `/admin/world` cold state redirects, wizard
lands Step 1, installer runs 27 entities + embed in ~10 s, snapshot
serves all entities with embeddings, customization banner renders,
`firstVisit` flag consumed once.

## Arc 1 — /admin/world landing + Content tab + module owns the renderer (June 2026 — head: `b7e2aca`)

The operator UI foundation. Collapses what would have been multiple
sub-modules into a single `world_signature` module with one landing
under `/admin/world` and four role-targeted tabs.

- **`/admin/world` landing** — new `AdminWorldController` with
  landing + Scenes / Content / Assets / Rules routes. Landing
  renders a 4-card orientation grid via a new `world_admin_landing`
  theme hook + twig template. Menu link `system.admin > World` +
  local-task tabs so the four pills read as siblings.
- **`administer world signature` permission** — admin-scope; coexists
  with the existing `edit world signature` (editor-scope).
- **Content tab — freshness banner + one-button refresh.** New
  `EmbeddingFreshness` service aggregates counts
  (total / embedded / stale / missing / dirty) + a per-entity-type
  pending list + dirty bookkeeping in State. New `AdminContentForm`
  renders banner cards + a primary `Refresh embeddings (N pending)`
  and a secondary `Force full re-embed`. Refresh uses Drupal's
  Batch API — gather + corpus-embed once in `batchPrepare`;
  `writeOneFromContext` runs per-descriptor in chunks of 8;
  `batchFinalize` stamps State + invalidates the snapshot cache.
  Drupal's batch UI provides progress + a Stop link for free — no
  more orphaned overnight embeds.
- **`EmbedRunner` batch API** — three new public methods
  (`prepareBatchContext` / `writeOneFromContext` / `finalizeBatch`)
  mirror the existing `run()` phases for batch consumption. The
  legacy `run()` stays untouched for drush + the legacy admin
  endpoint.
- **Auto-stale tracking** — `hook_entity_update` computes the new
  `embeddingText` hash and, when it differs from the stored
  `semanticHash` on an entity that already has an embedding, flags
  the entity dirty via `EmbeddingFreshness::markDirty()`. The flag
  clears in passing during `batchWriteChunk`. Banner's Pending
  counter is accurate without the operator running drush queries.
- **Renderer bundle relocation** — `dist/world.bundle.js` moved
  from `web/themes/custom/drupal_threejs/dist/` into
  `web/modules/custom/world_signature/js/`. Module ships its own
  `world` library carrying the bundle; the theme's `world` library
  is CSS-only and depends on `world_signature/world`. Sites without
  `drupal_threejs` can attach `world_signature/world` directly.
  Cache-bust `md5_file` hook moved from `drupal_threejs.theme` to
  `world_signature_library_info_alter`. `vite.config.ts` `outDir`
  updated; `emptyOutDir: false` preserves the hand-authored
  `asset-hover.js`.

## Embedding pipeline resilience (June 2026 — `bf138bd`, `9fe7f80`)

Two guardrails on the semantic layout so re-seeds and cold-start
sandboxes don't degrade the inner-mind cloud.

- **`SignatureWriter` preserves the existing embedding on
  signature re-extract** — extractors never mint
  `semantic.embedding`; only the corpus-wide `world:embed` does. So
  a plain re-extraction (entity update, seed re-run) was clobbering
  whatever embedding the previous embed pass had deposited. Fix:
  before writing, read the existing field; if the existing record
  carries an embedding AND the incoming signature carries none AND
  the semanticHash matches (same source text → same embedding still
  valid), carry the existing embedding + modelVersion + embeddedAt
  across. When the hash differs the embedding is genuinely stale
  and we let the null overwrite stand.
- **Inner-mind Fibonacci-sphere fallback when no embeddings
  present** — `computeLayout` previously returned null with < 2
  embeddings, dropping the atmosphere back to taxonomy ring
  placement. New `fibonacciSphere(ids, targetRadius)` in
  `projection.ts` — deterministic golden-angle-spaced points on a
  sphere, ordered by an id hash so alphabetical adjacency doesn't
  read as semantic adjacency. Same ids → same positions, every
  run. inner-mind's `computeLayout` now branches: ≥ 2 embeddings →
  real path (anchored → MDS-3D → temporal shift), < 2 embeddings →
  Fibonacci sphere. A fresh sandbox reads as a distinctly 3D cloud
  rather than a flat ring even before `world:embed` has ever run.

## Transition polish — pill spinner + 30% overlap + tween variants (June 2026 — `e6ecaf3`, `240b4e3`, `03280e7`, `e11561b`, `b7e59b9`)

Five iterative commits reshape the atmosphere/language switch from
"cover overlay + hard cut" to "everything tweens, no black moment."

- **Per-prop `intro()` / `outro()` on SmartObject** (`e11561b`) —
  each prop tweens its own scale with a deterministic per-entity
  stagger derived from an entityId hash. Same prop, same offset
  across runs; the bloom front reads as organic stagger.
- **World-layer breath-in** (`b7e59b9`) — the world-layer group
  itself scales from 0.93 → 1 on mount + atmosphere/language switch
  reveal, giving a subtle motion cushion.
- **CrossfadeOverlay → envelope tween** (`03280e7` peak-opacity
  drop; `240b4e3` overlay removed entirely). The former DOM cover
  read as "fade to black" on dark atmospheres. Now `scene.background`
  and `scene.fog` lerp continuously across the teardown boundary as
  the world-layer shrinks then grows — no flat-colour sheet ever
  layered on top of the canvas.
- **Pill spinner + 30% dual-scene overlap + 7 tween variants**
  (`e6ecaf3`) — three bundled improvements:
    - `AtmosphereSwitcher.setPending(name)` swaps the clicked pill's
      label for a CSS spinner glyph so the click registers
      immediately while the new scene preloads.
    - Outgoing world-layer + smartObjects + atmosphere disposers
      detach into an `OutgoingSlot` before teardown; buildScene runs
      the new scene in parallel with the outgoing's outro tween;
      the new intro starts at outro's 70 % mark (30 % overlap,
      configurable via `SCENE_OVERLAP_FRACTION`). Both scenes
      co-exist for ~115 ms.
    - `SmartObject` picks one of 7 recipes deterministically by
      entityId hash: `scale-cubic`, `scale-back`, `scale-elastic`,
      `drop-in` (falls from +18 above), `rise-in`, `spin-in`
      (1.25 rotations around Y), `snap-in`. Outro mirrors the intro
      variant — a tree that dropped in will rise out.

## Atmosphere registry — N-theme scalable (June 2026 — `a1c211d`)

Refactored so adding a 3rd / 4th / Nth visual theme is a single
directory under `atmospheres/<key>/` plus one line in `registry.ts`.
No edits anywhere else.

- **`AtmosphereModule` interface** (`atmospheres/types.ts`) — every
  atmosphere exports a `default` conforming to
  `{ key, i18nLabelKey, registerBuilders, setupEnvironment?,
  computeLayout?, buildSoundscape? }`. Plus `AtmosphereSetupContext`
  packaging the kitchen-sink ctx and `Soundscape` (lifted from
  `AtmosphereAudio`).
- **Central `registry.ts`** — insertion-ordered map of lazy loaders.
  `listAtmosphereKeys()`, `hasAtmosphere(key)`, `loadAtmosphere(key)`.
  Two lines today (forest, inner-mind).
- Every consumer reads the registry: `SceneManager.registerAtmosphere`
  no longer has a `switch(name)`, `AtmosphereSwitcher` pill list
  derives from `listAtmosphereKeys()`, `AtmosphereAudio` asks the
  registry for the active atmosphere's `buildSoundscape`, and the
  StageEditor default-atmosphere dropdown reads
  `["none", ...listAtmosphereKeys()]`.
- Per-atmosphere audio moved into `atmospheres/<key>/audio.ts`.
- Inner-mind's `StageEditor` mount moved into
  `inner-mind/index.ts`'s `setupEnvironment` — SceneManager has zero
  inner-mind-specific HUD code.

## Runtime cut off Atlas (June 2026 — `0d59538`)

The snapshot endpoint no longer round-trips to the RESTHeart gateway
on the read path. `SnapshotPublisher::buildSnapshot` now rebuilds
descriptors from Drupal directly (iterate published nodes carrying a
non-empty `field_world_signature`, decode the stored `Signature` JSON,
run the same `DescriptorBuilder` the write path uses). Same shape,
same fields, byte-identical payload.

Atlas / RESTHeart stays for the paths that genuinely need it:
`drush world:publish`, `drush world:embed`, `WorldSearchClient::nearest`.
Documented in `BATTLE_SCARS A7`. Root cause was a 2026-06-06 Atlas
IP-allowlist drift that black-holed the entire app despite every
descriptor being reproducible from MariaDB.

## Language state → persistent + SPA-style switching (June 2026 — `da83bcb`, `c80b6dc`, `9b8f47f`, `704a558`, `a7007b4`, `add5f93`, `a922d19`)

Six commits refactor language handling so it survives every navigation
and no longer round-trips through a page reload.

- **`hud/lang.ts`** — canonical persistent language module.
  `consumeUrlLang()` reads URL `?lang=` once at boot, writes
  localStorage, strips the param from the URL. `getCurrentLang()`
  reads localStorage → browser language → default. `setCurrentLang()`
  persists. `withLangQuery(url)` appends `?lang=<active>` to any URL
  a runtime fetch is about to send. Every fetch site (snapshot,
  card, HTML in-canvas surface, HTML mesh surface) uses it — one
  source of truth.
- **FullView card endpoint honors `?lang=`** — server side reads the
  query and loads the matching translation, resolving the earlier
  bug where the picker changed labels but the card body stayed in
  English.
- **SPA-style `switchLanguage`** — replaces the page reload with a
  soft snapshot re-fetch through the atmosphere-switch pipeline.
- **Pill mount hoisted before `buildScene`** — the switcher is
  visible + interactive during the world's boot instead of after it.
- **Race-gate fix** (`a7007b4`) — the redundant `setCurrentLang`
  call in `switchLanguage` was silently bailing (the switcher had
  already persisted, the second call reported "no change", the
  rebuild was skipped). Dropped the guard; the `code === currentLang`
  check at the top of the method is the canonical no-op gate.
- Companion editorial: `world_seed` enables taxonomy + user
  translation and seeds ES variants for the whole corpus
  (`add5f93`).

## Bonus infrastructure (June 2026)

- **DDEV watchdog** (`39df5c9`) — passive polling script at
  `scaffold/ddev-watchdog.sh` that logs heartbeats every 5 min and
  dumps rich diagnostics on any transition out of `running`. Log
  at `.local/ddev-watchdog.log`, PID at `.local/ddev-watchdog.pid`,
  both gitignored. Does NOT auto-restart — that would mask the
  cause. Documented side effect: an active process keeps WSL2 from
  auto-shutting-down its distro.
- **BATTLE_SCARS T1** (`a52d7ab`) — perceived renderer freeze in
  automated browsers is Chrome's unfocused-tab throttling of `rAF`,
  not a real perf wall. Rule: when a live observation is required,
  hand the URL to the user.
- **BATTLE_SCARS A7** — Atlas on the runtime read path is a
  boundary violation (see the runtime-cut chapter above).
- **`world_seed` 5 new non-Latin sectors** (`708fcc9`) — Ethiopia,
  Kenya, Sumatra, Yemen, Burundi added with 70 new entities + full
  ES translations. Dev-sandbox only; not shipped to contrib.
- **`world_seed` topic-term dedupe** (`b0722ba`) — seeder now reuses
  an existing term with the same name in the `topics` vocab rather
  than minting a duplicate.
- **Elegant install rewrite** (`a922d19`) — one-command bring-up
  via `drush en world_seed`; `enforced.module` deps on field
  storages so uninstall cleanly removes them; no `hook_update_N`.
- **Manifesto extensions** (`10a7c3c`, `5ff2acd`, `6549b2e`) —
  registry additions: `commerce.product` and
  `commerce.configurable_item` item types; `metaphor.world.shot`
  and `camera_pose` / `composite_lane` components;
  `binding_slot` for live Drupal-field → slot wiring.
- **Composer bump** (`dc391f5`) — Drupal core 11.3.8 → 11.3.11 +
  contrib updates.

---

## i18n polish & docs (May 2026 — head: `f3d99ac`)

The world now talks. Every in-canvas UI string flows through a small
i18n catalog so the chrome speaks the same language as the content.

- **`src/world/runtime/hud/i18n.ts`** — tiny dictionary keyed by
  string id, with `en` + `es` branches. Single-function API:
  `t(lang, key, subs?)`. Falls back to English when a key is missing
  from the requested language, and to the key itself when missing in
  both (so misspellings surface visibly in development).
- **Stage panel** — every label, button, banner, status flash, and
  time-ago format now routes through `t()`. The lang prop threads
  from `SceneManager.currentLang` (read from URL `?lang=` →
  localStorage → browser language → 'en') down to StageEditor.
- **Atmosphere + Language switcher pills** — aria labels, sound
  toggle title, atmosphere display names (Forest / Bosque, Inner
  mind / Mente interior). Switcher button labels in the language
  picker stay raw codes (EN / ES) by design — they're identity
  markers, not translatable nouns.
- **Honest scope cut**: loader overlay strings still use raw English
  for now. Path to fix is mechanical (catalog keys exist
  — `loader.title`, `loader.fetching`, etc.) but threading lang
  through the loader is its own slice.

Net effect: the entire editorial surface — Stage panel, World
section, Interpretation section, sign placement editor, switchers
— renders in the active language.

## Overdrive — Spanish full stack + richer embeddings + temporal gravity (May 2026 — `3209515`)

A single chapter that pushed three perpendicular improvements at once.

**i18n (full stack)**

- Drupal language + content_translation + locale modules enabled;
  Spanish (`es`) configured as the second language.
- Translation enabled on the `article`, `event`, and `profile`
  content types via `world_seed/config/optional/`.
- `world_seed` ships parallel `data/{articles,events,profiles,
  authors,sectors}_es.json` — 100 article translations + 15 events
  + 15 biographies + 6 author bios + 5 sectors, all hand-authored
  Latin American Spanish.
- `Seeder::maybeLoadJson()` + `Seeder::maybeAddSpanish()` give a
  silent fallback to English-only when the `*_es.json` files are
  absent.
- `WorldController` honors `?lang=en|es` on the snapshot route.
- `SnapshotPublisher::applyTranslationOverlay()` swaps each
  descriptor's title / summary / bodyText to the requested language
  at response time by reloading the source node and reading its
  translation. **3D positions stay language-agnostic** —
  embeddings are computed once from English, so the world's shape
  survives language switches.
- New cache context `url.query_args:lang` on the snapshot route.
- Client: new `LanguageSwitcher` pill bottom-right, sibling to the
  atmosphere pill. URL `?lang=` > localStorage > navigator.language >
  'en'. `SceneManager.fetchSnapshot()` appends `?lang=<current>`
  on every fetch.

**Richer embedding — weighted titles**

- `DescriptorBuilder::embeddingText()` now repeats the title three
  times before concatenating the body. Cheap to implement, real
  signal-to-noise improvement for the TF-IDF embedder on
  short-body corpora: title vocabulary gains three times the weight
  of any single body sentence.

**Metaverse rule — temporal gravity**

- `inner-mind/index.ts::applyTemporalShift()`: after the
  anchored / MDS-3D projection, newer entities (high `createdAt`)
  pull inward toward the cloud centroid; older entities push
  outward. Linear-in-normalised-age with ±15% gain so the
  embedding layout still dominates and the temporal signal reads as
  a second-order modulation. Same anchored cluster, but fresh
  reporting orbits closer to the camera's natural settle.

## World seed module — one-command site bring-up (May 2026 — `2b977f7`)

The site's canonical install path is now `drush en world_seed`.
Replaces the one-shot `scaffold/seed-atlas-coffee.php` with a real
Drupal artifact.

- New module `world_seed` (sibling to `world_signature`,
  depends on it).
- **What ships**: admin user (uid=1, generated password printed
  once), 6 authors with bios + writing themes (the field storage
  installs via `config/install/`), 5 sector taxonomy terms
  (Antigua / Cauca / Boquete / Sierra Madre / Tarrazú), 100 hand-
  authored coffee articles distributed 20-per-sector across the
  6 authors, 15 events, 15 biographies as `profile` nodes (real
  coffee figures).
- **Idempotence**: `world_seed.seed_state` tracks UUIDs created by
  the seeder; `drush world:seed` and `drush world:seed:purge`
  wipe by UUID only, never by title heuristic, so manually-
  authored content with overlapping titles is safe.
- **Editorial principle**: articles are byline-attributed to their
  author. Events and biographies are owned by `uid=1` because
  they're *factual descriptions of the world*, not opinion writing.
- **`WorldSearchClient::nearest($vector, $k, $filter)`** — POSTs a
  `$vectorSearch` aggregation pipeline through RESTHeart. Returns
  `{_id, score, descriptor}` triples sorted by score. Failures log
  and return `[]` so callers can fall back. README documents the
  Atlas index spec (cosine, 256-dim default, configurable
  dimensions when swapping providers).

## Beacons design — paradigm shift to data-polled gravity (May 2026 — `c4588b4`, `592f15e`)

Two consecutive doc commits captured the design for **gravity
attractors / concept beacons** — a discrete-point complement to
the interpretation engine's anchor axes (which are directions).

`docs/BEACONS.md` v1 (`592f15e`) introduced the concept as
editor-authored attractors. **v2 (`c4588b4`) inverted the
paradigm**: beacons are *discovered* by polling the corpus for
concept alignment; the editor's role becomes curation
(suppress, rename, override) rather than authorship. Captures:

- The polling pipeline (taxonomy terms, author themes,
  interpretation poles, frequent n-grams as candidate sources).
- Presence (binary, for explicit references) vs relevance
  (cosine, for prose-derived candidates).
- Derived beacon properties: embedding = mean of aligned
  embeddings; position = mean of worldPos; mass = aligned count;
  radius = embedding spread; color = source-kind hue band.
- **Visuality + effector scope** scale with the polled outcome —
  bright dense beacons mark the corpus's actual centers of
  gravity; faint sparse beacons mark its sparsities.
- The gravitational math: `p(e) = (1−λ)·p₀(e) + λ·Σᵢ αᵢ(e)·qᵢ`
  with softmax over cosine similarity. O(n·d·k).
- Mongo storage shape (new `beacons` collection) with `kind` +
  `source` + `*_override` editorial overlay.
- Implementation phases (storage + projection → visual → editor
  curation panel → pole-derived + n-gram sources).

Status: design only, no code yet.

## Phase 3 v3 polish — stale-poles indicator + in-place upgrade safety (May 2026 — `18a5ae4`)

The v3 surface gained the lived-experience polish that proves
the loop is real.

- `WorldInterpretationEditor` stamps `profiles.<atm>.updated_at`
  on every save. `SnapshotPublisher` ships it as
  `interpretation.updatedAt`.
- `StageEditor.polesStale()` compares `interpretation.updatedAt`
  vs `interpretationAxes.embeddedAt`. When edited-since-embed:
  the Interpretation section shows an amber "⚠ poles edited
  since last embed — re-embed to activate" banner, and the
  Re-embed button in the World section turns amber with a glow
  ring and flips its label to "Re-embed (poles stale)".
- New `world_signature.install` with `hook_update_N` for in-
  place upgrade safety: 11001 seeds `world_signature.interpretation`
  when missing; 11002 seeds `world_signature.stage`. Fresh
  installs land via `config/install/*.yml` automatically;
  existing sites get the same defaults via `drush updb`.

## Phase 4 v0 — stage placements persist to Drupal (May 2026 — `abe794f`)

The Phase 2 v0 placement editor wrote zodiac drags to localStorage
only. Phase 4 moves the canonical sink to Drupal config.

- New `world_signature.stage` config keyed by
  `placements.<atmosphere>.<layer>`.
- `WorldStageEditor` service with replace-all `applyPlacements()`,
  per-placement validation (finite floats, scale ≥ 0), cap at
  256 per layer, idempotent `updated` reporting.
- `PATCH /world/edit/stage` endpoint with the same `edit world
  signature` permission.
- `SnapshotPublisher::loadStage()` ships
  `world.stage.layers.zodiac` for the active atmosphere.
- StageEditor: `save()` does localStorage + a fire-and-forget
  PATCH; `loadSaved()` prefers `snapshot.world.stage.layers.zodiac`
  when present.

## Phase 3 v3 activation — anchored projector (May 2026 — `3568eec`)

v3 shipped the editor; activation made it real.

- EmbedRunner gained a Pass 4: read every anchors atmosphere's
  poles from `world_signature.interpretation`, embed each pole
  in a single batch, compute axis direction =
  `normalize(emb_a − emb_b)`, Gram–Schmidt orthogonalize the
  axis set, persist per-atmosphere to State.
- `SnapshotPublisher::loadInterpretationAxes()` ships
  `world.interpretationAxes`.
- Client: `projectAnchored(embeddings, axes, targetRadius)` —
  per-entity dot products against the shipped axes (O(n·d·k));
  axis 0 → x, 1 → z, 2 → y.
- `inner-mind/index.ts::computeLayout()` branches on whether
  the snapshot carries axes; falls back to MDS-3D otherwise.
- Honest caveat documented: TF-IDF makes anchored axes
  near-lexical (per `INTERPRETATION_ENGINE.md` §3); flipping
  `WORLD_EMBED_URL` to a neural provider activates the
  authored meaning.

## Phase 3 v3 — anchor pole editor (May 2026 — `a5fe992`)

The editing surface for *minting meaning*.

- New `world_signature.interpretation` config storing
  per-atmosphere axis prose (3 axes × `{name, pole_a, pole_b}`).
  Seeded for inner-mind matching `INTERPRETATION_ENGINE.md` §3
  (recollection↔anticipation, self↔world, order↔dissolution).
- `WorldInterpretationEditor` service — structured patcher
  (atmosphere + sparse axis map), per-field validation, returns
  per-axis updated-field reports.
- `PATCH /world/edit/interpretation` endpoint.
- `SnapshotPublisher::loadInterpretation()` ships
  `world.interpretation`; new cache tag
  `config:world_signature.interpretation`.
- StageEditor: new "Interpretation" section (axis dropdown +
  name input + two pole textareas + Save). Sparse patches (only
  dirty fields). Surfaces "saved — re-embed to activate" status.

## Phase 3 v2.1 — palette tints in the editor (May 2026 — `2598eec`)

Three color pickers (`background`, `fog.color`, `ground.color`)
under the atmosphere dropdown.

- `WorldConfigEditor::ALLOWED_KEYS` extends with the three
  tint keys; hex regex validates before write.
- **Scope-aware**: tints write to `atmosphere_overrides.<active>.<key>`
  when a non-default atmosphere is active, to base palette when
  active is `none`. A patch that flips atmosphere AND retints
  in one save lands its tints on the *new* atmosphere's overlay
  — the editorial "switch to inner-mind and tweak its background"
  case.

## Phase 3 v2 — default-atmosphere editor (May 2026 — `af35f36`)

The first preview-vs-save template — the architectural shape
v3 reuses.

- `WorldConfigEditor` — whitelist-driven config writer for the
  `world_signature.palette` config (today: `active_atmosphere`,
  later extended to tints).
- `PATCH /world/edit/config` endpoint (same `edit world signature`
  perm).
- StageEditor "World defaults" section: atmosphere dropdown +
  Save button + dirty-state gating.
- Snapshot cache bust is free — the snapshot already carries
  the `config:world_signature.palette` tag.

## Phase 3 v1 — in-canvas re-embed trigger (May 2026 — `6214b0c`)

The freshness panel needed a verb.

- `EmbedRunner` service: single source of truth shared by
  `drush world:embed` and the new admin endpoint.
- `PATCH /world/admin/embed` (also POST), gated by new
  `edit world signature` permission.
- StageEditor "Re-embed corpus" button → fetch → `onRefresh()`.
- **Cache-tag plumbing**: the snapshot's State-driven
  `world.lastEmbed` had no cache tag of its own; new
  `world_signature:embed` tag stamped on the snapshot,
  invalidated by `EmbedRunner` after stamping freshness state.

## Phase 3 v0 — world freshness panel (May 2026 — `f164b72`)

Closes the silent-staleness blindness.

- StageEditor World section with embedded count / model
  version / last-embed time-ago / atmosphere display.

## Stage GUI v0 — placements (May 2026 — `7318304`)

The first editor surface — drag zodiac signs around their ring,
save to localStorage.

## Inner-mind composition (May 2026 — `055b8e2`)

Cluster spheres (overlap on commonality) + free-orbit camera.

## Toolbox boundary (May 2026 — `255ed49`)

The strict rule: every `import "three"` goes through
`src/toolbox/three.ts`. Enforced by
`scripts/check-toolbox-boundary.mjs` (prebuild hook).

## Interpretation engine (May 2026 — `cc13f2c`)

Client-side MDS-3D projection for inner-mind. The "always-works"
frame from `docs/INTERPRETATION_ENGINE.md` §3.

## Inner-mind design pass (May 2026 — `2b7cef7`)

Surrounding zodiac — surreal structures in the unreachable outer
orbit, framing the navigable centre as a star system.

## World switcher v2 (May 2026 — `cd60edb`, `09db96c`, `464b32a`, `f9eeaf3`)

Live in-place atmosphere flip with crossfade + per-atmosphere
audio; in-canvas HUD pill; read-only `?atmosphere=` snapshot hint.

---

*Older entries — MVP, ALPHA 1, BETA 2 — captured in `git log`
prior to 2026-05.*
