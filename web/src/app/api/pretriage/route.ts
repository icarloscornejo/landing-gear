import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, readApplications, readInbox } from "@/lib/career-ops";
import { setInboxLabel, setInboxSkip } from "@/lib/inbox-skip.mjs";
import { preTriage, trackerKeys } from "@/lib/pre-triage.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Pre-triage all": zero-token title/location/tracker check over every Discovered
// row not pre-triaged or triaged yet. A drop closes the row with the same
// `closed: pre-triage: <reason>` label used by hand; a pass gets `pretriage: pass`
// so it is never pre-triaged again.
export async function POST() {
  const root = careerOpsRoot();
  const file = path.join(root, "data", "pipeline.md");
  const lockModule = path.join(root, "pipeline-lock.mjs");
  if (!fs.existsSync(lockModule)) {
    return NextResponse.json({ error: "pre-triage needs the career-ops scripts", code: "core-script-missing" }, { status: 503 });
  }

  const tracker = trackerKeys(readApplications());
  const targets = readInbox().filter((job) => !job.done && !job.pretriaged && !job.triage);
  const dropped: { company: string; role: string; reason: string }[] = [];
  let passed = 0;
  const failed: string[] = [];
  for (const job of targets) {
    const verdict = preTriage(job, tracker);
    const writes = verdict.pass
      ? [() => setInboxLabel(file, job.url, "pretriage", "pass", { lockModule })]
      : [
          () => setInboxLabel(file, job.url, "closed", `pre-triage: ${verdict.reason}`, { lockModule }),
          () => setInboxSkip(file, job.url, true, { lockModule }),
        ];
    let ok = true;
    for (const write of writes) {
      const result = await write();
      if (!result.ok) {
        ok = false;
        failed.push(`${job.company}: ${result.error}`);
        break;
      }
    }
    if (!ok) continue;
    if (verdict.pass) passed += 1;
    else dropped.push({ company: job.company, role: job.role, reason: verdict.reason });
  }
  return NextResponse.json({ ok: failed.length === 0, checked: targets.length, passed, dropped, failed });
}
