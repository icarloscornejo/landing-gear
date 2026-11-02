import assert from "node:assert/strict";
import { test } from "node:test";
import { formatInterviewDate, isoToWall, wallToIso } from "../../src/lib/interview-date.mjs";

test("wallToIso: a datetime-local wall time becomes ISO with the zone's offset", () => {
  assert.equal(wallToIso("2026-10-29T10:00", "America/El_Salvador"), "2026-10-29T10:00-06:00");
  assert.equal(wallToIso("2026-07-01T09:30", "Europe/Madrid"), "2026-07-01T09:30+02:00");
  assert.equal(wallToIso("2026-07-01T09:30", "UTC"), "2026-07-01T09:30+00:00");
});

test("wallToIso: anything but an exact real wall time is refused, so no client text reaches the tracker", () => {
  for (const bad of ["", "2026-10-29", "2026-10-29T10:00-06:00", "2026-10-29T10:00; OUTCOME: Rejected at Applied", "2026-10-29T10:00 | x", "2026-02-30T10:00", "2026-10-29T24:00", null, 42]) {
    assert.equal(wallToIso(bad, "America/El_Salvador"), null, String(bad));
  }
  // A wall time skipped by a DST jump has no instant.
  assert.equal(wallToIso("2026-03-08T02:30", "America/New_York"), null);
});

test("display reads the ISO's own wall time", () => {
  assert.equal(formatInterviewDate("2026-10-29T10:00-06:00"), "Thu Oct 29, 10:00");
  assert.equal(isoToWall("2026-10-29T10:00-06:00"), "2026-10-29T10:00");
  assert.equal(formatInterviewDate("garbage"), "");
});
