# Development and prototyping protocol

> **Scope:** how to develop, test, and prototype changes in this mixed
> PHP + TypeScript repo without losing your mind. Operational
> companion to [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Repo shape (target)

```
.
├── README.md, THESIS.md            # narrative — what this is, why
├── CHANGELOG.md                    # what shipped when
├── docs/                           # ARCHITECTURE.md, PROTOCOL.md
├── package.json, tsconfig.json     # JS toolchain (Vite + Vitest)
├── vitest.config.ts
├── composer.json                   # PHP toolchain (PHPUnit)
├── .ddev/                          # local Drupal sandbox
├── src/                            # JS — theme runtime
│   └── world/
├── test/                           # JS tests
├── modules/
│   ├── world_embeddings/           # PHP — embedding lifecycle owner
│   │   ├── world_embeddings.{info.yml,module,services.yml,install}
│   │   ├── src/{Embedder,Storage,Search,Projection,Plugin}/
│   │   └── tests/src/{Unit,Kernel}/
│   └── world_signature/            # PHP — companion module (the cypher)
│       ├── world_signature.{info.yml,module,services.yml,install}
│       ├── src/
│       └── tests/src/{Unit,Kernel}/
└── theme/                          # Drupal theme files
    ├── drupal_threejs.info.yml
    ├── drupal_threejs.libraries.yml
    └── templates/
```

Two toolchains, side by side. JS work touches `src/` and `test/`. PHP
work touches `modules/world_embeddings/` or `modules/world_signature/`.
Theme work touches `theme/`. They merge in CI and at deploy time.
Nothing in `theme/` ever imports from `modules/`; coupling is via the
descriptor contract only.

## 2. Local environment — DDEV

> **Working principle.** All code operations run inside DDEV. There is
> no bare-host fallback path. The host machine needs only Docker + DDEV
> installed; PHP, Composer, Node, MariaDB, and MongoDB are all provided
> by the containerized environment.

A sandbox property lives inside this repo's `.ddev/`. It is a
disposable Drupal 11 site that requires this theme via a Composer
path-repository, so changes in `modules/world_embeddings/`,
`modules/world_signature/`, `theme/`, and `src/` show up immediately.

### 2.1 Bring-up

```bash
ddev start                              # bring up the container stack
ddev composer install                   # install PHP deps
ddev npm install                        # install JS deps
ddev drush site:install minimal
ddev drush en world_embeddings world_signature advancedqueue
ddev drush theme:install drupal_threejs
ddev drush theme:default drupal_threejs
```

### 2.2 Running tests

| Layer | Command |
| --- | --- |
| **JS unit** (Vitest) | `ddev npm test` |
| **PHP unit** (PHPUnit, no Drupal bootstrap) | `ddev composer run test:unit` |
| **PHP kernel** (PHPUnit + Drupal kernel) | `ddev exec phpunit modules/*/tests/src/Kernel` |

### 2.3 Live editing

```bash
ddev npm run dev                        # Vite dev server, exposed via DDEV's reverse proxy
ddev exec drush cr                      # cache rebuild after Drupal-side changes
```

### 2.4 Sandbox seeding

The sandbox is **disposable**. `fixtures/sandbox.sql` is the canonical
seed. Rebuild:

```bash
ddev drush sql:cli < fixtures/sandbox.sql
ddev drush cache:rebuild
```

Save the current sandbox state as the new fixture:

```bash
ddev drush sql:dump > fixtures/sandbox.sql
```

### 2.5 Required DDEV add-ons

- **MongoDB** — vector storage. Installed via
  `ddev get ddev/ddev-mongo` (or equivalent). Production gets a
  sibling container in compose; sandbox uses the same image.
- **Embedder sidecar (sandbox)** — local sentence-transformers
  Python service, exposed as a DDEV service on a private port.
  Production swaps to Voyage AI via the same `EmbedderInterface`.

## 3. Test split

| Layer | Lives in | Speed | What it covers |
| --- | --- | --- | --- |
| **JS unit** | `test/*.test.ts` | <100 ms / suite | URI→coordinate, layout math, descriptor parsing, vantage |
| **PHP unit** | `modules/*/tests/src/Unit/` | <1 s / suite | Signature extractor math, serialization round-trip, embedding interface contracts |
| **PHP kernel** | `modules/*/tests/src/Kernel/` | seconds / suite | Hooks fire, queue worker runs, snapshot publishing produces the expected JSON, search service returns ranked results |

All three run inside DDEV. CI runs all three on every push. Local
development typically runs only the unit layers between commits;
kernel tests run on push, on a sandbox rebuild, or manually before a
PR.

## 4. Decision log

| # | Decision | Choice | Rationale |
| --- | --- | --- | --- |
| 1 | Module location | In this repo, alongside the theme. | One repo, one history; atomic changes across cypher + renderer + theme. Will split out if either module reaches independent reuse. |
| 2 | DDEV | Set up here as a sandbox property. | Doubles as integration test surface and prototyping playground. |
| 3 | Queue mechanism | `drupal/advancedqueue` (contrib). | Retries + admin UI; sturdier than core Queue API. |
| 4 | Embedding posture | First-class capability from day one. Not a deferred slot. | E1–E7 below; the embedding epic. |
| 5 | All code operations under DDEV | No bare-host fallback. | Single source of truth for tool versions; matches the webrunners stack working norm. |
| **Embedding epic** | | | |
| E1 | Embedding source | Voyage AI for production (`voyage-multilingual-2`); local sentence-transformers for sandbox. Both behind the same `EmbedderInterface`. *Pending user confirmation that "Claude" was shorthand for "Anthropic-aligned" — Anthropic does not offer first-party embeddings as of 2026-05-05.* | Closest-to-Claude posture that exists today; ships free in dev, paid in prod with a swap. |
| E2 | Vector storage | **MongoDB** (`$vectorSearch` aggregation; self-hosted Community Edition or Atlas, per-property choice). | Purpose-built filter/projection language; scales independently of MariaDB. |
| E3 | Indexing strategy | Async via `advancedqueue`. | Editor save is fast; vector arrives seconds later; resilient to embedder outages. |
| E4 | Search API surface | Both — Drupal route (`/api/world/search?q=...`) + JSON:API resource. | One backend, two surfaces. |
| E5 | Search type | Hybrid (BM25 + vector rerank). | Modern default; better recall on uncommon proper nouns. |
| E6 | Reindex protocol | Cron-driven bulk reindex *and* lazy on-retrieval determination. Reads check the stored vector's `modelVersion` tag; if stale, mark for reembed and serve stale this time. Cron sweeps the marked set. | Belt-and-suspenders. Cron prevents lazy path overload; lazy catches stragglers and post-cron model upgrades. |
| E7 | Language model | English is the language core for all content. Translations added for completeness. Default site language set per property only after the English core is in place. monpetitcafe → English-core / Spanish-default. | One vector space across the ecosystem; cross-property search free; query-translation via LLM (Claude is good at it) → embed in English → display in property's default language. |
| **Card model** | | | |
| C1 | Card source | Drupal view modes. Deck = enabled view modes for the bundle. | No new abstraction; reuse Drupal's existing render-array machinery. |
| C2 | Activation (trigger pad) | Click + hover preview. Touch maps to tap. | Modality without surprise; hover signals interactability without committing. |
| C3 | Paragraphs: cards or sub-objects | Per-paragraph-type config. Hero/quote/callout = cards on parent. Body-text = inline content of parent's main card. Section/divider = sub-objects in the world. | Editorial flexibility with sane defaults per type. |
| C4 | Rendering surface | DOM overlay over canvas (real `<div>`s). | Accessibility, copy-paste, browser-native features all work without bridges. |
| C5 | URL coupling | Bloom = URL fragment (`#card=<id>`); FullView = path segment (`/v/<viewMode>`). | Fragment for ephemeral state (no server hit on back/forward); path for deep-linkable, server-renderable state. |
| C6 | Deck UI | Single card visible with tabs to switch. Multi-pane responsive is v2. | Familiar; tabs map to `aria-tabpanel` for accessibility. |
| C7 | World during full view | **Engine paused** (`renderer.setAnimationLoop(null)`). Canvas freezes / fades; DOM overlay carries the read. | Battery and focus win bigger than DoF blur, especially on mobile. |
| C8 | Mode transition | `Mode = exploration \| reading` flag on SceneManager. Single state owner; clean enter/exit hooks. | Single source of truth for the renderer's macro-state. |
| C9 | Trigger pad design | Skinned per content type, with a sane default. Editorial config exposes the skin. | Visual identity per content type without forcing custom geometry per object. |
| C10 | Bloom event triggers | Schedule, proximity, search match, world-event-bus. Editorial config picks the subset per card. | Extensible; other modules can publish triggers without modifying the renderer. |
| C11 | Bloom auto-close | TTL per trigger source. Search blooms fade after 30 s; schedule blooms persist; manual blooms persist until dismissed. | Different sources have different urgency profiles. |
| C12 | Multi-card simultaneous bloom | Allowed, capped at 3 visible. Excess queue. | "This object has several reasons to look at it right now." |
| C13 | Engine-pause granularity | Full pause. | Throttle is a half-measure that loses most of the battery win. |

## 5. Prototyping a new metaphor

The protocol for trying a new mapping (e.g. *what if a `news_alert`
content type became a thunderclap moving across the sky?*).

1. Add the content type to the sandbox's config (`config/sync/`).
2. Define the metaphor mapping in the theme's per-content-type config
   (`theme/config/world_metaphors.yml`).
3. Configure the deck — which view modes are cards, which paragraphs
   are cards-on-parent vs sub-objects in the world, what events bloom
   each card, what the trigger pad looks like.
4. `ddev drush world:publish` — refresh the snapshot.
5. Reload the renderer. The new content type renders by mapping
   defaults until each override is implemented.
6. Iterate. Commit only when the mapping has stabilised.

The sandbox is **disposable**. `fixtures/sandbox.sql` is the canonical
seed.

## 6. Workflow gates

- **Pre-commit:** `ddev npm test && ddev composer run test:unit`
  (unit only, fast).
- **Pre-push (manual or CI):** kernel tests + `ddev exec tsc --noEmit`
  + PHP static analysis (phpstan or psalm — TBD).
- **CI:** unit + kernel + linters + `ddev npm run build`. Image build
  only on `main`.
- **Deploy on a property:** `drush deploy` followed by
  `drush world:publish` so the snapshot reflects live config.

## 7. Cross-toolchain etiquette

- Don't import PHP-side enums into TS or vice versa. Keep type
  definitions parallel and synced via the descriptor contract.
- The descriptor schema lives in two places: as TS types in
  `src/world/types.ts`, and as PHP value objects in
  `modules/world_signature/src/Signature/`. A schema test in each
  language asserts they round-trip the same JSON fixture
  (`fixtures/descriptor-canonical.json`).
- When the descriptor changes, both sides update **in the same
  commit**. CI fails loudly if the canonical fixture doesn't
  round-trip on both sides.
- The `EmbedderInterface` contract lives in PHP. The renderer never
  calls an embedder directly; it consumes pre-computed vectors from
  the snapshot. Crossing this line is a smell.
