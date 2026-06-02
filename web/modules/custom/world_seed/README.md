# world_seed

The site's canonical bring-up module. Installing it lands the demo
corpus exactly as the rest of the project documents it.

## What ships

- **Admin user** (`uid=1`, username `admin`) — created with a generated
  password printed once on first install. Re-running the seed leaves
  uid=1 alone.
- **6 authors** with bio + writing themes — `mcervantes`, `jruvalcaba`,
  `lbermudez`, `dpavon`, `ctorresvega`, `afonseca`.
- **5 sector taxonomy terms** in the `topics` vocabulary — Antigua,
  Cauca, Boquete, Sierra Madre, Tarrazú.
- **100 article nodes**, distributed across the authors and sectors
  (20 per sector; mix of authors per sector).
- **15 events** — harvests, cupping competitions, conferences.
- **15 biographies** as `profile` nodes (real coffee figures — producers,
  agronomists, mill operators).

Events and profiles are owned by `uid=1`. Articles are owned by their
author. The rationale: per the project's editorial model, **authors
write opinion + reportage** (articles), and **events / biographies
are factual descriptions of the world**, not someone's byline.

## Idempotence

Both `hook_install` and `drush world:seed` are idempotent: they
purge entities previously stamped with the seed marker (a
`world_seed.seed_state` Drupal state key tracks UUIDs) and recreate
them from `data/*.json`. Manually-authored content with overlapping
titles is **not** touched — the purge keys on UUID, never on title.

```bash
# Fresh install (or re-seed)
ddev drush en world_seed
# or, if already enabled:
ddev drush world:seed

# Clear only the seeded entities
ddev drush world:seed:purge
```

After seeding the install hook also fires a `world:embed` pass. If
the gateway isn't reachable that step is skipped with a warning;
run `drush world:embed` later.

## Atlas Vector Search index

`WorldSearchClient::nearest()` (added in this slice) projects an
entity's embedding against the corpus to find semantically-similar
documents. It depends on an Atlas Vector Search index. Atlas index
creation is out-of-band — Atlas Admin API or the Atlas UI — but the
spec is fixed.

### Index spec

Database: `drupal_three_js_theme_world` (or whatever
`WORLD_SIGNATURE_DATABASE` resolves to in `.ddev/config.yaml` ->
`web_environment`).

Collection: `descriptors`.

Index name: `world_embeddings` (override via `WORLD_VECTOR_INDEX`
env var if you need a different name).

JSON definition (paste into Atlas → Search → Create Search Index →
JSON editor):

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "signature.semantic.embedding",
      "numDimensions": 256,
      "similarity": "cosine"
    },
    {
      "type": "filter",
      "path": "bundle"
    },
    {
      "type": "filter",
      "path": "sector"
    }
  ]
}
```

Notes:

- `numDimensions: 256` matches the dev TF-IDF provider. When you
  flip `WORLD_EMBED_URL` to a neural provider with a different output
  dimension (1536 for OpenAI, 1024 for Voyage `voyage-3`, etc.),
  recreate the index with the new value. Mismatched dimensions are
  a `$vectorSearch` runtime error.
- `similarity: cosine` matches what the in-client projector and the
  pole-axis computation use. Don't change to euclidean / dotProduct
  without updating both ends.
- The `filter` fields enable combined queries like "nearest
  *articles* (bundle=article) within the *cauca* sector." Add more
  filter paths as needed; each filter field has Atlas-side index
  overhead.

### Verifying the index is live

```bash
# Pick any descriptor id from your snapshot, then:
ddev drush php:eval "
\$client = \Drupal::service('world_signature.world_search_client');
\$desc = \$client->find('node:article:12');
\$vec  = \$desc['signature']['semantic']['embedding'] ?? null;
print_r(\$client->nearest(\$vec, 5, ['bundle' => 'article']));
"
```

You should get a 5-element array sorted by `score` descending. If
the index isn't there, `nearest()` returns `[]` and logs a warning
(it doesn't throw — callers can fall back).

## Why this module exists

The previous bring-up was a `drush scr scaffold/seed-atlas-coffee.php`
script — a one-shot fixture loader. This module replaces it with a
real Drupal artifact: dependency-injected, drush-command-driven,
idempotent, and with an explicit purge path.

The seed data lives in JSON files under `data/` so a property build
can fork the module, edit the JSON, and have a different world.
That's the seed pattern — content is data, not code.
