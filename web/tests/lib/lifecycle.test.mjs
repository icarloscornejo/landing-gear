// The engineer's lifecycle in the web (pipeline -> triage -> evaluate -> approve ->
// applied with CV A/B): the pure rules behind the routes and buttons.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveJobId,
  evaluationNotes,
  jdSourceUrl,
  localJdPath,
  parseNeedsChrome,
  parseTriageLine,
  reportUrlField,
  resolveWorkerInput,
  stripEmDash,
  triageLabel,
} from "../../src/lib/lifecycle.mjs";
import { applyInboxLabel, applyInboxSkip, setInboxLabel } from "../../src/lib/inbox-skip.mjs";
import { parseInbox } from "../../src/lib/pipeline-table.mjs";
import { isApproved, pickApproved, pickAwaitingDecision } from "../../src/lib/home/awaiting.mjs";
import { claudeCliArgs, argValue } from "../../src/lib/claude-invocation.mjs";
import { buildPrompt, HOUSE_RULES_SCOPE } from "../../src/lib/run-prompts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EM = String.fromCharCode(0x2014);

test("claudeCliArgs: Haiku at max effort for evaluate and triage only", () => {
  for (const kind of ["evaluate", "triage"]) {
    const args = claudeCliArgs({ kind, prompt: "x" });
    assert.equal(argValue(args, "--model"), "haiku", kind);
    assert.equal(argValue(args, "--effort"), "max", kind);
  }
  for (const kind of ["pdf", "research", "cover", "fix-portal"]) {
    const args = claudeCliArgs({ kind, prompt: "x" });
    assert.equal(args.includes("--model"), false, kind);
    assert.equal(args.includes("--effort"), false, kind);
  }
});

test("triage gets the same read-only network scope as evaluate", () => {
  const triage = claudeCliArgs({ kind: "triage", prompt: "x" });
  const evaluate = claudeCliArgs({ kind: "evaluate", prompt: "x" });
  assert.equal(argValue(triage, "--allowedTools"), argValue(evaluate, "--allowedTools"));
  assert.match(argValue(triage, "--disallowedTools"), /\bWrite\b/);
});

test("localJdPath accepts a plain jds/ file and rejects traversal", () => {
  assert.equal(localJdPath("local:jds/linkedin-post-123.md"), "jds/linkedin-post-123.md");
  assert.equal(localJdPath("local:../x.md"), null);
  assert.equal(localJdPath("local:jds/../cv.md"), null);
  assert.equal(localJdPath("local:jds/a b.md"), null);
  assert.equal(localJdPath("https://example.com"), null);
});

test("resolveWorkerInput: LinkedIn and bot-walled hosts are never fetched", () => {
  const env = { jdFiles: ["linkedin-4483106233-x-team-mobile.md", "linkedin-post-9.md"], needsChromeHosts: parseNeedsChrome("# comment\ncareers.example.org\n") };
  assert.deepEqual(resolveWorkerInput("https://www.linkedin.com/jobs/view/4483106233/", env), { ok: true, jdPath: "jds/linkedin-4483106233-x-team-mobile.md" });
  assert.equal(resolveWorkerInput("https://www.linkedin.com/jobs/view/1111/", env).ok, false);
  assert.equal(resolveWorkerInput("https://www.linkedin.com/feed/update/urn:li:activity:9/", env).ok, false);
  assert.equal(resolveWorkerInput("https://jobs.careers.example.org/1", env).ok, false);
  assert.deepEqual(resolveWorkerInput("https://boards.greenhouse.io/acme/jobs/1", env), { ok: true, jdPath: null });
  assert.deepEqual(resolveWorkerInput("local:jds/linkedin-post-9.md", env), { ok: true, jdPath: "jds/linkedin-post-9.md" });
  assert.equal(resolveWorkerInput("local:jds/missing.md", env).ok, false);
  assert.equal(resolveWorkerInput("local:../cv.md", env).ok, false);
});

