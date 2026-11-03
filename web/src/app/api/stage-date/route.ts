import { NextResponse } from "next/server";
import { readProfileTimezone } from "@/lib/landing-gear";
import { parseCliJson, trackerRowArg } from "@/lib/status-cli.mjs";
import { readJsonObject } from "@/lib/json-body";
import { readRowWithHash, runSetStatus, setStatusFailure } from "@/lib/set-status-run";
import { DATED_PHASES, currentMark, currentPhase, datedNote, phaseInfo, phaseNote } from "@/lib/lifecycle.mjs";
import { wallToIso } from "@/lib/interview-date.mjs";
import { expectedMismatch } from "@/lib/phase-guard";

export const runtime = "nodejs";

// House rule 25: set, change or clear the interview date of the round a row is
// in. The date lives on that round's STAGE note ("STAGE: Tech interview 2 @
// <ISO>"), swapped in place with set-status --replace-note; a phase read from
// the status alone (bare Interview) gets its note appended. The status never
// changes, and the same phase/round and tracker-hash guards as /api/stage apply.
export async function POST(req: Request) {
  const body = await readJsonObject<{ n?: string; at?: string; expected?: { phase?: string; round?: number } }>(req);
  if (!body) return NextResponse.json({ error: "bad json" }, { status: 400 });
  const row = trackerRowArg(body.n);
  if (!row) return NextResponse.json({ error: "n must be a tracker row number" }, { status: 400 });
  const clearing = body.at === "" || body.at === null || body.at === undefined;
  const timezone = readProfileTimezone();
  const at = clearing ? null : wallToIso(body.at, timezone);
  if (!clearing && !at) return NextResponse.json({ error: "at must be a date and time (YYYY-MM-DDTHH:MM)" }, { status: 400 });

  const read = readRowWithHash(row);
  if (!read) return NextResponse.json({ error: "tracker not found" }, { status: 404 });
  if (!read.app) return NextResponse.json({ error: `row #${row} not found` }, { status: 404 });
  const stale = expectedMismatch(currentPhase(read.app), body.expected);
  if (stale) return NextResponse.json({ error: stale, code: "stale" }, { status: 409 });
  const mark = currentMark(read.app);
  if (!mark || !(DATED_PHASES as readonly string[]).includes(mark.phase)) {
    return NextResponse.json({ error: `#${row} is not in an interview phase.`, code: "out-of-order" }, { status: 409 });
  }

  let noteArgs: string[];
  if (mark.text) {
    const next = datedNote(mark.text, at);
    // Same date again, or clearing a date that isn't there: nothing to write.
    if (next === mark.text) return NextResponse.json({ ok: true, at, unchanged: true });
    // set-status takes only --note in the "=" form; --replace-note's value is the next argument.
    noteArgs = ["--replace-note", mark.text, `--note=${next}`];
  } else {
    if (!at) return NextResponse.json({ ok: true, at, unchanged: true });
    noteArgs = [`--note=${phaseNote(mark.phase, mark.round, at)}`];
  }
  const result = await runSetStatus([
    "--row", row, phaseInfo(mark.phase).status, ...noteArgs,
    "--source", "web", "--json", "--expect-tracker", read.sha,
  ]);
  const failure = setStatusFailure(result, "/api/stage-date");
  if (failure) return NextResponse.json(failure.body, { status: failure.status, ...(failure.headers ? { headers: failure.headers } : {}) });
  const parsed = parseCliJson(result.stdout);
  return NextResponse.json({ ok: true, at, ...(parsed?.changed === true ? {} : { unchanged: true }) });
}
