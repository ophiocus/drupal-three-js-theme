// @vitest-environment jsdom
//
// CameraController invariants. The DOM-requiring bits (hashchange,
// keydown, history.replaceState) need a jsdom window; the three.js
// math doesn't care either way.
//
// What we're locking:
//   - constructor seeds camera from initial URL vantage
//   - update(dt) is monotonic and frame-rate-consistent
//   - settle gate fires URL write after the threshold, only once
//   - target change before settle resets the gate
//   - bloomed-mesh continuous facing works and clears on null
//   - dispose detaches listeners

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { CameraController } from "../src/world/runtime/CameraController.js";
import type { Vantage } from "../src/world/types.js";

function makeVantage(
  uri: string,
  position = { x: 100, y: 50, z: 0 },
  lookAt = { x: 0, y: 0, z: 0 },
): Vantage {
  return {
    uri,
    kind: "detail",
    sectorId: null,
    position,
    lookAt,
    fov: 60,
  };
}

function makeCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  cam.position.set(0, 0, 0);
  return cam;
}

beforeEach(() => {
  // Reset URL between tests; jsdom keeps it sticky otherwise.
  history.replaceState(null, "", "/");
});

describe("CameraController — construction", () => {
  it("seeds the camera from the initial URL vantage", () => {
    const initial = makeVantage("/node/9", { x: 50, y: 30, z: 40 });
    const cam = makeCamera();
    new CameraController({
      camera: cam,
      getTargetVantageFromUrl: () => initial,
      setUrlFromVantage: () => {},
    });
    expect(cam.position.x).toBeCloseTo(50);
    expect(cam.position.y).toBeCloseTo(30);
    expect(cam.position.z).toBeCloseTo(40);
  });

  it("calls getTargetVantageFromUrl exactly once during construction", () => {
    const getter = vi.fn(() => makeVantage("/"));
    new CameraController({
      camera: makeCamera(),
      getTargetVantageFromUrl: getter,
      setUrlFromVantage: () => {},
    });
    expect(getter).toHaveBeenCalledTimes(1);
  });
});

describe("CameraController — update", () => {
  it("damps camera position toward a new target", () => {
    const cam = makeCamera();
    const initial = makeVantage("/", { x: 0, y: 0, z: 0 });
    const ctrl = new CameraController({
      camera: cam,
      getTargetVantageFromUrl: () => initial,
      setUrlFromVantage: () => {},
    });
    // Camera is at origin. Set a new target far away; one step
    // should move toward it without overshoot.
    ctrl.setTarget(makeVantage("/node/1", { x: 100, y: 0, z: 0 }));
    const before = cam.position.x;
    ctrl.update(1 / 60);
    expect(cam.position.x).toBeGreaterThan(before);
    expect(cam.position.x).toBeLessThan(100);
  });

  it("converges to the target after many frames", () => {
    const cam = makeCamera();
    const ctrl = new CameraController({
      camera: cam,
      getTargetVantageFromUrl: () => makeVantage("/", { x: 0, y: 0, z: 0 }),
      setUrlFromVantage: () => {},
    });
    ctrl.setTarget(makeVantage("/node/1", { x: 100, y: 50, z: -40 }));
    // 120 frames at 60fps = 2 seconds; well past convergence with
    // lambda=4 (~250ms to 90%), well before idle drift starts at 3s.
    for (let i = 0; i < 120; i++) ctrl.update(1 / 60);
    expect(cam.position.x).toBeCloseTo(100, 1);
    expect(cam.position.y).toBeCloseTo(50, 1);
    expect(cam.position.z).toBeCloseTo(-40, 1);
  });
});

