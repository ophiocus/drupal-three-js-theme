#!/usr/bin/env node
// Strict toolbox-boundary check (docs/TOOLBOX_AND_STAGE.md §1.3).
//
// Walks src/ and fails the build if any file outside src/toolbox/
// imports from "three" or a "three/..." sub-path. Run via:
//   node scripts/check-toolbox-boundary.mjs       (one-shot)
//   npm run check:toolbox                         (script alias)
//   npm run build                                 (via prebuild)
//
// The rule and its rationale live in docs/TOOLBOX_AND_STAGE.md. ESLint
// will eventually replace this with `no-restricted-imports`; until the
// project adopts ESLint, this is the enforcement gate.

import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const SRC = join(REPO_ROOT, "src");
const TOOLBOX = join(SRC, "toolbox");

// Match: `from "three"`, `from 'three'`, `from "three/anything"`.
const THREE_IMPORT = /from\s+["'](three(?:\/[^"']+)?)["']/g;

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

const files = await walk(SRC);
const violations = [];

for (const file of files) {
  // The barrel is the one place that's allowed.
  if (file.startsWith(TOOLBOX + sep)) continue;
  const text = await readFile(file, "utf8");
  THREE_IMPORT.lastIndex = 0;
  let m;
  while ((m = THREE_IMPORT.exec(text)) !== null) {
    const lineNumber = text.slice(0, m.index).split("\n").length;
    violations.push({
      file: relative(REPO_ROOT, file),
      line: lineNumber,
      import: m[1],
    });
  }
}

if (violations.length === 0) {
  console.log("[toolbox-boundary] OK — no direct three imports outside src/toolbox/");
  process.exit(0);
}

console.error(
  `[toolbox-boundary] FAIL — ${violations.length} direct three import(s) outside src/toolbox/:\n`,
);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  →  "${v.import}"`);
}
console.error(
  "\nFix: import three primitives from src/toolbox/three.ts. " +
    "If a needed symbol isn't exported there yet, add it to the barrel — never reach past.\n" +
    "Rule: docs/TOOLBOX_AND_STAGE.md §1.",
);
process.exit(1);
