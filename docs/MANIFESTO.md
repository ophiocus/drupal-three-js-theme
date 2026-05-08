# The World Manifesto

> **Status:** locked 2026-05-08.
> **Scope:** the canonical, declarative schema of *every kind of
> thing* the world contains and *every kind of property* a thing can
> expose. The cypher and the renderer both honor it; properties
> override its instances; future code registers against it without
> displacing what's already there.

## What the manifesto is

A **registry**. Two vocabularies cross at right angles:

- **Component types** — the kinds of *properties* world-items can
  carry. Color slots, texture slots, animation slots, hitboxes,
  physics bodies, sound slots, light emitters, trigger events.
  Universal vocabulary; small fixed list at any moment, append-only
  over time.
- **Item types** — the kinds of *things* the world contains. The
  world itself, sectors (regions), metaphors-per-bundle (node
  article = a room, paragraph quote = an inscription), trigger
  pads, lobby fixtures, chatvatars, et al. Each item type declares
  *which component slots it exposes*.

The manifesto is the document that lists both. Every concrete piece
of config in any property descends from a row in the manifesto.

## What the manifesto is not

- It is not a rendering engine. It carries data; the renderer reads
  data; nothing in the manifesto runs.
- It is not a content schema. Drupal entities, fields, and
  taxonomy live in their own tables; the manifesto describes what
  parts of those entities the *world* projects, not what the
  entities themselves are.
- It is not a closed standard. New component types and new item
  types land here as the project grows. The grammar is stable; the
  vocabulary is extensible.
- It is not a contract with editors. Editors read EDITORIAL.md.
  The manifesto is engineer-facing.

## Why the manifesto exists now

The palette landing as Drupal config (commit `8a6c203`) revealed a
pattern: a known *category of property* (color slots) of a known
*kind of thing* (the world itself), serialised as Drupal config,
read by the renderer through the snapshot. Every future
configurable thing — a sector's biome, a trigger pad's geometry, a
chatvatar's voice — follows the *same shape*. Naming the pattern
once means everything that comes after slots in instead of
inventing new shapes.

## The grammar

```
ItemType ──declares──▶ ComponentSlot[s]
   │                          │
   │                          └──schema──▶ shape of the value
   │                                         (color = CSS hex string,
   │                                          hitbox = {shape, dims},
   │                                          ...)
   │
   └──config_object──▶ Drupal config path where instances of this
                         item type land their actual values
```

A property's actual world is the cross product:

> **For every item type the manifesto declares, the property's
> config holds zero-or-more instances. Each instance specifies
> values for the component slots that item type exposes.**

Examples (in plain English):

- *world.global* — exactly one instance per property. Holds palette
  (color slots), world constants (dimensions). Config object:
  `world_signature.palette`, plus `world_signature.world` later.
- *sector.region* — one instance per top-level taxonomy term.
  Holds biome color tints, ambient sounds, lighting overrides.
  Config object: `world_signature.sector.<termId>`.
- *metaphor.node.article* — one instance per metaphor-plugin (the
  Article plugin). Holds room geometry parameters, default cards,
  paragraph-mapping rules. Config object:
  `world_signature.metaphor.node.article`.

## Component type vocabulary

The eight component types in v1 of the manifesto:

| Component | What it represents | Value shape |
|---|---|---|
| **`color_slot`** | A nameable color | CSS hex string, e.g. `"#8eb887"` |
| **`texture_slot`** | A nameable texture map | `{ path, repeat: [u,v], wrap }` |
| **`animation_slot`** | A nameable animation clip | `{ clip, duration_ms, easing, loop }` |
| **`hitbox`** | A clickable / collidable volume | `{ shape: box \| sphere \| cylinder \| mesh, dimensions: [...], offset: [x,y,z] }` |
| **`physics`** | Physics-body parameters | `{ mass, friction, restitution, kinematic }` |
| **`sound_slot`** | An audio source | `{ source, volume, loop, spatial }` |
| **`light_emitter`** | A light attached to the item | `{ type: point \| spot \| directional, color, intensity, decay }` |
| **`trigger_event`** | An event the item emits or listens for | `{ on: click \| hover \| gaze \| proximity \| search-match \| schedule \| world-event, action, ttl_ms }` |

