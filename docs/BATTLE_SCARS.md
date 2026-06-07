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

## Tooling / observation

### T1. "The renderer is freezing at N entities" via headless / MCP browser

**Symptom.** Driving the world through a remote-controlled Chrome
(MCP, Playwright, CDP) — the canvas appears stuck on the loader,
`Page.captureScreenshot` times out at 30s, hover/click ops never
complete. Conclusion that comes to mind: "the renderer can't handle
this corpus size, that's the perf wall."

**Diagnosis.** **It's not the renderer.** It's the automation tab
being unfocused / backgrounded. Chrome throttles
`requestAnimationFrame` in non-visible tabs (close to 1 Hz), and
hard-throttles or suspends entirely when the automation harness
doesn't keep the tab "user-visible." The boot pipeline
(snapshot fetch → SmartObject builds → HTML surface fetches) gets
chopped into 1 Hz slices instead of running flat-out, so a 2-second
mount stretches to many tens of seconds and the screenshot tool
gives up first.

The world has no graphical hindrance at the corpus sizes seen so far
(154 entities tested fine in a real user-driven browser). The
"freeze" is an artifact of *how* the page is being driven, not what
the page is doing.

**Fix.** Don't act on the throttled appearance. Specifically:
- Don't assume "the renderer is slow" from automated screenshots.
- Don't shrink the corpus or unpublish content to "make the demo
  work." (Once-bitten: I hard-deleted 124 nodes to chase this and
  had to re-seed — that's where this note comes from.)
- If a live observation is required, hand the URL to the user. They
  open it in their own browser; the tab is foregrounded; the
  renderer runs full-speed.
- Automated checks that don't depend on rendering — `curl` the
  snapshot endpoint, `drush sqlq` for inventory, console-log eval —
  are the right tools for verification.

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

### C5. Universal hover gate: same predicate as title visibility

**Pattern.** A hover affordance (silhouette glow, cursor change,
subtitle reveal) should only trigger when the entity's title
label is currently visible to the user. Reading the name is the
precondition for interacting with the thing.

**Implementation.** `PointerNavigator.isHoverEligible(mesh)`
mirrors `WorldHud`'s entity-label `visibleIf` predicate exactly —
same `overviewHeight * 0.45` / `closeUpHeight + 4` thresholds, same
`nearestSector(camera) === primarySector` check. Both gates read
the same constants from the snapshot's `world` block.

If the predicate ever needs to change, **change it in one place
and have both call sites read from it** — letting them drift is
an invisible-bug factory. Commit: `c7cb08e`.

### C6. Hover-driven subtitle reveal: one event source, multiple subscribers

**Pattern.** Hover changes are a single observable in the UI —
many subsystems might want to react (silhouette glow, subtitle
reveal, cursor change, audio cue, telemetry).
`PointerNavigator.NavigatorOptions.onHoverChange?: (entityId | null)`
is the canonical event source. `applyHover` emits the entity id;
`clearHover` emits null.

Subscribers wire themselves at construction time. `SceneManager`
currently has one — `WorldHud.setHoveredEntity` for subtitle
reveal — but the pattern accepts arbitrary callbacks for future
hooks (sound design, gaze tracking, breadcrumbs). Commit: `8674546`.

### P5. Deterministic layout is a hard requirement, not a nicety — freeze it in state

**Pattern.** BETA 2 projects embeddings → 2D positions. The naïve
design recomputes the projection inside `buildSnapshot()` every
request. Two ways that breaks "URI is a coordinate":

1. **Iterative/stochastic projectors wander.** UMAP/t-SNE seed from
   RNG; two runs give mirrored/rotated/different layouts. `/node/8`
   would point at a different place each page load.
2. **Even a deterministic projector moves under corpus change.**
   Add one article and MDS re-solves the whole eigenproblem; every
   existing entity shifts slightly. Bookmarks rot.

**Fix (two layers).**

- *Determinism in the projector itself:* classical MDS (closed-form,
  not iterative) + power iteration seeded from a FIXED non-uniform
  vector (`sin(i+1)`, not RNG, not all-ones — all-ones can start
  orthogonal to the dominant eigenvector of a centred matrix) + a
  fixed iteration count. Same embeddings → byte-identical coords.
