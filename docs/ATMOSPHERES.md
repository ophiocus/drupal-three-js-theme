# Atmospheres

A pipeline for taking a thematic intent — *forest*, *outer space*,
*inner mind* — and turning it into a rendered three.js scene that
visualises the project's actual content (article, profile, event,
chatvatar) **as** that theme. Editorial primacy preserved: the
content doesn't change; the visualisation does.

> **Atmosphere** = whole-world visual idiom.
> **Biome** = per-sector tonal slice within an atmosphere.
> The two compose: an `atlas_coffee` world in the *forest*
> atmosphere has Antigua biome / Cauca biome / etc. as
> different lighting + fog overlays on the same forest.

## Why "Atmosphere"

"Theme" would collide with Drupal's existing theme concept (the
rendering wrapper — we already have one named `drupal_threejs`).
"Atmosphere" composes with our existing **Biome** vocabulary and
reads naturally for *the way the world feels as a whole*.

## Relationship to the architecture

Atmosphere is the third-from-top layer in the editorial-to-render
stack:

```
EDITORIAL                  what the editors decide
DESCRIPTOR                 the cypher's frozen JSON
ATMOSPHERE       ← new     the visual idiom of the world
BIOME                      per-sector tonal overlay
GEOMETRY (SmartObjects)    what each entity actually looks like
SCREEN                     pixels
```

An Atmosphere swaps **what builds** for each bundle. The same
descriptor renders as a cube in the default atmosphere, a tree
in the forest atmosphere, a satellite in the outer-space
atmosphere. The signature-axis modulations (e.g. word-count →
size from `ArticleBuilder`) remain consistent across atmospheres
unless a specific atmosphere overrides them.

Atmospheres are **optional**. With none selected, the world
falls back to the default SmartObject Builders shipped in
`src/world/runtime/smart-objects/builders/`. Adopting an
atmosphere is purely additive.

## The pipeline — six stages

Each stage's output is the next stage's input. Each is partly
automatable, partly editorial. The taste-bearing moments cluster
at stages 1, 2, and 4; the rest is mechanical.

### Stage 1 — Charter (editorial)

Short Markdown declaring the atmosphere's mission.

**Artifact:** `docs/atmospheres/<name>/CHARTER.md`

**Content:**
- Name + tagline (one-line motto)
- Mood (3–5 adjectives)
- Palette overrides (extends `world_signature.palette`)
- Key visual motifs (3–6 bullets)
- Audio motifs (deferred; record intent for v0.2+)
- 3–5 inspiration references (image URLs, prior-art callouts)

**Tooling:** Markdown editor. An agent can draft from a prompt;
the final language is editorial.

### Stage 2 — Mapping (editorial + agent-proposed)

For each content bundle, the visual element it becomes in this
atmosphere, plus the signature-axis modulations applied.

**Artifact:** `docs/atmospheres/<name>/mappings.yml`

**Content:** for each `bundle:` (article, profile, event, future
chatvatar):
- `visual:` — short noun for the element type
- `geometry_source:` — `glb:<path>` for real asset, or
  `primitive:<shape>` for stub geometry
- `size_signal:` — which signature field drives size, and how
- `color_signal:` — which signature field drives hue/material
- `idle_motion:` — animation clip name if applicable
- `interaction_motion:` — bloom/click animation if applicable
- `notes:` — editorial freeform

**Tooling:** YAML editor. The agent proposes from CHARTER +
existing content inventory + the eight-axis editorial model
(`docs/EDITORIAL.md`); the human edits.

### Stage 3 — Inventory (automated)

Flatten the mapping into the unique 3D assets needed.

**Artifact:** `docs/atmospheres/<name>/assets-needed.yml`

**Content:** flat list — one entry per asset:
- `id:` — slug (e.g. `oak-stylized`)
- `search:` — keywords for the acquisition layer
- `license:` — required (CC0 preferred; CC-BY acceptable with
  attribution; never proprietary in shipped properties)
- `format:` — `glb` for geometry; `png`/`jpg` for decals/textures
- `poly_budget:` — soft cap
- `needs:` — skeleton, animations, materials (list of capabilities)
- `used_by:` — list of mapping entries that consume this asset

**Tooling:** pure transformation of stage 2. Agent generates this
mechanically. No human input until acquisition.

### Stage 4 — Acquisition (agent + MCPs)

For each entry in the inventory, source the asset.

**Artifacts:**
- glb / image files in
  `web/themes/custom/drupal_threejs/assets/atmospheres/<name>/`
- provenance entries in `docs/atmospheres/<name>/asset-log.yml`
- CC-BY attributions appended to `docs/ASSET_ATTRIBUTIONS.md`
  (project root, created on first arrival)

