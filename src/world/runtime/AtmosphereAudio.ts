// AtmosphereAudio — procedural per-atmosphere ambient soundscapes.
//
// Zero asset files: every bed is synthesised live with the Web Audio
// API (same ethos as the renderer's primitive geometry — no .mp3 to
// ship or license). Two beds today:
//   - forest:     looping noise through a slow-swept lowpass — "wind".
//   - inner-mind: detuned saw drones + octave shimmer under a slow
//                 filter sweep — the "trip" pad.
//
// Autoplay etiquette: browsers block audio until a user gesture, and
// surprise ambient sound is rude. So this stays SILENT until enable()
// is called from a click (the HUD sound toggle). enable() resumes the
// AudioContext; setAtmosphere() crossfades beds on a switch; disable()
// fades out and suspends.

interface Soundscape {
  /** Per-bed gain (0..1), ramped for fades; feeds the master gain. */
  gain: GainNode;
  /** Stop + disconnect every node in this bed. */
  stop: () => void;
}

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
    this.startSoundscape(atmosphere);
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
    this.startSoundscape(atmosphere);
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

  private startSoundscape(name: string): void {
    if (!this.ctx || !this.master) return;
    const sc =
      name === "forest"
        ? this.buildForest(this.ctx, this.master)
        : name === "inner-mind"
          ? this.buildInnerMind(this.ctx, this.master)
          : null;
    if (!sc) {
      this.current = null;
      return;
    }
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

  /** Forest: looping noise → lowpass with a slow LFO sweep (wind). */
  private buildForest(ctx: AudioContext, master: GainNode): Soundscape {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(master);

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(ctx, 3);
    noise.loop = true;

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 500;
    lp.Q.value = 0.6;
    noise.connect(lp);
    lp.connect(gain);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 240;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);

    noise.start();
    lfo.start();
    return {
      gain,
      stop: () => {
        try { noise.stop(); } catch { /* already stopped */ }
        try { lfo.stop(); } catch { /* already stopped */ }
        for (const n of [noise, lp, lfo, lfoGain, gain]) n.disconnect();
      },
    };
  }

  /** Inner-mind: detuned saw drones + octave shimmer under a slow sweep. */
  private buildInnerMind(ctx: AudioContext, master: GainNode): Soundscape {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(master);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 600;
    lp.Q.value = 4;
    lp.connect(gain);

    const base = 82.4; // E2
    const o1 = ctx.createOscillator();
    o1.type = "sawtooth";
    o1.frequency.value = base;
    const o2 = ctx.createOscillator();
    o2.type = "sawtooth";
    o2.frequency.value = base * 1.005; // slight detune → beating
    const o3 = ctx.createOscillator();
    o3.type = "sine";
    o3.frequency.value = base * 2; // octave shimmer
    const o3g = ctx.createGain();
    o3g.gain.value = 0.3;
    o3.connect(o3g);
    o1.connect(lp);
    o2.connect(lp);
    o3g.connect(lp);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 450;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);

    o1.start();
    o2.start();
    o3.start();
    lfo.start();
    return {
      gain,
      stop: () => {
        for (const o of [o1, o2, o3, lfo]) {
          try { o.stop(); } catch { /* already stopped */ }
        }
        for (const n of [o1, o2, o3, o3g, lp, lfo, lfoGain, gain]) n.disconnect();
      },
    };
  }

  private noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }
}
