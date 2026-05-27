// SilhouetteHover — Fresnel-glow hover affordance, in-shader.
//
// Modifies the hovered entity's actual mesh materials via Three.js's
// `onBeforeCompile` hook. No new mesh is added to the scene; the
// existing materials gain a Fresnel rim glow whose intensity is
// driven by a uniform we toggle 0 → 1 on hover, 1 → 0 on clear.
//
// Why in-shader rather than a sibling glow mesh:
//   - The hover effect lives ON the entity's surface, not as a
//     floating halo above/around it. Visually unified.
//   - No scene-graph manipulation per hover — zero allocation, just
//     a uniform value change after the first install.
//   - The Fresnel rim follows the actual geometry exactly (trunk,
//     canopy, head, leaves), with no shape mismatch from a
//     bounding-primitive substitute.
//
// Per-hover lifecycle:
//   - First hover on a given material: install glow via
//     onBeforeCompile, force a one-time shader recompile, cache
//     the uniform handle on `material.userData.glow`.
//   - Subsequent hovers: just set the uniform's value. No
//     recompilation. Near-zero cost.
//   - Clear: set uniform back to 0 for all currently-glowing
//     materials. Materials stay installed for next hover.
//
// Per-object hitbox: PointerNavigator walks up to the SmartObject
// ancestor before passing to set(). This class then traverses the
// SmartObject's children and applies the glow to every Mesh's
// material — so the entire entity glows together, not just the
// individual sub-mesh under the pointer.

import * as THREE from "../../../toolbox/three.js";

/** Warm white — reads cleanly over the forest dusk palette. */
const GLOW_COLOR = new THREE.Color(0xfff0c8);

/** Fresnel sharpness. Higher = tighter rim band. */
const GLOW_POWER = 2.5;

/** Multiplier on the Fresnel contribution. Tuned so the glow reads
 *  on dark backgrounds without blowing out close vantages. */
const GLOW_INTENSITY = 1.4;

/** Per-material handle to the installed glow uniforms. Stashed in
 *  `material.userData.glow` so subsequent hovers on the same
 *  material skip re-installation. */
interface GlowHandle {
  uGlowAmount: { value: number };
}

/**
 * Install Fresnel-glow injection on a material via onBeforeCompile.
 * Idempotent — returns the existing handle if the material was
 * previously installed. Returns null for material types we don't
 * support (e.g., ShaderMaterial without the expected chunks).
 */
function installGlow(material: THREE.Material): GlowHandle | null {
  // Already installed — return cached handle.
  const existing = material.userData.glow as GlowHandle | undefined;
  if (existing) return existing;

  // Whitelist supported material types. MeshBasicMaterial,
  // MeshStandardMaterial, and MeshPhongMaterial all expose
  // onBeforeCompile and use the standard chunk include points we
  // patch into. ShaderMaterial / RawShaderMaterial don't, so skip.
  const supported =
    material instanceof THREE.MeshStandardMaterial ||
    material instanceof THREE.MeshPhongMaterial ||
    material instanceof THREE.MeshLambertMaterial ||
    material instanceof THREE.MeshBasicMaterial;
  if (!supported) return null;

  const uGlowAmount = { value: 0 };
  const uGlowColor = { value: GLOW_COLOR };
  const uGlowPower = { value: GLOW_POWER };
  const uGlowIntensity = { value: GLOW_INTENSITY };

  // Chain any pre-existing onBeforeCompile (defensive — we don't
  // own this hook exclusively).
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(material, shader, renderer);

    shader.uniforms.uGlowAmount = uGlowAmount;
    shader.uniforms.uGlowColor = uGlowColor;
    shader.uniforms.uGlowPower = uGlowPower;
    shader.uniforms.uGlowIntensity = uGlowIntensity;

    // Vertex shader — add view-space varyings for the fragment.
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
varying vec3 vGlowViewPos;
varying vec3 vGlowNormal;`,
    );
    // After project_vertex, `mvPosition` is in scope and `normal`
    // is the original geometry normal. Compute the view-space
    // position and the camera-space normal.
    shader.vertexShader = shader.vertexShader.replace(
      "#include <project_vertex>",
      `#include <project_vertex>
vGlowViewPos = -mvPosition.xyz;
vGlowNormal = normalize(normalMatrix * normal);`,
    );

    // Fragment shader — declare varyings + uniforms, then add the
    // Fresnel contribution to the final fragment color just before
    // the dithering pass.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
varying vec3 vGlowViewPos;
varying vec3 vGlowNormal;
uniform float uGlowAmount;
uniform vec3 uGlowColor;
uniform float uGlowPower;
uniform float uGlowIntensity;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      `#include <dithering_fragment>
if (uGlowAmount > 0.0) {
  vec3 viewDir = normalize(vGlowViewPos);
  vec3 n = normalize(vGlowNormal);
  float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), uGlowPower);
  gl_FragColor.rgb += uGlowColor * fresnel * uGlowIntensity * uGlowAmount;
}`,
    );
  };

  // customProgramCacheKey ensures Three.js doesn't share a cached
  // program across materials whose onBeforeCompile differs from
  // ours — defensive against shader-cache collisions.
  const prevCacheKey = material.customProgramCacheKey;
  material.customProgramCacheKey = function (): string {
    return (prevCacheKey ? prevCacheKey.call(material) + "|" : "") + "glow";
  };

  // Force a one-time recompile so the new shader takes effect.
  material.needsUpdate = true;

  const handle: GlowHandle = { uGlowAmount };
  material.userData.glow = handle;
  return handle;
}

export class SilhouetteHover {
  private currentTarget: THREE.Object3D | null = null;
  /** Glow handles whose uGlowAmount is currently nonzero. */
  private active: GlowHandle[] = [];

  /**
   * Show the glow on `target` (and all its descendant meshes), or
   * clear if null. Idempotent — calling with the same target while
   * already showing is a no-op.
   */
  set(target: THREE.Object3D | null): void {
    if (target === this.currentTarget) return;
    this.clear();
    if (!target) return;

    target.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!m) continue;
        const handle = installGlow(m);
        if (!handle) continue;
        handle.uGlowAmount.value = 1.0;
        this.active.push(handle);
      }
    });
    this.currentTarget = target;
  }

  /** Turn the glow off on every currently-glowing material. The
   *  shader modifications stay installed for next hover. */
  clear(): void {
    for (const handle of this.active) {
      handle.uGlowAmount.value = 0;
    }
    this.active = [];
    this.currentTarget = null;
  }

  /** Idempotent with clear — nothing else owns persistent state.
   *  Materials' installed shaders remain for the rest of the session. */
  dispose(): void {
    this.clear();
  }

  /** Currently-hovered object, or null. */
  get target(): THREE.Object3D | null {
    return this.currentTarget;
  }
}
