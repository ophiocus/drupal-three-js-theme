# v0.1.2 — SmartObjects

Replaces the cube-shaped placeholders that have stood in for
every entity since the ALPHA. Establishes the abstraction layer
that lets articles, profiles, events, chatvatars, and (later)
custom item types all share infrastructure while reading
visually different.

## Goal

A composable presence model: each entity in the world becomes a
`SmartObject` — a `THREE.Group` plus a list of `Component`s — and
the *which components* and *with what parameters* is determined
by a `Builder` registered against the entity's bundle.

The mapping criteria — descriptor JSON → assembled SmartObject —
is the load-bearing question this doc answers.

## On vocabulary (UE → us)

Unreal's "Actor / Component / Pawn / Character" taxonomy is
battle-tested, but several of its terms cue game-mechanic
assumptions that don't apply to a Site as World:

| UE term | Status here | Why |
|---|---|---|
| **Actor** | renamed → `SmartObject` | UE's "actor" implies behavior + lifecycle; ours are *presences*, not autonomous entities. "SmartObject" matches UE 5.0+'s actual concept of "an actor that declares what interactions it supports" — and that's exactly what each of our entities does (bloom, navigate, hover, etc.). |
| **Component** | kept as `Component` | Universal, accurate, already in the Manifesto vocabulary (`component_types`). |
| **Pawn** | dropped | No player-controlled entities. The user navigates *to* SmartObjects, not *with* them. |
| **Character** | replaced by composition | A "Character" in our world is a SmartObject with a particular component set (skeletal mesh + idle animation + gaze behavior). No separate class needed; the Builder decides which components to attach. The Manifesto's `chatvatar.barista` item type *is* this composition. |
| **Blueprint** | dropped | UE-specific visual scripting; our equivalent is the Builder code in TypeScript and the Drupal-side metaphor plugin. |
| **Skeletal/Static Mesh distinction** | preserved at the Component level | `MeshComponent` (static geometry) vs `SkeletalMeshComponent` (rigged + bones + animations). Same divide for the same reason. |

The rest of this doc uses `SmartObject` / `Component` / `Builder` /
`Registry` / `Chatvatar` (existing manifesto term).

## Architecture overview

```
descriptor (CorpusSnapshot.entities[i])
        ↓
SmartObjectRegistry.find(descriptor.bundle)  →  Builder
        ↓
Builder.build(descriptor, BuilderContext)    →  SmartObject
        ↓
SmartObject (extends THREE.Group, contains Components)
        ↓
SceneManager adds the Group to scene.
        ↓
SceneManager.update(dt) calls SmartObject.update(dt)
        ↓
Each Component's update(dt) fires (animations, gaze, idle behaviors)
```

`SceneManager` becomes a thin shell that owns the registry, the
list of live SmartObjects, and the per-frame fanout. Today's
`placeEntities()` (cube + pad + surface) becomes
`Object.values(snapshot.entities).map(d => registry.build(d))`.

## Core types

```ts
// SmartObject.ts
import * as THREE from "three";

/**
 * Composable presence in the world. Extends Group so it's a
 * direct three.js scene-graph node — no wrapping object that
 * needs to be unwrapped to call .add() on the scene.
 */
export class SmartObject extends THREE.Group {
  /** Source descriptor's id, e.g. "node-12". Tagged on hit-test paths. */
  readonly entityId: string;
  /** Builder that produced this object — used for hot-rebuild on snapshot change. */
  readonly builderName: string;
  private readonly components: Component[] = [];

  constructor(entityId: string, builderName: string) {
    super();
    this.entityId = entityId;
    this.builderName = builderName;
    this.userData.entityId = entityId;
  }

  attach(component: Component): void {
    this.components.push(component);
    component.onAttach(this);
  }

  update(dt: number, ctx: FrameContext): void {
    for (const c of this.components) c.update?.(dt, ctx);
  }

  dispose(): void {
    for (const c of this.components) c.dispose?.();
    // Group cleanup: dispose geometries/materials owned by us.
    this.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
  }

  findComponent<T extends Component>(kind: new (...args: any[]) => T): T | undefined {
    return this.components.find((c) => c instanceof kind) as T | undefined;
  }
}

/** Per-frame context shared with components. */
export interface FrameContext {
  camera: THREE.Camera;
  time: number;
  /** Current "current sector" for region-aware behaviors. */
  currentSectorId: string | null;
}
```

