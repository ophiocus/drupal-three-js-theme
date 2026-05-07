# Architecture

> **Status:** locked 2026-05-05.
> **Scope:** normative architectural facts that apply to any project
> built under the Site-as-World thesis. New constraints land here;
> they cannot be relaxed by an individual theme or property.

## 1. The three-module PHP spine + the JS renderer

A Site-as-World installation is a four-piece system, three on the
PHP side and one on the JS side, coupled only by the descriptor
contract.

| Side | Module / Bundle | Responsibility | Where it lives |
| --- | --- | --- | --- |
| PHP | **`world_embeddings`** | Owns the embedding lifecycle. Computes vectors on entity save, stores them, exposes the `EmbedderInterface` and `EmbeddingStorageInterface`, runs the search service (BM25 + vector rerank). | `modules/world_embeddings/` |
| PHP | **`world_signature`** (the cypher) | Translates content into a dimensional signature. Listens to entity events; reads vectors from `world_embeddings`; emits descriptors; publishes corpus snapshots. | `modules/world_signature/` |
| PHP | **Snapshot publisher** | Drush command + cron worker; assembles versioned corpus snapshots and writes them to a known artifact path the renderer fetches. Lives in `world_signature` as a service. | `modules/world_signature/src/Snapshot/` |
| JS | **The renderer** | Reads snapshots, places objects, runs the camera (`vantage`), owns the SceneManager state machine, manages the card lifecycle, dispatches bloom events. | `src/` |

The wire format between PHP and JS is the **descriptor** — JSON shape
the cypher emits and the renderer consumes. The descriptor is the only
coupling. Either side can be replaced as long as the contract holds.

The wire format between `world_signature` and `world_embeddings` is
two PHP interfaces (`EmbedderInterface`, `EmbeddingStorageInterface`).
Search consumers (Drupal route, JSON:API, drush, external API) talk
to `world_embeddings` directly, not through the cypher.

## 2. The `world_signature` module — the metaphor cypher

The `world_signature` module is the **single source of truth for the
dimensional re-orientation of content into 3D elements.** It is the
*cypher*: the formal record of every metaphor that turns content into
world (article → room; paragraph → object in the room or card on the
parent; taxonomy → biome; edit-frequency → glow). When the metaphors
change, they change here, in one place, with version control.

### 2.1 Required by any 3D theme

> **Rule.** Any theme operating under the Site-as-World thesis MUST
> declare `world_signature` as a dependency in its `*.info.yml`. A 3D
> theme without `world_signature` is undefined behavior. There is no
> *light* version, no inline alternative, no theme-side opt-out.
>
> `world_signature` itself depends on `world_embeddings`; enabling
> the cypher pulls in the embedder.

### 2.2 Why a module, not a theme service

- Themes can be swapped per-property without invalidating the cypher's
  output. Switching visual style must not invalidate the corpus's
  signature data.
- A property running multiple themes (admin theme + 3D theme; A/B
  experiments) must share the same cypher; the module is the only
  sensible place.
- Drupal's module/theme separation is load-bearing here: modules can
  hook entity events, themes cannot.
- The cypher's output is consumed by tools other than the renderer
  (search indexes, analytics, sitemap generators, neighboring
  properties). A theme is the wrong distribution channel for that.

### 2.3 What the cypher does

1. Listens for entity insert / update / delete events.
2. For each event, enqueues a **signature extraction** job.
3. The worker computes a four-layer signature for the entity:
   - **Structural** — counts, dimensions, completeness, *card metrics*.
   - **Temporal** — when, how often, age relative to the corpus.
   - **Relational** — graph position: in/out-degree, taxonomy
     fingerprint, centrality.
   - **Semantic** — topic embedding (sourced from `world_embeddings`)
     plus the model-version tag for staleness detection.
4. Stores the signature on the entity as a computed field
   (`field_world_signature`).
5. Enumerates the entity's **cards** from the per-bundle config.
6. On request — drush command, scheduled snapshot publisher, deploy
   hook — the snapshot publisher assembles a **corpus snapshot**:
   every entity's signature plus the sector geometry, written to a
   versioned artifact the renderer can fetch.

### 2.4 What the cypher does NOT do

- It does not render. The DOM rendering of a card is delegated to
  Drupal's normal view-mode rendering, served on demand at
  `/world/card/{entity}/{viewMode}`.
- It does not navigate. Persistent canvas + Turbo wiring is
  renderer-side.
- It does not own the metaphor *meanings*. Mappings (which content
  type becomes which kind of room, which signature field drives which
  physical property, which view modes are cards) are per-theme
  configuration the cypher reads but does not own. The cypher records
  the form; the theme records the meaning.
