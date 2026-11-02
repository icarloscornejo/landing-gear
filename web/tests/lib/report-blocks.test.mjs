// The detail page's compact CV match, comp and legitimacy views.

import test from "node:test";
import assert from "node:assert/strict";
import { cvMatchRows, keyFacts, legitimacySignals, parseTable, plainText, weightTone } from "../../src/lib/report-blocks.mjs";

const cvMatch = `Pass order: read first.

| Requirement | Importance | Match | JD signal | Evidence / gap |
|---|---|---|---|---|
| Android app development | critical (stated) | ✅ Strong | "title" | cv.md: **Ticketmaster** |
| Advanced English level | critical (stated) | ⚠️ Partial | "Advanced" | Not stated |
| Python | high (stated) | ❌ Missing | "Python" | none |

### Gaps

**1. English**`;

test("the CV match table becomes rows with a match level", () => {
  const { rows, notes } = cvMatchRows(cvMatch);
  assert.deepEqual(rows.map((r) => [r.requirement, r.importance, r.match]), [
    ["Android app development", "critical", "strong"],
    ["Advanced English level", "critical", "partial"],
    ["Python", "high", "missing"],
  ]);
  assert.equal(rows[0].evidence, "cv.md: Ticketmaster");
  assert.match(notes, /^### Gaps/);
});

test("an unknown shape gives no rows, so the page falls back to markdown", () => {
  assert.deepEqual(cvMatchRows("just prose").rows, []);
  assert.deepEqual(parseTable("no table"), { headers: [], rows: [] });
});

test("legitimacy signals carry a tone from their weight, and the assessment line", () => {
  const md = `**Assessment:** Proceed with Caution. Old posting.

| # | Signal | Finding | Weight |
|---|---|---|---|
| 1 | Posting freshness | 96 days old | Concerning on age |
| 2 | Description quality | Named tools | Positive to mixed |
| 6 | Employment classification | No contractor wording | Clear |

**Conditional signals 8 to 17:**
- 8: not triggered.`;
  const { assessment, signals, notes } = legitimacySignals(md);
  assert.equal(assessment, "Proceed with Caution. Old posting.");
  assert.deepEqual(signals.map((s) => [s.signal, s.tone]), [["Posting freshness", "bad"], ["Description quality", "warn"], ["Employment classification", "good"]]);
  assert.match(notes, /Conditional signals/);
  assert.equal(weightTone("Neutral"), "muted");
});

test("comp facts split into the answer and its detail", () => {
  const md = `Demand trend: no reliable trend found. Sources disagree.

- **Company type:** Agency vendor (medium confidence).
- **Compensation reliability:** Unknown. No advertised figure.`;
  assert.deepEqual(keyFacts(md), [
    { key: "Demand trend", lead: "no reliable trend found.", rest: "Sources disagree." },
    { key: "Company type", lead: "Agency vendor (medium confidence).", rest: "" },
    { key: "Compensation reliability", lead: "Unknown.", rest: "No advertised figure." },
  ]);
  assert.equal(plainText("[Glassdoor](https://x) **bold** `code`"), "Glassdoor bold code");
});