```ts
// Component.ts

export interface Component {
  /** Called once when the component is attached to a SmartObject. */
  onAttach(host: SmartObject): void;
  /** Called once when the component is detached. Free GPU resources here. */
  dispose?(): void;
  /** Called each frame from SmartObject.update(). Optional — pure-geometry components don't need it. */
  update?(dt: number, ctx: FrameContext): void;
}
```

```ts
// Builder.ts

export interface BuilderContext {
  snapshot: CorpusSnapshot;
  palette: Palette;
  surfaceCache: SurfaceCache;
  /** Resolve an asset URL — defaults to theme-relative. */
  assetUrl: (path: string) => string;
}

export interface SmartObjectBuilder {
  /** Human-readable identifier; used in logs and `builderName`. */
  readonly name: string;
  /** Does this builder handle the given descriptor? First match wins. */
  matches(descriptor: Entity): boolean;
  /** Build + return the SmartObject. Builder owns all attached components. */
  build(descriptor: Entity, ctx: BuilderContext): Promise<SmartObject>;
}

export class SmartObjectRegistry {
  private readonly builders: SmartObjectBuilder[] = [];
  private readonly fallback: SmartObjectBuilder;

  constructor(fallback: SmartObjectBuilder) {
    this.fallback = fallback;
  }

  register(builder: SmartObjectBuilder): void {
    this.builders.push(builder);
  }

  async build(descriptor: Entity, ctx: BuilderContext): Promise<SmartObject> {
    const builder = this.builders.find((b) => b.matches(descriptor)) ?? this.fallback;
    return builder.build(descriptor, ctx);
  }
}
```

## The mapping criteria — descriptor → SmartObject

This is the load-bearing part. It splits into three layers, each
honoring a different invariant of the thesis.

### Layer 1 — Bundle → Builder (the dispatch table)

The bundle field on the descriptor picks the builder:

| Bundle | Builder | What it produces |
|---|---|---|
| `article` | `ArticleBuilder` | A standing form (currently a cube; v0.1.2 introduces a "stele" — a tall standing slab) with a trigger pad + HTML surface |
| `profile` | `ProfileBuilder` | A persona — skeletal-mesh torso/head, idle breathing, gaze tracks camera |
| `event` | `EventBuilder` | A temporal installation — banner + date column, scaled by recency |
| `chatvatar` | `ChatvatarBuilder` | A profile-builder superset with an interactive-conversation component |
| *(default)* | `FallbackBuilder` | The current cube — guarantees every entity renders even if unrecognized |