Each component type has a *named-slot* model: an item declares
*"I expose a color_slot called background"* — a color_slot called
*background* is a slot, not the literal value. The property's
config provides the value.

### Adding a new component type

A new component category — say *wind_effect* or *particle_emitter*
— is a one-PR change:

1. Add the component to this section's table.
2. Add it to `world_signature.manifesto.yml` under `component_types`.
3. Add its schema to `world_signature.schema.yml`.
4. Update the renderer to read the new component when items declare
   it; existing items that don't declare it are unaffected.

This is forward-compat by design: the renderer skips component
types it doesn't recognise. New components don't break old
properties.

## Item type registry — current

The five item types declared in v1 of the manifesto:

| Item type | Status | Components exposed | Config object(s) |
|---|---|---|---|
| `world.global` | **implemented** | color_slot × 5 (background, fog, ambient, sun, fill), light_emitter × 2 | `world_signature.palette` (+ `world_signature.world` planned) |
| `sector.region` | **planned** (v0.0.2) | color_slot × 3 (ground, ambient_tint, fog_tint), sound_slot, light_emitter | `world_signature.sector.<termId>` |
| `metaphor.node.article` | **partially implemented** (extraction yes, full config-driven rendering no) | color_slot × 2, texture_slot, hitbox, animation_slot × 2, sound_slot × 2, trigger_event × 2 | `world_signature.metaphor.node.article` |
| `trigger_pad.bookmark` | **planned** (Sprint 5) | color_slot × 2, texture_slot, hitbox, animation_slot × 2, sound_slot, trigger_event × 2 | `world_signature.trigger_pad.bookmark` |
| `chatvatar.barista` | **planned** (v0.0.3+) | color_slot × 2, texture_slot, animation_slot × 2, sound_slot, trigger_event × 2 | `world_signature.chatvatar.barista` |

`status` is one of:

- **`implemented`** — runtime fully consumes this item type and its
  components.
- **`partially implemented`** — runtime understands the item but
  doesn't yet honor every declared component (e.g. trigger events
  declared but not wired).
- **`planned`** — declared in the manifesto for forward-compat;
  no runtime code reads its config yet, but the schema is ready
  and properties may begin authoring values.

`planned` item types carry the same schema rigor as implemented
ones. The point is precisely that **a property can begin
configuring its chatvatar today even though chatvatars don't yet
exist** — the values land in valid Drupal config, survive deploys,
and are ready the moment the renderer side ships.

### Adding a new item type

New world-item kinds — *sentinel*, *portal*, *placard*, etc. —
land via:

1. Add a row to the table above.
2. Add an entry under `item_types:` in
   `world_signature.manifesto.yml` declaring the components it
   exposes and its config_object path.
3. Add the schema for its config_object to
   `world_signature.schema.yml`.
4. (When ready) write the cypher's metaphor plugin / the
   renderer's SmartObject subclass that consume it.

If the runtime isn't ready, declare with `status: planned`. The
schema is enforced; properties can author against it; nothing
breaks.

## Where it lives

| File | Role |
|---|---|
| `web/modules/custom/world_signature/config/install/world_signature.manifesto.yml` | The seed manifesto installed when the cypher module is enabled. |
| `web/modules/custom/world_signature/config/schema/world_signature.schema.yml` | Typed-config schema for both the manifesto and the per-item config objects it declares. |
| `web/modules/custom/world_signature/src/Service/WorldManifesto.php` | Read-only service (`getItemTypes()`, `getComponentTypes()`, `componentsOf($itemType)`, `configObject($itemType)`). Loaded via DI. |
| `docs/MANIFESTO.md` | This file — the canonical thinking. |

## How the manifesto and the snapshot relate

The renderer doesn't load the manifesto directly. Instead, the
**SnapshotPublisher** consults the manifesto when assembling the
snapshot: for each item type the property has instances of, it
looks up the configured values and embeds them in the right
location of the snapshot JSON. The renderer reads the snapshot;
the snapshot is *manifesto-derived*.

