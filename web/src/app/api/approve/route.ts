import { NextResponse } from "next/server";
import { canonStatus } from "@/lib/status-alias.mjs";
import { trackerRowArg } from "@/lib/status-cli.mjs";
import { readJsonObject } from "@/lib/json-body";
import { readRowWithHash, runSetStatus, setStatusFailure } from "@/lib/set-status-run";
import { APPROVED_NOTE, isApproved } from "@/lib/home/awaiting.mjs";

export const runtime = "nodejs";

// House rule 12: approving keeps the row at Evaluated and adds the APPROVED
// note. Only an Evaluated row can be approved, and --expect-tracker makes the
// write fail if the tracker changed after the row was read (a stale page).
export async function POST(req: Request) {
  const body = await readJsonObject<{ n?: string }>(req);
  if (!body) return NextResponse.json({ error: "bad json" }, { status: 400 });
  const row = trackerRowArg(body.n);
  if (!row) return NextResponse.json({ error: "n must be a tracker row number" }, { status: 400 });

  const read = readRowWithHash(row);
  if (!read) return NextResponse.json({ error: "tracker not found" }, { status: 404 });
  if (!read.app) return NextResponse.json({ error: `row #${row} not found` }, { status: 404 });
  if (canonStatus(String(read.app.status ?? "").trim()) !== "EVALUATED") {
    return NextResponse.json({ error: `#${row} is ${read.app.status}, not Evaluated, so it cannot be approved.` }, { status: 409 });
  }
  // House rule 20: approval needs the full evaluation report, not just a triage.
  if (!/\]\([^)]*reports\/[^)]+\.md\)/.test(String(read.app.report ?? ""))) {
    return NextResponse.json({ error: `#${row} has no full evaluation report yet. Run Evaluate first, then approve.`, code: "needs-report" }, { status: 409 });
  }
  // Already approved (the note can be worded differently): nothing to write.
  if (isApproved(read.app)) return NextResponse.json({ ok: true, changed: false });

  const result = await runSetStatus([
    "--row", row, "Evaluated", `--note=${APPROVED_NOTE}`,
    "--source", "web", "--json", "--expect-tracker", read.sha,
  ]);
  const failure = setStatusFailure(result, "/api/approve");
  if (failure) return NextResponse.json(failure.body, { status: failure.status, ...(failure.headers ? { headers: failure.headers } : {}) });
  return NextResponse.json({ ok: true });
}