The registry is constructed in `SceneManager.mount()` with built-in
builders. v0.2+ may allow modules/themes to inject custom builders
via a discovery mechanism (parallel to Drupal's metaphor plugins).

### Layer 2 — Signature → Visual properties (the editorial → visual function)

The signature's four axes drive a *visual modulation* applied to
whatever the bundle's builder produced. This is where editorial
decisions become geometric ones — the thesis at work.

| Signature axis | Maps to | Builder uses it for |
|---|---|---|
| `structural.wordCount` | scale.y multiplier (stele height) | tall stele = long article |
| `structural.paragraphCount` | segment count on stele | visible "structure" of the read |
| `structural.imageCount` | emissive ring count around base | media-richness signal |
| `temporal.changedAt` | hue shift toward palette `recent` | newer entries pulse warmer |
| `temporal.createdAt` | base material weathering parameter | older = more patina |
| `relational.inDegree` | glow intensity on hover | "cited often" entities light up |
| `relational.outDegree` | tendril/connection particle count | "connects to many" visualises outward |
| `semantic.embedding[…]` | subtle deformation seed | similar embeddings → similar silhouettes |

Each builder declares which axes it consumes. Not every builder
uses every axis — the `ChatvatarBuilder` reads relational data
heavily; the `EventBuilder` reads temporal heavily; the
`ArticleBuilder` is structural-leaning.

**Implementation shape**:

```ts
const heightMultiplier = THREE.MathUtils.mapLinear(
  Math.log10(Math.max(descriptor.signature.structural.wordCount, 10)),
  1, 4,        // 10 words → 10,000 words log range
  0.5, 2.0,    // y-scale range
);
mesh.scale.y *= heightMultiplier;
```

Pure functions. No state. The same descriptor produces the same
visual on every machine — preserves the determinism invariant
that makes URLs deep-linkable.

### Layer 3 — Manifesto → Component validity (the editorial guardrail)

The Drupal-side `world_signature.manifesto` config declares which
component types apply to which item types. The TS-side Builder
must only attach components that the manifesto declares valid
for its item type.

Example (manifesto snippet):

```yaml
item_types:
  - id: metaphor.node.article
    components:
      - color_slot
      - texture_slot
      - hitbox
      - trigger_event
      - html_surface
```

The `ArticleBuilder` may attach `MeshComponent`, `HtmlSurfaceComponent`,
`TriggerPadComponent`, `HoverComponent`. It may **not** attach
`AnimationComponent` (no `animation_slot` declared for article)
without first amending the manifesto.

This is what gives editors the eventual handle to the world:
adding `animation_slot` to `metaphor.node.article` in config →
articles can carry idle animations. Code change not required;
configuration change is.

At runtime, the Registry validates each builder's component list
against the manifesto's item-type definition; mismatches log a
warning and silently drop the offending component. Strict mode
(via env var or config) makes the mismatch a hard error.

## Component catalog

Initial component set for v0.1.2. Names match the Manifesto's
component_types where they exist; new names register a manifesto
addition in the same commit.

| Component | Manifesto type | Reads | Writes (scene) |
|---|---|---|---|
| `MeshComponent` | (implicit; every SmartObject has one) | geometry + material spec | adds a `THREE.Mesh` to the group |
| `MaterialSlotComponent` | `color_slot` + `texture_slot` | palette + descriptor signal | overrides material color/map |
| `HtmlSurfaceComponent` | `html_surface` | descriptor `cards[]` | attaches an `HtmlSurface` mesh |
| `TriggerPadComponent` | `trigger_event` | bundle color, entity id | adds a tagged disc mesh |
| `HoverComponent` | *(new)* — register as `hover_affordance` | host group | wires emissive lift; PointerNavigator-aware |
| `IdleAnimationComponent` | `animation_slot` | clip name, amplitude | drives `THREE.AnimationMixer` per frame |
| `GazeComponent` | *(new)* — register as `gaze_behavior` | camera position | rotates a child mesh toward camera each frame |
| `LightComponent` | `light_emitter` | color, intensity | adds a `THREE.PointLight` |
| `HitboxComponent` | `hitbox` | geometry | adds a transparent collision/click proxy |

Adding a component to the system is: (a) write a TypeScript class
implementing `Component`, (b) register the corresponding type name
in `world_signature.manifesto.component_types`, (c) reference it
from builders.

## Three concrete builders

### `ArticleBuilder` — v0.1.2 launch

```ts
class ArticleBuilder implements SmartObjectBuilder {
  readonly name = "article";
  matches(d: Entity) { return d.bundle === "article"; }

  async build(d: Entity, ctx: BuilderContext): Promise<SmartObject> {
    const obj = new SmartObject(d.id, this.name);

    // Mesh: a "stele" — a tall standing slab. Width modest, height
    // modulated by word count.
    const wordCount = d.signature.structural.wordCount;
    const heightMul = THREE.MathUtils.mapLinear(
      Math.log10(Math.max(wordCount, 10)), 1, 4, 0.6, 2.4,
    );
    const geo = new THREE.BoxGeometry(6, 12 * heightMul, 2);
    const mat = new THREE.MeshStandardMaterial({
      color: ctx.palette.bundleColors.article,
      roughness: 0.65,
      metalness: 0.08,
    });
    obj.attach(new MeshComponent({ geometry: geo, material: mat }));

    obj.attach(new HoverComponent());
    obj.attach(new TriggerPadComponent({
      color: ctx.palette.bundleColors.article,
      entityId: d.id,
      offset: { x: 0, z: 6 },
    }));
    obj.attach(new HtmlSurfaceComponent({
      url: d.cards.find((c) => c.viewMode === "default")?.contentRef
           ?? `/world/card/node/${numericIdOf(d.id)}/default`,
      surfaceCache: ctx.surfaceCache,
      offset: { x: 0, y: 14 * heightMul, z: 8 },
    }));

    return obj;
  }
}
```

### `ProfileBuilder` — v0.1.3+

```ts
class ProfileBuilder implements SmartObjectBuilder {
  readonly name = "profile";
  matches(d: Entity) { return d.bundle === "profile"; }

  async build(d: Entity, ctx: BuilderContext): Promise<SmartObject> {
    const obj = new SmartObject(d.id, this.name);

    // Skeletal mesh — a stylised standing figure. .glb loaded
    // from theme assets.
    obj.attach(new SkeletalMeshComponent({
      glb: ctx.assetUrl("models/persona-figure.glb"),
      scale: 1.0,
    }));

    // Subtle clothing tint from relational signature
    obj.attach(new MaterialSlotComponent({
      slot: "clothing",
      color: pickColorByDegree(d.signature.relational.outDegree),
    }));

    // Idle breathing animation, picked up automatically from the
    // glb's clip list.
    obj.attach(new IdleAnimationComponent({ clip: "idle_breathing", weight: 1.0 }));

    // Eyes follow the camera.
    obj.attach(new GazeComponent({ bone: "head" }));

    // Standard interactivity.
    obj.attach(new HoverComponent());
    obj.attach(new TriggerPadComponent({
      color: ctx.palette.bundleColors.profile,
      entityId: d.id,
    }));
    obj.attach(new HtmlSurfaceComponent({ /* card... */ }));
    return obj;
  }
}
```

### `EventBuilder` — v0.1.4+

A temporally-anchored installation: a column with a date band
that pulses as the event date approaches and patinas after it
passes.

```ts
class EventBuilder implements SmartObjectBuilder {
  readonly name = "event";
  matches(d: Entity) { return d.bundle === "event"; }

  async build(d: Entity, ctx: BuilderContext): Promise<SmartObject> {
    const obj = new SmartObject(d.id, this.name);

    obj.attach(new MeshComponent({ /* tall column */ }));
    obj.attach(new TemporalUrgencyComponent({
      eventDate: d.signature.temporal.eventDate,
      preGlow: 0.3,
      postPatina: 0.4,
    }));
    obj.attach(new HoverComponent());
    obj.attach(new TriggerPadComponent({ /* ... */ }));
    obj.attach(new HtmlSurfaceComponent({ /* ... */ }));
    return obj;
  }
}
```

## Asset pipeline

Static assets (glb meshes, textures, audio) live in the theme:

```
web/themes/custom/drupal_threejs/
├── assets/
│   ├── models/
│   │   ├── persona-figure.glb
│   │   ├── event-column.glb
│   │   └── ...
│   ├── textures/
│   │   └── ...
│   └── audio/
│       └── ...
```

`BuilderContext.assetUrl(path)` resolves to
`/themes/custom/drupal_threejs/assets/<path>` by default. Per-property
overrides (different theme) are a one-line config change.

Three loaders ship in three.js (`GLTFLoader`, `TextureLoader`,
`AudioLoader`); each Component that needs an asset loads it on
attach with a fallback to a placeholder if loading fails. The
fallback path is critical — a missing .glb shouldn't break the
world, just downgrade to a cube.

**Caching**: assets loaded by URL deduplicate at the Component
level (one `Map<url, Promise<asset>>`). v0.2 considers a
`AssetCache` peer to `SurfaceCache` if cross-builder reuse
patterns emerge.

**Editorial workflow**: artists drop .glb files in the theme
repo; the renderer picks them up on next build. v0.2 may add
Drupal media-entity binding so editors can swap assets via the
admin UI without a developer pushing files.

## File layout

```
src/world/
├── types.ts                  (existing)
├── layout.ts                 (existing)
├── vantage.ts                (existing)
├── runtime/
│   ├── SceneManager.ts       (slimmed — delegates to registry)
│   ├── CameraController.ts   (existing)
│   ├── PointerNavigator.ts   (existing)
│   ├── BiomeMixer.ts         (existing)
│   ├── SurfaceCache.ts       (existing)
│   ├── CardController.ts     (existing)
│   ├── HtmlSurface.ts        (existing)
│   └── smart-objects/        ← new tree
│       ├── SmartObject.ts
│       ├── Component.ts
│       ├── Builder.ts
│       ├── Registry.ts
│       ├── components/
│       │   ├── MeshComponent.ts
│       │   ├── MaterialSlotComponent.ts
│       │   ├── HtmlSurfaceComponent.ts
│       │   ├── TriggerPadComponent.ts
│       │   ├── HoverComponent.ts
│       │   ├── IdleAnimationComponent.ts
│       │   ├── GazeComponent.ts
│       │   ├── LightComponent.ts
│       │   └── HitboxComponent.ts
│       └── builders/
│           ├── FallbackBuilder.ts       (the current cube)
│           ├── ArticleBuilder.ts        (v0.1.2 launch)
│           ├── ProfileBuilder.ts        (v0.1.3+)
│           ├── EventBuilder.ts          (v0.1.4+)
│           └── ChatvatarBuilder.ts      (later)
```

## Migration path from current state

v0.1.2 lands the abstraction and the first non-cube builder
(`ArticleBuilder` producing the stele shape). Existing
`SceneManager.attachHtmlSurface()` and `CardController.makePad()`
plumbing migrates into Components.

**Phased rollout**:

1. **v0.1.2a** — `SmartObject` + `Component` + `Builder` types,
   `FallbackBuilder` that produces today's cube + pad + surface.
   No visible change; codebase reorganized. SceneManager slimmed.
2. **v0.1.2b** — `ArticleBuilder` shipping the stele shape with
   word-count-modulated height. Every entity becomes a stele
   instead of a cube. First visible signature → geometry mapping.
3. **v0.1.3** — `ProfileBuilder` and the asset pipeline.
   Introduces `SkeletalMeshComponent`, `IdleAnimationComponent`,
   `GazeComponent`. Needs at least one .glb model + a content
   bundle of type `profile` (or the seeder adapts a few articles
   into profiles).
4. **v0.1.4** — `EventBuilder`. Temporal modulation. New
   `TemporalUrgencyComponent`.
5. **v0.2** — `ChatvatarBuilder` + Anthropic-driven dialogue.
   The big one; depends on the AI epic landing.

The migration is incremental and the codebase stays green at
every step. `FallbackBuilder` remains forever as the safety net.

## Open questions

**Q1. Mesh ownership and disposal.**
SmartObject.dispose() traverses children and calls `.dispose()`
on geometries/materials. But shared materials (palette-driven)
shouldn't be disposed if other SmartObjects use them. **Options:**
- (a) Every SmartObject clones its materials at build time (memory
  cost; safe).
- (b) Materials carry a refcount; dispose decrements.
- (c) Builders use a `MaterialCache` that hands out shared
  references and manages disposal.
- Recommendation: **(a)** for v0.1.2 — memory cost is low at our
  20-entity scale; revisit at v0.2 when corpora reach 100+.

**Q2. Animation timing — global vs per-object.**
`THREE.AnimationMixer` runs per-skeleton. With 20+ persona
entities, that's 20 mixers ticked each frame. Acceptable cost
(<1ms total) but worth flagging. **Decision pending count > 100.**

**Q3. Builder hot-reload on snapshot change.**
When the cypher republishes (new entity, edited descriptor), do
we (a) rebuild every SmartObject from scratch, (b) diff and
rebuild only changed ones, (c) let components reapply their
mapping logic to new descriptor values?
- Recommendation: **(b)** — diff by entityId, rebuild changed
  + new, dispose deleted. Simple to implement, correct.

**Q4. Where do builders register?**
- (a) Hardcoded in `SceneManager.mount()` (zero ceremony, no
  discovery).
- (b) Each builder file `export default` registers itself on
  import (auto-discovery, magic).
- (c) Manifesto declares which builders are active for which
  item types (data-driven, slow).
- Recommendation: **(a)** for v0.1.2; revisit at v0.2 if
  property-specific builders emerge.

**Q5. Editorial visibility — should editors see component
attachments in Drupal admin UI?**
Per the editorial-primacy thesis, yes eventually — editors
should see and modify a Profile's components (swap idle anim,
adjust gaze enabled/disabled). v0.2-or-later concern; v0.1.2
hardcodes builder logic and exposes the manifesto for *type*
declarations only.

