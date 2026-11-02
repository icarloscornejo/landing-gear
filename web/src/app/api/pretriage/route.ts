import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, readApplications, readInbox, readProfileAuthorizedIn } from "@/lib/career-ops";
import { usAuthorizedFrom } from "@/lib/location-reach.mjs";
import { lookalikeAts } from "@/lib/core/ats-lookalike.mjs";
import { setInboxLabel, setInboxSkip } from "@/lib/inbox-skip.mjs";
import { preTriage, trackerKeys } from "@/lib/pre-triage.mjs";
import { createJdReader } from "@/lib/pretriage-jd";
import { readJsonObject } from "@/lib/json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const READ_AT_ONCE = 4;

// "Pre-triage all" (house rule 22): zero-token check over every Discovered row not
// pre-triaged or triaged yet, from its cells and, when it can be read for free,
// its JD (lib/pretriage-jd.ts). A drop closes the row with `closed: pre-triage:
// <reason>`; a pass gets `pretriage: pass` (or `pass, no JD`) so it is skipped next
// time. `{recheck: true}` re-runs it on every open, untriaged row, pre-triaged or not,
// so a rule change reaches rows already passed.
export async function POST(req: Request) {
  const body = (await readJsonObject<{ recheck?: unknown }>(req)) ?? {};
  const recheck = body.recheck === true;
  const root = careerOpsRoot();
  const file = path.join(root, "data", "pipeline.md");
  const lockModule = path.join(root, "pipeline-lock.mjs");
  if (!fs.existsSync(lockModule)) {
    return NextResponse.json({ error: "pre-triage needs the landing-gear core scripts", code: "core-script-missing" }, { status: 503 });
  }

  const tracker = trackerKeys(readApplications());
  const options = { usAuthorized: usAuthorizedFrom(readProfileAuthorizedIn()) };
  const targets = readInbox().filter((job) => !job.done && !job.triage && (recheck || !job.pretriaged));
  const readJd = createJdReader();
  const jds = new Array(targets.length);
  for (let start = 0; start < targets.length; start += READ_AT_ONCE) {
    const batch = targets.slice(start, start + READ_AT_ONCE);
    const read = await Promise.all(batch.map((job) => readJd(job)));
    read.forEach((jd, offset) => (jds[start + offset] = jd));
  }

  const dropped: { company: string; role: string; reason: string }[] = [];
  let passed = 0;
  let withoutJd = 0;
  const failed: string[] = [];
  for (const [index, job] of targets.entries()) {
    const jd = jds[index];
    // A real ATS domain with more labels after it (rule a) is a fake host: drop it. A reused
    // vendor word (rule b) is only labelled, since an unrelated site can carry the word.
    const lookalike = lookalikeAts(job.url);
    const verdict = lookalike?.rule === "a"
      ? { pass: false as const, reason: `look-alike ATS host (${lookalike.host})` }
      : preTriage(job, tracker, jd, options);
    const passLabel = `${jd ? "pass" : "pass, no JD"}${lookalike ? `, look-alike ${lookalike.vendor} host ${lookalike.host}` : ""}`;
    const writes = verdict.pass
      ? [() => setInboxLabel(file, job.url, "pretriage", passLabel, { lockModule })]
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
    if (verdict.pass) {
      passed += 1;
      if (!jd) withoutJd += 1;
    } else dropped.push({ company: job.company, role: job.role, reason: verdict.reason });
  }
  return NextResponse.json({ ok: failed.length === 0, checked: targets.length, passed, withoutJd, dropped, failed });
}
