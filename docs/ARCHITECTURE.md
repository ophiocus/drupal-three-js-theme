# Architecture

> **Status:** locked 2026-05-05.
> **Scope:** normative architectural facts that apply to any project
> built under the Site-as-World thesis. New constraints land here;
> they cannot be relaxed by an individual theme or property.

## 1. The two-side spine

A Site-as-World installation has two sides of one spine.

| Side | What it is | Where it lives |
| --- | --- | --- |
| **The cypher (PHP)** | A Drupal module that translates content into a dimensional signature. Listens to entity events, writes signatures, publishes corpus snapshots. | `modules/world_signature/` (bundled with the theme repo, distributed via Composer). |
| **The renderer (JS)** | A three.js bundle that reads signatures and snapshots, places objects in the world, and answers `vantage(url, snapshot)` for the camera. | `src/` in the theme repo, bundled by Vite. |

The wire format between them is the **descriptor** — a JSON shape the
cypher emits and the renderer consumes. The descriptor is the only
coupling. Either side can be replaced as long as the descriptor contract
holds.

## 2. The `world_signature` module — the metaphor cypher

The `world_signature` module is the **single source of truth for the
dimensional re-orientation of content into 3D elements.** It is the
*cypher*: the formal record of every metaphor that turns content into
world (article → room; paragraph → object in the room; taxonomy → biome;
edit-frequency → glow). When the metaphors change, they change here, in
one place, with version control.

### 2.1 Required by any 3D theme

> **Rule.** Any theme operating under the Site-as-World thesis MUST
> declare `world_signature` as a dependency in its `*.info.yml`. A 3D
> theme without `world_signature` is undefined behavior. There is no
> *light* version, no inline alternative, no theme-side opt-out.

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
   - **Structural** — counts, dimensions, completeness.
   - **Temporal** — when, how often, age relative to the corpus.
   - **Relational** — graph position: in/out-degree, taxonomy
     fingerprint, centrality.
   - **Semantic** — topic embedding (slot reserved; populated in v2).
4. Stores the signature on the entity as a computed field
   (`field_world_signature`).
5. On request — drush command, scheduled snapshot publisher, deploy
   hook — assembles a **corpus snapshot**: every entity's signature
   plus the sector geometry, written to a versioned artifact the
   renderer can fetch.

### 2.4 What the cypher does NOT do

- It does not render. Not even the SEO/a11y document fallback; that's
  the theme's job, unchanged from the parent theme's defaults.
- It does not navigate. Persistent canvas + Turbo wiring is
  renderer-side.
- It does not own the metaphor *meanings*. Mappings (which content
  type becomes which kind of room, which signature field drives which
  physical property) are per-theme configuration the cypher reads but
  does not own. The cypher records the form; the theme records the
  meaning.

## 3. The descriptor schema (the contract)

Every entity the cypher emits is a Descriptor of this shape:

```
{
  "type": "node:article",
  "id": "node-42",
  "signature": {
    "structural": { "wordCount": 800, "paragraphCount": 6, "imageCount": 2 },
    "temporal":   { "createdAt": 1700000000, "changedAt": 1714867200 },
    "relational": { "inDegree": 3, "outDegree": 5 },
    "semantic":   { "embedding": null }
  },
  "sector": { "id": "fishing", "parent": null, "termPath": ["fishing"] },
  "children": [
    /* recursively, same shape, for paragraphs, media references, etc. */
  ]
}
```

- `type` is `<entity_type>:<bundle>` in kebab case.
- `signature` is what the cypher computes.
- `sector` is taxonomy-derived membership.
- `children` is the recursive shape for entity-referenced sub-content.
  Paragraphs, media, taxonomy refs all walk through it.

The descriptor is the same shape the renderer's `vantage()` and
`entityPosition()` already consume in `src/world/`.

## 4. Corpus snapshots

The world is **deterministic across visitors**. To preserve that under
a moving corpus, the cypher publishes versioned snapshots.

- A snapshot is `{ version, generatedAt, sectors, entities }`.
- Snapshots are **immutable** once published.
- Live URLs reference the latest snapshot; permalinks may pin a
  specific snapshot (`?world=v143`) for citation and reproducibility.
- Publishing cadence is per-property — typical: nightly cron + on
  deploy.

## 5. Module distribution (v1)

The module ships **bundled with the theme repo** (see
[PROTOCOL.md §1](PROTOCOL.md)). A property's `composer.json` requires
the theme; Composer pulls the module via the theme's package metadata.
The theme's `*.info.yml` declares the module as a Drupal-level
dependency, so enabling the theme requires the module to be enabled.

If the cypher reaches stability and is adopted outside this theme,
extract it to its own repo. The theme then declares it as an external
Composer dependency. The descriptor contract is what makes that split
safe.

## 6. The renderer side

The renderer exposes three pure functions against the descriptor:

- `entityPosition(entity, snapshot) → Vec3` — deterministic position
  from id and sector.
- `vantage(url, snapshot) → Vantage` — URI → camera position + lookAt +
  sector.
- `mapping(signature) → PhysicalProperties` — a per-theme function
  that maps the four signature layers to size, color, light, etc.
  Defaults supplied; overridable per theme.

These are pure and testable in isolation. See `src/world/` and the
seven invariants in `test/vantage.test.ts`.
