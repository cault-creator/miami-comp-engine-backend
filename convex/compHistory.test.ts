import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCompHistory } from "./compHistory.ts";

const run = (mostLikely?: number) => ({
  _id: "test-run",
  address: "Test property",
  createdAt: 1234,
  valuation: mostLikely === undefined ? null : { mostLikely },
});

test("first comp has empty history and no delta", () => {
  const result = buildCompHistory(run(2600000), []);
  assert.equal(result.current.mostLikely, 2600000);
  assert.deepEqual(result.previous, []);
  assert.equal(result.deltaFromPrevious, null);
});

test("previous runs without a valuation do not crash a first valid comp", () => {
  assert.equal(buildCompHistory(run(100), [run()]).deltaFromPrevious, null);
});

test("a current run without a valuation has no delta", () => {
  assert.equal(buildCompHistory(run(), [run(100)]).deltaFromPrevious, null);
});

test("prior value zero never produces an infinite percentage", () => {
  assert.equal(buildCompHistory(run(100), [run(0)]).deltaFromPrevious, null);
});

test("existing history retains increasing, decreasing and flat deltas", () => {
  for (const [value, amount, direction] of [
    [120, 20, "up"], [80, -20, "down"], [100, 0, "flat"],
  ] as const) {
    const delta = buildCompHistory(run(value), [run(100)]).deltaFromPrevious;
    assert.equal(delta?.amount, amount);
    assert.equal(delta?.percent, amount / 100);
    assert.equal(delta?.direction, direction);
    assert.equal(delta?.previousRunId, "test-run");
  }
});
