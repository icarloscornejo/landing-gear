import test from "node:test";
import assert from "node:assert/strict";
import { staleSweep } from "../../src/lib/stale-sweep.mjs";

const entry = (num, extra = {}) => ({ num, status: "applied", daysSinceApplication: 90, daysSinceLastFollowup: null, nextOverride: null, appDateSource: "notes", ...extra });

test("Applied rows quiet 60+ days go to bulk; pinned and estimated rows are listed apart", () => {
  const { bulk, pinned, estimated } = staleSweep(
    [
      entry(1),
      entry(2, { daysSinceApplication: 59 }),
      entry(3, { daysSinceLastFollowup: 20 }),
      entry(4, { nextOverride: "2026-01-01" }),
      entry(5, { appDateSource: "evaluation-date-fallback" }),
      entry(6, { status: "responded" }),
      entry(7, { daysSinceLastFollowup: 70 }),
    ],
    [entry(8, { urgency: "retired" })],
  );
  assert.deepEqual(bulk.map((e) => e.num), [1, 7, 8]);
  assert.deepEqual(pinned.map((e) => e.num), [4]);
  assert.deepEqual(estimated.map((e) => e.num), [5]);
});

test("a retired Applied row from 90 days ago enters the sweep", () => {
  assert.deepEqual(staleSweep([], [entry(31, { urgency: "retired", daysSinceApplication: 90 })]).bulk.map((e) => e.num), [31]);
});
