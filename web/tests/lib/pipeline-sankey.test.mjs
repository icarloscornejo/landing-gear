// Graph + layout tests for the analytics Pipeline Sankey.
// Run:  node --test tests/lib/pipeline-sankey.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import "../helpers/web-ts-alias-loader.mjs";
import { SANKEY_COLUMN_WIDTH, buildPipelineSankey, layoutSankey, parseStatusLog, sankeyWidth, statusToken } from "../../src/lib/pipeline-sankey.mjs";

// The tracker's "no status" dash, built from its code point: house rules keep
// the character itself out of source files.
const DASH = String.fromCharCode(0x2014);

const values = (g) => Object.fromEntries(g.nodes.map((n) => [n.id, n.value]));
const flow = (g, source, target) => g.links.find((l) => l.source === source && l.target === target)?.value ?? 0;
const inflow = (g, id) => g.links.filter((l) => l.target === id).reduce((s, l) => s + l.value, 0);
const outflow = (g, id) => g.links.filter((l) => l.source === id).reduce((s, l) => s + l.value, 0);

/** How many open rows stop at a phase node, read from its tooltip. */
const still = (g, id) => Number(/(\d+) still here/.exec(g.nodes.find((n) => n.id === id)?.detail ?? "")?.[1] ?? 0);

/** Every phase node = its inflow = its outflows + the open rows still in it. */
function assertConserved(g) {
  const v = values(g);
  assert.equal(v.tracked, outflow(g, "tracked"), "tracked = its outflows");
  for (const id of ["applied", "replied", "screening", "assessment", "tech", "manager", "final", "offer"]) {
    if (v[id] === undefined) continue;
    assert.equal(v[id], inflow(g, id), `${id} value = inflow`);
    assert.equal(v[id], outflow(g, id) + still(g, id), `${id} value = outflow + still here`);
  }
}

test("statusToken uses canonStatus aliases (same map as Analytics)", () => {
  assert.equal(statusToken("Interview"), "INTERVIEW");
  assert.equal(statusToken("Interview 2026-08-20"), "INTERVIEW");
  assert.equal(statusToken("**Rejected**"), "REJECTED");
  assert.equal(statusToken(DASH), "DISCARDED");
  assert.equal(statusToken("Oferta"), "OFFER");
  assert.equal(statusToken("**Mülakat**"), "INTERVIEW");
  assert.equal(statusToken("Entrevista"), "INTERVIEW");
  assert.equal(statusToken("Rechazado"), "REJECTED");
});

test("parseStatusLog skips header and reads Interview→Rejected rows", () => {
  const rows = parseStatusLog(
    "num\tdate\tfrom\tto\tsource\tnote\n13\t2026-08-26\tInterview\tRejected\tset-status\t\n3\t2026-08-15\tApplied\tRejected\tset-status\t\n",
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].num, 13);
  assert.equal(rows[0].from, "Interview");
  assert.equal(rows[0].to, "Rejected");
});

test("the chain follows each row's phases and ends in Active or Out", () => {
  const apps = [
    { n: 1, status: "SKIP" },
    { n: 2, status: "Evaluated" },
    { n: 3, status: "Applied" },
    { n: 4, status: "Responded", notes: "STAGE: Screening 1; STAGE: Screening 2" },
    { n: 5, status: "Interview", notes: "STAGE: Screening 1; STAGE: Tech interview 1" },
    { n: 6, status: "Rejected", notes: "STAGE: Screening 1; OUTCOME: Rejected at Screening 1" },
    { n: 7, status: "Discarded", notes: "OUTCOME: Ghosted at Applied" },
    { n: 8, status: "Hired", notes: "STAGE: Tech interview 1; STAGE: Offer; STAGE: Hired" },
  ];
  const g = buildPipelineSankey(apps);
  const v = values(g);
  assert.equal(v.tracked, 8);
  assert.equal(v.skip, 1);
  assert.equal(v.evaluated, 1);
  assert.equal(v.applied, 6);
  assert.equal(v.replied, 4);
  assert.equal(v.screening, 3);
  assert.equal(v.tech, 2);
  assert.equal(v.hired, 1);
  assert.equal(still(g, "applied"), 1);
  assert.equal(flow(g, "applied", "out:applied"), 1);
  assert.equal(still(g, "screening"), 1);
  assert.equal(flow(g, "screening", "out:screening"), 1);
  assert.equal(still(g, "tech"), 1);
  // Open rows leave no ribbon: there are no "still" side nodes.
  assert.equal(g.nodes.some((n) => n.id.startsWith("active:")), false);
  assert.match(g.nodes.find((n) => n.id === "out:applied").detail, /1 ghosted/);
  assertConserved(g);
});