- *Stability across corpus change:* don't recompute per snapshot.
  `drush world:relayout` computes once and FREEZES the layout in
  state; `buildSnapshot` reads the frozen positions. The world
  moves only when an operator deliberately re-lays-it-out. This
  trades "always fresh" for "always stable" — the right trade when
  the coordinate IS the contract.

The remaining sharp edge (parked): re-running relayout after adding
content still re-solves globally, so the *whole* map can rotate/
flip even though each run is internally deterministic. Procrustes
alignment against the previous layout (rotate/reflect the new
solution to best-match the old) is the fix when it matters.

**Generalisation.** When a derived coordinate becomes a stable
external reference (URL, bookmark, deep link), the derivation must
be deterministic AND stable-under-input-change. Those are two
different properties; closed-form math buys the first, freezing the
output buys the second.

### A6 (renamed C9). Builder asset/primitive split must share scaffolding via helpers

**Pattern.** A bundle Builder has two paths — load a curated .glb
vs. assemble primitives — but both paths attach the same
card-lifecycle scaffolding: trigger pad + HTML surface + (for
events) ground-decal moss ring. Inlining the scaffold at the end
of the build method duplicates it inside the `if (prop) { ... }`
branch; copying that block doubles maintenance every time the
scaffold changes (e.g., card view-mode swap, trigger-pad radius
formula tweak, surface dimensions).

**Fix.** Extract the scaffold into private helpers on each Builder:

```ts
async build(...) {
  const totalHeight = sizeFromSignature(descriptor);
  const prop = await ctx.tryLoadProp(SLOT);
  if (prop) {
    obj.attach(new GltfComponent({ scene: prop.scene, ... }));
    await this.attachCardScaffold(obj, ctx, descriptor, totalHeight);
    return obj;
  }
  // ... primitive geometry ...
  await this.attachCardScaffold(obj, ctx, descriptor, totalHeight);
  return obj;
}

private async attachCardScaffold(obj, ctx, descriptor, totalHeight, padZ?) {
  obj.attach(new TriggerPadComponent({ ... }));
  obj.attach(new HtmlSurfaceComponent({ ... }));
}
```

The pad-Z parameter handles the fact that primitive geometry
exposes a true trunk radius while a loaded .glb doesn't —
the caller passes whichever is appropriate. For event totems
the moss ring is event-coherent regardless of geometry source,
so it gets its own `attachMossRing()` helper and runs on both
paths.

**Generalisation.** Any "two ways to produce X, identical wrap-up
afterwards" pattern wants extract-helper, not copy-paste. The
inline duplication is plausible at first ("just two paths") but
the wrap-up always grows new responsibilities (a new component,
a new tag, a new optional behaviour), and divergence between the
paths becomes a class of latent bugs nobody notices until a fix
lands in one path and not the other.

Commits: A.4 builder hookups across ArticleAsTree / ProfileAsSpirit /
EventAsTotem.

### C8. Touch needs `touch-action: none` + pointer capture or it's a coin-flip

**Pattern.** Mobile pointer events fire fine without setup —
`pointerdown / pointermove / pointerup` are dispatched the same
way for touch as for mouse. But two problems make naive
implementations unusably flaky on phones:

1. **The browser's default touch gestures eat the input.** A
   two-finger pinch zooms the *page*, not the camera. A one-finger
   drag pull-to-refreshes the browser. The user thinks the app
   is broken; actually the browser is just claiming the gesture
   first.

2. **Fingers leave the canvas mid-drag and events stop firing.**
   On a small screen the user's finger easily wanders off the
   canvas while orbiting. Without pointer capture, the
   `pointermove` events stop arriving the moment the touch exits
   the canvas bounds — the drag freezes in place until they lift
   and re-touch.

**Fix.** Two one-liners that have to BOTH be in place:

```ts
canvas.style.touchAction = "none";                    // (1)
canvas.setPointerCapture(event.pointerId);            // (2) on pointerdown
```

`touch-action: none` tells the browser "I'm handling all touch
gestures on this element; don't interpret them." `setPointerCapture`
binds the pointer to the canvas so events keep flowing even when
the finger leaves the element's bounds. Both are necessary; either
alone leaves a different failure mode.

