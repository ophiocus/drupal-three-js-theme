# Battle scars

Bugs that bit, with diagnoses and resolutions. Organised by category
so you can search by symptom. Each entry references the commit that
fixed it; the commit message is the long-form story, this doc is the
quick-lookup index.

The pattern: write the symptom you'd actually see, *then* the
diagnosis, *then* the fix. If the symptom doesn't sound right when
re-read out loud, the entry needs rewording — the doc fails if it
can't pattern-match a future complaint.

---

## Build & bundling

### B1. `THREE.WARNING: Multiple instances of Three.js being imported`

**Symptom.** Three.js itself prints this message to the console at
boot. Often paired with `[world] boot() re-entry; ignoring (already
mounted)` — the canvas-dataset guard catches the second `boot()`
call.

**Diagnosis.** Vite splits dynamic imports into separate chunks. The
page's `<script>` tag loads `world.bundle.js?v=<hash>` (cache-bust
query added by `drupal_threejs_library_info_alter`). The lazy
chunks `import { ... } from "./world.bundle.js"` — *without* the
query string. **ES modules cache by full URL including query.** The
two URLs are two module instances. Every top-level class definition
runs twice, including Three's module-init sentinel, which prints
the warning.

The downstream damage: `instanceof` checks across the two instances
return false. Components attached by builders (in the chunk's
instance) are invisible to `CardController.findComponent` (in the
main page's instance). Every entity drops out of card registration.

**Fix.** `rollupOptions.output.inlineDynamicImports: true` in
`vite.config.ts`. Inlines every dynamic import into the main
bundle — no chunks, no second URL, one canonical module instance.
Bundle grows ~20 KB; instanceof works.

**Future tradeoff.** When code-splitting genuinely matters (multiple
atmospheres, large feature flags), the proper fix is filename-hash
cache-busting (`world-<hash>.bundle.js`) instead of `?v=` query,
or stripping the query entirely. Commit: `444ae75`.

### B2. The cache-bust automation that unleashed the bug

**Symptom.** Adding `hook_library_info_alter` to compute a content
hash for the `version:` string (so cache-bust is automatic on
content change) made the world stop responding to clicks.

**Diagnosis.** Pre-automation, `version: 0.2.1` was static. Drupal
appended `?v=0.2.1` to the script URL. Lazy chunks imported
`./world.bundle.js` with no query, so they hit `?v=0.2.1` from
HTTP cache and resolved to the same module instance (browsers are
lenient about HTTP caching across query strings even when ES module
identity disagrees — or maybe were, in this configuration).

The automated cache-bust generates `?v=0.2.x.<12-char-hash>` — a
unique URL per bundle content. Now the chunk's `./world.bundle.js`
import *definitely* resolves to a different ES module identity.
Multi-instance latency-bomb activated.

**Fix.** Same as B1 — `inlineDynamicImports: true` makes the whole
class of problem disappear. Commit: `444ae75`. The cache-bust
automation in `5d66aec` is correct in isolation; what changed is
that downstream architecture needs to be aware of it.

### B3. Stale-bundle on cache-bust version bump

**Symptom.** Bumped `version:` in `libraries.yml`, rebuilt, but the
browser still runs the old code. New errors appear but the user
swears they reloaded.

**Diagnosis.** `defer: true` + browser HTTP cache + Drupal
asset-renderer can compound. The version bump *was* applied, but
the browser served the cached bundle from before the bump.

**Fix.** The content-hash automation (`5d66aec`) makes this
impossible — the version changes exactly when the bundle changes.
For one-off testing, hard-refresh (Ctrl+F5) once after a build.
Commit: `d020eaf` (the manual bump that surfaced this).

---

## Drupal config-as-code

### D1. Custom content types render empty if Standard's view-display is missing

**Symptom.** A custom bundle's node-render output is ~480 bytes —
just the `<article>` wrapper and metadata, no body, no field
content. Card endpoint returns 200 but the rendered HTML is
visually empty. FullView modal opens but shows nothing useful.

**Diagnosis.** The Standard install profile ships
`core.entity_view_display.node.article.default` and
`core.entity_view_display.node.page.default` — but no others.
Custom bundles (here: `profile`, `event`, `monument`, etc.) need
their own view-display configs or Drupal renders a bare wrapper.

**Fix.** Ship `core.entity_view_display.node.<bundle>.default.yml`
from the module's `config/install/`. Render the `body` field with
`text_default`. Hide world-metadata fields
(`field_world_signature`, etc.). View-mode `default` is enough —
Drupal falls back to default when a requested mode (e.g. `full`)
isn't configured. Commit: `bd6801e`.

### D2. drush enable refuses because configs are orphaned from previous installs

**Symptom.** `drush en world_signature` errors with "configuration
objects already exist in active configuration" listing every
field-storage / content-type / vocab the module ships.

**Diagnosis.** A previous install of the module attached config
objects to active config. `drush pmu` (uninstall) removed the
module but left some configs orphaned. Re-enabling refuses because
it won't overwrite live config it doesn't own.

**Fix for development.** Full fresh `drush si standard` is the
clean answer. For production, write a hook_update_N or use
`drush config:import` against fresh module config. For this
project's pre-release stage, drush si is the documented path.

### D3. advancedqueue is NOT core queue

**Symptom.** Seeder reports "queue depth before flush: 0" right
after creating 20 entities whose entity_insert hook enqueues
extraction jobs. Cron has not yet run. The 0 makes no sense.

**Diagnosis.** The hook enqueues via
`\Drupal\advancedqueue\Entity\Queue::load(...)` →
`$queue->enqueueJob(...)`. The seeder polls via
`\Drupal::service('queue')->get('world_signature_extract')` — that's
*core's* queue service, a different API. Core's queue is empty;
advancedqueue's is full.

**Fix.** Drive `advancedqueue.processor->processQueue($queueEntity)`
directly, the same API `drush advancedqueue:queue:process` uses.
Re-query `getBackend()->countJobs()` after for the per-state
breakdown. Commit: `7a17a83`.

### D4. `world:publish` errors on every non-world bundle

**Symptom.** `drush world:publish` reports "Publishing node: N
entities" then logs `[error] node/X failed: No metaphor for
node:asset — entity is not part of the world` for every catalog
node. Final tally: "N published, M errors."

**Diagnosis.** The drush command walked every entity of every
participating entity type. Bundles without a registered Metaphor
plugin (here: pack, asset — catalog content) errored on the
plugin lookup. The publish *succeeded* for the world content; the
error spam was the noise.

**Fix.** `collectParticipatingBundles(): array<entity_type, bundles[]>`
returning the bundle filter. `publish()` applies
`->condition($bundleKey, $bundles, 'IN')` to the entity query.
Catalog bundles are never touched. Commit: `7a17a83`.

### D5. Module ships vocab as config, fixture ships terms as content

**Pattern (not a bug).** A vocabulary is config (the *kind* of
classification). Its terms are content (the *instances* of the
classification). Custom modules should ship
`taxonomy.vocabulary.<vid>.yml` in `config/install/`, but never
ship the terms — those go in a `scaffold/seed-*-vocab.php` script
that the user runs after `drush en`.

Reference: `topics` vocab (shipped by module) +
`scaffold/seed-atlas-coffee.php` phase 2 (seeds the region terms).
Same pattern for `asset_licenses` / `asset_slots` / `asset_status`
+ `scaffold/seed-asset-vocab.php`. Commits: `8364613`, `4aab257`.

---

## Data plumbing across layers

### P1. Adding a descriptor field needs THREE updates

**Symptom.** Added a new field to `DescriptorBuilder`. Published.
The snapshot endpoint returns it. The renderer's TypeScript code
reads `entity.title`. But `entity.title` is `undefined` at
runtime — even though the JSON has it.

**Diagnosis.** The pipeline runs through three layers:
1. **`DescriptorBuilder.build()`** — writes the field into the
   descriptor that goes to RESTHeart.
2. **`SnapshotPublisher`** — pulls descriptors from RESTHeart and
   passes them through to the snapshot endpoint. Strips a few
   gateway-internal fields (`_etag`).
3. **`SceneManager.adaptSnapshot()`** — the *contract boundary*
   between the raw descriptor shape and the renderer's narrow
   `Entity` interface. Projects each descriptor into
   `{ id, bundle, taxonomyTerms, signature, title? }`.

A field added at layer 1 traverses 2 transparently — but if it's
not in adaptSnapshot's projection at layer 3, it's silently
stripped. The TypeScript type `Entity` may even *declare* the
field, but if adaptSnapshot doesn't populate it, runtime sees
`undefined`.

**Fix.** When adding a descriptor field:
1. `DescriptorBuilder.build()` writes it.
2. `Entity` interface in `src/world/types.ts` adds it (optional).
3. `SceneManager.adaptSnapshot()` projects it.

Three places. Miss any one and the field is invisible. Commit:
`9826915`.

### P2. RESTHeart sidecar persists across `drush si`

**Symptom.** Fresh `drush si standard` + re-seed + publish — but
the snapshot endpoint returns 40 entities (or 60, or 80) when there
should be 20. Sector count is similarly inflated.

**Diagnosis.** RESTHeart is a separate Docker container, not part
of Drupal's storage. `drush si` drops the Drupal DB but the
RESTHeart MongoDB is untouched. Entity-delete hooks never fire
during a DB drop (Drupal is dropping tables, not deleting
entities). Stale descriptors from previous sessions accumulate.

**Fix.** `scaffold/wipe-gateway.php` — iterates `findAll()`,
deletes each descriptor. Run before `drush world:publish` after
any fresh install. Commits: `7a17a83`. Future: a `--clean` flag on
`world:publish` would automate this.

### P3. SnapshotPublisher placeholder labels surface only when rendered

**Symptom.** WorldHud labels at overview show "Sector 19", "Sector
20", etc. instead of "Antigua, Guatemala", "Cauca, Colombia".

**Diagnosis.** `humaniseTermId()` was a v0.1.x placeholder
returning `'Sector ' . $id` for numeric tids with a TODO comment
"future snapshots can join the term entity to fetch real names."
The placeholder went unfixed for two-plus releases because nothing
ever surfaced sector names visually. The first time the data was
rendered, the gap appeared.

**Fix.** Inject `EntityTypeManagerInterface`, load the term, return
its real label. Fall back to the legacy placeholder only if the
term is gone. Commit: `348592d`.

**Meta-lesson.** Placeholders that aren't visible are nearly free
to leave in. The cost lands when the data finally surfaces. If a
placeholder is being added, write the proper version at the same
time, or comment it loudly so it's not lost.

### P4. parseUrl entity-type prefix loss

**Symptom.** Clicking a tree throws `Uncaught Error: Unknown
entity: 19` — but the snapshot has `node-19`, not `19`.

**Diagnosis.** The descriptor key carries the entity-type prefix
(`node-19`). The URL form splits them (`/node/19`). `parseUrl` was
stripping the prefix and returning bare `entityId='19'`. Snapshot
lookup missed every time.

**Fix.** `ParsedUrl.detail` now carries `entityType` AND
`entityId` separately. `vantage.ts` reconstructs the key as
`${type}-${id}`. Same parse used for production /sector/ URLs vs
internal 'section' vantage kind. Commit: `d020eaf`.

---

## Seeder hygiene

### S1. Atlas seeder's phase-1 cleanup must be bundle-scoped

**Symptom.** Run `scaffold/seed-atlas-coffee.php` and the
`pack` / `asset` catalog content (from
`scaffold/seed-asset-catalog.php`) is silently wiped. Re-running
either seeder doesn't restore the other's content.

**Diagnosis.** Phase 1 of `seed-atlas-coffee.php` was an unscoped
`entityQuery('node')->execute()->delete()` — every node, every
bundle. The atlas seeder is meant to manage *world* content
(article/profile/event); catalog content (pack/asset) is a
separate concern that should be untouched.

**Fix.** Scope the cleanup query:
`->condition('type', ['article', 'profile', 'event'], 'IN')`. Each
seeder cleans only the bundles it owns. Commit: `7a17a83`.

**Generalisation.** Every seeder's phase-1 cleanup should be
bundle-scoped to the bundles that seeder owns. Cross-seeder
collisions are silent and the symptom (empty data) appears far from
the cause.

### S2. Two seeders ran fresh after `drush si` — but one bundle's content vanishes after `drush world:publish`

**Symptom.** Both seeders run clean (correct entity counts).
`drush world:publish` runs clean. Snapshot endpoint shows fewer
entities than expected.

**Diagnosis.** A combination of S1 and D4 — the world:publish
walked catalog bundles, errored, but the publish itself succeeded
for the valid bundles. The "fewer entities" is a publish-bundle
filter problem, not a delete problem.

**Fix.** D4 fix (`collectParticipatingBundles`). Once publish only
touches bundles with a Metaphor plugin, the counts stay right.

### S3. Module uninstall + reinstall accumulates orphaned config

**Symptom.** `drush pmu world_signature` then `drush en
world_signature` fails on "configs already exist."

**Diagnosis.** Uninstall doesn't fully reverse install. Module
config has dependencies (fields, view-displays, etc.) that
reference Drupal-core types (text, link, taxonomy). Some configs
survive uninstall as "orphans without owner."

**Fix for development.** `drush si standard` for clean state.
**Fix for production.** Write `hook_update_N` updates, never
rely on uninstall+reinstall.

---

## Shell quoting

### Q1. The three-shell battle: Windows → WSL → DDEV

**Symptom.** A bash one-liner with `$var` substitution and quotes
arrives at drush with the `$` stripped. `drush php:eval` errors
with `unexpected token ")"` because `$entityType` became empty.

**Diagnosis.** Three shells argue over `$` expansion and quote
handling:
1. Windows PowerShell or cmd, host of the user's terminal.
2. WSL bash, which receives the command from PowerShell.
3. DDEV's `web` container shell, which receives the command from
   WSL.

Each layer applies its own quote rules. Single-quotes within
single-quotes need escaping. `$`-expansion fires at each layer
unless explicitly escaped. By the time the command reaches drush,
the original intent is unrecognisable.

**Fix.** Write the PHP to a file in the project. Run
`ddev drush scr scaffold/<file>.php`. The file's quoting is local
to PHP and doesn't traverse shells. `scaffold/peek-nids.php`,
`scaffold/probe-cards.php`, etc. are this pattern.

### Q2. Backticks in commit-message heredocs

**Symptom.** A commit lands with three words missing from the
message body — words that were wrapped in backticks.

**Diagnosis.** Backticks inside heredocs are interpreted as
command substitution, even within single-quoted heredocs in some
shell configurations. The shell tries to execute the backticked
text as a command, fails, and substitutes empty.

**Fix.** Don't use backticks for code fences in commit messages.
Use plain text (`set_state` → `set_state`) or single quotes
(`'set_state'`). Or escape backticks individually.

### Q3. drush php:eval with $-vars

**Symptom.** `drush php:eval "echo \$x"` — output is `echo`.

**Diagnosis.** The `$x` is consumed by some shell layer before
drush ever sees it. Even with backslash-escaping, the escaping
gets stripped at one of the shell hops.

**Fix.** Same as Q1 — write the PHP to a file and use
`drush scr scaffold/<file>.php`.

---

## Click & interaction

### C1. CardController.register required BOTH pad AND surface

**Symptom.** Components attach successfully but `register()` finds
neither pad nor surface — only one of them was missing.

**Diagnosis.** `register()` had `if (!pad || !surface) return;` —
both required. If `HtmlSurfaceComponent` failed to attach (card
endpoint returned 404, html-to-image threw, etc.), the entity was
silently skipped from CardController entirely. `openFullView`
would find no record and clicks would do nothing.

**Fix.** Surface is now optional. `register()` admits any entity
with at least one of {pad, surface}. Bloomed state gracefully
degrades (no in-world card-as-texture). FullView path is preserved
because it does its own fetch via `fetchCardHtml()` — it doesn't
need the in-world surface. Commit: `97f130c`.

**Architectural lesson.** Don't gate a downstream-independent
feature on an upstream optional feature. The card-as-texture is
an aesthetic flourish; the full-text reading is the primary
contract.

### C2. Entity-body click context — near vs far

**Symptom.** Clicking a tree in another sector at sector vantage
opened a FullView modal *immediately*, blocking the camera fly the
user expected.

**Diagnosis.** Activity C ("one click to node") was first
implemented as: any entity-body click → `openFullView`. That made
sense for clicks on nearby entities, but for distant entities the
user wanted "translate to that sector."

**Fix.** PointerNavigator now checks
`isEntityInCurrentSector(entityId)`:
- **Near** (entity in camera's current sector) →
  `cardController.openFullView(entityId)` (the express path).
- **Far** (entity in another sector) →
  `cameraController.navigateTo(uri)` (the travel path).

Distance is the discriminator. Commit: `e7abf0b`.

### C3. Detail URLs don't auto-open FullView

**Symptom.** Page loaded at `/node/19` — camera flew to the detail
vantage, but no full-text modal opened. User saw the entity from
its vantage but no text.

**Diagnosis.** `cameraController.navigateTo("/node/19")` updates
the URL and animates the camera. There was no separate hook to
trigger FullView from a detail URL. Hash-driven FullView existed
(`#card=<id>&v=full`) but URL-driven did not.

**Fix.** `SceneManager.setUrlFromVantage` callback intercepts
detail vantages: when `v.kind === "detail"`, also call
`cardController.openFullView(entityId)`. Now any way of arriving
at `/node/<id>` (URL bar, click on far entity, page reload) opens
FullView on settle. Commit: `829f5a2`.

### C4. WorldHud / CardOverlay z-index coordination

**Pattern (not a bug, but adjacent).** The DOM-overlay stack:
- **`CardOverlay`** (FullView modal) — `z-index: 1000`. Modal,
  pauses the engine.
- **`WorldHud`** (region labels, entity titles) — `z-index: 100`.
  Non-modal, persistent.
- **Drupal admin toolbar** — `z-index: 502+`. Floating chrome.

`CardOverlay` at 1000 covers everything including the toolbar.
`WorldHud` at 100 sits below the toolbar (won't fight admin
chrome) but above the canvas. Document this anytime you add
another DOM overlay layer.

---

## Three.js / geometry

### G1. Z-fighting between coplanar ground meshes

**Symptom.** Visible flickering stripes across the sector pads or
ground decals from overview, especially where two transparent or
similarly-colored ground meshes overlap.

**Diagnosis.** Depth-buffer precision degrades quadratically with
distance under perspective projection. At the overview camera
(y≈200) looking at the world's 200-unit radius, sub-unit Y
separations between coplanar ground meshes fall below the depth
buffer's quantisation step. Two meshes at the same Y compete for
each pixel and the GPU picks chaotically per frame.

**Fix.** `FLOOR_LAYERS` named slots in `src/world/runtime/floor-layers.ts`:

```ts
ground: 0,        // bedrock
sector_pad: 0.5,  // large sector centroid discs
ground_decal: 0.75, // moss circles, leaf patches
trigger_pad: 1.0,   // small entity-side click discs
```

Each layer half a world-unit apart. Imperceptible visually,
enormous in depth-buffer terms. New decorative meshes use the named
slot, never bare numbers, never arithmetic on the slots.
Commit: `18f2c5b`.

### G2. Compute decal Y from a NAMED slot, not arithmetic on a slot

**Symptom.** A new decorative mesh z-fights with another
decorative mesh despite both using `FLOOR_LAYERS` constants.

**Diagnosis.** Someone wrote
`y: FLOOR_LAYERS.trigger_pad * 0.5` thinking they wanted
"halfway between ground and trigger pad" — but
`trigger_pad * 0.5 = 0.5`, exactly `sector_pad`. Two meshes
collapsed onto the same Y.

**Fix.** Use the named slot directly: `FLOOR_LAYERS.ground_decal`.
If no existing slot fits, *add a new named slot* with a comment
explaining its place in the order. Never compute. Commit:
`70de5b6`.

---

## Architecture defense-in-depth

### A1. Surface-optional CardController.register (C1 again)

The C1 fix is also a defense-in-depth pattern. Even after the
v0.4 module-duplication fix made every entity register correctly,
the surface-optional register is still in place: if a single
entity's card endpoint ever genuinely 404s (cache hiccup, content
just-deleted, etc.), only that one entity fails to bloom — the
other 23 keep working. Single-entity bug → single-entity
degradation. Don't revert C1 when adjacent code looks "redundant."