test("deriveJobId: post file, then URL patterns, then a plain model id", () => {
  assert.equal(deriveJobId({ jdPath: "jds/linkedin-post-7519416564022951936.md" }), "7519416564022951936");
  assert.equal(deriveJobId({ jdPath: "jds/linkedin-post-share-42.md" }), "42");
  assert.equal(deriveJobId({ urls: ["https://www.linkedin.com/jobs/view/senior-dev-at-acme-4483106233"] }), "4483106233");
  assert.equal(deriveJobId({ urls: ["https://boards.greenhouse.io/acme/jobs/5512345"] }), "5512345");
  assert.equal(deriveJobId({ urls: ["https://jobs.lever.co/acme/0a1b2c3d-1111-2222-3333-444455556666"] }), "0a1b2c3d-1111-2222-3333-444455556666");
  assert.equal(deriveJobId({ urls: ["https://jobs.ashbyhq.com/acme/0a1b2c3d-1111-2222-3333-444455556666"] }), "0a1b2c3d-1111-2222-3333-444455556666");
  assert.equal(deriveJobId({ urls: ["https://zillow.wd5.myworkdayjobs.com/Ext/job/Mexico-City/Senior-Engineer_P751457"] }), "P751457");
  assert.equal(deriveJobId({ urls: ["https://applicants.bairesdev.com/job/46/305081/apply"] }), "305081");
  assert.equal(deriveJobId({ urls: ["https://acme.com/careers/7"], modelId: "REQ-77" }), "REQ-77");
  assert.equal(deriveJobId({ urls: ["https://acme.com/careers/7"], modelId: "a|b" }), null);
});

test("evaluationNotes: job id first, review note always, post note only off the employer site", () => {
  assert.equal(
    evaluationNotes({ jobId: "42", isPost: true, finalUrl: "https://www.linkedin.com/feed/update/urn:li:share:42/" }),
    "job id 42; pending manual review; LinkedIn post, not on employer site",
  );
  assert.equal(
    evaluationNotes({ jobId: "42", isPost: true, finalUrl: "https://acme.com/careers/42" }),
    "job id 42; pending manual review",
  );
  assert.equal(evaluationNotes({ jobId: null, isPost: false, finalUrl: "", postedAt: "2026-10-01" }), "pending manual review; posted: 2026-10-01");
});

test("report and capture fields", () => {
  assert.equal(reportUrlField("**Score:** 3/5\n**URL:** https://acme.com/j/1\n"), "https://acme.com/j/1");
  assert.equal(reportUrlField("**URL:** not a url | x"), null);
  assert.equal(jdSourceUrl("Source: https://www.linkedin.com/feed/update/urn:li:activity:1/\nCompany: ?"), "https://www.linkedin.com/feed/update/urn:li:activity:1/");
});

test("parseTriageLine reads all four examples in modes/triage.md, em-dash removed", () => {
  const md = readFileSync(join(HERE, "..", "..", "..", "modes", "triage.md"), "utf8");
  const examples = md.split("\n").filter((l) => l.startsWith("TRIAGE: ") && !l.includes("{"));
  assert.equal(examples.length, 4);
  const parsed = examples.map(parseTriageLine);
  assert.deepEqual(parsed.map((p) => p?.verdict), ["PASS", "FAIL", "MARGINAL", "SKIP"]);
  assert.deepEqual(parsed.map((p) => p?.score), ["4.3/5", "2.0/5", "3.4/5", "0.0/5"]);
  for (const p of parsed) assert.ok(!p.reason.includes(EM), p.reason);
});

test("parseTriageLine takes the LAST line and refuses text without one", () => {
  assert.equal(parseTriageLine("thinking...\nno verdict here"), null);
  const p = parseTriageLine("TRIAGE: FAIL | A | B | 2/5 | early\nmore\nTRIAGE: PASS | A | B | 4/5 | final");
  assert.deepEqual(p, { verdict: "PASS", score: "4.0/5", reason: "final" });
  assert.equal(triageLabel(p), "PASS 4.0/5 final");
});

const PIPE = `# Pipeline

## Pending
- [ ] local:jds/linkedin-post-1.md | Acme | Android Dev | Remote
- [ ] https://boards.greenhouse.io/acme/jobs/2 | Beta
- [x] https://example.com/done | Done Co | Old

## Processed
- [x] #12 | local:jds/linkedin-post-1.md | Acme | Android Dev
`;

test("applyInboxSkip accepts local:jds rows and still refuses traversal", () => {
  const r = applyInboxSkip(PIPE, "local:jds/linkedin-post-1.md", true);
  assert.equal(r.ok, true);
  assert.equal(r.changed, 1);
  assert.match(r.text, /- \[x\] local:jds\/linkedin-post-1\.md \| Acme/);
  assert.equal(applyInboxSkip(PIPE, "local:../x.md", true).error, "invalid-url");
});

