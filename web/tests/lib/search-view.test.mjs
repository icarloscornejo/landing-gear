// The single Analytics page: one number per question, from tracker + log.

import test from "node:test";
import assert from "node:assert/strict";
import { appFacts, archetypeOf, breakdown, cvSplit, fitBands, headline, isoWeek, sourceOf, weeklyActivity } from "../../src/lib/analytics/search-view.mjs";

const apps = [
  { n: "1", date: "2026-10-18", status: "APPLIED", score: "4.2/5", url: "https://www.getonbrd.com/jobs/a", archetype: "Senior / Lead Android Engineer" },
  { n: "2", date: "2026-10-18", status: "REJECTED", score: "3.6/5", url: "https://www.linkedin.com/jobs/view/1/", archetype: "AI Engineer / Agentic Dev" },
  { n: "3", date: "2026-10-22", status: "DISCARDED", score: "2.0/5", url: "https://jobs.lever.co/x/y", archetype: "Not a target" },
  { n: "4", date: "2026-10-22", status: "DISCARDED", score: "3.1/5", url: "", archetype: "AI Engineer / Agentic Dev (stretch)" },
  { n: "5", date: "2026-10-23", status: "RESPONDED", score: "N/A", url: "mailto:x@y.com" },
];
const log = [
  { num: 1, date: "2026-10-23", to: "Applied" },
  { num: 3, date: "2026-10-24", to: "Applied" },
];

test("the log recovers an application a later Discard hides, and a rejection is a reply", () => {
  const facts = appFacts(apps, log);
  assert.deepEqual(facts.map((f) => [f.applied, f.replied]), [[true, false], [true, true], [true, false], [false, false], [true, true]]);
  assert.equal(facts[0].appliedDate, "2026-10-23");
  assert.deepEqual(headline(facts), { applied: 4, replied: 2, replyRate: 50, avgAppliedScore: 3.3 });
});

test("weeks count evaluations by row date and applications by applied date", () => {
  assert.equal(isoWeek("2026-10-25"), "2026-W43");
  assert.deepEqual(weeklyActivity(appFacts(apps, log)), [
    { week: "2026-W42", evaluated: 2, applied: 1 },
    { week: "2026-W43", evaluated: 3, applied: 3 },
  ]);
});

test("fit bands split evaluated and applied", () => {
  assert.deepEqual(fitBands(appFacts(apps, log)), [
    { label: "4.0+", evaluated: 1, applied: 1 },
    { label: "3.5 to 3.9", evaluated: 1, applied: 1 },
    { label: "3.0 to 3.4", evaluated: 1, applied: 0 },
    { label: "Below 3.0", evaluated: 1, applied: 1 },
  ]);
});

test("archetypes count only canonical names; the rest is missing", () => {
  const { rows, missing } = breakdown(appFacts(apps, log), archetypeOf);
  assert.deepEqual(rows.map((r) => [r.label, r.evaluated, r.applied, r.replied]), [
    ["AI Engineer / Agentic Dev", 1, 1, 1],
    ["Not a target", 1, 1, 0],
    ["Senior / Lead Android Engineer", 1, 1, 0],
  ]);
  assert.equal(missing, 2);
});

test("sources come from the posting URL", () => {
  assert.deepEqual(appFacts(apps, log).map(sourceOf), ["Get on Board", "LinkedIn", "Company ATS", null, "Email to recruiter"]);
});

test("CV split counts replies per CV", () => {
  assert.deepEqual(cvSplit([{ cv: "a", outcome: "Applied" }, { cv: "a", outcome: "Responded" }, { cv: "b", outcome: "Rejected" }]), [
    { cv: "A", applied: 2, replied: 1 },
    { cv: "B", applied: 1, replied: 1 },
  ]);
});