### A2. Pack/asset two-layer model (architectural lesson)

**Pattern.** The asset-catalog work first shipped as a single
`asset` content type with all metadata fields. Then immediately
refactored to two bundles: `pack` (unit of acquisition — source
URL, license, raw download) and `asset` (unit of use — slot,
status, curated .glb), with `asset.field_asset_pack` referencing
its parent pack.

**Reasoning.** A KayKit Forest pack is ONE source URL + ONE
license + ONE downloaded .zip — but contains 100+ meshes filling
different metaphor slots. Flattening into a single bundle either
duplicated provenance across 100 child nodes or lost the
relationship entirely. The two-bundle shape made the cardinality
mismatch visible in the schema. Commit: `6b81ba3`.

**Generalisation.** When the same provenance is shared across many
items, split into two bundles: provenance (parent) and items
(children with required reference back). The "every item carries
its own provenance" alternative looks simpler but lies about the
data.

### A3. Tab-pause needs BOTH `window.blur` AND `visibilitychange`

**Symptom.** Tab out of the browser; engine should pause. But the
pause is inconsistent — sometimes works, sometimes doesn't.

**Diagnosis.** Single-event detection is unreliable across
browsers:
- `visibilitychange` fires when the tab is hidden, but not always
  when the window loses focus (e.g., another window covers it).
