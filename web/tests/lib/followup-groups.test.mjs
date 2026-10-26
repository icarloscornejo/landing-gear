import test from "node:test";
import assert from "node:assert/strict";
import { cvSent, groupFollowups } from "../../src/lib/followup-groups.mjs";

const row = (num, urgency, date, until, age) => ({ num, urgency, nextFollowupDate: date, daysUntilNext: until, daysSinceApplication: age });

test("due rows lead, then one group per date in order, then undated", () => {
  const groups = groupFollowups([
    row(1, "waiting", "2026-11-03", 9, 2),
    row(2, "waiting", "2026-10-30", 5, 7),
    row(3, "overdue", "2026-10-20", -5, 12),
    row(4, "waiting", "2026-10-30", 5, 3),
    row(5, "waiting", null, null, 1),
    row(6, "waiting", "2026-10-25", 0, 6),
  ]);
  assert.deepEqual(groups.map((g) => [g.key, g.entries.map((e) => e.num)]), [
    ["due", [3, 6]],
    ["2026-10-30", [2, 4]],
    ["2026-11-03", [1]],
    ["undated", [5]],
  ]);
});

test("the due group is always there, even empty", () => {
  assert.deepEqual(groupFollowups([]).map((g) => g.key), ["due"]);
});

test("the CV comes from the notes", () => {
  assert.equal(cvSent("Applied 2026-10-24 via Recruitee with CV A and a cover"), "A");
  assert.equal(cvSent("applied with CV B"), "B");
  assert.equal(cvSent("no cv mentioned; CVS store"), null);
});