test("applyInboxLabel writes, replaces on re-triage, pads short rows, never em-dash", () => {
  const first = applyInboxLabel(PIPE, "local:jds/linkedin-post-1.md", "triage", `PASS 4.0/5 good ${EM} remote`);
  assert.equal(first.ok, true);
  const again = applyInboxLabel(first.text, "local:jds/linkedin-post-1.md", "triage", "FAIL 2.0/5 onsite");
  const row = again.text.split("\n").find((l) => l.includes("linkedin-post-1") && l.startsWith("- [ ]"));
  assert.equal(row, "- [ ] local:jds/linkedin-post-1.md | Acme | Android Dev | Remote | triage: FAIL 2.0/5 onsite");
  assert.ok(!first.text.includes(EM));

  const short = applyInboxLabel(PIPE, "https://boards.greenhouse.io/acme/jobs/2", "triage", "MARGINAL 3.2/5 ok");
  const jobs = parseInbox(short.text);
  const beta = jobs.find((j) => j.url.endsWith("/jobs/2"));
  assert.equal(beta.company, "Beta");
  assert.equal(beta.location, undefined);
  assert.equal(beta.triage, "MARGINAL 3.2/5 ok");

  assert.equal(applyInboxLabel(PIPE, "local:../x", "triage", "PASS").error, "invalid-url");
  assert.equal(applyInboxLabel(PIPE, "https://nope.example/1", "triage", "PASS").error, "unmatched");
});

test("a restored pre-triage drop loses its closed label and is kept out of re-checks", () => {
  const url = "local:jds/linkedin-post-1.md";
  const closed = applyInboxLabel(applyInboxSkip(PIPE, url, true).text, url, "closed", "pre-triage: residency");
  const reopened = applyInboxSkip(closed.text, url, false).text;
  const cleared = applyInboxLabel(reopened, url, "closed", null);
  const restored = applyInboxLabel(cleared.text, url, "pretriage", "pass (restored by the engineer)");
  const row = restored.text.split("\n").find((l) => l.includes("linkedin-post-1") && l.startsWith("- [ ]"));
  assert.equal(row, "- [ ] local:jds/linkedin-post-1.md | Acme | Android Dev | Remote | pretriage: pass (restored by the engineer)");
  const job = parseInbox(restored.text).find((j) => j.url === url);
  assert.equal(job.pretriaged, true);
  assert.equal(job.pretriageKept, true);
  assert.equal(parseInbox(PIPE).find((j) => j.url === url).pretriageKept, undefined);
});