**Q6. Cube fallback or invisible fallback?**
When a builder fails (asset 404, malformed descriptor), should
the SmartObject render as a cube (legible "something here is
broken") or be invisible (don't pollute the world)?
- Recommendation: **cube + console.warn**. Legibility wins; the
  user can see something's wrong and report it.

**Q7. Per-Component signature mapping — function or config?**
Layer 2's "signature → visual property" mappings can live either
as JavaScript functions in the Component (`MaterialSlotComponent`
hardcodes "outDegree → glow intensity") OR as Drupal config
("MaterialSlotComponent has a mapping_rule field; editors edit
the curve"). The latter is editorial-primacy ideal but heavy.
- Recommendation: **functions in code for v0.1.2; config-driven
  mappings on the v0.2+ list.** Get the abstraction right first;
  let editors touch it once it's stable.

## Size estimate

| Stage | LOC delta | Time |
|---|---|---|
| v0.1.2a (abstraction + FallbackBuilder) | ~600 added, ~100 removed | 1 day |
| v0.1.2b (ArticleBuilder + stele) | ~250 added | 0.5 day |
| v0.1.3 (ProfileBuilder + asset pipeline) | ~700 added | 1.5 days |
| v0.1.4 (EventBuilder + TemporalUrgency) | ~350 added | 0.5 day |

Total to v0.1.4 (all three bundles distinct): roughly 1,900 LOC
added, ~3.5 days of focused build time.

## Decision points

Before I build, three forks worth confirming:

**D1. Vocabulary — "SmartObject" / "Component" / "Builder" / "Chatvatar".**
Accept, or rewrite? My recommendation is to keep "SmartObject"
(matches UE 5's actual concept) and "Component" (universal),
drop "Actor / Pawn / Character / Blueprint", keep the existing
manifesto's "chatvatar." A pure-rename alternative is in the
table at the top.

**D2. Per-bundle silhouette for v0.1.2.**
- (a) Stele (tall slab, word-count-modulated height) for `article`.
- (b) Keep the cube and just modulate its proportions by signature.
- (c) Defer all visual changes; ship just the abstraction this
  release, real geometry in v0.1.3+.

I'd recommend **(a)** — first visible signature→geometry mapping
is good demo value and isn't much extra work.

**D3. Asset loader pre-warm.**
Should `SceneManager.mount()` pre-load all known .glb models
referenced by registered builders (slower initial load, no pop-in)
or load on demand per Component (faster initial load, individual
pop-in when each builder runs)?

I'd recommend **on-demand with a global asset cache** — the
HtmlSurface lazy-load pattern proved out the bridge philosophy;
do the same for meshes.

Pick (or override), then I build.
