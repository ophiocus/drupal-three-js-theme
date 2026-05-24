#!/usr/bin/env node
/**
 * asset_workshop CLI — headless asset solutions, invoked with a file path.
 *
 *   workshop transform <input.glb|gltf> [output.glb] [--fit-height=N] [--no-recenter]
 *   workshop turntable <input.glb|gltf> [output.mp4] [--size=1024] [--frames=120] [--fps=30] [--elev=75]
 *
 * Independent of the Drupal module. Writes a normalized .glb or a
 * turntable .mp4 to disk; the module only ever hosts the result.
 */

import { resolve, basename, extname } from 'node:path';
import { transform } from '../lib/transform.js';
import { turntable } from '../lib/turntable.js';

function parseFlags(args) {
  const flags = {};
  const positionals = [];
  for (const a of args) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      flags[k] = v === undefined ? true : v;
    } else {
      positionals.push(a);
    }
  }
  return { flags, positionals };
}

function usage() {
  console.log(`asset_workshop — headless glTF transform + turntable MP4

Usage:
  workshop transform <input.glb|gltf> [output.glb] [--fit-height=N] [--no-recenter]
  workshop turntable <input.glb|gltf> [output.mp4] [--size=1024] [--frames=120] [--fps=30] [--elev=75]

All media output is MP4 (good resolution h264). No GIF.`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { flags, positionals } = parseFlags(rest);

  if (!command || command === '--help' || command === '-h') {
    usage();
    process.exit(command ? 0 : 1);
  }

  const input = positionals[0];
  if (!input) {
    console.error('error: missing <input> file path');
    usage();
    process.exit(1);
  }
  const inPath = resolve(process.cwd(), input);
  const stem = basename(input, extname(input));

  if (command === 'transform') {
    const out = resolve(process.cwd(), positionals[1] || `${stem}.transformed.glb`);
    await transform(inPath, out, {
      recenter: flags['no-recenter'] ? false : true,
      fitHeight: flags['fit-height'] ? Number(flags['fit-height']) : null,
    });
    console.log(`✓ transform → ${out}`);
    return;
  }

  if (command === 'turntable') {
    const out = resolve(process.cwd(), positionals[1] || `${stem}.turntable.mp4`);
    await turntable(inPath, out, {
      size: flags.size ? Number(flags.size) : 1024,
      frames: flags.frames ? Number(flags.frames) : 120,
      fps: flags.fps ? Number(flags.fps) : 30,
      elevationDeg: flags.elev ? Number(flags.elev) : 75,
    });
    console.log(`✓ turntable → ${out}`);
    return;
  }

  console.error(`error: unknown command "${command}"`);
  usage();
  process.exit(1);
}

main().catch((err) => {
  console.error('✗ ' + (err?.stack || err));
  process.exit(1);
});
