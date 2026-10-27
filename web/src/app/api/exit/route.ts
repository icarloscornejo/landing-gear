import { NextResponse } from "next/server";
import { findApplication, readStatusLog } from "@/lib/career-ops";
import { parseCliJson, trackerRowArg } from "@/lib/status-cli.mjs";
import { readJsonObject } from "@/lib/json-body";
import { readRowWithHash, runSetStatus, setStatusFailure } from "@/lib/set-status-run";
import { EXIT_KINDS, currentPhase, exitNote, isOpenApplied, phasePath, stageMarks, type ExitKind } from "@/lib/lifecycle.mjs";
import { cvPickUrl, recordCvOutcome } from "@/lib/cv-pick-run";
import { expectedMismatch } from "@/lib/phase-guard";

export const runtime = "nodejs";

// House rule 25: close an applied row and remember where it ended. The status
// (Rejected, or Discarded for withdrawn / ghosted / posting closed) and an
// "OUTCOME: <Kind> at <Phase n>" note are written together through set-status.mjs.
// The phase is computed here from the row read under --expect-tracker.
export async function POST(req: Request) {
  const body = await readJsonObject<{ n?: string; kind?: string; expected?: { phase?: string; round?: number } }>(req);
  if (!body) return NextResponse.json({ error: "bad json" }, { status: 400 });
  const row = trackerRowArg(body.n);
  if (!row) return NextResponse.json({ error: "n must be a tracker row number" }, { status: 400 });
  const kind = body.kind as ExitKind;
  if (typeof body.kind !== "string" || !Object.hasOwn(EXIT_KINDS, kind)) return NextResponse.json({ error: "unknown exit" }, { status: 400 });

  const read = readRowWithHash(row);
  if (!read) return NextResponse.json({ error: "tracker not found" }, { status: 404 });
  if (!read.app) return NextResponse.json({ error: `row #${row} not found` }, { status: 404 });
  if (!isOpenApplied(read.app)) {
    return NextResponse.json({ error: `#${row} is ${read.app.status}; only an open, applied row can end this way.`, code: "out-of-order" }, { status: 409 });
  }
  const current = currentPhase(read.app);
  const stale = expectedMismatch(current, body.expected);
  if (stale) return NextResponse.json({ error: stale, code: "stale" }, { status: 409 });

  // The phase it ended at: the last phase it went through (the current one for an open row).
  const path = phasePath(read.app, readStatusLog());
  const phase = path.length ? path[path.length - 1] : current!.phase;
  const round = stageMarks(read.app.notes).filter((mark) => mark.phase === phase).pop()?.round ?? current?.round ?? 1;
  const status = EXIT_KINDS[kind].status;
  const result = await runSetStatus([
    "--row", row, status, `--note=${exitNote(kind, phase, round)}`,
    "--source", "web", "--json", "--expect-tracker", read.sha,
  ]);
  const failure = setStatusFailure(result, "/api/exit");
  if (failure) return NextResponse.json(failure.body, { status: failure.status, ...(failure.headers ? { headers: failure.headers } : {}) });
  const parsed = parseCliJson(result.stdout);
  if (parsed?.changed !== true) {
    return NextResponse.json({ error: `#${row} was not changed; reload and retry.`, code: "unchanged" }, { status: 409 });
  }

  // House rule 6: the CV A/B log follows the closing status.
  let warning: string | undefined;
  const url = cvPickUrl(findApplication(row)?.url);
  if (url) {
    const outcome = await recordCvOutcome(url, status);
    if (!outcome.ok) warning = `Saved, but the CV log was not updated: ${outcome.error}`;
  }
  return NextResponse.json({ ok: true, kind, phase, round, ...(warning ? { warning } : {}) });
}
