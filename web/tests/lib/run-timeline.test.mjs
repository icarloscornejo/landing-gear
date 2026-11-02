// The run detail page's timeline: narration and tool calls in order.

import test from "node:test";
import assert from "node:assert/strict";
import { buildTimeline, elapsedLabel } from "../../src/lib/run-timeline.mjs";

const steps = [
  { kind: "status", label: "Queued", ts: 1 },
  { kind: "tool", label: "Read", ts: 3 },
  { kind: "tool", label: "Read", ts: 4 },
  { kind: "tool", label: "WebFetch", ts: 5 },
  { kind: "status", label: "Done", ts: 9 },
];
const notes = [
  { text: "Reading the brief.\n", ts: 2 },
  { text: "  ", ts: 6 },
  { text: "TRIAGE: PASS\n", ts: 7 },
];

test("notes and steps interleave by time, consecutive tools collapse with counts", () => {
  const { items } = buildTimeline(steps, notes, false);
  assert.deepEqual(items, [
    { type: "status", label: "Queued", ts: 1 },
    { type: "note", text: "Reading the brief.", ts: 2 },
    { type: "tools", tools: [{ label: "Read", count: 2 }, { label: "WebFetch", count: 1 }], ts: 3 },
    { type: "note", text: "TRIAGE: PASS", ts: 7 },
    { type: "status", label: "Done", ts: 9 },
  ]);
});

test("a finished run's last note is the result, not a timeline row", () => {
  const { items, result } = buildTimeline(steps, notes, true);
  assert.equal(result, "TRIAGE: PASS");
  assert.equal(items.some((item) => item.type === "note" && item.text === "TRIAGE: PASS"), false);
});

test("elapsed labels read in seconds, then minutes", () => {
  assert.equal(elapsedLabel(8_400, 0), "+8s");
  assert.equal(elapsedLabel(125_000, 0), "+2m 05s");
});
