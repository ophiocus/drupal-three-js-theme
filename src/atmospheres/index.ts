// The theme's atmospheres — registered with the runtime's registry.
//
// The runtime ships the registry mechanism and the AtmosphereModule
// contract (world/runtime/atmospheres/); which atmospheres exist is
// the theme's content. main.ts imports this module before mount, so
// the switcher and the snapshot's `activeAtmosphere` see every key.
//
// Add a new atmosphere by adding one line. The dynamic import keeps
// inactive atmospheres lazily evaluated.

import { registerAtmosphereLoader } from "../world/runtime/atmospheres/registry.js";

registerAtmosphereLoader("forest", async () =>
  (await import("./forest/index.js")).default,
);

registerAtmosphereLoader("inner-mind", async () =>
  (await import("./inner-mind/index.js")).default,
);
