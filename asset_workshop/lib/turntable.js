/**
 * Headless turntable MP4 — render a model rotating 360° to a short,
 * loop-friendly h264 .mp4 (no GIF; MP4 only).
 *
 * Stack: a tiny local HTTP server serves the model + a <model-viewer>
 * page; puppeteer drives headless Chromium, sets cameraOrbit per
 * frame and screenshots; ffmpeg (bundled via @ffmpeg-installer)
 * encodes the PNG sequence to MP4. model-viewer handles glTF loading,
 * PBR lighting, and camera framing, so this works for arbitrary input.
 */

import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

const MV_FILE = fileURLToPath(
  new URL('../node_modules/@google/model-viewer/dist/model-viewer.min.js', import.meta.url),
);

const PAGE = (size) => `<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden;background:#1d2a1f}
  model-viewer{width:${size}px;height:${size}px;background:#1d2a1f;--poster-color:transparent}
</style>
<script type="module" src="/mv.js"></script>
</head><body>
<model-viewer id="mv" src="/model.glb"
  environment-image="neutral" exposure="1.0" shadow-intensity="0.5" shadow-softness="0.8"
  interaction-prompt="none" disable-zoom disable-pan
  camera-orbit="0deg 75deg auto" field-of-view="32deg"></model-viewer>
</body></html>`;

/**
 * @param {string} input   path to .glb/.gltf
 * @param {string} output  path to write .mp4
 * @param {{size?:number, frames?:number, fps?:number, elevationDeg?:number}} opts
 */
export async function turntable(input, output, opts = {}) {
  const { size = 1024, frames = 120, fps = 30, elevationDeg = 75 } = opts;

  const modelBytes = await readFile(input);
  const mvBytes = await readFile(MV_FILE);
  const ext = extname(input).toLowerCase();
  const modelMime = ext === '.glb' ? 'model/gltf-binary' : 'model/gltf+json';

  // 1. Serve model + model-viewer + page on an ephemeral port.
  const server = createServer((req, res) => {
    if (req.url.startsWith('/model.glb') || req.url.startsWith('/model.gltf')) {
      res.writeHead(200, { 'Content-Type': modelMime }); res.end(modelBytes);
    } else if (req.url.startsWith('/mv.js')) {
      res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(mvBytes);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE(size));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const workdir = await mkdtemp(join(tmpdir(), 'turntable-'));
  let browser;
  try {
    // 2. Headless Chromium. --no-sandbox for container/CI; SwiftShader
    //    software GL means no GPU is required.
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=swiftshader', '--hide-scrollbars'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });

    // 3. Wait for model-viewer to finish loading the model.
    await page.waitForFunction(
      () => { const mv = document.getElementById('mv'); return mv && mv.loaded; },
      { timeout: 60000 },
    );

    // 4. One screenshot per orbit step.
    for (let i = 0; i < frames; i++) {
      const theta = (360 * i) / frames;
      await page.evaluate(async (t, elev) => {
        const mv = document.getElementById('mv');
        mv.cameraOrbit = `${t}deg ${elev}deg auto`;
        await mv.updateComplete;
        // Two rAFs ensure the new orbit has actually painted.
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }, theta, elevationDeg);
      const framePath = join(workdir, `frame_${String(i).padStart(4, '0')}.png`);
      await page.screenshot({ path: framePath });
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }

  // 5. Encode PNG sequence → MP4 (h264, yuv420p for broad playback,
  //    +faststart for web streaming, crf 18 = visually lossless-ish).
  await encode(workdir, output, fps);
  await rm(workdir, { recursive: true, force: true });
  return { output };
}

function encode(workdir, output, fps) {
  return new Promise((resolvePromise, reject) => {
    const args = [
      '-y',
      '-framerate', String(fps),
      '-i', join(workdir, 'frame_%04d.png'),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-crf', '18',
      '-preset', 'medium',
      '-movflags', '+faststart',
      // Guarantee even dimensions (h264 requirement).
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      output,
    ];
    const proc = spawn(ffmpegInstaller.path, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error('ffmpeg failed (' + code + '):\n' + stderr.slice(-800)));
    });
    proc.on('error', reject);
  });
}