- It does not embed. Embedding is `world_embeddings`'s job.

## 3. The descriptor schema (the contract)

Every entity the cypher emits is a Descriptor of this shape:

```jsonc
{
  "type": "node:article",
  "id": "node-42",
  "signature": {
    "structural": {
      "wordCount": 800,
      "paragraphCount": 6,
      "imageCount": 2,
      "cardCount": 3,
      "bloomTriggerCount": 2,
      "totalCardWordCount": 1450
    },
    "temporal":   { "createdAt": 1700000000, "changedAt": 1714867200 },
    "relational": { "inDegree": 3, "outDegree": 5 },
    "semantic": {
      "embedding": [0.012, -0.034, /* …1024 dims */],
      "modelVersion": "voyage-multilingual-2",
      "embeddedAt": 1714867200
    }
  },
  "sector": { "id": "fishing", "parent": null, "termPath": ["fishing"] },
  "cards": [
    {
      "id": "full",
      "viewMode": "full",
      "label": "Full article",
      "contentRef": "/world/card/node-42/full",
      "triggers": [{ "kind": "user_click" }]
    },
    {
      "id": "related",
      "viewMode": "related",
      "label": "Related",
      "contentRef": "/world/card/node-42/related",
      "triggers": [
        { "kind": "user_click" },
        { "kind": "search_match", "ttl": 30 }
      ]
    }
  ],
  "children": [
    /* recursively, for paragraphs configured as sub-objects */
  ]
}
```

Schema notes:

- `type` is `<entity_type>:<bundle>` in kebab case.
- `signature.structural` adds **card metrics** — `cardCount`,
  `bloomTriggerCount`, `totalCardWordCount`. These flow into
  physicality: rich, frequently-triggering decks become visually
  denser/brighter.
- `signature.semantic` adds `modelVersion` and `embeddedAt` to
  support the on-retrieval staleness check (PROTOCOL E6).
- `sector` is taxonomy-derived membership.
- `cards` enumerates activatable surfaces. Metadata + ordering live
  here; the rendered HTML lives at `contentRef` and is fetched
  lazily by the renderer on bloom or activation.
- `children` is *only* paragraphs / refs the editor configured as
  **sub-objects in the world**. Paragraphs configured as
  cards-on-parent appear in the parent's `cards` instead.

The descriptor is the same shape the renderer's `vantage()` and
`entityPosition()` consume in `src/world/`.

## 4. Cards — the document representation

A card is the document representation of an entity (or a view mode
of one), surfaced *in situ* on its world object. The world contains
the document; it does not run parallel to it. What a screen reader
gets, what a crawler indexes, what a copy-paste reader copies — all
served from the same card HTML.

Cards exist in a three-state runtime contract:

```
       trigger
HIDDEN ─────────► BLOOMED ─────────► FULLVIEW    (engine PAUSED)
   ▲ dismiss        ▲                  │
   │ /timeout       │ close            │ close
   │                │                  │
   └────────────────┴──────────────────┘
```

### 4.1 `Hidden` — innocuous to processing

The default state. The card exists only as a row in the descriptor.
No DOM. No geometry. No fetch. An entity with 50 cards costs the
same per frame as an entity with 1, until something blooms.

### 4.2 `Bloomed` — visible preview surfaced by a trigger pad

A small interactive surface attached to the entity's object — the
*trigger pad* — produces the bloom. Pads are skinned per content
type (an article's pad differs from a product's). Two activation
channels, equal-class:

| Channel | Sources |
|---|---|
| **User-driven** | Click; hover preview; tap (touch maps to click) |
| **Event-driven** | Schedule; proximity; search match; world-event-bus; narrative sequence |

The bloom is an in-world preview — light visual cost; no engine
pause. Multiple cards can be bloomed simultaneously on one object
(capped at 3 visible; excess queue).

The search service is the headline event-driven producer: a query
returns matches → bloom events fire on each matching card with a
30 s TTL → cards bloom across the world on relevant objects → the
inhabitant walks to the one they want. The world becomes a search
interface; the compass made literal.

### 4.3 `FullView` — engine paused, document served

Activation of a bloomed card transitions to FullView. A DOM overlay
takes over the visual field. The three.js engine is paused via
`renderer.setAnimationLoop(null)`. The canvas freezes on its last
frame (or fades out under the overlay). All particle systems, all
ambient animations, all camera drift: paused.

This is a substantial performance commitment. On mobile it's the
difference between a long read costing 5 % battery vs 40 %. On
desktop it gives reading mode a computational quiet that matches
its mental quality.