test("a skipped phase is crossed, not counted", () => {
  // Applied straight to Tech interview: Screening and Assessment never happened.
  const g = buildPipelineSankey([{ n: 1, status: "Interview", notes: "STAGE: Tech interview 1" }]);
  const v = values(g);
  assert.equal(v.screening, undefined);
  assert.equal(v.assessment, undefined);
  assert.equal(flow(g, "replied", "tech"), 1);
  assertConserved(g);
});

test("a web move Screening -> Final does not invent Tech from the ledger; same for Hiring manager", () => {
  for (const [label, key] of [["Final interview", "final"], ["Hiring manager", "manager"]]) {
    const g = buildPipelineSankey(
      [{ n: 9, status: "Interview", notes: `STAGE: Screening 1; STAGE: ${label} 1` }],
      [{ num: 9, from: "Applied", to: "Responded" }, { num: 9, from: "Responded", to: "Interview" }],
    );
    assert.equal(values(g).tech, undefined, label);
    assert.equal(flow(g, "screening", key), 1, label);
    assertConserved(g);
  }
});

test("ledger evidence never pushes a row past its tab or its exit", () => {
  // Open row whose ledger says Interview while its notes say Screening (#54).
  const open = buildPipelineSankey(
    [{ n: 54, status: "Responded", notes: "STAGE: Screening" }],
    [{ num: 54, from: "Applied", to: "Interview" }, { num: 54, from: "Interview", to: "Responded" }],
  );
  assert.equal(values(open).tech, undefined);
  assert.equal(still(open, "screening"), 1);
  // Closed row whose OUTCOME says Replied, with a stray Interview row in the ledger.
  const closed = buildPipelineSankey(
    [{ n: 3, status: "Rejected", notes: "OUTCOME: Rejected at Replied" }],
    [{ num: 3, from: "Applied", to: "Interview" }, { num: 3, from: "Interview", to: "Rejected" }],
  );
  assert.equal(values(closed).tech, undefined);
  assert.equal(flow(closed, "replied", "out:replied"), 1);
  assertConserved(closed);
});

test("bare Interview reads as Tech interview; legacy closed rows land at their last phase", () => {
  const g = buildPipelineSankey(
    [
      { n: 1, status: "Interview" },
      { n: 2, status: "Rejected" },
      { n: 3, status: "Discarded", notes: "repeated: same posting as #1" },
      { n: 4, status: "Discarded" },
    ],
    [
      { num: 2, from: "Responded", to: "Rejected" },
      { num: 3, from: "Applied", to: "Discarded" },
      { num: 4, from: "Evaluated", to: "Discarded" },
    ],
  );
  assert.equal(still(g, "tech"), 1);
  assert.equal(flow(g, "replied", "out:replied"), 1);
  assert.equal(flow(g, "applied", "out:applied"), 1);
  assert.equal(flow(g, "tracked", "discardedEarly"), 1);
  assert.match(g.nodes.find((n) => n.id === "out:applied").detail, /1 repeated/);
  assertConserved(g);
});

test("Discarded with no application in the log is not a submission", () => {
  for (const [app, log] of [
    [{ n: 7, status: "Discarded" }, []],
    [{ n: 7, status: "Discarded" }, [{ num: 7, from: "Evaluated", to: "Discarded" }]],
    [{ n: 8, status: DASH }, []],
    [{ n: 7, status: "Discarded" }, [{ num: 70, from: "Applied", to: "Discarded" }]],
  ]) {
    assert.equal(flow(buildPipelineSankey([app], log), "tracked", "discardedEarly"), 1);
  }
});

test("empty apps yield empty graph", () => {
  const g = buildPipelineSankey([]);
  assert.equal(g.total, 0);
  assert.equal(g.nodes.length, 0);
  assert.equal(g.links.length, 0);
});

test("layoutSankey positions nodes and draws a path per live link", () => {
  const g = buildPipelineSankey([
    { n: 1, status: "Applied" },
    { n: 2, status: "Interview", notes: "STAGE: Tech interview 1" },
    { n: 3, status: "Rejected", notes: "OUTCOME: Rejected at Tech interview 1" },
  ]);
  const laid = layoutSankey(g, { width: 800, height: 300 });
  assert.equal(laid.nodes.length, g.nodes.length);
  assert.equal(laid.links.length, g.links.length);
  for (const n of laid.nodes) {
    assert.ok(n.width > 0);
    assert.ok(n.height > 0);
    assert.ok(n.x >= 0);
    assert.ok(n.y >= 0);
  }
  for (const l of laid.links) {
    assert.ok(l.d.startsWith("M"));
    assert.ok(l.d.includes("C"));
    assert.ok(l.thickness > 0);
  }
});