**Companion.** The hover concept doesn't exist on touch. Pointer
events fire `pointermove` on touch too (during drag), but treating
those as "hover" highlights the wrong entity then snaps away when
the finger lifts. Gate hover on `event.pointerType !== "touch"`.
Silhouette hover + WorldHud subtitle-on-hover are desktop-only by
construction; touch users tap-to-open instead.

Commits: v0.4 mobile-touch pass.

### C7. Parallel-prefetch the new entity's HTML during the camera fly

**Pattern.** Far-click on an entity → `cameraController.navigateTo`
flies the camera, on settle `setUrlFromVantage` fires
`openFullView(newEntityId)`, and `applyFullView` THEN starts the
HTML fetch. The camera has settled; the user is staring at the old
content (or no content) for the fetch's duration; the modal pops
"Loading…" → content. Two pops, very jerky.

**Fix.** Start the fetch when the click registers, not when the
camera settles. `CardController.prefetchEntity(id)` stores a
single-slot promise; `applyFullView` consumes it. The camera fly
and the fetch race; by the time settle fires, the HTML is usually
already in hand (or much closer to it).

Companion piece: the overlay's state machine. Calling
`prefetchEntity` while a FullView is already open flips the
overlay to `loading` immediately — the user sees a skeleton
pulsing during the fly rather than watching old content sit
unchanged until camera arrival, then jerking through "Loading…"
to new content. The skeleton is a stable visual signal that a
transition is underway.

```ts
// PointerNavigator far-click branch:
this.options.cardController.prefetchEntity(tag.entityId);   // start fetch
this.options.cameraController.navigateTo(uri);              // start fly

// CardController.applyFullView:
const promise = this.prefetchSlot?.entityId === record.entityId
  ? this.prefetchSlot.html        // reuse the in-flight promise
  : fetchCardHtml(url);           // fresh fetch as fallback
this.overlay.setState("loading"); // skeleton up
const html = await promise;
this.overlay.setContent(html);    // fade-in via class flip + rAF
```

**Generalisation.** Any "navigate then load" sequence with visible
in-between time should overlap the two. Compose the gestures by
making them parallel, not sequential. The single-slot cache is
deliberately simple: orphaned in-flight fetches just resolve and
get dropped on the floor; tracking them costs more than it saves.

Commits: v0.4-fix replacing the sequential fetch with parallel
prefetch + the CardOverlay state machine.

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

### G3. `setViewOffset` is for tiled rendering, not viewport pan

**Symptom.** When the modal opens, the world view distorts —
everything stretches horizontally. The user described it as
"adding numbers to visual values that end up distorting the
proportions of FOV."

**Diagnosis.** `camera.setViewOffset(W*2, H, 0, 0, W, H)` was
called to "shift the world right so the entity stays visible in
the right half when the modal covers the left." That call DOES
shift the framing — but does so by narrowing the horizontal view
frustum (multiplying view width by `view.width / fullWidth = 1/2`)
without narrowing the canvas. Result: half the horizontal angular
content renders to the full canvas width → 2× horizontal stretch.

`setViewOffset` is intentionally for *tiled rendering* — splitting
one large image across multiple render passes, each pass rendering
a sub-frustum, then stitched together at full resolution. It is
NOT a "pan the visible portion of a single render" operation. The
function name's similarity to other projection-shift mechanics is
misleading.

**Fix.** Lateral camera shift (parallax). Compute the camera's
local right vector (`forward × up`), move the camera position
leftward by some fraction of the close-up distance, render. Same
FOV, same pixel scale, no distortion — the world apparently
shifts right by the lateral offset divided by the camera-to-target
distance.

```ts
const forward = new THREE.Vector3();
camera.getWorldDirection(forward);
const right = new THREE.Vector3()
  .crossVectors(forward, camera.up).normalize();
camera.position.addScaledVector(right, -shiftMagnitude);
```

Stash the original position; restore on modal close. Commits:
`ccf9a73` (introduced distortion) → `64c9fd8` (lateral-shift fix).

---

### G4. Verifying disposal with `renderer.info.memory` fights freeze-on-defocus — force a manual `render()`

**Context.** The world-switcher v1.5 acceptance is "no GPU leak across
atmosphere switches": `renderer.info.memory.{geometries,textures}` must
return to baseline after teardown + rebuild. The obvious test — load the
page in an automated browser, read `info.memory` before/after
`switchAtmosphere()` — silently gives garbage.

