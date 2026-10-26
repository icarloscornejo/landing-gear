import { NextResponse } from "next/server";
import { canonStatus } from "@/lib/status-alias.mjs";
import { trackerRowArg } from "@/lib/status-cli.mjs";
import { readJsonObject } from "@/lib/json-body";
import { readRowWithHash, runSetStatus, setStatusFailure } from "@/lib/set-status-run";
import { cvPickUrl, recordCvOutcome } from "@/lib/cv-pick-run";
import { findApplication } from "@/lib/career-ops";
import { nextStatuses } from "@/lib/lifecycle.mjs";

export const runtime = "nodejs";

// "Repeated": this row is a posting Carlos already has elsewhere. career-ops has
// no Duplicate state, so it closes as Discarded with a "repeated" note (naming
// the original row only when one is given); allowed whenever Discard is (any
// open row). --expect-tracker refuses the write if the tracker changed after it
// was read.
export async function POST(req: Request) {
  const body = await readJsonObject<{ n?: string; of?: string }>(req);
  if (!body) return NextResponse.json({ error: "bad json" }, { status: 400 });
  const row = trackerRowArg(body.n);
  if (!row) return NextResponse.json({ error: "n must be a tracker row number" }, { status: 400 });
  const original = body.of === undefined || body.of === "" ? null : trackerRowArg(body.of);
  if (body.of !== undefined && body.of !== "" && !original) return NextResponse.json({ error: "of must be a tracker row number" }, { status: 400 });
  if (original === row) return NextResponse.json({ error: "A row cannot repeat itself." }, { status: 400 });

  const read = readRowWithHash(row);
  if (!read) return NextResponse.json({ error: "tracker not found" }, { status: 404 });
  if (!read.app) return NextResponse.json({ error: `row #${row} not found` }, { status: 404 });
  if (original && !findApplication(original)) return NextResponse.json({ error: `There is no row #${original}.` }, { status: 404 });
  if (!nextStatuses(canonStatus(String(read.app.status ?? "").trim())).includes("Discarded")) {
    return NextResponse.json({ error: `#${row} is ${read.app.status}, already closed.` }, { status: 409 });
  }

  const result = await runSetStatus([
    "--row", row, "Discarded", `--note=${original ? `repeated: same posting as #${original}` : "repeated: posting already seen"}`,
    "--source", "web", "--json", "--expect-tracker", read.sha,
  ]);
  const failure = setStatusFailure(result, "/api/repeated");
  if (failure) return NextResponse.json(failure.body, { status: failure.status, ...(failure.headers ? { headers: failure.headers } : {}) });

  // House rule 6: keep the CV A/B log in step, as /api/status does.
  const url = cvPickUrl(read.app.url);
  if (url) {
    const outcome = await recordCvOutcome(url, "Discarded");
    if (!outcome.ok) return NextResponse.json({ ok: true, warning: `Saved, but the CV log was not updated: ${outcome.error}` });
  }
  return NextResponse.json({ ok: true });
}
