// CrossfadeOverlay — a palette-coloured fade used for the live
// atmosphere switch (world-switcher v2 polish, BETA 1).
//
// The switch tears the scene down and rebuilds it; rather than the
// LoaderOverlay's hard cut, this fades the world out to its current
// palette background, holds while the rebuild happens behind the
// cover, then fades back in to reveal the new skin. Pure DOM, one
// opacity transition — the heavy WebGL teardown/rebuild runs on the
// main thread while the compositor animates the fade.
//
// Choreography (driven by SceneManager.switchAtmosphere):
//   const fade = new CrossfadeOverlay({ color: oldPaletteBg });
//   await fade.cover();        // world → old bg
//   ...teardown + refetch + rebuild...
//   fade.setColor(newPaletteBg);
//   ...force one render so the new scene is painted under the cover...
//   await fade.reveal();       // new bg → new world
//
// z-index sits ABOVE the canvas + WorldHud (100) but BELOW the
// AtmosphereSwitcher (200) — the toggle pill stays visible through the
// fade so its active-skin highlight reads during the transition — and
// below the LoaderOverlay (999) / CardOverlay (1000).

export interface CrossfadeOverlayOptions {
  /** Initial cover colour — typically the outgoing palette background. */
  color: string;
  /** One-way fade duration in ms (cover and reveal each take this long). */
  fadeMs?: number;
  /** CSS class, so instances/apps don't collide. Defaults to "world-crossfade". */
  namespace?: string;
  /**
   * Peak opacity of the cover at full `cover()` — `0` to `1`. Default
   * `0.55`. The cover used to drive to `1` (a full opaque sheet), which
   * read as "fade to black" on dark atmospheres because the palette
   * colour completely replaced the canvas. With per-prop outro/intro
   * tweens carrying the visual transition, the cover only needs to be
   * a wash that softens the camera/palette/light swap behind it — the
   * world stays partially visible the whole time. Pass `1` to restore
   * the old fully-opaque behaviour (e.g., for debugging seams).
   */
  peakOpacity?: number;
}

const DEFAULT_FADE_MS = 350;
const DEFAULT_PEAK_OPACITY = 0.55;

export class CrossfadeOverlay {
  private readonly el: HTMLDivElement;
  private readonly fadeMs: number;
  private readonly peakOpacity: number;

  constructor(options: CrossfadeOverlayOptions) {
    this.fadeMs = options.fadeMs ?? DEFAULT_FADE_MS;
    // Clamp to [0, 1] — a peak below 0 or above 1 silently breaks the
    // opacity transition; clamping fails closed to "still visible."
    const requested = options.peakOpacity ?? DEFAULT_PEAK_OPACITY;
    this.peakOpacity = Math.max(0, Math.min(1, requested));
    this.el = document.createElement("div");
    this.el.className = options.namespace ?? "world-crossfade";
    this.el.setAttribute("aria-hidden", "true");
    this.el.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:150",
      "pointer-events:none",
      "opacity:0",
      `background:${options.color}`,
      `transition:opacity ${this.fadeMs}ms ease-in-out`,
    ].join(";");
    document.body.appendChild(this.el);
  }

  /** Fade up to `peakOpacity` (default 0.55 — a wash, not a black sheet). */
  async cover(): Promise<void> {
    // Force a reflow so the freshly-inserted node's opacity:0 is
    // committed before we flip — the transition then fires. Using a
    // reflow (not requestAnimationFrame) keeps this working even when
    // the tab is briefly throttled; rAF can stall in a hidden tab.
    void this.el.offsetHeight;
    this.el.style.opacity = String(this.peakOpacity);
    await this.wait(this.fadeMs);
  }

  /** Instant cover-colour swap. Do this while opaque (invisible change). */
  setColor(color: string): void {
    this.el.style.background = color;
  }

  /** Fade to transparent (reveal the world), then remove. Resolves after. */
  async reveal(): Promise<void> {
    this.el.style.opacity = "0";
    await this.wait(this.fadeMs);
    this.el.remove();
  }

  /** Immediate teardown — error-path bailout. */
  dispose(): void {
    this.el.remove();
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