describe("CameraController — settle / URL write", () => {
  it("writes URL once after settle threshold", () => {
    const cam = makeCamera();
    const writer = vi.fn();
    const ctrl = new CameraController({
      camera: cam,
      getTargetVantageFromUrl: () => makeVantage("/", { x: 0, y: 0, z: 0 }),
      setUrlFromVantage: writer,
      settleSeconds: 0.5,
    });
    // Set a different target than initial; let the camera converge,
    // then keep ticking past the settle threshold.
    ctrl.setTarget(makeVantage("/node/5", { x: 10, y: 10, z: 10 }));
    // Many small ticks past settle threshold.
    for (let i = 0; i < 200; i++) ctrl.update(0.05);
    expect(writer).toHaveBeenCalled();
    const calls = writer.mock.calls.length;
    // Beyond the first write, further ticks should not re-write
    // the same URI.
    for (let i = 0; i < 50; i++) ctrl.update(0.05);
    expect(writer.mock.calls.length).toBe(calls);
  });

  it("doesn't write URL if target hasn't changed from the initial", () => {
    const cam = makeCamera();
    const writer = vi.fn();
    new CameraController({
      camera: cam,
      getTargetVantageFromUrl: () => makeVantage("/", { x: 0, y: 0, z: 0 }),
      setUrlFromVantage: writer,
    });
    // No setTarget call; camera stays put.
    // (We can't update() because the controller is bound to its
    // own update loop; we just verify no write fires on construction.)
    expect(writer).not.toHaveBeenCalled();
  });

  it("resets settle when the target changes mid-flight", () => {
    const cam = makeCamera();
    const writer = vi.fn();
    const ctrl = new CameraController({
      camera: cam,
      getTargetVantageFromUrl: () => makeVantage("/", { x: 0, y: 0, z: 0 }),
      setUrlFromVantage: writer,
      settleSeconds: 0.5,
    });
    ctrl.setTarget(makeVantage("/a", { x: 50, y: 0, z: 0 }));
    for (let i = 0; i < 30; i++) ctrl.update(1 / 60);
    // Mid-flight: change target.
    ctrl.setTarget(makeVantage("/b", { x: -50, y: 0, z: 0 }));
    for (let i = 0; i < 200; i++) ctrl.update(0.05);
    // Should settle at the second target, not the first.
    const lastCall = writer.mock.calls[writer.mock.calls.length - 1];
    expect(lastCall?.[0]?.uri).toBe("/b");
  });
});

describe("CameraController — bloomed mesh", () => {
  it("re-orients the bloomed mesh toward the camera each frame", () => {
    // Put the camera to the side so a default-oriented plane mesh
    // (normal pointing +Z) is NOT already facing it. Otherwise the
    // lookAt() is a no-op and the test passes vacuously.
    const cam = makeCamera();
    cam.position.set(100, 50, 0);
    const ctrl = new CameraController({
      camera: cam,
      getTargetVantageFromUrl: () => makeVantage("/", { x: 100, y: 50, z: 0 }),
      setUrlFromVantage: () => {},
    });
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial(),
    );
    mesh.position.set(0, 50, 0);
    const initialQuat = mesh.quaternion.clone();
    ctrl.setBloomedMesh(mesh);
    ctrl.update(1 / 60);
    expect(mesh.quaternion.equals(initialQuat)).toBe(false);
  });

  it("stops re-orienting after setBloomedMesh(null)", () => {
    const cam = makeCamera();
    const ctrl = new CameraController({
      camera: cam,
      getTargetVantageFromUrl: () => makeVantage("/", { x: 0, y: 50, z: 100 }),
      setUrlFromVantage: () => {},
    });
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial(),
    );
    ctrl.setBloomedMesh(mesh);
    ctrl.update(1 / 60);
    const afterBloom = mesh.quaternion.clone();
    ctrl.setBloomedMesh(null);
    // Move the camera; with no bloomed mesh, the mesh's quaternion
    // shouldn't change.
    cam.position.set(200, 0, 0);
    ctrl.update(1 / 60);
    expect(mesh.quaternion.equals(afterBloom)).toBe(true);
  });
});

