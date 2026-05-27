# Toolbox & Stage

**Status:** architectural commitment + POC sequencing (2026-05-25)
**Relates to:** `docs/MILESTONES.md` (ALPHA 2, ALPHA 3, backburner "game engine
core") · `docs/INTERPRETATION_ENGINE.md` · `docs/BOUNDARY.md` ·
`docs/BATTLE_SCARS.md`

> Two layers, one rule. **Toolbox** wraps every primitive the renderer
> needs (three.js + project-grade lifecycle on top). **Toolset** is
> everything we build *with* the toolbox — atmospheres, fixtures,
> controllers, GUIs. **The toolset never imports `three` directly.** The
> rule is what gives the abstraction teeth; the lab equipment is what
> makes it productive.

---

## 1. The principle

### 1.1 Strict boundary

```
src/toolbox/   ─┐
                ├─ may import "three", "three/examples/...", any addon
                │
src/{world,shared,…}/  ─┐
                         ├─ MUST import three primitives only from src/toolbox/*
                         │  no `import "three"` lines outside the toolbox
```

Why strict and not pragmatic-guideline: a guideline rots the first time
someone is in a hurry. The boundary is *enforced by tooling* (a small
script wired into `prebuild`), so a violating commit fails the build.
That's the cost of forever-clean architecture.

### 1.2 What "comply with all of three.js" actually means

A naive reading — re-export every class — yields a 1000-symbol facade
nobody curates. The honest target:

- **All three.js core is re-exported through the barrel** (`export *
  from "three"`). Tree-shaking handles the unused half.
- **Addons** (loaders, utils, postprocessing, controls) are added to
  the barrel **as the toolset needs them**, never blind-imported. Today
  that's `GLTFLoader` + `SkeletonUtils.clone`; tomorrow it'll be more.
- **Project-grade wrappers** on top of raw three (the "lab equipment"):
  every wrapper knows about `dispose()`, the disposable world-layer
  seam, snapshot orientation, and the `?atmosphere=` preview pattern.
  These wrappers (`SmartObject`, `WorldHud`, `AtmosphereSwitcher`,
  `CrossfadeOverlay`, `AtmosphereAudio`, `LoaderOverlay`,
  `CameraController`, `PointerNavigator`, …) move into the toolbox over
  time — for phase 1 they stay where they are; the boundary just bites
  at the `three` import line.
- **Explicit escape hatch:** if the toolset needs a three primitive the
  barrel doesn't export, the answer is *"add it to the barrel,"* never
  *"reach past."* That keeps the boundary real while staying tractable.

### 1.3 Enforcement (phase 1)

- `src/toolbox/three.ts` — the **only file** in the project allowed to
  `import` from `three` / `three/…`. Re-exports the surface.
- `scripts/check-toolbox-boundary.mjs` — Node script that walks `src/`,
  matches `from\s+["']three(?:\/[^"']*)?["']`, and exits non-zero if
  any match falls outside `src/toolbox/`. Run as `npm run
  check:toolbox`; wired into `prebuild` so `vite build` fails on
  violation.
- All 32 existing direct importers migrate to relative paths into the
  barrel. Mechanical, zero behavior change.

ESLint is not adopted in this phase (the project has no eslint config
today; adding it is a separate decision). When ESLint lands,
`no-restricted-imports` replaces the script — same rule, prettier UX.

---

## 2. The Stage GUI — in-canvas, three layers

The renderer is already a richly-overlaid 2D-over-3D surface
(`WorldHud`, the switcher pill, the loader, the crossfade). The Stage
GUI extends the same pattern into an **in-canvas world editor** an
editor can open over the live world.

### 2.1 What the Stage GUI manipulates

Three concerns, one overlay, three persistence sinks:

| Layer | What an editor places / configures | Persists to |
|---|---|---|
| **Stage fixtures** — *the far-reaching background* | Zodiac signs (drag a sign around its ring, pick archetype, recolor), scenery rings, monuments, ambient fixtures. Selectable as 2D markers, manipulated via screen-space gizmos. | A `field_world_stage` JSON blob on the world node, scoped per-atmosphere. |
| **World config** — *the overall* | World constants (radius, heights, sector ring), palette colors, biome list, active atmosphere, fog distance — all live-previewed. | Existing world node fields + `world_signature.palette` config. |
| **Embedding parsing rules** — *the interpretation lens* | The interpretation profile: dimensionality (2/3), frame mode (mds / anchors / hybrid), the **anchor poles** (the words that mint meaning), region model + threshold, camera mode. | A new `field_world_interpretation` JSON / sub-entity on the world (resolves `INTERPRETATION_ENGINE.md` O-I1 / O-I2). |

### 2.2 Mounting — in-canvas (not /admin)

Mounted as a fixed DOM overlay above the canvas (z-index between
WorldHud and CardOverlay), revealed by an editor-role "edit world" gate
in the corner. The world keeps rendering live behind the GUI; selection
adds screen-space gizmos to the targeted fixtures via the WorldHud
projection seam. Reasons:

- **Live preview is intrinsic.** Every mutation is a live change to the
  in-memory profile the renderer reads — what you see is what you'll
  save.
- **The world is the UI** — the project's ethos.
- **No `/admin` context-switch** breaks the editor flow.

(Auth: the GUI shell only mounts for an authenticated user with the
`edit world` permission; the same permission gates the write endpoints.)

### 2.3 Preview vs. save

Every change has two phases, naturally:

1. **Preview** — the renderer accepts a *mutable in-memory override
   bundle* the GUI mutates. No Drupal write. This generalizes the
   `?atmosphere=` hint pattern we already shipped (read-only,
   per-client, no global mutation).
2. **Save** — a small authenticated REST endpoint per layer
   (`PATCH /world/edit/stage`, `…/config`, `…/interpretation`) writes
   the bundle back to Drupal as the canonical sink (node field /
   config). Role-gated; CSRF-protected; structured payload validated
   against a schema.

### 2.4 Freshness — the silent-staleness fix

When the editor changes anchor poles or anything that invalidates
embeddings, the GUI surfaces a **freshness indicator**: "rules changed
→ poles need re-embedding (N nodes stale)." A one-click button calls an
admin route that invokes the existing `world:embed` logic in a queue.

This closes the silent-staleness wound from the editor-UX discussion
without breaking `BOUNDARY.md`: the **trigger** lives in the GUI, the
**compute** stays external.

---

## 3. Code seams

| Concern | Today | Stage GUI / strict-toolbox change |
|---|---|---|
| three primitives | imported in 32 files | imported only in `src/toolbox/three.ts`; rest go through it |
| Live-render mutation | atmosphere code mutates scene directly | a *profile bundle* the renderer reads (already true for palette / interpretation); the GUI mutates the bundle |
| Persistence | drush + raw config | `PATCH /world/edit/{stage,config,interpretation}` endpoints |
| Auth | n/a (drush is operator) | `edit world` permission + CSRF |
| Re-embed trigger | drush only | admin route + queue, surfaced from the GUI |

---

## 4. Sequencing (the phases)

Four phases, each independently shippable. Phase 1 is the boundary
hardening that everything else stands on; phases 2-4 build the GUI
incrementally.

1. **Phase 1 — toolbox barrel + enforcement.** `src/toolbox/three.ts`,
   the boundary check script, the 32-file migration. No behavior
   change; foundation for everything below.
2. **Phase 2 — Stage GUI v0: placements.** Edit-mode gate; click a
   zodiac sign → screen-space gizmo; drag to reposition; save to a
   `field_world_stage` blob. Validates the whole pattern (selection +
   gizmo + preview + persist) with the smallest possible scope.
3. **Phase 3 — Stage GUI v1: world config + freshness.** Right-rail
   panel for palette / world constants / active atmosphere; freshness
   indicator with one-click "re-embed + relayout." This is the
   editor-completeness fix.
4. **Phase 4 — Stage GUI v2: interpretation authoring.** Edit anchor
   poles + frame mode; live re-project preview; save → schedule
   re-embed-of-poles. The moment editors *mint meaning*.

Beyond the four: ESLint adoption (replacing the script check),
extracting `src/toolbox/` as a published `world-engine` package
(MILESTONES backburner).

---

## 5. Open questions

- **O-TS1 — wrappers in toolbox?** Today the controllers / HUD live in
  `src/world/runtime/`; long-term they belong in `src/toolbox/` (they
  *are* the lab equipment). Migration is mechanical but noisy; defer
  until phase 1 is settled.
- **O-TS2 — gizmo library?** Build screen-space gizmos from primitives
  we already have (WorldHud labels + DOM drag handlers), or import an
  addon (three's `TransformControls`)? The DOM-overlay route fits our
  ethos and avoids more 3D primitives; revisit if dragging feels off.
- **O-TS3 — schema for the stage blob.** A JSON shape per
  atmosphere; needs versioning from day one so old worlds don't break
  when the schema grows.
- **O-TS4 — role.** `edit world` as a single permission, or split
  per-layer (`edit world stage`, `…config`, `…interpretation`)?
  Per-layer is safer; we ship single first.
