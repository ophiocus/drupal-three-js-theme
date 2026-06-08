// Forest soundscape — looping noise → lowpass with a slow LFO sweep ("wind").
//
// Moved out of AtmosphereAudio.ts (where it lived alongside an
// inner-mind branch in a hardcoded if/else) into the forest
// atmosphere's own directory. Each atmosphere now owns its own
// soundscape; AtmosphereAudio is a generic lifecycle wrapper that
// asks the registry for whichever atmosphere is active.

import type { Soundscape } from "../types.js";

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export function buildForestSoundscape(
  ctx: AudioContext,
  master: GainNode,
): Soundscape {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(master);

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, 3);
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
