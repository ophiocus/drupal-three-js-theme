# Shipping a world from a dataset of nodes

The end-to-end runbook: configure the external services, then turn a
set of Drupal nodes into a navigable 3D world. The theme does the
modelling, rendering, and consumption; the external services do the
compute (see `docs/BOUNDARY.md`).

Nothing here is needed just to *boot* the world — taxonomy layout +
primitive geometry render with zero external services. The services
unlock the richer paths: semantic layout (embeddings) and real
models (assets).

---

## Part A — External services (configure once)

All config is environment variables — never in code, never in the
repo. In DDEV they live in `.ddev/.env` (or `web_environment` in
`.ddev/config.yaml`); in production, in the container's environment.

### A1. Descriptor + vector store — Drupal's database  *(built in)*

Nothing to stand up. Descriptors and their vectors live in the
`world_signature_descriptor` table (created by `drush updb`), behind
`DescriptorStoreInterface`; `nearest()` is exact cosine in PHP —
milliseconds at hundreds of entities, a few hundred at ~10k.

```
drush updb          # creates world_signature_descriptor
drush world:embed   # fills it (descriptors + vectors)
```

Verify: `drush world:validate` → "✓ descriptor store reachable
(DatabaseDescriptorStore)"; `GET /world/health` → `store: reachable`.

Atlas was retired in 2026-10 (no active cluster). The RESTHeart →
MongoDB client is kept as an alternative backend: point the
`world_signature.descriptor_store` alias in
`world_signature.services.yml` at `world_signature.world_search_client`
and set `WORLD_GATEWAY_URL` / `_USER` / `_PASSWORD` and
`WORLD_SIGNATURE_DATABASE` (self-hosted MongoDB 8.2+ with mongot for
`$vectorSearch`). At larger scale, a MariaDB 11.8 `VECTOR` column with
an HNSW index can back the same interface.

### A2. Embedding service — for semantic layout  *(optional)*

Any OpenAI-compatible / Voyage-style embeddings endpoint. Without it,
`world:embed` falls back to the **dev-only** local TF-IDF embedder
(fine for a demo, not production — see `docs/BOUNDARY.md`).

Local, no key — an Ollama on the host (the 2026-10 bake-off pick;
`ollama pull qwen3-embedding:4b`):

```
WORLD_EMBED_URL=http://<ollama-host>:11434/v1/embeddings
WORLD_EMBED_MODEL=qwen3-embedding:4b
WORLD_EMBED_DIM=1024
```

Hosted:

```
WORLD_EMBED_URL=https://api.voyageai.com/v1/embeddings
WORLD_EMBED_KEY=<token>
WORLD_EMBED_MODEL=voyage-3
```

Set → `world:embed` calls the service. Unset → dev fallback.

`WORLD_EMBED_DIM` is sent as the OpenAI-style `dimensions` field
(Ollama and OpenAI truncate Matryoshka models to it — qwen3-embedding
is 2560 wide natively) and every returned vector must match it; leave
it unset for a provider that rejects the field (width then defaults to
1024). Keep it ≤ 1024: below 400 entities the snapshot ships the raw
vectors to the browser. The width is part of the model version, so
changing it marks the corpus stale; re-run `world:embed` and recreate
the Atlas vector index at the new `numDimensions`.

In DDEV these are machine-specific (the Ollama host differs per seat),
so they go in the git-ignored `.ddev/.env`, not `config.yaml`. From a
WSL2 DDEV, a Windows-side Ollama is reached at the WSL gateway address
(`ip route show default`), not `host.docker.internal`.

### A3. asset_workshop — transform + turntable  *(optional)*

The headless toolkit at `asset_workshop/` (separate from the module).
Run it wherever Node 20 + headless Chromium libs are available (a
worker box, CI, or the web container with the libs added — see
`asset_workshop/README.md`).

```
cd asset_workshop && npm install
node bin/workshop.js transform <raw.glb> <curated.glb> --fit-height=8
node bin/workshop.js turntable  <curated.glb> <preview.mp4> --size=1024
```

Outputs feed the asset nodes: `curated.glb` → `field_asset_curated_file`,
`preview.mp4` → `field_asset_turntable`. All media is MP4.

### A4. LLM provider — chatvatar  *(deferred, v0.5)*

Not required to ship a world. `drupal/ai_provider_anthropic` keys when
the dialogue layer lands.

---

## Part B — Generate the world from nodes

### B0. Install (once per site)

1. `composer require` the theme + enable `world_signature`.
2. Run the scaffolds that create the content model on a live site:
   `drush scr scaffold/install-world-bundle.php` (the `world` content
   type + a seeded active World node),
   `install-raw-file-field.php`, and `install-turntable-field.php`
   (fresh installs get the bundles from `config/install`; the field
   scaffolds add their fields).
3. Build the renderer bundle: `ddev exec "./node_modules/.bin/vite build"`.

### B1. Author / import the dataset

Nodes of bundles the cypher knows — `article`, `profile`, `event` —
each tagged with a **sector** (the region taxonomy term). Sector tag
drives placement in taxonomy mode; it's also the fallback when
semantic layout is off.

### B2. Publish — nodes → descriptors → gateway

```
drush world:publish
```

Extracts the signature for every participating node, writes
`field_world_signature`, and upserts the skinny descriptor to the
gateway. The world is now renderable in **taxonomy** layout with
primitive geometry. Visit `/`.

### B3. (Optional) Semantic layout — meaning becomes geography

```
drush world:embed       # calls WORLD_EMBED_* service (or dev fallback)
drush world:relayout    # project vectors → positions, freeze, activate
```

`world:layout-mode taxonomy|semantic` toggles without recomputing.
Re-run `relayout` deliberately after the corpus grows (positions are
frozen for URI-stability).

### B4. (Optional) Real models — assets

1. **Resolve + acquire** a source via the provider layer
   (`docs/feature-requests/asset-ingestion.md`): PolyHaven / ambientCG /
   ToxSam / PolyPizza / direct URL → leechable asset + licence.
2. **Sanitize** with asset_workshop `transform` → world-ready `.glb`.
3. Attach `.glb` to `field_asset_curated_file`, set `field_asset_slot`
   + `field_asset_atmospheres`, mark `field_asset_status = live`
   (the licence gate blocks unsafe `live`).
4. **Turntable** with asset_workshop → `.mp4` → `field_asset_turntable`
   (autoplays on hover in asset listings).
5. Reload — builders swap primitives for the live `.glb` per slot. No
   code change.

### B5. Verify + deploy

```
drush world:validate          # gateway, plugins, queue, snapshot
drush world:assets-status     # which asset is live per atmosphere/slot
curl .../world/snapshot/full  # entities + sectors + assets[]
```

Deploy the built `dist/world.bundle.js` with the theme. Visit `/` —
the dataset is a world.

---

## The shortest path (taxonomy, primitives, no external compute)

```
# A1 only (gateway), then:
drush world:publish
ddev exec "./node_modules/.bin/vite build"
# open /
```

Semantic layout (A2 + B3) and real models (A3 + B4) are additive on
top of this — each is a service you switch on, not a rewrite.