**Tooling priority (per `docs/PROTOCOL.md` §4c.4):**

1. Direct curl from known CC0 sources (Quaternius, Kenney,
   three.js examples, Poly Haven)
2. Sketchfab MCP with `license=cc0|cc-by`, `format=glb`
3. Tripo MCP for AI generation when nothing in libraries fits
4. Blender MCP for refinement / re-rig / decimation

**Acquisition discipline:**
- Every asset goes in `asset-log.yml` with: source URL or Tripo
  prompt+seed, license, author (for CC-BY), polycount, file
  size, retrieval date.
- License field is **non-negotiable** for shipped properties.
  Mismatch = the world-building technical layer rejects the
  asset on processing.

**If an MCP isn't installed** (or the agent doesn't have access),
the stage produces a partial result: `assets-needed.yml` and
`asset-log.yml` entries marked `status: pending`. The Builders
in stage 6 fall back to primitives for pending assets, log
warnings, and the world degrades gracefully — no broken scene.

### Stage 5 — Processing (agent + Blender MCP)

Normalise the acquired assets.

**Artifacts:** optimized glbs in same location +
`web/themes/custom/drupal_threejs/assets/atmospheres/<name>/manifest.json`

**Operations per asset:**
- Polycount audit, decimate if over budget
- Texture compression / atlas merging
- Y-up axis convention check (three.js convention; Blender's
  Z-up needs rotation)
- Animation clip naming convention (`idle_breathing`, not
  `Take 001`) so `IdleAnimationComponent` finds them reliably
- Origin centering so SmartObject offsets compute consistently

**Manifest schema** (typed import on the renderer side):

```json
{
  "atmosphere": "<name>",
  "version": "1.0",
  "assets": {
    "<asset-id>": {
      "glb": "<filename>",
      "polycount": 0,
      "animations": ["clip1", "clip2"],
      "skeleton": "humanoid_simple|null",
      "license": "CC0|CC-BY|CC-BY-SA",
      "attribution": "<freeform attribution string>"
    }
  }
}
```

### Stage 6 — Renderer integration (code)

The atmosphere becomes a typed code module that registers
itself with the SmartObjectRegistry.

**Artifact:** `src/world/runtime/atmospheres/<name>/`

```
src/world/runtime/atmospheres/<name>/
├── index.ts                          ← register<Name>Atmosphere(registry)
├── manifest.ts                       ← typed import of manifest.json
├── builders/                         ← atmosphere-specific Builders
│   ├── ArticleAs<Element>.ts
│   ├── ProfileAs<Element>.ts
│   └── EventAs<Element>.ts
└── components/                       ← atmosphere-specific Components
    └── (optional new components specific to this atmosphere)
```

**Registration contract:**

```ts
export function registerForestAtmosphere(registry: SmartObjectRegistry): void {
  registry.register(new ArticleAsTree());
  registry.register(new ProfileAsSpirit());
  registry.register(new EventAsTotem());
}
```

Atmosphere builders register **before** the default builders in
`SceneManager.mount()`. First-match-wins ordering means the
atmosphere claims its bundles; anything it doesn't claim falls
through to defaults (FallbackBuilder, ArticleBuilder, etc.).

**Atmosphere selection** lives in `world_signature.palette`:

```yaml
active_atmosphere: forest   # default: "none" → no atmosphere builders register
```

The snapshot's `world.activeAtmosphere` field carries it to the
renderer; SceneManager reads it on mount and conditionally
imports + registers the matching atmosphere module.

**Pending-asset handling:**

```ts
async build(d, ctx) {
  const obj = new SmartObject(d.id, this.name);
  obj.position.copy(ctx.worldPosition);

  try {
    const glb = await ctx.assetLoader.load("trees/oak-stylized.glb");
    obj.attach(new MeshComponent({ ...derived from glb... }));
  } catch (e) {
    console.warn(`[atmosphere:forest] asset pending for ${d.id}; primitive fallback`);
    // Compose a primitive that still reads as "tree": cylinder trunk + cone canopy
    obj.attach(this.makePrimitiveTree(d, ctx));
  }
  // Always attach pad + surface regardless of asset state
  obj.attach(new TriggerPadComponent({...}));
  obj.attach(new HtmlSurfaceComponent({...}));
  return obj;
}
```

The primitive fallback is **atmosphere-coherent** — a forest
atmosphere's primitive is still tree-shaped, not a cube. Falling
back doesn't break the visual identity; it just degrades the
fidelity until real assets arrive.

## Directory conventions

