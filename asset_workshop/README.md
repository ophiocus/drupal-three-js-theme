# asset_workshop

Headless asset solutions for the three.js world, invoked with a file
path. **Independent of the `world_signature` Drupal module** — the
module never renders or transforms; it only hosts the results. This
folder is the "external render/transform platform" the module's
turntable + curation features depend on.

All media output is **MP4** (good-resolution h264). No GIF.

## Solutions

| Command | In | Out | Stack |
| --- | --- | --- | --- |
| `transform` | `.glb` / `.gltf` | normalized `.glb` | `gltf-transform` (pure JS) |
| `turntable` | `.glb` / `.gltf` | turntable `.mp4` | headless Chromium + `model-viewer` + ffmpeg |

## Usage

```bash
# Optimize + recenter (base pivot, X/Z centered) → self-contained .glb
node bin/workshop.js transform input.glb output.glb
node bin/workshop.js transform input.glb --fit-height=8     # rescale to 8 units tall
node bin/workshop.js transform input.glb --no-recenter

# Render a 360° turntable MP4 (default 1024px, 120 frames @ 30fps)
node bin/workshop.js turntable input.glb output.mp4
node bin/workshop.js turntable input.glb --size=1280 --frames=180 --fps=30 --elev=70
```

`transform` does: `dedup → flatten → join → weld → prune`, then a
recenter pass (base at y=0, centered on X/Z) and optional `--fit-height`
rescale. Texture re-compression is deliberately left out (needs the
native `sharp` dep) — add later if texture weight matters.

`turntable` serves the model to a `<model-viewer>` page in headless
Chromium, screenshots one frame per orbit step, and encodes the PNG
sequence to h264 MP4 (yuv420p, crf 18, +faststart, even dims).

## Requirements

- **Node ≥ 20.**
- **`transform`** needs only the npm deps (pure JS).
- **`turntable`** needs headless Chromium (puppeteer downloads its own)
  plus its runtime libraries. On a Debian/Ubuntu host/container that
  means, roughly:
  `libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2`.
  ffmpeg is bundled via `@ffmpeg-installer/ffmpeg` — no system install.

## How it feeds the module

The module's `field_asset_turntable` (asset bundle) receives the
`.mp4` this folder produces; the asset teaser autoplays it on hover.
A curator runs (or a future queue job runs) `transform` to produce the
world-ready `.glb` for `field_asset_curated_file`. Neither operation
lives in the module — this is the seam.