**Symptom.** In an automated/occluded browser tab, `document.hidden` is
`true`. Two failures cascade: (1) `mount()` *stalls at "0 / 24"* because
the HTML-surface texture generation the builders await is throttled to a
crawl in a hidden tab; (2) even once built, `info.memory.geometries`
reads low/zero because geometries upload to the GPU lazily on first
*render*, and the render loop is gated off by our own freeze-on-defocus
(`refreshLoopState` → `document.hasFocus() && !document.hidden`). So you
measure a world that never finished building and never rendered.

**Diagnosis.** This is the same freeze-on-defocus property (A3) biting
from the measurement side. Counts in `info.memory` are renderer-driven:
geometries/textures increment on *upload* (first render that uses them),
decrement on the `dispose` event. No render → no upload → no count.

**Fix — two parts.**
1. **Un-occlude to build.** The build genuinely needs the tab visible
   (the HTML-surface step). Driving via Claude-in-Chrome, a `screenshot`
   action brings the controlled window forward → `visibilityState`
   flips to `visible` → `mount()` completes. (A headless harness would
   need the surface step stubbed or the tab forced visible.)
2. **Force a manual render before each read**, so the measurement does
   not depend on the loop being awake:
   ```js
   await sm.switchAtmosphere();
   sm.renderer.render(sm.scene, sm.camera);   // upload now, not "next frame"
   const m = sm.renderer.info.memory;          // accurate geometries/textures
   ```

**Result + the one subtlety.** Geometries returned to the *exact*
baseline across inner-mind ⇄ forest round-trips. Textures settled at
baseline **+1** and stayed there — that's the deliberately
module-cached forest pollen sprite (`pollen.ts` `moteSprite()`),
allocated once and reused; its `dispose()` intentionally leaves it
alone. Lesson: a *bounded, non-climbing* delta from a shared cache is
not a leak — measure across *several* switches and watch the trend, not
a single before/after pair. (TS `private` fields like `renderer` are
reachable from the console — `private` is compile-time only.)

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

### A5. Engine-pause requires an explicit final render to commit state ⚠ SUPERSEDED by A6

**Pattern.** `SceneManager.setMode("reading")` *used to* stop the
animation loop. If you mutate camera state (position, view offset,
lookAt) just before the pause, that mutation never reaches the
screen — the last-rendered frame remains, frozen, on the canvas.

**Fix-at-the-time.** Call `this.renderer.render(this.scene,
this.camera)` explicitly after the state change AND the pause
toggle, to flush one final frame.

**Why superseded.** v0.4-fix kept the loop *running* during reading
mode (see A6). The "final-frame flush" pattern no longer applies
because there is no pause. The instinct that drove A5 — "if I
change camera state and the user can't see it, something between
my write and the canvas is wrong" — generalises into A6's deeper
lesson: don't write to `camera.position` while the loop is alive.

Commits: `ccf9a73` (introduced), `64c9fd8` (carried forward),
then v0.4-fix removed the explicit-render calls when the
loop-pause was lifted.

### A7. Atlas on the runtime read path is a boundary violation

**Symptom.** A single message in the Atlas dashboard — "Current IP
Address not added. You will not be able to connect to databases from
this address." — and the entire `/` page goes blank. The world
"failed to load." The renderer dutifully reports
`snapshot fetch failed: HTTP 502` and bails. Every entity remained
visible in Drupal admin, every signature was intact on disk, the
local DDEV stack was 100% green — and the app was unrenderable.

**Diagnosis.** `SnapshotPublisher::buildSnapshot()` opened with
`$this->client->findAll()` — pulling the entire descriptor corpus
from the RESTHeart gateway, which proxies to Atlas. The local
gateway answered `/ping` in 2ms because RESTHeart itself is a
healthy Java process; but every Mongo-backed call timed out after
15s because Atlas's IP allowlist had drifted off the workstation's
current egress and the TCP connect to `*.sghk71.mongodb.net:27017`
was silently dropped. Guzzle surfaced `cURL error 28`,
`WorldController::snapshot` turned that into HTTP 502, the
renderer's `fetchSnapshot` threw, and the whole boot pipeline
collapsed.

