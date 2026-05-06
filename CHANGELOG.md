# Changelog

All notable changes to this project are recorded here. The format
loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased] — pre-v0.0.1 ALPHA

### Established (philosophy & architecture)

- **Site as World thesis** committed (`THESIS.md`). A site is not a
  collection of pages; it is a *place* whose geography is the
  editorial team's attention given physical form. URIs are
  coordinates; the world and the document are two valid
  representations of the same resource.
- **`world_signature` module as the metaphor cypher**
  (`docs/ARCHITECTURE.md`). The single source of truth for the
  dimensional re-orientation of content into 3D elements. **Required
  by every 3D theme under this thesis.** Listens to entity events;
  emits descriptors; depends on `world_embeddings`; has the snapshot
  publisher as an internal service.
- **Three-module PHP spine + JS renderer.** `world_embeddings` →
  `world_signature` → snapshot publisher, and the renderer reads
  snapshots. Search consumes embeddings directly, not through the
  cypher.
- **Two-side renderer/cypher coupling** via the descriptor JSON.
  Either side can be replaced as long as the descriptor contract
  holds.
- **Cards as the document representation, in situ.** The world
  contains the document, accessed by activation. Three runtime
  states: `Hidden` (zero cost), `Bloomed` (preview surfaced by a
  trigger pad, user- or event-driven), `FullView` (DOM overlay;
  three.js engine paused).
- **Trigger pads** as per-content-type interactive surfaces on each
  world object. Skinned per bundle; activated by click + hover
  preview, or by world events (schedule, proximity, search match,
  world-event-bus).
- **Engine pause during full-view reading**
  (`renderer.setAnimationLoop(null)`). The world stops to honor the
  document. Battery, focus, and computational quiet all win.
- **Search-driven blooming.** Open language search publishes bloom
  events to matching cards across the corpus; the world becomes a
  search interface.
- **URL coupling for cards.** `#card=<id>` for ephemeral bloom
  state; `/v/<viewMode>` for deep-linkable full-view state.
- **Language model: English core.** All content's source language
  is English; translations added for completeness; default property
  language set after the English core is in place. Per-property:
  `monpetitcafe` = English-core / Spanish-default.
- **Embedding epic** locked across E1–E7. First-class capability
  from day one, dual-purpose (within-sector geometry + open
  language search), with model-version tracking for staleness.
  Vector storage: MongoDB. Indexing: async via `advancedqueue`.
  Search: hybrid (BM25 + vector rerank). Reindex: cron + lazy
  on-retrieval.
- **DDEV-only working principle.** All code operations (npm,
  composer, phpunit, vitest, drush) run inside DDEV. No bare-host
  fallback path.

### Added (code)

- **JS spine** (`src/world/`): pure-TS `vantage(url, snapshot)`,
  layout math (`entityPosition`, deterministic within-sector
  offsets, FNV-1a hash for seeded determinism), URL parser,
  type definitions for the descriptor contract.
- **Vitest suite** with seven invariant tests for URI-as-coordinate
  (determinism, sector containment, sector adjacency, section
  vantage faces sector, borderland, front-page coverage,
  distinguishability). 11 cases, all green.

### Migrated

- **WSL home**: project moved from `I:\drupal-threejs-theme`
  (Windows) to `/home/csant/tecnocratica/projects/drupal-three-js-theme`
  (WSL2 Ubuntu) on 2026-05-05. Git history intact (4 commits at
  migration time). Git identity now resolves to `csantanad@gmail.com`
  via a path-conditional `includeIf` rule on
  `gitdir:~/tecnocratica/projects/`.
- Windows path retired with a marker `README.md` pointing to the
  WSL home and warning about WSL availability. The Windows
  directory is empty save for the marker.

### Documentation

- `THESIS.md` — philosophical thesis. Site as World. Adds *The
  document, in situ* — cards, three states, search-driven blooming.
- `docs/ARCHITECTURE.md` — normative architecture. Three-module PHP
  spine, descriptor schema with cards + model-version, cards
  three-state lifecycle, language model.
- `docs/PROTOCOL.md` — DDEV-only environment, test split, decision
  log expanded with 1–5, E1–E7, C1–C13. Added §4a (external
  version notes — Atlas-recommended PHP driver pins) and §4b
  (development MCP tooling — MongoDB MCP server, user-level config,
  read-only-by-policy).
- `CHANGELOG.md` — this file.
- `docs/EDITORIAL.md` — editor-facing guide to the eight axes of
  content richness; per-content-type recipes; pre-publish
  checklist. Lands before any editor sees the model.

### Development tooling

- **MongoDB MCP server registered at user level.** Each engineer
  configures `~/.claude.json` with `mongodb-mcp-server@latest` in
  read-only mode, scoped to a per-engineer `mcp_readonly` Atlas
  user. Gives Claude Code agents a direct, side-effect-free window
  into the cluster for verifying writes and inspecting vector
  indexes during development. Not a production tool. See
  `docs/PROTOCOL.md` §4b for setup.

## [Pre-history]

- 2026-04-27 — Repo greenfielded with README sketching the project's
  intent.
- 2026-05-03 — Philosophical thesis committed; project becomes
  active. (`7d6b967`)
- 2026-05-04 — URI-as-coordinate mechanic with invariant tests; 11
  cases green; `npm test` passes; tsc clean. (`228c9da`)
- 2026-05-05 — Architecture & protocol docs lock the project's
  normative shape; `world_signature` named as the required cypher
  for any 3D theme. (`5c0326e`)
- 2026-05-05 — Migrated to WSL; Windows path retired with a
  pointer-to-WSL marker README; git includeIf added for
  `~/tecnocratica/projects/`.
