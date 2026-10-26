// Server-owned triage/evaluate runs (house rule 16). A run started from the web
// or from a chat session (my-tools/run-job.mjs) is owned by this server process:
// it reads /api/run's own stream to the end, so it finishes and saves even with
// no browser attached, and its snapshot lives in .career-ops-web/live/ where
// every browser can poll it. At most MAX_ACTIVE Haiku runs go at once; the rest
// wait their turn instead of starting dozens of `claude -p` processes.
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { readJobStream } from "@/lib/job-stream.mjs";
import { shouldRetryRun } from "@/lib/lifecycle.mjs";
import { writeRunLog } from "@/lib/run-log.mjs";
import { addStatus, applyRunEvent, newRunSnapshot, runSummary, settleOrphan, type RunSnapshot } from "@/lib/live-run-state.mjs";

// Raised from 3 on 2026-10-25 at Carlos's request: Haiku runs are cheap.
const MAX_ACTIVE = 6;
const LIST_LIMIT = 40;

type Registry = { runs: Map<string, RunSnapshot>; active: number; waiting: (() => void)[] };
// On globalThis so dev hot reloads keep the runs this process still owns.
const registry: Registry = ((globalThis as { __careerOpsLiveRuns?: Registry }).__careerOpsLiveRuns ??= {
  runs: new Map(),
  active: 0,
  waiting: [],
});

const liveDir = () => path.join(careerOpsRoot(), ".career-ops-web", "live");
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

export function safeRunId(value: unknown): string | null {
  return typeof value === "string" && SAFE_ID.test(value) ? value : null;
}

function save(run: RunSnapshot): RunSnapshot {
  registry.runs.set(run.id, run);
  try {
    fs.mkdirSync(liveDir(), { recursive: true });
    fs.writeFileSync(path.join(liveDir(), `${run.id}.json`), JSON.stringify(run));
  } catch (error) {
    // The in-memory snapshot still serves this process; only restart history is lost.
    console.error(`[live-runs] could not persist ${run.id}:`, error);
  }
  return run;
}

function update(id: string, change: (run: RunSnapshot) => RunSnapshot): RunSnapshot | null {
  const run = registry.runs.get(id);
  return run ? save(change(run)) : null;
}

function readFromDisk(id: string): RunSnapshot | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(liveDir(), `${id}.json`), "utf8")) as RunSnapshot;
  } catch {
    return null;
  }
}

export function getLiveRun(id: string): RunSnapshot | null {
  const safe = safeRunId(id);
  if (!safe) return null;
  const run = registry.runs.get(safe) ?? readFromDisk(safe);
  return run ? settleOrphan(run, registry.runs.has(safe), Date.now()) : null;
}

/** The most recent runs, newest first, as summaries (no text or step log). */
export function listLiveRuns() {
  let files: string[] = [];
  try {
    files = fs.readdirSync(liveDir()).filter((name) => name.endsWith(".json"));
  } catch {
    // No run yet: an empty list.
  }
  const runs = files
    .map((name) => getLiveRun(name.slice(0, -".json".length)))
    .filter((run): run is RunSnapshot => run !== null)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, LIST_LIMIT);
  return runs.map(runSummary);
}

/** A run of this kind for this input that has not finished yet, if any. */
function activeRunFor(kind: string, input: string): RunSnapshot | null {
  for (const run of registry.runs.values()) {
    if (run.kind === kind && run.input === input && (run.status === "queued" || run.status === "running")) return run;
  }
  return null;
}

async function takeSlot(): Promise<void> {
  if (registry.active < MAX_ACTIVE) {
    registry.active += 1;
    return;
  }
  await new Promise<void>((resolve) => registry.waiting.push(resolve));
}

function releaseSlot(): void {
  registry.active -= 1;
  // Fill every free slot, so raising MAX_ACTIVE also starts runs already waiting.
  while (registry.active < MAX_ACTIVE && registry.waiting.length > 0) {
    registry.active += 1;
    registry.waiting.shift()?.();
  }
}

function verdictResult(line: string): { score: number | null; summary: string } | null {
  const score = line.match(/([0-5](?:\.\d+)?)\s*\/\s*5/);
  return score ? { score: Number(score[1]), summary: line.slice(0, 160) } : null;
}

export type DetachedRunRequest = {
  id: string;
  kind: string;
  input: string;
  title: string;
  subtitle?: string;
  source?: string;
  body: Record<string, unknown>;
};

/**
 * Starts (or joins) a server-owned run and returns its id at once.
 * `launch` runs one attempt through /api/run's normal streaming path.
 */
export function startDetachedRun(request: DetachedRunRequest, launch: (body: Record<string, unknown>) => Promise<Response>): string {
  const existing = activeRunFor(request.kind, request.input);
  if (existing) return existing.id;

  save(newRunSnapshot(request, Date.now()));
  void (async () => {
    await takeSlot();
    try {
      for (let attempt = 0; ; attempt += 1) {
        update(request.id, (run) => addStatus({ ...run, status: "running", error: null }, attempt ? "Retrying once" : "Starting", Date.now()));
        const message = await runAttempt(request, launch);
        if (message === null || !shouldRetryRun(request.kind, message, attempt)) break;
      }
    } catch (error) {
      update(request.id, (run) => applyRunEvent(run, { type: "error", msg: `Run crashed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200) }, Date.now()));
    } finally {
      releaseSlot();
      const run = registry.runs.get(request.id);
      if (run) {
        writeRunLog(careerOpsRoot(), {
          id: run.id,
          title: run.status === "done" ? run.title : `${run.title} (failed: ${run.error ?? "error"})`,
          subtitle: run.subtitle,
          page: `server run (${run.source})`,
          input: run.input,
          result: verdictResult(run.verdictLine),
          steps: run.steps,
          output: run.text,
        });
      }
    }
  })();
  return request.id;
}

/** One attempt; returns null on success, else the error message. */
async function runAttempt(request: DetachedRunRequest, launch: (body: Record<string, unknown>) => Promise<Response>): Promise<string | null> {
  const response = await launch(request.body);
  if (!response.ok || !response.body) {
    const detail = (await response.json().catch(() => ({}))) as { error?: string };
    const message = detail.error || `Failed to start (${response.status})`;
    update(request.id, (run) => applyRunEvent(run, { type: "error", msg: message }, Date.now()));
    return message;
  }
  const completion = await readJobStream(response.body, (event) => {
    update(request.id, (run) => applyRunEvent(run, event, Date.now()));
  });
  if (completion.status === "error") {
    update(request.id, (run) => applyRunEvent(run, { type: "error", msg: completion.message }, Date.now()));
    return completion.message;
  }
  update(request.id, (run) => applyRunEvent(run, { type: "done", ...completion }, Date.now()));
  return null;
}