- `window.blur` fires on focus loss but not on tab-switching
  within the same window in some browsers.

**Fix.** Listen to both. The engine pauses when *either* says
"not focused." It resumes only when *both* say "focused again."
Commit: `c5f93c9`.

### A4. The boot() re-entry guard catches the second mount, but not the second module-evaluation

**Pattern.** `main.ts`'s `canvas.dataset.worldBooted === "1"`
guard prevents `boot()` from running twice. That guard is correct
and should stay. But it does NOT prevent module-level side
effects from running twice if the module file is evaluated twice
(B1 / B2). The guard is downstream of the bug; the bug needs an
upstream fix (single-bundle, single URL identity).

---

## Meta

### M1. Diagnostic logs that earn their keep stay; chatter goes

When debugging, `console.info` + `console.warn` instrumentation
is cheap and surfaces invariants fast. After the bug is fixed,
two questions per log:

1. **Will this fire on success?** If yes, it's chatter — remove.
2. **Will it fire only on a real regression?** If yes, it's a
   future signal — keep.

The `register()` warnings (no pad AND no surface; surface missing)
stay because they fire only when something legitimately breaks.
The `openFullView found record, state=hidden` `console.info` was
removed because it fires on every successful click. Same rule
applies anywhere instrumentation lives in production code.

### M2. The expensive diagnostic is the one that confirms the false hypothesis

Two false hypotheses about the v0.4 module-duplication bug:
1. *"Surfaces are failing to attach"* — fixed with
   surface-optional register. Useful (defense-in-depth) but not
   the root cause. The bug persisted.
2. *"Three is duplicated; vite resolve.dedupe will fix it"* —
   dedupe applied. The bug persisted.

The third diagnostic — logging `_components` array contents at
register time — was what surfaced the real shape (components ARE
there; the *classes themselves* are duplicated, not just three).
That insight took five seconds to read but was only available
once the first two false fixes had been ruled out by direct test.

**Lesson.** Each fix that doesn't resolve the symptom is a
deletion of one branch in hypothesis space. The work isn't
wasted; the diagnostic budget has to allow for those branches.
Worth keeping the surface-optional register and the dedupe even
though neither alone was sufficient — they're defense in depth.