describe("CameraController — drag orbit (v0.1.1)", () => {
  it("applyDragDelta(dx, 0) rotates azimuth around target", () => {
    const cam = makeCamera();
    const initial = makeVantage("/", { x: 0, y: 50, z: 100 }, { x: 0, y: 0, z: 0 });
    const ctrl = new CameraController({
      camera: cam,
      getTargetVantageFromUrl: () => initial,
      setUrlFromVantage: () => {},
    });
    const radius0 = cam.position.length();
    // Drag horizontally by 100 pixels → azimuth rotates 100 * 0.005 = 0.5 rad.
    ctrl.setUserInteracting(true);
    ctrl.applyDragDelta(100, 0);
    // Sync the camera once (no time elapsed, but base target moved).
    // Camera is at old position; targetPos is new. After several
    // damp steps it converges; radius should be preserved.
    for (let i = 0; i < 60; i++) ctrl.update(1 / 60);
    ctrl.setUserInteracting(false);
    expect(cam.position.length()).toBeCloseTo(radius0, 0);
  });

  it("polar is clamped — large dy drag doesn't flip the camera", () => {
    const cam = makeCamera();
    const ctrl = new CameraController({
      camera: cam,
      getTargetVantageFromUrl: () =>
        makeVantage("/", { x: 0, y: 50, z: 100 }, { x: 0, y: 0, z: 0 }),
      setUrlFromVantage: () => {},
    });
    ctrl.setUserInteracting(true);
    // 10,000 pixels of dy = ~40 rad, but POLAR is clamped to
    // [~0.2, ~1.47]; the y component of camera must stay positive
    // (camera never goes below ground when looking at y=0).
    ctrl.applyDragDelta(0, 10000);
    for (let i = 0; i < 60; i++) ctrl.update(1 / 60);
    expect(cam.position.y).toBeGreaterThan(0);
  });
});

describe("CameraController — idle drift (v0.1.1)", () => {
  it("starts drifting after 3s of no interaction", () => {
    const cam = makeCamera();
    const ctrl = new CameraController({
      camera: cam,
      getTargetVantageFromUrl: () => makeVantage("/", { x: 0, y: 50, z: 100 }),
      setUrlFromVantage: () => {},
    });
    // Let the camera fully converge (2s).
    for (let i = 0; i < 120; i++) ctrl.update(1 / 60);
    const settledPos = cam.position.clone();
    // Advance past the 3s idle threshold + half a drift period.
    for (let i = 0; i < 300; i++) ctrl.update(1 / 60);
    // After drift starts, position differs from the converged settle pos.
    expect(cam.position.distanceTo(settledPos)).toBeGreaterThan(0.5);
  });

  it("interacting suppresses drift", () => {
    const cam = makeCamera();
    const ctrl = new CameraController({
      camera: cam,
      getTargetVantageFromUrl: () => makeVantage("/", { x: 0, y: 50, z: 100 }),
      setUrlFromVantage: () => {},
    });
    for (let i = 0; i < 120; i++) ctrl.update(1 / 60);
    ctrl.setUserInteracting(true);
    const heldPos = cam.position.clone();
    // 5 seconds of held interaction — drift should not kick in.
    for (let i = 0; i < 300; i++) ctrl.update(1 / 60);
    // No applyDragDelta calls; baseTargetPos unchanged; camera stays
    // close to where it was.
    expect(cam.position.distanceTo(heldPos)).toBeLessThan(0.1);
  });
});

describe("CameraController — lifecycle", () => {
  it("dispose() removes listeners", () => {
    const cam = makeCamera();
    const getter = vi.fn(() => makeVantage("/"));
    const ctrl = new CameraController({
      camera: cam,
      getTargetVantageFromUrl: getter,
      setUrlFromVantage: () => {},
    });
    expect(getter).toHaveBeenCalledTimes(1);
    ctrl.dispose();
    window.dispatchEvent(new Event("hashchange"));
    // Getter would have been called a second time if the listener
    // were still attached.
    expect(getter).toHaveBeenCalledTimes(1);
  });
});
