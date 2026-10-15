#!/usr/bin/env node
// Runtime-boundary check — the seam between the world runtime and the
// Drupal binding (docs/TOOLBOX_AND_STAGE.md §1, same enforcement
// pattern as check-toolbox-boundary.mjs).
//
// src/world/ is the runtime: the descriptor contract, vantage(), and
// world/runtime/. It must stay liftable out of this theme, so it may
// not reach into the theme's own layers:
//
//   1. Imports from src/world/ resolve only inside src/world/,
//      src/toolbox/ or src/shared/ — never src/binding/,
//      src/atmospheres/, src/builders/ or main.ts.
//   2. No `fetch(` in src/world/. Every request goes through the
//      WorldTransport the host hands SceneManager.
//   3. No Drupal routes or settings in src/world/ code: no
//      "/world/card|snapshot|edit|admin", "/themes/", drupalSettings,
//      and no page paths ("/sector/…", "/node/…") — URL shapes come
//      from the RouteCodec. Those belong to src/binding/.
//
// Comments are ignored, so history and rationale can still name the
// routes. Run via:
//   node scripts/check-runtime-boundary.mjs    (one-shot)
//   npm run check:runtime                      (script alias)
//   npm run build                              (via prebuild)

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const SRC = join(REPO_ROOT, "src");
const RUNTIME = join(SRC, "world");
const ALLOWED_ROOTS = ["world", "toolbox", "shared"].map((d) => join(SRC, d) + sep);

const RELATIVE_IMPORT = /(?:from\s+|import\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;
const FETCH_CALL = /\bfetch\s*\(/g;
const DRUPAL_TOKEN =
  /["'`][^"'`\n]*(\/world\/(?:card|snapshot|edit|admin)\b|\/themes\/|\/(?:sector|node)\/)[^"'`\n]*["'`]|\bdrupalSettings\b/g;

/** Recursively list .ts files under root. */
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (e.isFile() && /\.(ts|tsx|mts)$/.test(e.name)) out.push(full);
  }
  return out;
}

/** Blank out comments, keeping offsets (and so line numbers) intact. */
function stripComments(text) {
  const blank = (s) => s.replace(/[^\n]/g, " ");
  return text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, (m, lead) => lead + blank(m.slice(lead.length)));
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

const files = await walk(RUNTIME);
const violations = [];

for (const file of files) {
  const code = stripComments(await readFile(file, "utf8"));
  const where = relative(REPO_ROOT, file);
  let m;

  RELATIVE_IMPORT.lastIndex = 0;
  while ((m = RELATIVE_IMPORT.exec(code)) !== null) {
    const target = resolve(dirname(file), m[1]);
    if (!ALLOWED_ROOTS.some((root) => target.startsWith(root))) {
      violations.push(`${where}:${lineOf(code, m.index)}  imports "${m[1]}" (outside world/toolbox/shared)`);
    }
  }
  FETCH_CALL.lastIndex = 0;
  while ((m = FETCH_CALL.exec(code)) !== null) {
    violations.push(`${where}:${lineOf(code, m.index)}  calls fetch() (use the WorldTransport)`);
  }
  DRUPAL_TOKEN.lastIndex = 0;
  while ((m = DRUPAL_TOKEN.exec(code)) !== null) {
    violations.push(`${where}:${lineOf(code, m.index)}  Drupal-specific ${m[1] ? `route "${m[1]}"` : "drupalSettings"}`);
  }
}

if (violations.length === 0) {
  console.log("[runtime-boundary] OK — src/world/ reaches no binding, content, fetch or Drupal route");
  process.exit(0);
}

console.error(`[runtime-boundary] FAIL — ${violations.length} violation(s) in src/world/:\n`);
for (const v of violations) console.error(`  ${v}`);
console.error(
  "\nFix: requests go through WorldTransport (world/runtime/wire.ts), URL shapes through " +
    "RouteCodec (world/routes.ts); their Drupal implementations live in src/binding/.\n" +
    "Rule: scripts/check-runtime-boundary.mjs header.",
);
process.exit(1);
