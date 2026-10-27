// Server-owned runs: the snapshot the web and the chat both read.

import test from "node:test";
import assert from "node:assert/strict";
import { MAX_TEXT, applyRunEvent, newRunSnapshot, runSummary, settleOrphan } from "../../src/lib/live-run-state.mjs";

const meta = { id: "run-1", kind: "evaluate", input: "https://example.com/job/1", title: "Evaluate · Acme", source: "chat" };

test("events build the run: tools and statuses as steps, text as a tail, done as the end", () => {
  let run = newRunSnapshot(meta, 1);
  assert.equal(run.status, "queued");
  run = applyRunEvent(run, { type: "status", label: "Starting" }, 2);
  run = applyRunEvent(run, { type: "tool", name: "Read" }, 3);
  assert.equal(run.status, "running");
  run = applyRunEvent(run, { type: "text", text: "thinking\nVERDICT: 4.1/5: good fit\n" }, 4);
  run = applyRunEvent(run, { type: "keepalive" }, 5);
  run = applyRunEvent(run, { type: "done", tokens: 900, costUsd: 0.6, reportN: 68 }, 6);
  assert.equal(run.status, "done");
  assert.equal(run.reportN, 68);
  assert.equal(run.endedAt, 6);
  assert.equal(run.verdictLine, "VERDICT: 4.1/5: good fit");
  assert.deepEqual(run.steps.map((step) => step.label), ["Queued", "Starting", "Read", "Done"]);
});

test("narration becomes one note per stretch between steps, stamped when it started", () => {
  let run = newRunSnapshot(meta, 1);
  run = applyRunEvent(run, { type: "text", text: "Reading the " }, 2);
  run = applyRunEvent(run, { type: "text", text: "brief.\n" }, 3);
  run = applyRunEvent(run, { type: "tool", name: "Read" }, 4);
  run = applyRunEvent(run, { type: "tool", name: "WebFetch" }, 5);
  run = applyRunEvent(run, { type: "text", text: "TRIAGE: PASS" }, 6);
  assert.deepEqual(run.notes, [
    { text: "Reading the brief.\n", ts: 2 },
    { text: "TRIAGE: PASS", ts: 6 },
  ]);
  assert.deepEqual(run.steps.map((step) => step.label), ["Queued", "Read", "WebFetch"]);
  assert.equal("notes" in runSummary(run), false);
});

test("the verdict survives the text tail being trimmed", () => {
  let run = applyRunEvent(newRunSnapshot(meta, 1), { type: "text", text: "TRIAGE: PASS | Acme | Dev | 3.6/5 | ok\n" }, 2);
  run = applyRunEvent(run, { type: "text", text: "x".repeat(MAX_TEXT + 50) }, 3);
  assert.equal(run.text.length, MAX_TEXT);
  assert.match(run.verdictLine, /^TRIAGE: PASS/);
});

test("an error ends the run with its message", () => {
  const run = applyRunEvent(newRunSnapshot(meta, 1), { type: "error", msg: "no report to save" }, 2);
  assert.equal(run.status, "error");
  assert.equal(run.error, "no report to save");
});

test("the summary drops the heavy fields and keeps the last step", () => {
  const run = applyRunEvent(newRunSnapshot(meta, 1), { type: "tool", name: "WebFetch" }, 2);
  const summary = runSummary(run);
  assert.equal("text" in summary, false);
  assert.equal("steps" in summary, false);
  assert.equal(summary.lastStep, "WebFetch");
  assert.equal(summary.source, "chat");
});

test("a run left running by a restarted server reads as interrupted", () => {
  const running = applyRunEvent(newRunSnapshot(meta, 1), { type: "tool", name: "Read" }, 2);
  assert.equal(settleOrphan(running, true, 3).status, "running");
  const orphan = settleOrphan(running, false, 3);
  assert.equal(orphan.status, "error");
  assert.match(orphan.error, /restarted/);
  const done = applyRunEvent(running, { type: "done" }, 3);
  assert.equal(settleOrphan(done, false, 4), done);
});
