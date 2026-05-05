# Development and prototyping protocol

> **Scope:** how to develop, test, and prototype changes in this mixed
> PHP + TypeScript repo without losing your mind. Operational
> companion to [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Repo shape (target)

```
.
├── README.md, THESIS.md            # narrative — what this is, why
├── docs/                           # ARCHITECTURE.md, PROTOCOL.md
├── package.json, tsconfig.json     # JS toolchain (Vite + Vitest)
├── vitest.config.ts
├── composer.json                   # PHP toolchain (PHPUnit)
├── .ddev/                          # local Drupal sandbox
├── src/                            # JS — theme runtime
│   └── world/
├── test/                           # JS tests
├── modules/
│   └── world_signature/            # PHP — companion module (the cypher)
│       ├── world_signature.{info.yml,module,services.yml,install}
│       ├── src/
│       └── tests/src/
│           ├── Unit/
│           └── Kernel/
└── theme/                          # Drupal theme files
    ├── drupal_threejs.info.yml
    ├── drupal_threejs.libraries.yml
    └── templates/
```

Two toolchains, side by side. JS work touches `src/` and `test/`. PHP
work touches `modules/world_signature/`. Theme work touches `theme/`.
They merge in CI and at deploy time. Nothing in `theme/` ever imports
from `modules/`; coupling is via the descriptor contract only.

## 2. Local environments

Three environments, used at different speeds.

### 2.1 Bare PHP — for unit tests

PHPUnit unit tests in `modules/world_signature/tests/src/Unit/` run on
bare PHP + Composer. **No DDEV needed**, no Drupal bootstrap.

```bash
composer install
composer run test:unit
```

This is the fast inner loop for cypher math.

### 2.2 Vitest — for renderer math

```bash
npm install
npm test
```

The fast inner loop for vantage and layout math. Already in place; see
`test/vantage.test.ts`.

### 2.3 DDEV — for kernel tests, integration, and prototyping

A **sandbox property** lives inside this repo's `.ddev/`. It is a
disposable Drupal 11 site that requires this theme via a Composer
path-repository, so changes in `modules/world_signature/` and
`theme/` show up immediately.

```bash
ddev start
ddev composer install
ddev drush site:install minimal
ddev drush theme:install drupal_threejs
ddev drush theme:default drupal_threejs
ddev drush phpunit modules/world_signature/tests/src/Kernel
```

The sandbox is **not a property repo**. It is the prototyping surface,
seeded from `fixtures/sandbox.sql` and rebuildable in seconds:

```bash
ddev drush sql:cli < fixtures/sandbox.sql
ddev drush cache:rebuild
```

## 3. Test split

| Layer | Lives in | Runs in | Speed | What it covers |
| --- | --- | --- | --- | --- |
| **JS unit** | `test/*.test.ts` | Vitest, Node | <100 ms / suite | URI→coordinate, layout math, descriptor parsing |
| **PHP unit** | `modules/world_signature/tests/src/Unit/` | PHPUnit, bare PHP | <1 s / suite | Signature extractor math, serialization round-trip |
| **PHP kernel** | `modules/world_signature/tests/src/Kernel/` | PHPUnit in DDEV | seconds / suite | Hooks fire, queue worker runs, snapshot publishing produces the expected JSON |

CI runs all three on every push. Local development typically runs only
the unit layers between commits; kernel tests run on push, on a
sandbox rebuild, or manually before a PR.

## 4. Decision log

The decisions that shape the codebase. Update this when revisiting.

| # | Decision | Choice | Rationale |
| --- | --- | --- | --- |
| 1 | Module location | In this repo, alongside the theme (`modules/world_signature/`). | One repo, one history, atomic changes across cypher + renderer + theme. Will split out if cypher reaches independent reuse. |
| 2 | DDEV | Set up here, in this repo, as a sandbox property. | The sandbox doubles as the integration test surface and the prototyping playground; a property repo would couple us to a specific site's editorial schema. |
| 3 | Queue mechanism | `drupal/advancedqueue` (contrib). | Retries, admin UI, observable failure modes. Sturdier than core Queue API for the production pipeline. |
| 4 | Embedding posture (v1) | Slot reserved in the signature schema, feature-flagged off; placeholder hash populated for plumbing. | Tests cover the Semantic layer's wire shape without committing to an embedding service. v2 fills the slot without a schema migration. |

## 5. Prototyping a new metaphor

The protocol for trying a new mapping (e.g. *what if a `news_alert`
content type became a thunderclap moving across the sky?*).

1. Add the content type to the sandbox's config (`config/sync/`).
2. Define the metaphor mapping in the theme's per-content-type config
   (`theme/config/world_metaphors.yml` or similar).
3. `ddev drush world:publish` — refresh the snapshot.
4. Reload the renderer. The new content type renders by mapping
   defaults until the override is implemented.
5. Iterate. Commit only when the mapping has stabilised.

The sandbox is **disposable**. `fixtures/sandbox.sql` is the canonical
seed. If your sandbox's state diverges in a way you don't want to
keep, rebuild it; if you want to keep it, export to the fixture:

```bash
ddev drush sql:dump > fixtures/sandbox.sql
```

## 6. Workflow gates

- **Pre-commit:** `npm test && composer run test:unit` (unit only,
  fast).
- **Pre-push (manual or CI):** kernel tests + `tsc --noEmit` +
  PHP static analysis (phpstan or psalm — TBD).
- **CI:** unit + kernel + linters + `vite build`. Image build only on
  `main`.
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
  commit**. The CI is allowed to fail loudly if the canonical fixture
  doesn't round-trip on both sides.
