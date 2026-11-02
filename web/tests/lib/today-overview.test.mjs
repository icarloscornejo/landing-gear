import test from "node:test";
import assert from "node:assert/strict";
import { todayOverview } from "../../src/lib/home/today-overview.mjs";

test("the lifecycle strip counts each stage and flags the ones waiting on the engineer", () => {
  const apps = [
    { n: "1", status: "Evaluated", notes: "" },
    { n: "2", status: "Evaluated", notes: "APPROVED: will apply (not applied yet)" },
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

test("upcoming lists dated current rounds from two hours ago on, soonest first, soon within a day", () => {
  const now = Date.parse("2026-10-28T12:00-06:00");
  const apps = [
    { n: "1", status: "Interview", company: "Later", notes: "STAGE: Tech interview 1 @ 2026-11-03T10:00-06:00" },
    { n: "2", status: "Responded", company: "Tomorrow", notes: "STAGE: Screening 2 @ 2026-10-29T09:00-06:00" },
    { n: "3", status: "Responded", company: "Past", notes: "STAGE: Screening 1 @ 2026-10-27T10:00-06:00" },
    // A dated note from an earlier phase is not the current round.
    { n: "4", status: "Interview", company: "Moved on", notes: "STAGE: Screening 1 @ 2026-10-30T10:00-06:00; STAGE: Final interview 1" },
    { n: "5", status: "Responded", company: "Undated", notes: "STAGE: Screening 1" },
  ];
  const { upcoming } = todayOverview(apps, [], now);
  assert.deepEqual(upcoming.map((u) => [u.n, u.phase, u.soon]), [["2", "Screening 2", true], ["1", "Tech interview 1", false]]);
});
