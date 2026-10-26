import test from "node:test";
import assert from "node:assert/strict";
import { todayOverview } from "../../src/lib/home/today-overview.mjs";

test("the lifecycle strip counts each stage and flags the ones waiting on Carlos", () => {
  const apps = [
    { n: "1", status: "Evaluated", notes: "" },
    { n: "2", status: "Evaluated", notes: "APPROVED by Carlos: will apply (not applied yet)" },
    { n: "3", status: "Applied", date: "2026-10-20" },
    { n: "4", status: "Responded", company: "Acme", role: "Dev", date: "2026-10-24" },
    { n: "5", status: "Discarded" },
  ];
  const { stages, replies } = todayOverview(apps, [{}, {}, { triage: "PASS 3.6/5" }]);
  assert.deepEqual(stages.map((s) => [s.label, s.count, s.needsAction]), [
    ["Discovered", 2, true],
    ["Triaged", 1, true],
    ["Evaluated", 1, true],
    ["Approved", 1, true],
    ["Applied", 1, false],
    ["In talks", 1, true],
  ]);
  assert.deepEqual(replies.map((r) => [r.n, r.status]), [["4", "RESPONDED"]]);
});
