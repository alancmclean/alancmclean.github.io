import test from "node:test";
import assert from "node:assert/strict";
import {
  resizedFrame,
  framePixels,
  normalizedFrame,
} from "../runtime/canvas-layout.mjs";
test("normalized canvas frames round trip with scrolling and viewport changes", () => {
  const root = {
    clientWidth: 800,
    clientHeight: 600,
    scrollLeft: 0,
    scrollTop: 70,
    getBoundingClientRect: () => ({ left: 100, top: 80 }),
  };
  const f = {
    x: 40,
    y: 35,
    width: 30,
    height: 20,
    angle: 37,
    naturalWidth: 200,
    naturalHeight: 100,
  };
  assert.deepEqual(normalizedFrame(framePixels(f, root), root, f), f);
  root.clientWidth = 400;
  root.clientHeight = 800;
  assert.deepEqual(normalizedFrame(framePixels(f, root), root, f), f);
});
test("locked corner resize preserves ratio; unlocked resize does not; opposite anchor fixed", () => {
  const s = { x: 200, y: 100, w: 100, h: 50, angle: 0 };
  const locked = resizedFrame(s, { x: 300, y: 130 }, "se", true);
  assert.equal(locked.w / locked.h, 2);
  assert.equal(locked.x - locked.w / 2, 150);
  assert.equal(locked.y - locked.h / 2, 75);
  const free = resizedFrame(s, { x: 300, y: 130 }, "se", false);
  assert.notEqual(free.w / free.h, 2);
  assert.equal(free.x - free.w / 2, 150);
  assert.equal(free.y - free.h / 2, 75);
});
test("rotated corner resize keeps its opposite corner anchored", () => {
  const s = { x: 200, y: 100, w: 100, h: 50, angle: 90 };
  const r = resizedFrame(s, { x: 140, y: 210 }, "se", false);
  assert.ok(Math.abs(r.x + r.h / 2 - (s.x + s.h / 2)) < 1e-9);
  assert.ok(Math.abs(r.y - r.w / 2 - (s.y - s.w / 2)) < 1e-9);
});