The FullView's HTML *is* the document representation served to
screen readers, crawlers, and any non-WebGL client at the same
URI. The page's `<head>` metadata (Open Graph, JSON-LD,
description) is set from the active card so deep-linked URLs share
correctly.

### 4.4 URL coupling

| URL form | State |
|---|---|
| `/node/42` | At the object, all cards Hidden |
| `/node/42#card=related` | Related card Bloomed (fragment, ephemeral) |
| `/node/42/v/related` | Related card in FullView (path segment, deep-linkable) |

Fragments carry ephemeral state (browser handles back/forward
without server hits). Path segments carry deep-linkable state
(server-renderable for crawlers; on the wire, content negotiation
decides the shell — world or document).

The `vantage()` function is extended to recognise these forms and
return `{ position, lookAt, sectorId, mode, cardId? }`.

### 4.5 Bloom event registry

The renderer subscribes to a `BloomEventBus`. Sources publish events
of shape `{ cardId, source, score?, ttl }`. The bus dispatches to
SceneManager which transitions Hidden → Bloomed for the named card.
Default TTL per source:

| Source | TTL |
|---|---|
| `user_click` | until dismissed |
| `schedule` | until schedule moves on |
| `search_match` | 30 s after the query changes |
| `proximity` | while within range |
| `world_event` | per-event TTL |

### 4.6 SceneManager macro-state

`Mode = exploration | reading` flag, owned by the SceneManager.

On `reading` enter:
1. Stop the animation loop (`renderer.setAnimationLoop(null)`).
2. Freeze (or fade out) the canvas.
3. Mount the DOM overlay with the card's HTML.
4. Set `<head>` metadata.
5. Update URL via History API to `/v/<viewMode>`.

On `reading` exit:
1. Tear down the DOM overlay.
2. Restart the animation loop.
3. Bloom resumes its in-world position.
4. URL drops the path segment back to `#card=<id>` (or fully cleared).

## 5. Corpus snapshots

The world is **deterministic across visitors**. To preserve that
under a moving corpus, the snapshot publisher emits versioned
artifacts.

- A snapshot is `{ version, generatedAt, sectors, entities }`.
- Snapshots are **immutable** once published.
- Live URLs reference the latest snapshot; permalinks may pin a
  specific snapshot (`?world=v143`) for citation and reproducibility.
- Publishing cadence is per-property — typical: nightly cron + on
  deploy.
- The 2D within-sector projection of the high-dim embeddings is
  computed at snapshot time (UMAP or similar) and cached on the
  snapshot, so the renderer doesn't ship a UMAP runtime.

## 6. Module distribution (v1)

Both modules ship **bundled with the theme repo** (see
[PROTOCOL.md §1](PROTOCOL.md)). A property's `composer.json` requires
the theme; Composer pulls the modules via the theme's package
metadata. The theme's `*.info.yml` declares both as Drupal-level
dependencies, so enabling the theme requires both modules to be
enabled.

If either module reaches independent stability and is adopted outside
this theme, extract it to its own repo. The theme then declares it
as an external Composer dependency. The descriptor and embedder
contracts make the splits safe.

## 7. The renderer side

The renderer exposes pure functions against the descriptor:

- `entityPosition(entity, snapshot) → Vec3` — deterministic position
  from id and sector.
- `vantage(url, snapshot) → Vantage` — URI → camera position +
  lookAt + sector + mode + cardId.
- `mapping(signature) → PhysicalProperties` — per-theme function
  mapping the four signature layers to size, color, light, etc.
  Defaults supplied; overridable per theme.

These are pure and testable in isolation. See `src/world/` and the
seven invariants in `test/vantage.test.ts`.

The non-pure surface (animations, render loop, DOM overlay,
BloomEventBus, History API) lives in `src/world/runtime/` — exercised
by integration tests, not unit tests.

## 9. Data gateway — RESTHeart, multi-tenant by design

> **Status:** locked 2026-05-07. Replaces the original
> Atlas-App-Services-Function plan, which became unviable when
> MongoDB sunset App Services on 2025-09-30.

### 9.1 The shape

```
Drupal property A ─┐
Drupal property B ─┤  Guzzle/HTTPS  ┌─→ Atlas cluster A
Drupal property C ─┼──────────────→ RESTHeart ──→ cluster B
…                  ┘   (one URL)    └─→ cluster C
                                       (per-tenant routing)
```

Drupal never holds a MongoDB connection string. RESTHeart does.
Each property holds only a per-property API key (or JWT) and the
gateway URL. RESTHeart maps `/clients/<slug>/...` (or auth-claim-derived
routing) to the correct Atlas cluster.

