import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeQuantizedMesh, encodeQuantizedMesh } from "../src/world/terrain/QuantizedMesh.ts";
import { coverageFraction } from "../src/systems/DoomSchedule.ts";

test("quantized-mesh decoder round-trips vertices, heights and indices", () => {
  const tile = {
    minHeight: 840,
    maxHeight: 2942,
    u: [0, 32767, 0, 32767, 16000],
    v: [0, 0, 32767, 32767, 16000],
    h: [0, 1000, 20000, 32767, 12345],
    indices: [0, 1, 2, 1, 3, 2, 2, 3, 4],
  };
  const out = decodeQuantizedMesh(encodeQuantizedMesh(tile));
  assert.equal(out.vertexCount, 5);
  assert.equal(out.minHeight, 840);
  assert.equal(out.maxHeight, 2942);
  assert.deepEqual([...out.u], tile.u);
  assert.deepEqual([...out.v], tile.v);
  assert.deepEqual([...out.h], tile.h);
  assert.deepEqual([...out.indices], tile.indices);
});

test("quantized-mesh decoder handles zig-zag deltas that decrease", () => {
  const tile = { minHeight: 0, maxHeight: 100, u: [32767, 10, 5000], v: [100, 32000, 0], h: [500, 0, 32767], indices: [0, 1, 2] };
  const out = decodeQuantizedMesh(encodeQuantizedMesh(tile));
  assert.deepEqual([...out.u], tile.u);
  assert.deepEqual([...out.v], tile.v);
  assert.deepEqual([...out.h], tile.h);
});

test("the poison cloud follows the 14-day timetable", () => {
  assert.equal(coverageFraction(0), 0);
  assert.ok(coverageFraction(1) > 0 && coverageFraction(1) <= 0.05, "day 1: only the outer edges");
  assert.ok(coverageFraction(4) >= 0.15 && coverageFraction(4) <= 0.25, "days 2-4: outer valleys");
  assert.ok(coverageFraction(7) >= 0.4 && coverageFraction(7) <= 0.5, "days 5-7: large parts");
  assert.ok(coverageFraction(13) > 0.9, "days 11-13: almost all");
  assert.equal(coverageFraction(14), 1, "day 14: entire country consumed");
  let prev = -1;
  for (let d = 0; d <= 14; d += 0.25) {
    const f = coverageFraction(d);
    assert.ok(f >= prev, "monotonic");
    prev = f;
  }
});
