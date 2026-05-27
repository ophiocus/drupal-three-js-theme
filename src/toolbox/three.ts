// The toolbox / three barrel — the project's ONE allowed entry point
// into three.js and its addons.
//
// Rule (docs/TOOLBOX_AND_STAGE.md §1):
//   - This file may `import` from "three", "three/examples/...", and
//     any other three.js addon path.
//   - Every other file in src/ MUST get three primitives from here,
//     never directly from "three" or a three/* sub-path. The boundary
//     is enforced by scripts/check-toolbox-boundary.mjs (wired into
//     `prebuild`); a violation fails the build.
//
// Adding a primitive: just add the export below. The barrel is meant
// to grow — that's the *escape hatch* the rule allows for.

export * from "three";

// ─── Addons we currently use ───────────────────────────────────────────────
// Add new addons as the toolset needs them; never reach past the barrel.

export { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// SkeletonUtils.clone is the *only* SkeletonUtils symbol we use, and the
// project consumes it under the local name `skeletonClone` (the unrenamed
// `clone` collides with too many call-sites). Re-export under both so
// either spelling works.
export {
  clone,
  clone as skeletonClone,
} from "three/examples/jsm/utils/SkeletonUtils.js";
