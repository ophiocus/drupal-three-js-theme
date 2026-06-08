// AtmosphereAudio — procedural per-atmosphere ambient soundscapes.
//
// Zero asset files: every bed is synthesised live with the Web Audio
// API (same ethos as the renderer's primitive geometry — no .mp3 to
// ship or license). The per-atmosphere builders live with their
// atmosphere modules (forest/audio.ts, inner-mind/audio.ts, …); this
// file is a generic lifecycle wrapper that asks the atmosphere
// registry for whichever bed is active.
//
// Adding a 3rd / 4th / Nth soundscape: export `buildSoundscape` from
// the new atmosphere module. AtmosphereAudio picks it up automatically.
//
// Autoplay etiquette: browsers block audio until a user gesture, and
// surprise ambient sound is rude. So this stays SILENT until enable()
// is called from a click (the HUD sound toggle). enable() resumes the
// AudioContext; setAtmosphere() crossfades beds on a switch; disable()
// fades out and suspends.

import { loadAtmosphere } from "./atmospheres/registry.js";
import type { Soundscape } from "./atmospheres/types.js";

export interface AtmosphereAudioOptions {
  /** Master ceiling — kept low; ambient, not foreground. Default 0.18. */
  maxGain?: number;
  /** Fade in/out seconds for enable/disable/switch. Default 0.8. */
  fadeSeconds?: number;
}

export class AtmosphereAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private current: Soundscape | null = null;
  /** Remembered even while disabled, so enable() starts the right bed. */
  private currentName = "none";
  private _enabled = false;
  private readonly maxGain: number;
  private readonly fadeSeconds: number;

  constructor(options: AtmosphereAudioOptions = {}) {
    this.maxGain = options.maxGain ?? 0.18;
    this.fadeSeconds = options.fadeSeconds ?? 0.8;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  /**
   * Turn audio on. MUST be called from a user gesture (autoplay policy).
   * Resumes the context and starts the current atmosphere's bed.
   */
  async enable(atmosphere: string): Promise<void> {
    if (this._enabled) return;
    this._enabled = true;
    this.currentName = atmosphere;
    this.ensureContext();
    if (this.ctx && this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch {
        /* resume can reject if not from a gesture — caller handles UI */
      }
    }
    void this.startSoundscape(atmosphere);
  }

  /** Turn audio off — fade out, then suspend the device. */
  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    this.fadeOutAndStop(this.current);
    this.current = null;
    const ctx = this.ctx;
    if (ctx) {
      setTimeout(() => {
        if (!this._enabled) ctx.suspend().catch(() => {});
      }, this.fadeSeconds * 1000 + 50);
    }
  }

  /** Crossfade the bed to a new atmosphere. No-op while disabled. */
  setAtmosphere(atmosphere: string): void {
    this.currentName = atmosphere;
    if (!this._enabled) return;
    this.fadeOutAndStop(this.current);
    this.current = null;
    void this.startSoundscape(atmosphere);
  }

  /** Full teardown — close the context. */
  dispose(): void {
    this.fadeOutAndStop(this.current);
    this.current = null;
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    if (ctx) ctx.close().catch(() => {});
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private ensureContext(): void {
    if (this.ctx) return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.maxGain;
    this.master.connect(this.ctx.destination);
  }

  /**
   * Resolve the atmosphere's soundscape via the registry, start it,
   * fade it in. Async because atmosphere modules are lazy-loaded;
   * the load is cached by the registry so the second call to the
   * same atmosphere is synchronous.
   *
   * Race-guard: between the `await loadAtmosphere` resolving and
   * `startSoundscape` proceeding, the user can have flipped to
   * another atmosphere (or disabled). We re-check `currentName` and
   * `_enabled` afterwards and drop the freshly-built bed if either
   * has moved on. Cheap — building a Web Audio graph then tearing
   * it down within ms costs nothing user-visible.
   */
  private async startSoundscape(name: string): Promise<void> {
    if (!this.ctx || !this.master) return;
    const mod = await loadAtmosphere(name);
    if (!mod || !mod.buildSoundscape) {
      // Atmosphere has no bed (or unknown name) — silence is fine.
      if (this.currentName === name) this.current = null;
      return;
    }
    // Re-check state — the user may have switched while we awaited.
    if (!this._enabled || this.currentName !== name) return;
    if (!this.ctx || !this.master) return;
    const sc = mod.buildSoundscape(this.ctx, this.master);
    const now = this.ctx.currentTime;
    sc.gain.gain.setValueAtTime(0, now);
    sc.gain.gain.linearRampToValueAtTime(1, now + this.fadeSeconds);
    this.current = sc;
  }

  private fadeOutAndStop(sc: Soundscape | null): void {
    if (!this.ctx || !sc) return;
    const now = this.ctx.currentTime;
    sc.gain.gain.cancelScheduledValues(now);
    sc.gain.gain.setValueAtTime(sc.gain.gain.value, now);
    sc.gain.gain.linearRampToValueAtTime(0, now + this.fadeSeconds);
    setTimeout(() => sc.stop(), this.fadeSeconds * 1000 + 80);
  }
}
