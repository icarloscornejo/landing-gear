import { NextResponse } from "next/server";
import { findApplication, readProfileTimezone } from "@/lib/career-ops";
import { wallToIso } from "@/lib/interview-date.mjs";
import { canonStatus } from "@/lib/status-alias.mjs";
import { parseCliJson, trackerRowArg } from "@/lib/status-cli.mjs";
import { readJsonObject } from "@/lib/json-body";
import { readRowWithHash, runSetStatus, setStatusFailure } from "@/lib/set-status-run";
import { DATED_PHASES, currentPhase, nextPhases, nextRound, phaseInfo, phaseLabel, phaseNote, type PhaseKey } from "@/lib/lifecycle.mjs";
import { cvPickUrl, recordCvOutcome } from "@/lib/cv-pick-run";
import { expectedMismatch } from "@/lib/phase-guard";

export const runtime = "nodejs";

// House rule 25: move a row to a hiring phase, or to its next round. The phase's
// canonical status and its "STAGE: <Phase> <round>" note are written together
// through set-status.mjs. The client sends the phase and round it saw, so a
// replayed click cannot write a round that never happened, and --expect-tracker
// refuses the write if the row changed after it was read.
export async function POST(req: Request) {
  const body = await readJsonObject<{ n?: string; phase?: string; at?: string; expected?: { phase?: string; round?: number } }>(req);
  if (!body) return NextResponse.json({ error: "bad json" }, { status: 400 });
  const row = trackerRowArg(body.n);
  if (!row) return NextResponse.json({ error: "n must be a tracker row number" }, { status: 400 });
  const phase = body.phase as PhaseKey;
  if (typeof body.phase !== "string" || !phaseInfo(phase)) return NextResponse.json({ error: "unknown phase" }, { status: 400 });
  // Optional interview date: a datetime-local wall time, rebuilt as ISO here so no client text reaches the tracker.
  let at: string | null = null;
  if (body.at) {
    if (!(DATED_PHASES as readonly string[]).includes(phase)) return NextResponse.json({ error: `${phaseInfo(phase).label} takes no date` }, { status: 400 });
    at = wallToIso(body.at, readProfileTimezone());
    if (!at) return NextResponse.json({ error: "at must be a date and time (YYYY-MM-DDTHH:MM)" }, { status: 400 });
  }

  const read = readRowWithHash(row);
  if (!read) return NextResponse.json({ error: "tracker not found" }, { status: 404 });
  if (!read.app) return NextResponse.json({ error: `row #${row} not found` }, { status: 404 });
  const stale = expectedMismatch(currentPhase(read.app), body.expected);
  if (stale) return NextResponse.json({ error: stale, code: "stale" }, { status: 409 });
  if (!nextPhases(read.app).includes(phase)) {
    return NextResponse.json(
      { error: `#${row} is ${read.app.status}; it cannot move to ${phaseInfo(phase).label}.`, code: "out-of-order" },
      { status: 409 },
    );
  }

  const round = nextRound(read.app, phase);
  const status = phaseInfo(phase).status;
  const note = phaseNote(phase, round, at);
  const result = await runSetStatus([
    "--row", row, status, ...(note ? [`--note=${note}`] : []),
    // A move into Interview archives the JD; detached, so it cannot outlast the web's 30 s timeout.
    "--detach-jd-archive",
    "--source", "web", "--json", "--expect-tracker", read.sha,
  ]);
  const failure = setStatusFailure(result, "/api/stage");
  if (failure) return NextResponse.json(failure.body, { status: failure.status, ...(failure.headers ? { headers: failure.headers } : {}) });
  const parsed = parseCliJson(result.stdout);
  if (parsed?.changed !== true) {
    return NextResponse.json({ error: `#${row} was not changed; reload and retry.`, code: "unchanged" }, { status: 409 });
  }

  // House rule 6: the CV A/B log follows real status changes, as /api/status does.
  let warning: string | undefined;
  const url = cvPickUrl(findApplication(row)?.url);
  if (url && status.toUpperCase() !== canonStatus(String(read.app.status ?? "").trim())) {
    const outcome = await recordCvOutcome(url, status);
    if (!outcome.ok) warning = `Saved, but the CV log was not updated: ${outcome.error}`;
  }
  return NextResponse.json({
    ok: true,
    phase,
    round,
    label: phaseLabel(phase, round),
    at,
    ...(parsed?.jdArchiveTriggered ? { jdArchiveTriggered: parsed.jdArchiveTriggered } : {}),
    ...(warning ? { warning } : {}),
  });
}
