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

### A1. Descriptor + vector store — RESTHeart → Atlas  *(required)*

The store the snapshot reads from. Stand up a RESTHeart gateway in
front of a MongoDB Atlas cluster (one cluster per tenant), then:

```
WORLD_GATEWAY_URL=https://<restheart-host>
WORLD_SIGNATURE_DATABASE=<tenant_db_name>
WORLD_GATEWAY_USER=<gateway_user>
WORLD_GATEWAY_PASSWORD=<gateway_password>
```

Verify: `drush world:validate` → "✓ gateway reachable".

### A2. Embedding service — for semantic layout  *(optional)*

Any OpenAI-compatible / Voyage-style embeddings endpoint. Without it,
`world:embed` falls back to the **dev-only** local TF-IDF embedder
(fine for a demo, not production — see `docs/BOUNDARY.md`).

```
WORLD_EMBED_URL=https://api.voyageai.com/v1/embeddings
WORLD_EMBED_KEY=<token>
WORLD_EMBED_MODEL=voyage-3
WORLD_EMBED_DIM=1024
```

Set → `world:embed` calls the service. Unset → dev fallback.

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
