import { NextResponse } from "next/server";
import { trackerRowArg } from "@/lib/status-cli.mjs";
import { readJsonObject } from "@/lib/json-body";
import { scoreNum } from "@/lib/format";
import { readRowWithHash, runSetStatus, setStatusFailure } from "@/lib/set-status-run";
import { cvPickUrl, recordCvOutcome, recordCvPick } from "@/lib/cv-pick-run";
import { isApproved } from "@/lib/home/awaiting.mjs";

export const runtime = "nodejs";

const BELOW_THRESHOLD_NOTE =
  "Carlos decided to apply on his own judgment (below the 4.0/5 threshold), not on engine recommendation";

type Step = { ok: boolean; skipped?: boolean; error?: string };

// "Applied with CV A/B" (house rules 6, 9, 12). Three steps, in order:
//   1. cv-pick a|b <url>    record which CV was sent
//   2. set-status Applied   the tracker row (also seeds the follow-up)
//   3. cv-pick --outcome    the A/B log's outcome
// A failure in step 1 stops before the tracker is touched; a failure in step 2
// skips step 3. The response carries each step so the UI can retry only step 3.
export async function POST(req: Request) {
  const body = await readJsonObject<{ n?: string; cv?: string; retryOutcomeOnly?: boolean }>(req);
  if (!body) return NextResponse.json({ error: "bad json" }, { status: 400 });
  const row = trackerRowArg(body.n);
  if (!row) return NextResponse.json({ error: "n must be a tracker row number" }, { status: 400 });

  const read = readRowWithHash(row);
  if (!read) return NextResponse.json({ error: "tracker not found" }, { status: 404 });
  const app = read.app;
  if (!app) return NextResponse.json({ error: `row #${row} not found` }, { status: 404 });
  const url = cvPickUrl(app.url);

  // Retry of step 3 only, after the row is already Applied.
  if (body.retryOutcomeOnly === true) {
    if (!url) return NextResponse.json({ error: "this row has no URL for the CV log" }, { status: 400 });
    const outcome = await recordCvOutcome(url, "Applied");
    return NextResponse.json({ ok: outcome.ok, steps: { outcome } }, { status: outcome.ok ? 200 : 500 });
  }

  const cv = body.cv === "a" || body.cv === "b" ? body.cv : null;
  if (!cv) return NextResponse.json({ error: "cv must be \"a\" or \"b\"" }, { status: 400 });
  if (!isApproved(app)) {
    return NextResponse.json({ error: `#${row} is not an approved Evaluated row. Approve it first.` }, { status: 409 });
  }

  const steps: { pick: Step; status?: Step; outcome?: Step } = { pick: { ok: true, skipped: true } };

  // 1. Which CV. A row with no http/mailto URL cannot be logged; the apply still goes ahead.
  if (url) {
    const pick = await recordCvPick(cv, url, app.company, app.role);
    if (pick.code !== 0) {
      steps.pick = { ok: false, error: pick.stderr.trim().replace(/^ERROR:\s*/, "").slice(0, 200) || "cv-pick failed" };
      return NextResponse.json({ ok: false, error: "The CV choice was not recorded, so nothing changed.", steps }, { status: 500 });
    }
    steps.pick = { ok: true };
  }

  // 2. Tracker row. --expect-tracker refuses a write if the tracker changed after the read.
  const score = scoreNum(app.score);
  const args = ["--row", row, "Applied", "--source", "web", "--json", "--expect-tracker", read.sha];
  if (Number.isFinite(score) && score < 4.0) args.push(`--note=${BELOW_THRESHOLD_NOTE}`);
  const result = await runSetStatus(args);
  const failure = setStatusFailure(result, "/api/apply-cv");
  if (failure) {
    steps.status = { ok: false, error: String(failure.body.error ?? "status update failed") };
    return NextResponse.json({ ...failure.body, ok: false, steps }, { status: failure.status, ...(failure.headers ? { headers: failure.headers } : {}) });
  }
  steps.status = { ok: true };

  // 3. Outcome in the A/B log.
  if (url) {
    steps.outcome = await recordCvOutcome(url, "Applied");
  }
  const warnings: string[] = [];
  if (!url) warnings.push("CV not logged: this row has no http or mailto URL.");
  if (steps.outcome && !steps.outcome.ok) warnings.push("Applied, but the CV log failed. Retry the CV log.");
  return NextResponse.json({ ok: true, steps, ...(warnings.length ? { warnings } : {}) });
}