This gives us:

- **One source of truth** for what's configurable (the manifesto).
- **One transport format** to the renderer (the snapshot).
- **No runtime coupling** between renderer and manifesto — the
  renderer just consumes its slice of the snapshot, ignorant of
  the meta-grammar.

## How the manifesto and the cypher relate

The cypher's **MetaphorPluginManager** (already shipped) is the
Drupal-plugin discovery mechanism for *metaphor.node.* and
*metaphor.paragraph.* item types. A metaphor plugin's annotation
declares the item type id; the manifesto declares which components
that item type exposes. The two cross-reference: **the manifesto
is the schema, the plugin is the implementation**.

A future plugin manager (Sprint 5+) will discover *trigger_pad.* and
*chatvatar.* item types the same way — each is annotated, each
maps to a manifesto entry.

## Forward-compat — what this buys us

Three concrete payoffs:

1. **Properties can author for the future.** atlas_coffee can
   today author `world_signature.chatvatar.barista` config (voice,
   color, animation cues) even though no chatvatar code exists.
   When the chatvatar feature ships, the config is *already there*
   and the property's chatvatar comes online without a
   configuration retro.

2. **The runtime evolves without invalidating data.** Adding a new
   component type — *particle_emitter* for atmospheric effects —
   doesn't require a config migration. Items declare the new
   component when they want to use it; old items don't and aren't
   affected.

3. **Cross-property reuse is a config-export, not a code-fork.**
   atlas_coffee's full set of `world_signature.*` config exports
   to YAML; another property imports it and inherits the world's
   look-and-feel without forking the theme.

## How a new item type comes online (worked example)

Suppose Sprint 7 adds *sentinel* — a fixed sentinel-figure item
type that stands at sector borders and guides newcomers. The
sequence:

1. **Doc** — add the row to *Item type registry* above (status:
   planned).
2. **Manifesto** — add to `manifesto.yml`:
   ```yaml
   item_types:
     sentinel.guide:
       label: 'Sentinel guide'
       components:
         - color_slot:robe
         - texture_slot:face
         - animation_slot:idle
         - animation_slot:beckon
         - sound_slot:hail
         - trigger_event:proximity
       config_object: world_signature.sentinel.guide
       status: planned
   ```
3. **Schema** — add the typed-config shape for
   `world_signature.sentinel.guide` to `world_signature.schema.yml`.
4. **Property authoring (optional, immediate)** — atlas_coffee's
   `config/sync/world_signature.sentinel.guide.yml` lands; values
   sit valid in Drupal config; nothing renders yet.
5. **Runtime (later)** — Sprint 7's renderer code reads the
   sentinel's config from the snapshot and instantiates the
   SmartObject. Existing properties' sentinel config comes
   online silently.

Three of those steps require zero new schema invention because
the manifesto already standardised the component types. Steps 1–3
are mechanical; step 4 is editorial; step 5 is when the visible
world catches up to what the manifesto already promised.

## What the manifesto deliberately does NOT promise

- It doesn't promise a fixed schema for component-type *values*
  beyond what's declared. Some values (texture paths, animation
  clip names) refer to assets the manifesto doesn't manage.
- It doesn't promise that every component an item declares is
  visually distinct. Two color slots called *primary* and
  *accent* might end up rendered identically until the runtime
  treats them differently. Manifesto = declared surface; renderer
  = honored surface.
- It doesn't promise property-author freedom from breaking
  changes during the *implementation* of an item type. A `planned`
  item type's component list may be revised before it goes
  `implemented` — that's the point of the lifecycle marker.

## Closing

The manifesto is the project's *constitutional* layer for the
configurable surface. The thesis says the world is shaped by the
corpus; the manifesto says the world's *texture* is shaped by
configuration; the cypher says the corpus's measurements drive
both. Three concentric layers, three documents, one project.

Edit this file when you change the grammar. Edit the YAML when
you add an item type or a component type. Edit
`world_signature.schema.yml` when a new config object joins.
Everything else is downstream.
