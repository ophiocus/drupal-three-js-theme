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

import * as THREE from "three";
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

const BIOMES_BY_INDEX: Biome[] = [
  // Sector 0 / Antigua — volcanic Central America. Warm grey-green,
  // golden ambient, slight haze.
  {
    background: "#cad6c2",
    fogColor: "#c8d2c2",
    fogNear: 80,
    fogFar: 480,
    ambientColor: "#f0e8c8",
    ambientIntensity: 0.95,
  },
  // Sector 1 / Cauca — high Colombian Andes. Bright, clear, cool.
  {
    background: "#d8dfe6",
    fogColor: "#cdd6e0",
    fogNear: 100,
    fogFar: 520,
    ambientColor: "#e8eef4",
    ambientIntensity: 0.85,
  },
  // Sector 2 / Boquete — Panamanian cloud forest. Cool blue-grey,
  // dimmer ambient (the forest filters the light).
  {
    background: "#c4cfd6",
    fogColor: "#b8c4cc",
    fogNear: 60,
    fogFar: 420,
    ambientColor: "#d8e0e6",
    ambientIntensity: 0.70,
  },
  // Sector 3 / Sierra Madre — Chiapas. Warm earth tones, dusty haze.
  {
    background: "#d4ccba",
    fogColor: "#ccc2b0",
    fogNear: 80,
    fogFar: 480,
    ambientColor: "#f4e8c8",
    ambientIntensity: 0.90,
  },
  // Sector 4 / Tarrazú — Costa Rica. Saturated greens, light fog,
  // soft ambient.
  {
    background: "#c6d6c4",
    fogColor: "#bccdba",
    fogNear: 90,
    fogFar: 500,
    ambientColor: "#e0e8d8",
    ambientIntensity: 0.88,
  },
];

const DEFAULT_BIOME: Biome = {
  background: "#d0dce6",
  fogColor: "#c8d8e0",
  fogNear: 80,
  fogFar: 500,
  ambientColor: "#e8efe9",
  ambientIntensity: 0.85,
};

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
    sorted.forEach((sector, i) => {
      this.bindings.push({
        sector,
        biome: BIOMES_BY_INDEX[i % BIOMES_BY_INDEX.length],
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