test("setInboxLabel writes the file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lifecycle-"));
  try {
    const file = join(dir, "pipeline.md");
    writeFileSync(file, PIPE);
    const r = await setInboxLabel(file, "local:jds/linkedin-post-1.md", "triage", "PASS 3.9/5 fits");
    assert.equal(r.ok, true);
    assert.match(readFileSync(file, "utf8"), /\| triage: PASS 3\.9\/5 fits$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const row = (n, status, score, notes = "", date = "2026-10-20") => ({ n, status, score, notes, date });

test("isApproved needs Evaluated AND the APPROVED note", () => {
  assert.equal(isApproved(row("1", "Evaluated", "3.0/5", "APPROVED: will apply (not applied yet)")), true);
  assert.equal(isApproved(row("2", "Applied", "3.0/5", "APPROVED: will apply (not applied yet)")), false);
  // Older notes name who approved.
  assert.equal(isApproved(row("4", "Evaluated", "3.0/5", "job id 7; APPROVED by Ana: will apply (not applied yet)")), true);
  assert.equal(isApproved(row("3", "Evaluated", "3.0/5", "")), false);
});

test("approved rows leave the awaiting list before the 6-row cut and are never cut", () => {
  const approvedNote = "APPROVED: will apply (not applied yet)";
  const rows = [
    ...Array.from({ length: 6 }, (_, i) => row(String(i + 1), "Evaluated", "4.5/5")),
    row("7", "Evaluated", "2.0/5", approvedNote),
    row("8", "Applied", "4.9/5", approvedNote),
  ];
  const scoreOf = (s) => parseFloat(s);
  assert.deepEqual(pickApproved(rows, scoreOf).map((r) => r.n), ["7"]);
  assert.ok(!pickAwaitingDecision(rows, scoreOf).some((r) => r.n === "7"));
});

test("todaySnapshot ships approved rows to Today (they left the awaiting list)", async () => {
  const { todaySnapshot } = await import("../../src/lib/home/today-snapshot.mjs");
  const approvedRow = row("54", "Evaluated", "2.3/5", "APPROVED: will apply (not applied yet)");
  const snap = todaySnapshot({ applications: [approvedRow, row("1", "Evaluated", "4.0/5")], inbox: [] }, (s) => parseFloat(s));
  assert.deepEqual(snap.applications.map((r) => r.n).sort(), ["1", "54"]);
});

test("evaluate and triage prompts carry the house-rules scope; a jds input never fetches LinkedIn", () => {
  const base = { input: "local:jds/linkedin-post-1.md", memory: "", today: "2026-10-24", jdPath: "jds/linkedin-post-1.md" };
  for (const kind of ["evaluate", "triage"]) {
    const prompt = buildPrompt({ ...base, kind, triageThreshold: 3.5 });
    assert.ok(prompt.includes(HOUSE_RULES_SCOPE), kind);
    assert.match(prompt, /NEVER fetch LinkedIn/, kind);
    assert.match(prompt, /jds\/linkedin-post-1\.md/, kind);
  }
  assert.match(buildPrompt({ ...base, kind: "triage", triageThreshold: 3.8 }), /triage_threshold is 3\.8/);
});

test("an unwrapped but complete report is recovered; anything else still fails", async () => {
  const { parseReportEnvelope } = await import("../../src/lib/report-envelope.mjs");
  const report = "# Evaluation: Acme - Android Dev\n\n**URL:** https://acme.com/1\n\n## Machine Summary\n```yaml\ncompany: \"Acme\"\nrole: \"Android Dev\"\nscore: 3.5\n```";
  const got = parseReportEnvelope(`Notes before the report.\n\n${report}\n\nVERDICT: 3.5/5, ok`);
  assert.equal(got.ok, true);
  assert.equal(got.recovered, true);
  assert.equal(got.markdown, report);
  assert.equal(parseReportEnvelope("# Evaluation: Acme - X\n\nno summary\nVERDICT: 1/5").ok, false);
  assert.equal(parseReportEnvelope("VERDICT: 4.2/5 no envelope here").ok, false);
});

test("shouldRetryRun: once, only for Haiku runs that ended with nothing to save", async () => {
  const { shouldRetryRun } = await import("../../src/lib/lifecycle.mjs");
  const noReport = "This evaluation didn't produce a report to save, so it isn't in your tracker.";
  assert.equal(shouldRetryRun("evaluate", noReport, 0), true);
  assert.equal(shouldRetryRun("evaluate", noReport, 1), false);
  assert.equal(shouldRetryRun("triage", "The triage ended without a TRIAGE: line, so nothing was saved.", 0), true);
  assert.equal(shouldRetryRun("pdf", noReport, 0), false);
  assert.equal(shouldRetryRun("evaluate", "The CLI exited with an error", 0), false);
});

test("stripEmDash", () => {
  assert.equal(stripEmDash(`a ${EM} b`), "a, b");
});

test("status moves are forward-only, one step, Discarded always while open", async () => {
  const { nextStatuses } = await import("../../src/lib/lifecycle.mjs");
  assert.deepEqual(nextStatuses("EVALUATED"), ["Discarded"]);
  assert.deepEqual(nextStatuses("APPLIED"), ["Responded", "Rejected", "Discarded"]);
  assert.deepEqual(nextStatuses("INTERVIEW"), ["Offer", "Rejected", "Discarded"]);
  for (const closed of ["HIRED", "REJECTED", "DISCARDED", "SKIP"]) assert.deepEqual(nextStatuses(closed), []);
});

test("a saved triage label splits back into verdict, score and reason", async () => {
  const { splitTriageLabel, triageLabel } = await import("../../src/lib/lifecycle.mjs");
  const label = triageLabel({ verdict: "MARGINAL", score: "3.1/5", reason: "Worldwide remote, AI/API work fits." });
  assert.deepEqual(splitTriageLabel(label), { verdict: "MARGINAL", score: 3.1, reason: "Worldwide remote, AI/API work fits." });
  assert.deepEqual(splitTriageLabel("FAIL 2/5"), { verdict: "FAIL", score: 2, reason: "" });
  assert.deepEqual(splitTriageLabel("something odd"), { verdict: null, score: null, reason: "something odd" });
});

test("a pasted JD for the same posting URL is used instead of fetching, on any host", async () => {
  const { resolveWorkerInput, sameUrl, jdSourceLine, pastedJdMarkdown } = await import("../../src/lib/lifecycle.mjs");
  const md = pastedJdMarkdown({ url: "https://parser.bamboohr.com/careers/502", company: "Parser", role: "Fullstack", text: "Build things.", date: "2026-10-25" });
  assert.equal(jdSourceLine(md), "https://parser.bamboohr.com/careers/502");
  assert.match(md, /untrusted posting text/);
  const jdSources = [{ file: "pasted-parser-502.md", source: jdSourceLine(md) }];
  assert.deepEqual(
    resolveWorkerInput("https://Parser.bamboohr.com/careers/502/", { jdFiles: ["pasted-parser-502.md"], needsChromeHosts: [], jdSources }),
    { ok: true, jdPath: "jds/pasted-parser-502.md" },
  );
  // Even a host that blocks scripts goes through once its JD is pasted.
  const blocked = [{ file: "x.md", source: "https://himalayas.app/companies/a/jobs/b" }];
  assert.deepEqual(
    resolveWorkerInput("https://himalayas.app/companies/a/jobs/b", { jdFiles: ["x.md"], needsChromeHosts: ["himalayas.app"], jdSources: blocked }),
    { ok: true, jdPath: "jds/x.md" },
  );
  // No paste: the old rules still apply.
  assert.equal(resolveWorkerInput("https://himalayas.app/companies/a/jobs/b", { jdFiles: [], needsChromeHosts: ["himalayas.app"] }).ok, false);
  assert.equal(sameUrl("https://a.test/x?id=1", "https://a.test/x?id=2"), false);
});

// House rule 25: hiring phases are a status plus a "STAGE: <Phase> <round>" note.
// A block, so this tracker-row helper does not clash with the awaiting tests' `row`.
{
const row = (status, notes = "", n = 1) => ({ n, status, notes });

test("phases: the round lives in the note; a legacy bare note and a note-less status are round 1", async () => {
  const { currentPhase, nextRound, phaseNote } = await import("../../src/lib/lifecycle.mjs");
  assert.equal(phaseNote("tech", 2), "STAGE: Tech interview 2");
  assert.equal(phaseNote("offer"), "STAGE: Offer");
  assert.equal(phaseNote("replied"), null);
  assert.deepEqual(currentPhase(row("Responded", "job id 1; STAGE: Screening")), { phase: "screening", round: 1 });
  assert.deepEqual(currentPhase(row("Responded", "STAGE: Screening 1; STAGE: Screening 2")), { phase: "screening", round: 2 });
  // set-status will not append the same note twice, so the next round must be a new number.
  assert.equal(nextRound(row("Responded", "STAGE: Screening 1"), "screening"), 2);
  // A bare Assessment row is round 1, so its first repeat writes round 2.
  assert.deepEqual(currentPhase(row("Assessment")), { phase: "assessment", round: 1 });
  assert.equal(nextRound(row("Assessment"), "assessment"), 2);
});

test("phases: the current phase follows the row's status; bare Interview reads as Tech interview", async () => {
  const { currentPhase } = await import("../../src/lib/lifecycle.mjs");
  assert.deepEqual(currentPhase(row("Interview", "STAGE: Screening 1; STAGE: Final interview 1")), { phase: "final", round: 1 });
  // A Screening note on a row that later became Interview without a phase note is stale.
  assert.deepEqual(currentPhase(row("Interview", "STAGE: Screening 1")), { phase: "tech", round: 1 });
  assert.deepEqual(currentPhase(row("Responded")), { phase: "replied", round: 1 });
  assert.equal(currentPhase(row("Evaluated")), null);
});

test("phases: moves are forward, may skip, repeat only the five round phases, and never target Applied", async () => {
  const { nextPhases } = await import("../../src/lib/lifecycle.mjs");
  assert.deepEqual(nextPhases(row("Applied")), ["replied", "screening", "assessment", "tech", "manager", "final", "offer", "hired"]);
  assert.deepEqual(nextPhases(row("Responded", "STAGE: Screening 1")).slice(0, 2), ["screening", "assessment"]);
  assert.equal(nextPhases(row("Responded")).includes("replied"), false);
  assert.deepEqual(nextPhases(row("Offer", "STAGE: Offer")), ["hired"]);
  for (const status of ["Evaluated", "Rejected", "Discarded", "SKIP", "Hired"]) assert.deepEqual(nextPhases(row(status)), [], status);
});

test("phases: the path is what the row went through, capped at its level", async () => {
  const { phasePath } = await import("../../src/lib/lifecycle.mjs");
  // A web move Screening -> Final writes ledger Responded -> Interview; that must not invent Tech.
  assert.deepEqual(
    phasePath(row("Interview", "STAGE: Screening 1; STAGE: Final interview 1", 9), [{ num: 9, from: "Responded", to: "Interview" }]),
    ["applied", "replied", "screening", "final"],
  );
  // #54's mistaken ledger Interview row cannot push it past the Screening tab.
  assert.deepEqual(
    phasePath(row("Responded", "STAGE: Screening", 54), [{ num: 54, from: "Applied", to: "Interview" }, { num: 54, from: "Interview", to: "Responded" }]),
    ["applied", "replied", "screening"],
  );
  // Applied straight to Assessment: the company replied by sending it.
  assert.deepEqual(phasePath(row("Assessment", "STAGE: Assessment 1", 3)), ["applied", "replied", "assessment"]);
  assert.deepEqual(phasePath(row("Evaluated", "", 4)), []);
});

test("exits: the OUTCOME note first, then legacy rules for closed rows without one", async () => {
  const { exitNote, exitOutcome, outcomeText } = await import("../../src/lib/lifecycle.mjs");
  assert.equal(exitNote("closed", "screening", 1), "OUTCOME: Posting closed at Screening 1");
  const rejected = row("Rejected", "STAGE: Tech interview 2; OUTCOME: Rejected at Tech interview 2", 5);
  assert.deepEqual(exitOutcome(rejected), { kind: "rejected", phase: "tech", round: 2 });
  assert.equal(outcomeText(rejected), "Rejected after Tech interview 2");
  assert.equal(outcomeText(row("Discarded", "OUTCOME: Ghosted at Applied", 6)), "Ghosted after Applied");
  // Legacy: no-note Rejected, a repeated row, a Discarded applied row, a row closed before applying.
  assert.equal(exitOutcome(row("Rejected", "", 7), [{ num: 7, from: "Applied", to: "Rejected" }]).kind, "rejected");
  assert.equal(exitOutcome(row("Discarded", "repeated: same posting as #3", 8), [{ num: 8, from: "Applied", to: "Discarded" }]).kind, "repeated");
  assert.deepEqual(exitOutcome(row("Discarded", "", 9), [{ num: 9, from: "Responded", to: "Discarded" }]), { kind: "closed", phase: "replied", round: 1 });
  assert.deepEqual(exitOutcome(row("Discarded", "", 10), [{ num: 10, from: "Evaluated", to: "Discarded" }]), { kind: "discarded", phase: null, round: 1 });
  assert.equal(exitOutcome(row("Responded")), null);
});

test("dates: the @ date sits after the round and never leaks into the round or the next note", async () => {
  const { currentMark, currentPhase, datedNote, phaseNote, stageMarks } = await import("../../src/lib/lifecycle.mjs");
  const at = "2026-10-29T10:00-06:00";
  assert.equal(phaseNote("tech", 2, at), `STAGE: Tech interview 2 @ ${at}`);
  const dated = row("Interview", `job id 1; STAGE: Tech interview 2 @ ${at}; foo`);
  assert.deepEqual(currentPhase(dated), { phase: "tech", round: 2 });
  assert.deepEqual(currentMark(dated), { phase: "tech", round: 2, at, text: `STAGE: Tech interview 2 @ ${at}` });
  // A following OUTCOME note is its own note, not part of the date.
  const closed = stageMarks(`STAGE: Screening 1 @ ${at}; OUTCOME: Rejected at Screening 1`);
  assert.equal(closed[0].at, at);
  // The note text is the whole note, suffix included, for set-status --replace-note.
  const suffixed = row("Responded", "STAGE: Screening 1 (call)");
  assert.equal(currentMark(suffixed).text, "STAGE: Screening 1 (call)");
  // Dating a suffixed or round-less note reads back the same date.
  for (const text of ["STAGE: Screening 1 (call)", "STAGE: Screening"]) {
    const note = datedNote(text, at);
    assert.equal(currentMark(row("Responded", note)).at, at, note);
    assert.equal(datedNote(note, null), text);
  }
  assert.equal(datedNote("STAGE: Screening 1 (call)", at), `STAGE: Screening 1 @ ${at} (call)`);
  // A bare status has no mark text.
  assert.deepEqual(currentMark(row("Assessment")), { phase: "assessment", round: 1, at: null, text: null });
});
}
