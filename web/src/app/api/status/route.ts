import { NextResponse } from "next/server";
import fs from "node:fs";
import { findApplication, rootScript } from "@/lib/career-ops";
import { canonicalizeStatus } from "@/lib/core/states";
import { parseCliJson, trackerRowArg } from "@/lib/status-cli.mjs";
import { readJsonObject } from "@/lib/json-body";
import { readRowWithHash, runSetStatus, setStatusFailure } from "@/lib/set-status-run";
import { canonStatus } from "@/lib/status-alias.mjs";
import { PHASES, isOpenApplied, nextStatuses } from "@/lib/lifecycle.mjs";

// Statuses that belong to a hiring phase (lifecycle.mjs PHASES), Applied aside.
const PHASE_STATUSES = new Set(PHASES.map((phase) => phase.status).filter((status) => status !== "Applied"));
import { cvPickUrl, recordCvOutcome } from "@/lib/cv-pick-run";

export const runtime = "nodejs"; // delegates to the core CLI via child_process

// Writeback: UPDATE the status cell of an EXISTING tracker row only. Never adds
// rows: per the core data contract, new rows go through the TSV + merge flow.
//
// It delegates to set-status.mjs, the path every other writer uses: it holds the
// shared tracker lock across the whole read-modify-write, validates the state
// against templates/states.yml, and appends the transition ledger (#2900).
// `--source web` keeps rows written from here distinguishable in the ledger.
//
// What stays here is the HTTP contract: reject a bad request before spawning
// anything, and map the CLI's exit codes onto status codes (set-status-run.ts).

export async function POST(req: Request) {
  const body = await readJsonObject<{ n?: string; status?: string }>(req);
  if (!body) return NextResponse.json({ error: "bad json" }, { status: 400 });
  const { n, status } = body;
  if (!n || typeof status !== "string" || !status.trim()) {
    return NextResponse.json({ error: "n and status required" }, { status: 400 });
  }
  // Rejected here rather than left to the CLI: these characters would break the
  // markdown row.
  if (/[|\r\n*]/.test(status)) {
    return NextResponse.json({ error: "invalid status (table-breaking characters)" }, { status: 400 });
  }
  // Fast path for an unknown state; set-status.mjs validates again.
  const canon = canonicalizeStatus(status);
  if (!canon) {
    return NextResponse.json({ error: `not a canonical status: ${status}` }, { status: 400 });
  }
  // House rule 6: every application records which CV was sent, so Applied is
  // written only by /api/apply-cv ("Applied with CV A/B").
  if (canon === "Applied") {
    return NextResponse.json(
      { error: "Use \"Applied with CV A\" or \"CV B\" so the CV choice is recorded.", code: "use-apply-cv" },
      { status: 409 },
    );
  }
  // House rule 25: hiring phases are a status plus a STAGE note, written by
  // /api/stage, so a bare phase status never lands on a row.
  if (PHASE_STATUSES.has(canon)) {
    return NextResponse.json(
      { error: "Use the phase buttons (Replied, Screening, Tech interview...) so the phase and round are recorded.", code: "use-stage" },
      { status: 409 },
    );
  }
  // `n` arrives from untrusted JSON, so it can be an array or an object.
  const row = trackerRowArg(n);
  if (!row) {
    return NextResponse.json({ error: "n must be a tracker row number" }, { status: 400 });
  }

  // A data-only CAREER_OPS_ROOT has no scripts; answer that explicitly.
  if (!fs.existsSync(rootScript("set-status"))) {
    return NextResponse.json(
      {
        error: "status updates need the career-ops scripts; this root has data only",
        code: "core-script-missing",
      },
      { status: 503 },
    );
  }

  // Forward-only, one step at a time (lifecycle.mjs). --expect-tracker refuses
  // the write when the row changed between this check and the CLI's lock.
  const read = readRowWithHash(row);
  if (!read) return NextResponse.json({ error: "tracker not found" }, { status: 404 });
  if (!read.app) return NextResponse.json({ error: `row #${row} not found` }, { status: 404 });
  // An applied row closes through /api/exit, which records how and at which phase it ended.
  if ((canon === "Rejected" || canon === "Discarded") && isOpenApplied(read.app)) {
    return NextResponse.json(
      { error: "Use the exit buttons (They rejected me, I withdrew, Ghosted, Posting closed) so the phase it ended at is recorded.", code: "use-exit" },
      { status: 409 },
    );
  }
  const allowed = nextStatuses(canonStatus(String(read.app.status ?? "").trim()));
  if (!allowed.includes(canon)) {
    return NextResponse.json(
      { error: `#${row} is ${read.app.status}; it can only move to ${allowed.join(", ") || "nothing (closed)"}.`, code: "out-of-order" },
      { status: 409 },
    );
  }

  // --row: `n` is the tracker's # column, NOT a report number.
  const result = await runSetStatus(["--row", row, canon, "--source", "web", "--json", "--expect-tracker", read.sha]);
  const failure = setStatusFailure(result, "/api/status");
  if (failure) return NextResponse.json(failure.body, { status: failure.status, ...(failure.headers ? { headers: failure.headers } : {}) });
  const parsed = parseCliJson(result.stdout);

  // House rule 6: keep the CV A/B log's outcome in step with the tracker. A
  // failure here does not undo the status change; it comes back as a warning.
  let warning: string | undefined;
  const url = cvPickUrl(findApplication(row)?.url);
  if (url && parsed?.changed === true) {
    const outcome = await recordCvOutcome(url, canon);
    if (!outcome.ok) warning = `Status saved, but the CV log was not updated: ${outcome.error}`;
  }

  // Response shape is unchanged for existing callers; `changed`,
  // `statusLogged` and `warning` are additive.
  return NextResponse.json({
    ok: true,
    status: canon,
    changed: parsed?.changed === true,
    statusLogged: parsed?.statusLogged === true,
    ...(warning ? { warning } : {}),
  });
}
