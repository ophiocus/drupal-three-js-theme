# world_seed

The site's canonical bring-up. **One command**, repeatable, no
post-install ceremony:

```bash
ddev drush en world_seed -y
```

That's it. After that command settles, the world is in its canonical
demo state: admin user (uid=1), six authors with bios + writing
themes, five sector taxonomy terms, 100 articles, 15 events, 15
biographies, plus Spanish translations of all content and an embed
pass for the corpus. If the embed pass fails the step is skipped with
a notice and `drush world:embed` picks it up later.

## Re-running

```bash
# Re-seed in place (purges only marker-stamped seeded entities,
# leaves manually-authored content alone):
ddev drush world:seed

# Full reset (uninstall removes the seeded fields via enforced
# dependencies; reinstall lands them again clean):
ddev drush pmu world_seed -y && ddev drush en world_seed -y
```

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
it fails that step is skipped with a warning; run `drush world:embed`
later.

## Content packs (opt-in)

`data/packs/<name>.json` holds extra content that is **not** part of
the canonical demo — for example the `bakeoff-*` packs written to
tell embedding models apart (lexical traps, paraphrase pairs,
long-form, inner-mind pole pieces). Each pack is
`{"pack": ..., "records": [{bundle, region|sector, author?, title, body, eval?}]}`;
`region` is a slug from `sectors.json`, `sector` a `topics` term name
("Art", "Science", …), and `eval` carries labels for the evaluation
harness that the seeder ignores.

```bash
ddev drush world:seed:pack bakeoff-hard          # add or replace, then embed
ddev drush world:seed:pack bakeoff-hard --skip-embed
ddev drush world:seed:pack-purge bakeoff-hard    # remove only that pack
```

Packs add nodes only and are tracked under their own state key
(`world_seed.pack_state.<name>`), so `world:seed:purge` leaves them
alone. `world:seed` recreates the region terms, so re-run any packs
after a re-seed to point them at live terms.

## Descriptor store and `nearest()`

Descriptors (the search-side projection of each world entity, vector
included) live behind `world_signature.descriptor_store`
(`DescriptorStoreInterface`). The default backend is the
`world_signature_descriptor` table in Drupal's own database (created
by `world_signature_update_11001`; `drush updb`), filled by
`drush world:embed` and kept current by the save-time queue job.
Atlas was retired in 2026-10; the RESTHeart → MongoDB client remains
as an alternative implementation (see `world_signature.services.yml`).

`nearest($vector, $k, $filter)` is exact cosine over the stored
vectors of the same width — milliseconds at hundreds of entities.
Filters are equality (or "any of" with an array) on the indexed
columns `bundle`, `sector` (primary sector term id), `type`
(`node:article`), `status`, `lang`. Scores are cosine similarity in
[-1, 1], best first. No index to create; a width change (new
`WORLD_EMBED_DIM`) just needs a `drush world:embed`.

```bash
ddev drush php:eval "
\$store = \Drupal::service('world_signature.descriptor_store');
\$vec = \$store->find('node-1098')['signature']['semantic']['embedding'];
foreach (\$store->nearest(\$vec, 5, ['bundle' => 'article']) as \$hit) {
  printf('%.3f %s %s' . PHP_EOL, \$hit['score'], \$hit['_id'], \$hit['descriptor']['title']);
}"
```

The first hit is the entity itself (score 1.000). On a store
failure `nearest()` returns `[]` and logs a warning instead of
throwing, so callers can fall back.

## Why this module exists

The previous bring-up was a `drush scr scaffold/seed-atlas-coffee.php`
script — a one-shot fixture loader. This module replaces it with a
real Drupal artifact: dependency-injected, drush-command-driven,
idempotent, and with an explicit purge path.

The seed data lives in JSON files under `data/` so a property build
can fork the module, edit the JSON, and have a different world.
That's the seed pattern — content is data, not code.