The architectural mistake is the dependency direction. MariaDB is
the source of truth for the corpus (`field_world_signature` JSON on
every participating node). Atlas is a *write+search* projection of
that truth — populated by `drush world:publish` / `world:embed`,
queried by editorial vector-search paths. A runtime read of "what's
in the world right now" should never need to leave the local DB.
Letting it do so subordinated the read SLA of every page view to the
availability of a remote service.

**Fix.** Rip Atlas off the runtime read path. `SnapshotPublisher`
now rebuilds descriptors directly from Drupal: iterate published
nodes whose `field_world_signature` is populated, decode the stored
`Signature` JSON, and run the same `DescriptorBuilder` the write
path uses. Same shape, same fields, same payload byte-count.
Verified by stopping the RESTHeart container entirely and observing
the snapshot still serve 200 OK in 271 ms.

The gateway/Atlas client stays in the codebase — it just becomes
opt-in, for the paths that actually need it: `drush world:publish`
(write descriptors), `drush world:embed` (write embeddings + axes),
and `WorldSearchClient::nearest` (vector search for "more like this"
and pole-anchored projection). Editorial features that genuinely
need Atlas degrade when Atlas is down, as they should. The render
path doesn't.

Cache invalidation also tightened: previously the snapshot tagged
only `node_list:world` (just the active World node). Now it tags
each participating bundle (`node_list:article`, `…:event`,
`…:profile`), discovered from the metaphor plugin definitions so
new metaphors extend the set automatically. Editing any
participating node correctly busts the snapshot's cache.

**Generalisation.** "Source of truth" is a directional property.
If A is the truth and B is a projection of A, the read path SHOULD
go to A — even when B is faster, even when "we already wrote to B,
might as well read from B." Coupling the read SLA to the projection
makes the projection's availability part of the contract, and you
inherit every outage and every config drift the projection
experiences. The asymmetry is the point: writes go A → B; reads
go straight from A. Atlas as a read-through cache for descriptors
would be acceptable; Atlas as the only place we look for them is
not.

Commit: the change that swapped `client->findAll()` for
`loadDescriptorsFromDrupal()` in `SnapshotPublisher`. Also the
prompt for this entry — the user's "Drupal should only request
Atlas on content edits and editorial request, not runtime" was
exactly right, and the fix was a 70-line PR that closes the entire
class of outage permanently.

### A6. Direct `camera.position` writes lose to the per-frame damp

**Pattern.** Once the animation loop is running, every frame's
`CameraController.update(dt)` damps the actual camera position
toward `targetPos` (vantage + idle drift + lateral shift). Any
direct `camera.position.set(...)` or `camera.position.add(...)`
made from outside the controller survives for *exactly one frame*
— the next damp pass pulls the camera back to where the
controller thinks it should be.

This was hidden until v0.4-fix because reading mode paused the
loop: a direct-write `camera.position.addScaledVector(right,
-shift)` in `enterReadingMode()` survived because nothing ran
after it. The moment we kept the loop running so the right half
of the canvas stayed navigable, the direct-write got undone on
the next frame and the entity snapped back under the modal.

**Fix.** Mutate the *target* state, not the camera. The
controller exposes the seams:

- Vantage / look target → `setTarget(vantage)` (writes via
  `syncTargetVectors`).
- Per-frame additive offset (parallax, modal recentre) →
  `setLateralShiftMagnitude(magnitude)`, applied to `targetPos`
  inside `update()` so the damp converges to the shifted target
  instead of fighting an external write.
- Drag-orbit deltas → `applyDragDelta(dx, dy)` (writes via
  `syncBaseFromOrbit`).
- Suppress autonomous motion (idle drift) while reading →
  `setIdleDriftSuppressed(true)` (gates the idle timer).

**Generalisation.** Anywhere a system has a target + damp toward
target, never write the visible state directly. Always write the
target — the damp does the rest, smoothly, and survives whatever
else is also writing the target. The renderer-side analogue of
"single source of truth": the controller owns the camera's
desired state, and only the controller writes the camera.

Commits: v0.4-fix replacing the `enterReadingMode` direct-write
with `cameraController.setLateralShiftMagnitude(magnitude)`,
plus `setIdleDriftSuppressed(true)` so the user's mouse over the
modal doesn't let idle drift wander the framing.

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
