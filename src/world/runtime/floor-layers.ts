// Floor stacking heights — z-fighting prevention.
//
// Every ground-coplanar decorative mesh (ground plane, sector
// centroid pads, ground decals, trigger pads, future scenery
// patches) sits at one of these Y values, NOT literally at y=0.
//
// Why this matters: the depth buffer's precision degrades
// quadratically with distance under perspective projection. From
// the overview camera at y≈200 looking at a 200-unit-distant
// sector, a 0.05-unit Y separation between ground and sector pad
// resolves below the depth buffer's quantisation step → flicker
// stripes / z-fighting / Moiré-like patterns across the pad.
//
// Each layer here is half a world unit apart. Imperceptible to
// the user from any reasonable angle (a half-unit rise on a
// 200-unit-radius world reads as flat), but enormous in
// depth-buffer terms — well above the precision floor at every
// viable camera distance.
//
// New layers go BETWEEN existing values, never overlapping. The
// numeric gaps are deliberate room for that growth.

export const FLOOR_LAYERS = {
  /** The bedrock ground plane. The reference layer. */
  ground: 0,
  /** Sector centroid pads (large discs marking sector positions). */
  sector_pad: 0.5,
  /** Decorative ground decals — moss circles, leaf patches, etc. */
  ground_decal: 0.75,
  /** Trigger pads — small discs by each entity, click targets. */
  trigger_pad: 1.0,
} as const;

export type FloorLayer = keyof typeof FLOOR_LAYERS;
