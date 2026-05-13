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

### 2.5 External services (sandbox vs production)

The cypher writes through a gateway, not directly to a database.
Local development and production use the same shape:

| Service | Sandbox (DDEV) | Production (tecnocratica VPS) |
| --- | --- | --- |
| **MongoDB Atlas cluster** | M0 free tier (one shared sandbox cluster) | One cluster per client/theme deployment |
| **RESTHeart gateway** | Container in DDEV (`ddev get` add-on or custom service in `.ddev/docker-compose.restheart.yaml`) | Sidecar container in the property's compose stack |
| **Embedding generation** | Atlas-managed (Voyage) — fires on insert into a Vector Search-indexed collection. No separate embedder service. | Same — Atlas handles it server-side. |
| **LLM operations** (chatvatars, query translation in v0.0.3+) | `drupal/ai` + `drupal/ai_provider_anthropic` from Drupal | Same |

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
| E2 | Vector storage | **MongoDB Atlas** (`$vectorSearch` aggregation, Atlas-managed Voyage embeddings on insert). One cluster per client / per theme deployment for tenant isolation. | Purpose-built filter/projection language; scales independently of MariaDB; per-tenant isolation is a hard requirement once the cypher becomes a service offering. |
| E2a | Atlas access path | **RESTHeart sidecar** as the gateway. Drupal speaks Guzzle/HTTPS to RESTHeart; RESTHeart routes per-tenant to the right Atlas cluster. *(Pivot recorded 2026-05-07; Atlas App Services was sunset 2025-09-30, killing the original Function-as-bridge plan.)* | Multi-tenant routing, central auth, observability gateway, no `ext-mongodb` in DDEV. Direct `mongodb/mongodb` PHP driver kept on file as the second-fallback. |
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

## 4b. Development tooling — MCP servers

Claude Code agents working on this project benefit from a direct
window into Atlas. The dev environment expects (but does not
require) the **MongoDB MCP server** registered at the user level.

### What it gives us

- Inspect the `descriptors` collection without going through Drupal.
- Verify a queue worker's Atlas write actually landed.
- Run `$vectorSearch` aggregations during search-tuning (Sprint 3b-2+).
- Inspect vector index definitions Atlas auto-creates.

### Configuration

The MCP server is **user-level, not project-level**. Each engineer
configures it in their own `~/.claude.json` against a personal
read-only credential. No MCP config is committed to this repo.

Setup (per-engineer, one-time):

1. **In Atlas:** create a database user `mcp_readonly` (or similar)
   with `read` role scoped to `drupal_three_js_theme_world` only.
   Do **not** reuse the cluster's admin user (`csantanad_db_user`).
