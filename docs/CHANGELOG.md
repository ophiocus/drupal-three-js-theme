# Changelog

Reverse-chronological record of substantive feature work. One section
per logical chapter, oldest at the bottom. For per-commit detail see
`git log`; this file captures *what arrived and why*.

Sections are stamped with their lead commit (newest in the chapter)
and the date range of the work.

---

## i18n polish & docs (May 2026 — head: `<this commit>`)

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
