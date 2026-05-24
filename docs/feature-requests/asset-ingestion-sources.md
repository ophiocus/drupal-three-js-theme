# Asset sources — research for ingestion

Companion to `asset-ingestion.md`. A round of research (2026-05) on
free online 3D-asset resources, classified by whether the **Asset
ingestion** feature can reach them. Three deliverables, as requested:

1. **Primary listing** — every candidate source.
2. **Accessibility-confirmed subset** — sources the ingestor can
   leech directly (open download URL or open API, no login/JS wall).
3. **API services** — for sources *only* in the primary list (gated /
   not directly leechable), whether a programmatic API exists.

"Leechable" = the ingestion pipeline (`leech → decompress → extract →
card`) can fetch a real binary from a stable URL without a human
clicking through a login or JS gate.

---

## 1. Primary listing (all candidates)

| # | Source | License(s) | Formats | Notes |
| --- | --- | --- | --- | --- |
| 1 | **Quaternius** | CC0 | glTF, FBX, OBJ | ~1,400 low-poly models; no login. Already in our catalog. |
| 2 | **Kenney** | CC0 | glTF, FBX, OBJ, …; zipped packs | Hundreds of themed kits; no login. |
| 3 | **Poly Haven** | CC0 | glTF, fbx, blend, usd(z) | Public REST API with download URLs. Mostly props/nature + HDRIs/textures. |
| 4 | **OpenGameArt (OGA)** | CC0, CC-BY, CC-BY-SA, OGA-BY, GPL, PD | OBJ, FBX, blend, glTF (mixed) | No registration to download; **per-asset license varies — must read each.** Already in our catalog. |
| 5 | **Poly Pizza** | CC0 + CC-BY (per model) | glTF/GLB | Page download no-login; programmatic via API key. Mirrors Google Poly + community. |
| 6 | **KayKit (Kay Lousberg)** | CC0 | glTF, FBX, GLB | Hosted on itch.io; "name-your-price" (free) modal. Already in our catalog. |
| 7 | **itch.io (CC0 3D packs)** | per-pack (often CC0) | GLB, FBX, …; zipped | e.g. Eclair Assets car-kit. Free packs gate behind a price modal; itch API / `butler` automate. |
| 8 | **Khronos glTF-Sample-Assets** | CC0 + mixed (per model) | glTF, GLB | GitHub repo; raw file URLs. Reference/test meshes, not a scenery library. |
| 9 | **open-source-3D-assets (ToxSam)** | CC0 | GLB | GitHub JSON registry, 991+ GLB linking to permanent storage. "API-friendly" by design. |
| 10 | **ambientCG** | CC0 | mostly materials/textures; some models | API v2 with direct `rawLink`. Primarily PBR materials. |
| 11 | **Sketchfab** | CC0, CC-BY, CC-BY-SA, … | glTF, GLB, USDZ (download API) | **Login/OAuth required to download.** Robust Data + Download API. |
| 12 | **Fab (Epic)** | mixed (free + paid) | UE/Unity + various | **No public download API**; launcher/web only. |
| 13 | **CGTrader** | Royalty-Free / Editorial + free tier | MAX, OBJ, FBX, 3DS, C4D, glTF | Free models require login; no public bulk-download API. |
| 14 | **Free3D** | mixed (per model) | many | Login + ad gate; no API. |
| 15 | **Meshy / Magnific (AI gen)** | generated (CC0-ish, check ToS) | GLB | Generative, not a library; generation APIs are paid. Out of metaphor scope for now. |

---

## 2. Accessibility-confirmed subset (ingestor can leech)

These have **open, stable download paths** — direct files or an open
API — with no login/JS wall. This is the set the ingestion feature
should target first.

| Source | How to leech | License default | Confirmed |
| --- | --- | --- | --- |
| **Quaternius** | Direct pack/file download links on the model pages; no login. | CC0 | ✅ no-login download (search-confirmed) |
| **Kenney** | Direct CC0 zip per asset page. | CC0 | ✅ no-login download |
| **Poly Haven** | **Open REST API** `https://api.polyhaven.com` → `/assets?type=models`, `/files/{slug}` returns glTF URL + MD5 + size + texture includes. Requires a `User-Agent` header. | CC0 | ✅ API live — `/types` returned `["hdris","textures","models"]` |
| **OpenGameArt** | Direct download button, no registration. **Parse the per-asset license** before importing. | mixed (CC0/CC-BY/…) | ✅ no-registration download |
| **glTF-Sample-Assets** | Raw GitHub URLs (`raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/<Name>/glTF-Binary/<Name>.glb`). | CC0 + mixed | ✅ public GitHub raw |
| **open-source-3D-assets (ToxSam)** | GitHub JSON registry → permanent-storage GLB URLs. Ideal first integration: it *is* a catalog API. | CC0 | ✅ public GitHub JSON |
| **ambientCG** | API v2 `https://ambientcg.com/api/v2/full_json` → `rawLink` (direct) vs `downloadLink` (counted redirect). | CC0 | ✅ documented direct `rawLink` |
| **Poly Pizza** | Model-page download is no-login (leechable); programmatic use wants the free API key. | CC0 / CC-BY (per model) | ◐ page-download open; API key for bulk |
| **itch.io / KayKit** | Free packs reachable past the price modal; `butler` + itch API (`/uploads`, `/download`) automate. | per-pack (KayKit = CC0) | ◐ soft gate; API/butler automatable |

