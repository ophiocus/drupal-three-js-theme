# The boundary — theme vs external service

The rule that decides where a capability lives:

> **The theme/module owns the data model, the world, and the *use* of
> computed results. An external service owns heavy or specialized
> *compute* — binary transformation, model inference, offline
> rendering.**

If a feature *produces* a binary, a vector, a rendered frame, or an
LLM completion, it's external. If it *models*, *stores*, *renders the
world*, or *consumes a produced result*, it's the theme.

---

## In the theme/module (YES)

| Capability | Why it's internal |
| --- | --- |
| **Asset management** — content types, fields, lifecycle, pack/asset references, the catalog | The data model is the theme's job |
| **Embedding *usage* for spatial referencing** — vectors → world coordinates (MDS), emergent sectors, `world:relayout` | Using a computed result is internal |
| **World rendering + navigation** — entities-as-objects, camera, URI-as-coordinate, vantages, snapshot read API | The world itself |
| **Reading in situ** — FullView modal, teaser, WorldHud labels/hover | Presentation |
| **Hosting + playing produced media** — `field_asset_turntable` mp4 + hover-autoplay | Host/play yes; *produce* no |
| **Source resolution + licensing metadata** — provider layer (ref → URL + licence), copyright/`live` gate | Cataloguing, not processing |
| **Animation catalogue (light metadata read) + playback** — read `gltf.animations`; mix clips at runtime | Asset-management + rendering |
| **Gateway *client*** — Guzzle calls to RESTHeart | Consuming a service |

## External service (NO)

| Capability | Why it's external | Where it lives |
| --- | --- | --- |
| **Asset sanitization / transformation** — gltf-transform, re-pivot, decimate, convert | Heavy binary compute | `asset_workshop/` |
| **Embedding *processing*** — running the model, computing vectors | Model inference | embedding service (`WORLD_EMBED_*`) |
| **Turntable / offline rendering** — headless Chromium/Blender → mp4 | Render pipeline | `asset_workshop/` |
| **LLM inference** — chatvatar dialogue, auto-descriptors | Model inference | LLM provider |
| **Heavy leech / decompress / extract** — download + unpack archives | Worker concern, not request-path | ingestion worker |
| **Vector store + gateway** — Atlas, RESTHeart | Infrastructure | hosted services |
| **Search query embedding** — computing the query vector | Model inference (the *fly-to* UI is internal) | embedding service |

---

## Consequence for what's already built

BETA 2 put embedding **compute** inside the module (`world:embed` +
`LocalTfIdfEmbeddingProvider`). By this boundary that's the wrong
side. The corrected shape — already half-built:

- **`RemoteEmbeddingProvider`** (external service produces vectors) is
  the **production path**.
- **`LocalTfIdfEmbeddingProvider`** is a **dev-only / PoC fallback** —
  zero-setup local lexical vectors so DDEV works without an embedding
  service. Not for production.
- **`world:embed`** is reframed: "call the configured embedder and
  store the result," not "compute embeddings here." With
  `WORLD_EMBED_URL` set it calls the service; unset, it falls back to
  the dev embedder.
- **`SemanticLayoutProjector` + `world:relayout`** stay — that's the
  internal "use the vectors for spatial referencing" half.

Everything else we've built already sits on the correct side.
