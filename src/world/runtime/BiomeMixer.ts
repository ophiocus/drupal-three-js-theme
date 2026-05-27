// BiomeMixer — per-sector palette overlays + per-frame spatial
// blend of biome contribution against the camera's XZ position.
//
// Sprint 5f / 6b: regions are the macro-organizing principle of
// the world; different sectors should *feel* different. The mixer
// makes the scene background, fog, and ambient light a function
// of position — not a state machine, not a temporal lerp.
//
// Weighting model: inverse-distance, normalized. Approach a sector
// → its biome dominates. Equidistant from all → smooth average.
// At ALPHA the biome list is hardcoded; v0.1 moves it to the
// `world_signature.palette` config so editors can tune their world
// without touching code.

import * as THREE from "../../toolbox/three.js";
import type { Sector } from "../types.js";

/** Per-biome overlay. Each property mixes independently. */
export interface Biome {
  /** Hex color string. */
  background: string;
  /** Hex color string. */
  fogColor: string;
  fogNear: number;
  fogFar: number;
  /** Hex color string. */
  ambientColor: string;
  ambientIntensity: number;
}

/**
 * Snapshot-shaped biome — the JSON arrives in this form from the
 * cypher (`world_signature.palette.biomes` → snapshot). The
 * BiomeMixer flattens it to the runtime `Biome` shape on intake.
 */
export interface BiomePaletteEntry {
  label?: string;
  background: string;
  fog: { color: string; near: number; far: number };
  ambient: { color: string; intensity: number };
}

const DEFAULT_BIOME: Biome = {
  background: "#d0dce6",
  fogColor: "#c8d8e0",
  fogNear: 80,
  fogFar: 500,
  ambientColor: "#e8efe9",
  ambientIntensity: 0.85,
};

function fromPaletteEntry(entry: BiomePaletteEntry): Biome {
  return {
    background: entry.background,
    fogColor: entry.fog.color,
    fogNear: entry.fog.near,
    fogFar: entry.fog.far,
    ambientColor: entry.ambient.color,
    ambientIntensity: entry.ambient.intensity,
  };
}

interface SectorBinding {
  sector: Sector;
  biome: Biome;
}

export class BiomeMixer {
  private readonly bindings: SectorBinding[] = [];
  private readonly bgColor = new THREE.Color();
  private readonly fogColor = new THREE.Color();
  private readonly ambColor = new THREE.Color();

  constructor(
    sectors: Sector[],
    biomeEntries: BiomePaletteEntry[],
    private readonly scene: THREE.Scene,
    private readonly ambient: THREE.AmbientLight,
  ) {
    // Sort sectors by termId so biome assignment is stable across
    // snapshot regenerations. termIds are strings; numeric sort.
    const sorted = [...sectors].sort((a, b) => {
      const an = Number(a.termId);
      const bn = Number(b.termId);
      return an - bn;
    });
    // No biome entries in config = no biome blending; every sector
    // gets the default biome and the result is the global palette
    // unchanged. The mixer still runs (cheap), it just doesn't do
    // anything visible.
    const biomes = biomeEntries.length > 0
      ? biomeEntries.map(fromPaletteEntry)
      : [DEFAULT_BIOME];
    sorted.forEach((sector, i) => {
      this.bindings.push({
        sector,
        biome: biomes[i % biomes.length],
      });
    });
  }

  /**
   * Recompute the blended biome from the camera's XZ position and
   * apply it to scene.background, scene.fog, and ambient. Call once
   * per frame; the work is O(sectors) and cheap.
   */
  update(cameraXZ: { x: number; z: number }): void {
    if (this.bindings.length === 0) {
      // No sectors → use the default biome unchanged.
      this.applyBiome(DEFAULT_BIOME);
      return;
    }

    // Inverse-distance weights, clamped so a camera sitting on top
    // of a centroid doesn't divide by zero.
    const weights = this.bindings.map((b) => {
      const c = b.sector.centroid;
      const dx = cameraXZ.x - c.x;
      const dz = cameraXZ.z - c.z;
      const d = Math.max(Math.sqrt(dx * dx + dz * dz), 1);
      // Square the inverse so closer sectors dominate sharply; bare
      // 1/d gives too uniform a blend at the camera's orbit radius.
      return 1 / (d * d);
    });
    const total = weights.reduce((s, w) => s + w, 0);

    let bgR = 0, bgG = 0, bgB = 0;
    let fgR = 0, fgG = 0, fgB = 0;
    let fogN = 0, fogF = 0;
    let amR = 0, amG = 0, amB = 0;
    let amI = 0;

    for (let i = 0; i < this.bindings.length; i++) {
      const w = weights[i] / total;
      const bi = this.bindings[i].biome;
      const bg = new THREE.Color(bi.background);
      const fc = new THREE.Color(bi.fogColor);
      const ac = new THREE.Color(bi.ambientColor);
      bgR += bg.r * w; bgG += bg.g * w; bgB += bg.b * w;
      fgR += fc.r * w; fgG += fc.g * w; fgB += fc.b * w;
      fogN += bi.fogNear * w;
      fogF += bi.fogFar * w;
      amR += ac.r * w; amG += ac.g * w; amB += ac.b * w;
      amI += bi.ambientIntensity * w;
    }

    this.bgColor.setRGB(bgR, bgG, bgB);
    this.fogColor.setRGB(fgR, fgG, fgB);
    this.ambColor.setRGB(amR, amG, amB);

    this.scene.background = this.bgColor;
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color = this.fogColor;
      this.scene.fog.near = fogN;
      this.scene.fog.far = fogF;
    } else {
      this.scene.fog = new THREE.Fog(this.fogColor, fogN, fogF);
    }
    this.ambient.color = this.ambColor;
    this.ambient.intensity = amI;
  }

  private applyBiome(biome: Biome): void {
    this.bgColor.set(biome.background);
    this.fogColor.set(biome.fogColor);
    this.ambColor.set(biome.ambientColor);
    this.scene.background = this.bgColor;
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color = this.fogColor;
      this.scene.fog.near = biome.fogNear;
      this.scene.fog.far = biome.fogFar;
    } else {
      this.scene.fog = new THREE.Fog(this.fogColor, biome.fogNear, biome.fogFar);
    }
    this.ambient.color = this.ambColor;
    this.ambient.intensity = biome.ambientIntensity;
  }
}