```
drupal-three-js-theme/
├── docs/
│   └── atmospheres/
│       └── <name>/
│           ├── CHARTER.md             ← stage 1
│           ├── mappings.yml           ← stage 2
│           ├── assets-needed.yml      ← stage 3
│           └── asset-log.yml          ← stage 4 provenance
├── web/themes/custom/drupal_threejs/
│   └── assets/
│       └── atmospheres/
│           └── <name>/
│               ├── manifest.json      ← stage 5 output
│               ├── <element>.glb      ← stage 4 downloads
│               └── ...
├── src/world/runtime/
│   └── atmospheres/
│       └── <name>/
│           ├── index.ts               ← stage 6 entry point
│           ├── manifest.ts
│           ├── builders/
│           └── components/
└── docs/
    └── ASSET_ATTRIBUTIONS.md          ← CC-BY consolidator (project root in docs/)
```

## Where each stage's automation ceiling sits

| Stage | What an agent can do | What still needs a human |
|---|---|---|
| 1 Charter | Draft from a one-line prompt | Confirm mood, palette, motifs — taste |
| 2 Mapping | Propose from Charter + content + signature | Approve / edit per-bundle visual choices |
| 3 Inventory | Fully automated | — |
| 4 Acquisition | Search, download, log provenance | Approve "is this candidate atmospheric-right?" — taste |
| 5 Processing | Polycount audit, decimation, naming | Approve heavy stylization choices |
| 6 Integration | Write the Builders end-to-end | Code review |

The taste-bearing handoffs are 1, 2, 4. Everything else is mechanical.

## License hygiene

For every shipped property:

- **CC0** assets: provenance recorded in `asset-log.yml`. No
  user-facing attribution required.
- **CC-BY / CC-BY-SA** assets: provenance in `asset-log.yml`,
  attribution string in `docs/ASSET_ATTRIBUTIONS.md`. The
  attribution must be reachable from the rendered property —
  v0.2 design intent: a `/attributions` route generated from
  the file.
- **Proprietary / no-license / unclear**: **rejected**. The
  world-building technical layer enforces this on stage 5
  processing — assets without a clear license tag fail the
  build.

## What this changes architecturally

Concretely, on top of v0.1.2's SmartObject system:

- **New top-level concept** — Atmosphere lives in `docs/atmospheres/`,
  `src/world/runtime/atmospheres/`, `web/themes/custom/drupal_threejs/assets/atmospheres/`.
- **Existing Builders become "default atmosphere."** Today's
  `ArticleBuilder` (cube + word-count side) renders any article
  the active atmosphere doesn't claim.
- **Manifesto unchanged.** Atmospheres declare their Components
  against the same `world_signature.manifesto.component_types`
  that exist now. Adding atmosphere-specific Component types
  (e.g. `canopy_sway` animation slot) means a manifesto entry
  in the same commit, per the §3 discipline in this doc's stage 6.
- **One new config key** —
  `world_signature.palette.active_atmosphere` (defaults to
  `"none"`). Per-property override; one cluster can run multiple
  properties with different atmospheres on the same code.

## Future — what atmospheres unlock

- **Per-property aesthetic identity** without per-property code.
  The same `drupal_threejs` theme renders one property as forest,
  another as outer space, another as inner mind, by config alone.
- **A/B atmosphere testing** for the same content. Editorial can
  see how its corpus reads as a forest vs an underwater scene
  before committing.
- **Mood as a runtime property.** Sprint 5's deferred sound layer
  + atmosphere's audio motifs converge here — an atmosphere
  isn't just visual, it's the *entire sensory wrap* eventually.
- **Generative atmosphere creation** in v0.3+ — an editor
  describes "the world feels like an Ursula K. Le Guin novel"
  and an agent drafts CHARTER + mappings + assets via Tripo
  generation, presents the result for review.

## Pilot — forest atmosphere

See `docs/atmospheres/forest/` for the in-progress first
atmosphere. Status, per stage:

| Stage | Status |
|---|---|
| 1 Charter | CHARTER.md written; editorial review pending |
| 2 Mapping | mappings.yml drafted (article + profile + event); editorial review pending |
| 3 Inventory | assets-needed.yml generated mechanically from stage 2 |
| 4 Acquisition | asset-log.yml template ready; MCPs not yet installed → `status: pending` entries; primitives fall back |
| 5 Processing | deferred until stage 4 completes |
| 6 Integration | first atmosphere Builder (`ArticleAsTree`) shipped using primitives; ProfileAsSpirit + EventAsTotem deferred until real assets arrive |

The pilot validates the *pipeline shape* before the asset layer
arrives. Once Sketchfab / Tripo / Blender MCPs are wired and the
world-building technical layer runs through stages 4–5, this
table updates to `complete` and the forest atmosphere becomes
the visual baseline.