2. **In WSL:** run `npx mongodb-mcp-server@latest setup`. Pick
   *Claude Code* as the client, paste the connection string for
   the `mcp_readonly` user, **enable read-only mode** (the
   wizard's recommended default).
3. **Restart Claude Code** to register the MCP server.

The resulting config block in `~/.claude.json`:

```json
{
  "mcpServers": {
    "MongoDB": {
      "command": "npx",
      "args": ["-y", "mongodb-mcp-server@latest", "--readOnly"],
      "env": {
        "MDB_MCP_CONNECTION_STRING": "mongodb+srv://mcp_readonly:<password>@<cluster-host>/drupal_three_js_theme_world"
      }
    }
  }
}
```

### Boundaries

- **Read-only by policy.** The `--readOnly` arg + the user's
  scoped `read` role are belt-and-suspenders. Don't grant the
  MCP user write access; if you need to clear test data, use
  Drupal-side or the Atlas web UI.
- **Not a production tool.** Production Drupal writes via the
  cypher's queue worker; MCP is for development verification
  only.
- **Credential hygiene.** Never paste the `mcp_readonly`
  password into chat or commit messages. The password lives
  in `~/.claude.json` (gitignored at the user level by Claude
  Code itself).

### Verifying the MCP is wired

After restarting Claude Code, the agent should see tools prefixed
with `mcp__MongoDB__*` (e.g. `mcp__MongoDB__find`,
`mcp__MongoDB__aggregate`, `mcp__MongoDB__list_collections`).
A simple sanity query: list collections in
`drupal_three_js_theme_world` — should return `[]` until Sprint
3b-2 writes the first descriptor.

## 4c. Asset MCP servers — Sketchfab + Blender

Once `v0.1.3` lands its `ProfileBuilder` (per
`docs/v0.1/SMART_OBJECTS.md`), the renderer needs real 3D assets
— rigged figures, idle animations, props. Two MCP servers give
agents working on this project the ability to source and
manipulate those assets without leaving the chat.

Both are **optional**: every Builder degrades to a primitive
when its required asset is missing (per
`FallbackBuilder.matches()` and the `try/catch` guards inside
each specific Builder). An engineer not running these MCPs sees
the cube fallback for any glb-dependent entity; nothing breaks.

### 4c.1 Sketchfab MCP — asset discovery + download

Searches and downloads free 3D models from Sketchfab. The
matching pattern for our use: rigged low-poly characters under
CC0 or CC-BY licenses, exported as `.glb`.

#### What it gives us

- Search Sketchfab's catalog by keyword + license filter + format.
- Read model metadata (polycount, animation count, license,
  attribution required y/n).
- Download in `gltf` / `glb` / `usdz` / source format.

For the project this collapses asset sourcing from "open browser,
search, download, unzip, find the glb, copy to theme assets" to
a single agent call.

#### Configuration (per-engineer, one-time)

1. **Get a Sketchfab API token.** Free account at
   [sketchfab.com](https://sketchfab.com); profile → settings →
   *Password & API* → copy the token. The token grants the same
   read/download permissions the logged-in user has — keep it
   private.
2. **Add to `~/.claude.json`** (user-level, not committed):

   ```json
   {
     "mcpServers": {
       "Sketchfab": {
         "command": "npx",
         "args": ["-y", "@gregkop/sketchfab-mcp-server"],
         "env": {
           "SKETCHFAB_API_TOKEN": "<your-token>"
         }
       }
     }
   }
   ```

3. **Restart Claude Code** so the server registers.

The Windows-host `~/.claude.json` is the one Claude Code reads;
if you're working through WSL, follow the host-side merge pattern
documented in the founding-session battle scars (jq merge of the
`mcpServers` block) rather than maintaining two configs.

#### Usage patterns

| Want | Agent does |
|---|---|
| A stylized humanoid figure | `mcp__Sketchfab__search` with `q="low-poly character"`, `license=cc0`, `format=glb`, `animated=true` |
| Inspect a candidate before downloading | `mcp__Sketchfab__get_model` with the model UID |
| Download to project | `mcp__Sketchfab__download_model` to `web/themes/custom/drupal_threejs/assets/models/<slug>.glb` |

**License hygiene** — when a CC-BY asset lands in the project,
the attribution string (author + URL + license) must be
recorded in `docs/ASSET_ATTRIBUTIONS.md` (created the first time
a CC-BY asset arrives). CC0 assets need no attribution but are
worth recording anyway for provenance. The Sketchfab MCP returns
the attribution block per asset; agents are expected to append
it on download.

#### Boundaries

- **Free / open-license only.** Don't download anything under
  Sketchfab's "Editorial" or "Standard" commercial licenses for
  use in the project; the matching `license=cc0|cc-by|cc-by-sa`
  filter is non-negotiable for shipped assets.
- **Read-only operations only.** The server supports search and
  download; do not enable the upload-side of Sketchfab's API
  from this MCP.
- **API rate limits.** Sketchfab's free tier rate-limits search
  to ~60/minute. Don't sweep the catalog in a tight loop.

### 4c.2 Blender MCP — modeling + asset transformation

When Sketchfab doesn't have what we need (or what's there needs
re-rigging, re-scaling, animation re-targeting, or stylization
to match the world's aesthetic), Blender MCP lets an agent
drive Blender directly: create scenes, modify objects, run
Python, export glb.

#### What it gives us

- Scene inspection (current objects, materials, modifiers).
- Object create / modify / delete + parameter control.
- Arbitrary Python execution inside Blender (the escape hatch).
- Pull from **Poly Haven** (CC0) and **Sketchfab** (forwarded
  through Blender MCP's own Sketchfab integration).
- AI-generated geometry via **Hyper3D / Hunyuan3D** text-to-3D
  (useful for v0.2+ generative Chatvatar work).
- Export the active scene or selection as `.glb` / `.gltf` /
  `.fbx` / `.obj`.

Blender MCP is heavier than Sketchfab MCP — it talks to a
running Blender instance via a Blender addon — but its scope
covers the whole pipeline from blank scene to project-ready glb.

#### Configuration (per-engineer, one-time)

1. **Install Blender** (4.0+ recommended).
   - Windows: [blender.org/download](https://www.blender.org/download/).
   - WSL: Blender is GUI-heavy; run it on the Windows host even
     if your project files live in WSL. Save exported glbs into
     the WSL-mounted project path.
2. **Install the Blender addon.** Clone
   [ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp),
   open Blender → *Edit → Preferences → Add-ons → Install* and
   point it at the repo's `addon.py`. Enable the addon. The
   addon shows a panel in the 3D viewport's N-side; click
   *Start MCP Server* to open the listener (default port 9876).
3. **Add the MCP server to `~/.claude.json`:**

   ```json
   {
     "mcpServers": {
       "Blender": {
         "command": "uvx",
         "args": ["blender-mcp"]
       }
     }
   }
   ```

   The server is a Python tool installed via `uv` / `uvx`; if
   `uv` isn't on PATH, install it with
   `curl -LsSf https://astral.sh/uv/install.sh | sh` (per
   astral.sh) then re-run.
4. **Restart Claude Code.** Blender must be running with the
   addon's MCP server started *before* an agent reaches for
   `mcp__Blender__*` tools; otherwise the calls fail with a
   connection-refused error.

#### Usage patterns

| Want | Agent does |
|---|---|
| A Poly Haven HDRI for environment lighting | `mcp__Blender__poly_haven_search` + `download_asset` |
| Stylize a Sketchfab figure to match the world | search via Sketchfab MCP, download via Sketchfab MCP, *open in Blender* via Blender MCP, run a Python script to recolor/decimate/re-rig, *export glb* |
| Generate a chair "looking like Antigua coffee shop" | `mcp__Blender__hyper3d_generate` with the prompt |
| Recompute UVs or bake a procedural material | `mcp__Blender__execute_python` with the recipe |

#### Boundaries

- **Local Blender instance only.** No agent should `apt install`
  Blender into the DDEV web container — Blender is a
  developer-tool, not a runtime dependency. Per the DDEV-only
  working principle (§1), Blender is an exception: it lives on
  the host because it's authoring software, not application code.
- **Generated content gets license-tagged.** Hyper3D / Hunyuan3D
  generations are CC0 by default; record the prompt and seed in
  `docs/ASSET_ATTRIBUTIONS.md` so the provenance is reproducible.
- **Python execution is wide-open.** The
  `mcp__Blender__execute_python` tool runs arbitrary Python
  inside Blender. Don't paste Python that touches the filesystem
  outside the project's `web/themes/custom/drupal_threejs/assets/`
  tree without a clear reason.

### 4c.3 When to use which (and when to use neither)

Decision tree at the point of needing an asset:

1. **Is it already in `web/themes/custom/drupal_threejs/assets/`?**
   Use it.
2. **Is there a known CC0 source** (Quaternius, Kenney.nl, Poly
   Haven, three.js examples)? Fetch by curl, drop into assets/.
   Fastest path; no MCP setup needed.
3. **Does Sketchfab have a near-fit under CC0 or CC-BY?**
   Sketchfab MCP, search + download, record attribution.
4. **Does the asset need shape/material modification to fit
   the world's aesthetic?** Sketchfab → Blender MCP for the
   modification step → export glb.
5. **Is the asset something no library plausibly has** (the
   property's brand persona, a custom Chatvatar)? Blender MCP
   with Hyper3D for the generation step → manual review +
   touch-up → export.

Most v0.1.3 work (ProfileBuilder, first rigged figure) lives in
step 2 or 3. Steps 4–5 wait for v0.2+ when the world's aesthetic
is more crystallized.

### 4c.4 Verifying the MCPs are wired

After restarting Claude Code with either or both configured:

- **Sketchfab:** the agent should see `mcp__Sketchfab__search`,
  `mcp__Sketchfab__get_model`, `mcp__Sketchfab__download_model`.
  Sanity query: search `q="cube"`, `license=cc0`, `count=1`.
- **Blender:** with Blender running + addon active + *Start MCP
  Server* clicked, the agent should see
  `mcp__Blender__get_scene_info`, `mcp__Blender__execute_python`,
  `mcp__Blender__poly_haven_search`, etc. Sanity query:
  `mcp__Blender__get_scene_info` → returns the current scene's
  object list (likely just the default cube + camera + light).

If either MCP is registered but tools don't show up, check
Claude Code's MCP logs (settings → MCP Servers → server name →
*View logs*) for connection errors. The two most common scars:

- **Sketchfab token expired** — generate a new one; `npx` won't
  warn, the search just returns 401s.
- **Blender addon not listening** — the *Start MCP Server*
  button must be clicked each time Blender restarts; the addon
  doesn't auto-start.

## 4a. External service version notes — RESTHeart-mediated stack

> **Architecture pivot recorded 2026-05-07.** Atlas App Services
> (and its Custom HTTPS Endpoints + Functions) was sunset on
> **2025-09-30**. The original Sprint 3b-2 design that bridged
> Drupal → Guzzle HTTPS → Atlas Function → cluster is dead. We
> pivoted to **RESTHeart** as the data gateway. See
> [docs/ARCHITECTURE.md §9](ARCHITECTURE.md) for the full pattern.

### Stack pinned at the pivot

| Layer | Component | Notes |
| --- | --- | --- |
| **Drupal-side data access** | Guzzle (already in Drupal core) | No PHP MongoDB driver, no `ext-mongodb`. Drupal sees only HTTPS to RESTHeart. |
| **Gateway** | RESTHeart (Java/Kotlin, OSS, Apache 2.0) | Self-hosted on the tecnocratica VPS as a Docker sidecar. |
| **Vector store** | MongoDB Atlas — one cluster per client / per theme deployment | Atlas-managed embeddings (Voyage-powered, post-MongoDB-acquisition) trigger on insert; no separate embedder service needed. |
| **Auth Drupal → RESTHeart** | JWT or scoped API key issued by RESTHeart | Per-property credential. Token leak compromises one property, not all clusters. |
| **Auth RESTHeart → Atlas** | MongoDB connection string per cluster, configured in RESTHeart's `restheart.yml` | One credential per managed cluster. RESTHeart never exposes the connection strings outward. |

### Versions worth recording

Captured 2026-05-07 from upstream sources:

| Component | Version line |
| --- | --- |
| **RESTHeart** | track latest 8.x; pin to a specific tag in production compose for reproducibility |
| **MongoDB Atlas Vector Search** | M0+ supports `$vectorSearch`; managed embeddings GA per Atlas docs |
| **Drupal `guzzlehttp/guzzle`** | tracks Drupal core's pin (^7.x as of D11.3) |

### Fallback path (kept on file)

If RESTHeart turns out to be operationally unsuitable in the future
(unlikely but possible; the pivot's escape hatch is the same one we
nearly took before App Services died):

| Driver | Version |
| --- | --- |
| `mongodb/mongodb` (PHPLIB) | ^1.11 |
| `ext-mongodb` (PECL) | ^1.10 |

The fallback recipe — install `ext-mongodb` via PECL in
`.ddev/web-build/Dockerfile.example`, add `mongodb/mongodb` to
`composer.json`, replace `WorldSearchClient`'s HTTPS calls with
direct `MongoDB\Client` calls — is the same shape we documented
pre-pivot. Recorded here as the second-fallback option only.

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