test("the chart width leaves every column room for its side labels", () => {
  const g = buildPipelineSankey([
    { n: 1, status: "Hired", notes: "STAGE: Screening 1; STAGE: Assessment 1; STAGE: Tech interview 1; STAGE: Hiring manager 1; STAGE: Final interview 1; STAGE: Offer; STAGE: Hired" },
    { n: 2, status: "Rejected", notes: "STAGE: Offer; OUTCOME: Rejected at Offer" },
  ]);
  const padding = { top: 24, right: 188, bottom: 24, left: 100 };
  const width = sankeyWidth(g, padding);
  const laid = layoutSankey(g, { width, height: 440, padding });
  const xs = [...new Set(laid.nodes.map((n) => n.x))].sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i += 1) assert.ok(xs[i] - xs[i - 1] >= SANKEY_COLUMN_WIDTH - 20, `column ${i} gap ${xs[i] - xs[i - 1]}`);
});

// ── readStatusLog(): the ledger read behind the Sankey ──────────────────────
// A missing data/status-log.tsv is normal and charts from the snapshot; any
// other read failure must surface instead of passing for an empty log. It lives
// in career-ops.ts, reached through the shared @/ alias hook, with
// CAREER_OPS_ROOT pointed at a scratch data root.
const skipTs = !process.features?.typescript && "this Node cannot import career-ops.ts (no type stripping)";
const { readStatusLog, readApplicationStatusLog } = skipTs ? {} : await import("@/lib/career-ops");

function withDataRoot(setup, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sankey-status-log-"));
  fs.mkdirSync(path.join(root, "data"));
  fs.writeFileSync(path.join(root, "data/applications.md"), "");
  setup(path.join(root, "data"));
  const prev = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prev;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("readStatusLog: a present log is parsed from the data root", { skip: skipTs }, () => {
  const tsv = "13\t2026-08-26\tInterview\tRejected\tset-status\t\n";
  const rows = withDataRoot((data) => fs.writeFileSync(path.join(data, "status-log.tsv"), tsv), () => readStatusLog());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].num, 13);
});

test("readStatusLog: a missing log is an empty log", { skip: skipTs }, () => {
  assert.deepEqual(withDataRoot(() => {}, () => readStatusLog()), []);
});

test("Sankey and cumulative tiles read the same active tracker's ledger", { skip: skipTs }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sankey-tracker-"));
  const priorRoot = process.env.CAREER_OPS_ROOT;
  const priorTracker = process.env.CAREER_OPS_TRACKER;
  const ledger = (num) => `${num}\t2026-08-26\tOffer\tRejected\tset-status\t\n`;
  try {
    process.env.CAREER_OPS_ROOT = root;
    delete process.env.CAREER_OPS_TRACKER;
    for (const [dir, num] of [["", 1], ["data", 2], ["custom", 3]]) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
      fs.writeFileSync(path.join(root, dir, "applications.md"), "");
      fs.writeFileSync(path.join(root, dir, "status-log.tsv"), ledger(num));
    }
    const check = (num) => {
      assert.equal(readApplicationStatusLog(), ledger(num));
      assert.deepEqual(readStatusLog(), parseStatusLog(ledger(num)));
    };
    check(2);
    fs.unlinkSync(path.join(root, "data/applications.md"));
    check(1);
    const custom = path.join(root, "custom/applications.md");
    process.env.CAREER_OPS_TRACKER = custom;
    check(3);
    process.env.CAREER_OPS_TRACKER = path.relative(process.cwd(), custom);
    check(3);
    // A FILE symlink needs a privilege a non-elevated Windows shell lacks, and
    // a junction only links directories, so this one leg has no stand-in there.
    // Skip it by name; any other error is still a failure.
    let linked = true;
    try {
      fs.symlinkSync(custom, path.join(root, "linked.md"));
    } catch (e) {
      if (e?.code !== "EPERM" || e?.syscall !== "symlink") throw e;
      linked = false;
      t.diagnostic("symlinked-tracker leg skipped: no symlink privilege (EPERM)");
    }
    if (linked) {
      process.env.CAREER_OPS_TRACKER = path.join(root, "linked.md");
      check(3);
    }
  } finally {
    if (priorRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = priorRoot;
    if (priorTracker === undefined) delete process.env.CAREER_OPS_TRACKER;
    else process.env.CAREER_OPS_TRACKER = priorTracker;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("readStatusLog: an unreadable log throws instead of reading as empty", { skip: skipTs }, () => {
  // A directory where the file should be: EISDIR, a read failure that is not ENOENT.
  withDataRoot(
    (data) => fs.mkdirSync(path.join(data, "status-log.tsv")),
    () => assert.throws(() => readStatusLog(), (err) => err?.code !== undefined && err.code !== "ENOENT"),
  );
});
