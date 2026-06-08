// Inner-mind soundscape — detuned saw drones + octave shimmer under
// a slow filter sweep. The "trip pad."
//
// Moved out of AtmosphereAudio.ts into the inner-mind atmosphere's
// own directory. See ../forest/audio.ts for the same rationale.

import type { Soundscape } from "../types.js";

export function buildInnerMindSoundscape(
  ctx: AudioContext,
  master: GainNode,
): Soundscape {
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