**Recommended ingestion priority:** Poly Haven (clean API, CC0,
textures included) → ToxSam registry (pure CC0 GLB catalog) →
Quaternius / Kenney (CC0, direct, already in catalog) →
glTF-Sample-Assets (CC0 test meshes) → OpenGameArt (direct but
per-asset license parsing) → ambientCG (materials) → Poly Pizza
(API key) → itch (butler).

---

## 3. API services — for primary-list-only (gated) sources

These are in the primary list but **not** in the confirmed-leechable
subset. Whether the ingestor could integrate via API instead:

| Source | API? | Auth | Download verdict |
| --- | --- | --- | --- |
| **Sketchfab** | **Yes** — Data API v3 + Download API. `GET /v3/models/{uid}/download` returns temporary glTF/GLB/USDZ links. Search via `GET /v3/search?type=models&downloadable=true`. | OAuth2 *or* `Authorization: Token {API_TOKEN}`; **end-user must authenticate** (or contact Sketchfab for app-level download). | Possible via API + token, but requires an authenticated account; respect per-model CC license + author attribution. The temp download link itself needs no auth (short-lived). |
| **Fab (Epic)** | **No public API.** Marketplace via Epic Games Launcher / web only. Unofficial `egs-api-py` reverse-engineers the store API (fragile, ToS-risky). | Epic account | Manual only. Not a viable ingestion target. |
| **CGTrader** | No public *download* API for the free tier. Has upload/partner APIs, not bulk free fetch. Free models require login. | account | Manual only for free models. |
| **Free3D** | No API. Login + ad-gated downloads. | account | Manual only. |
| **Meshy / Magnific** | Generation APIs exist (paid) — they *create* models, not serve a free library. | API key (paid) | Out of scope (generative, not ingestion of existing free assets). |

---

## Implications for the ingestion feature

- **Phase 1 targets** = the §2 confirmed subset. Two integration
  shapes the ingestor must support:
  - **Direct-URL leech** (Quaternius, Kenney, OGA, glTF-Sample-Assets,
    itch packs) — the generic `leech → decompress → extract` path.
  - **Catalog-API leech** (Poly Haven, ToxSam registry, ambientCG,
    Poly Pizza) — query the API for an asset's file URL, then leech
    that URL. Worth a thin `SourceAdapter` interface so each catalog
    API plugs in without touching the core pipeline.
- **License handling is non-uniform.** CC0 sources (Quaternius,
  Kenney, Poly Haven, ToxSam, KayKit) auto-fill `field_pack_license`.
  **OpenGameArt and Poly Pizza are per-asset** — the ingestor must
  capture the declared license per item and block `live` promotion
  when it's unknown or non-commercial-incompatible.
- **Sketchfab** is the one gated source worth a *later* API adapter
  (huge catalog), but it needs OAuth + per-model attribution — a
  bigger lift than the open sources. Defer past Phase 1.
- **Fab / CGTrader / Free3D** stay manual — feed their direct URLs to
  the leecher by hand when a human has obtained one.

---

## Sources

- Poly Haven API — https://api.polyhaven.com · https://github.com/Poly-Haven/Public-API
- Poly Pizza API — https://poly.pizza/docs/api/v1.1
- Sketchfab Download API — https://sketchfab.com/developers/download-api · Data API v3 https://sketchfab.com/developers/data-api/v3
- ambientCG API — https://docs.ambientcg.com/api/v2/
- Quaternius — https://quaternius.com/
- Kenney — https://kenney.nl/assets
- OpenGameArt — https://opengameart.org/
- KayKit — https://kaylousberg.itch.io/
- itch.io butler — https://itch.io/docs/butler/
- Khronos glTF-Sample-Assets — https://github.com/KhronosGroup/glTF-Sample-Assets
- open-source-3D-assets (ToxSam) — https://github.com/toxsam/open-source-3D-assets
- Fab (no API) — https://dev.epicgames.com/documentation/fab/