### 9.2 Why this shape

- **Multi-tenancy from day one.** *One cluster per client / per
  theme deployment* is a strategic commitment (per PROTOCOL E2).
  Without a gateway each property would carry its own cluster
  credential, multiplying the credential-leak surface and making
  cross-tenant operations awkward.
- **Productization.** When the cypher + theme become a service
  offering, RESTHeart is the API surface clients address. They
  see one URL with their tenant slug; the per-tenant cluster is
  invisible.
- **App Services replacement.** RESTHeart is MongoDB's listed
  recommended replacement for the deprecated Custom HTTPS
  Endpoints + Data API. We're inside that wave, not outside it.
- **Operational simplicity for Drupal.** No `ext-mongodb` in the
  DDEV web image. No PECL build. No Sury PHP-repo GPG-key fight.
  Drupal stays pure-Guzzle.

### 9.3 What the gateway exposes

A small, deliberately-narrow REST surface — not a generic data
API. The cypher needs three operations:

| HTTP | Path | Purpose |
| --- | --- | --- |
| `PUT` / `POST` | `/clients/<slug>/descriptors` | Upsert a skinny descriptor (the queue worker writes here on entity save) |
| `DELETE` | `/clients/<slug>/descriptors/<id>` | Remove a descriptor (entity delete) |
| `POST` | `/clients/<slug>/search` | Hybrid search (BM25 + vector rerank); returns ranked descriptors |

RESTHeart's general MongoDB access (find/aggregate/admin) is
**disabled at the gateway level** for client-facing routes. Only
these three project-specific endpoints are exposed. RESTHeart's
configuration locks the rest down.

### 9.4 Auth model

| Boundary | Mechanism |
| --- | --- |
| **Drupal property → RESTHeart** | Per-property API key in `Authorization: Bearer …` header. Issued by RESTHeart at provisioning time. |
| **RESTHeart → Atlas cluster** | MongoDB connection string per managed cluster, configured server-side in RESTHeart's `restheart.yml`. Never exposed outward. |
| **Token rotation** | Drupal-side: per-property env var; rotation = redeploy. RESTHeart-side: standard hot-reload. |

### 9.5 Observability

RESTHeart logs every request. One pane of glass for:

- per-property request rate
- per-tenant query latency
- failed auth attempts (cross-tenant probe attempts)
- search-result-empty alarms (potential editorial-coverage signal)

This is a side-benefit of choosing the gateway pattern; it costs
nothing extra.

### 9.6 Local development (DDEV) shape

The sandbox property runs a RESTHeart container alongside the web
container in DDEV, configured against the M0 sandbox Atlas cluster.
The Drupal-side `WORLD_GATEWAY_URL` env var points at
`http://restheart:8080/clients/sandbox/` (DDEV-internal hostname).
End-to-end same as production, only the cluster size and the URL
differ.

### 9.7 Fallback (recorded but not chosen)

If RESTHeart proves operationally unsuitable later, the documented
fallback is direct `mongodb/mongodb` PHP driver access from Drupal,
with `ext-mongodb` installed in the DDEV web image via PECL. See
PROTOCOL §4a for the exact recipe.

## 8. Language model — English core, translation as completeness

> **Rule.** All content's source language is English. Translations
> are added for completeness. A property's default display language
> is set only after the English core is in place.

### 8.1 Per-property defaults

| Property | Source language | Default display language |
| --- | --- | --- |
| `tecnocratica` | English | English (or Spanish — TBD) |
| `monpetitcafe` | **English** | **Spanish** |

### 8.2 Why

- One vector space across the entire ecosystem. Embeddings are
  computed on the English text always — cross-property search works
  for free; properties don't have parallel vector spaces to align.
- A new language is "translate to/from English," not "build a
  parallel vector space." Adding language N is O(corpus_size), not
  O(corpus_size × N).
- Cross-language queries: query in any language → translate to
  English (LLMs are excellent at this; this is where Claude lands
  in the pipeline) → embed → ANN over corpus → display in property's
  default language.

### 8.3 Mechanic

- Entity creation hook in `world_signature` (or sibling
  `world_language` if it gets thick) refuses to let `langcode = 'en'`
  be replaced as the source.
- Translations use Drupal core `content_translation`; English is
  always the canonical source.
- Embeddings always run on the English text. Translation entities
  share the parent entity's vector.
- Display language is decided by the property's `settings.php` and
  Drupal's standard language negotiation — independent of the
  source-language rule.
