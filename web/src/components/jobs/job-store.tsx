"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { scoreTone } from "@/lib/format";
import { resolveCliId } from "@/lib/saved-cli";
import { createWorkerFeedback } from "@/lib/worker-feedback.mjs";
import { readJobStream } from "@/lib/job-stream.mjs";
import { HAIKU_KINDS, shouldRetryRun } from "@/lib/lifecycle.mjs";

export type JobStep = { kind: "tool" | "status"; label: string; ts: number };
export type JobResult = { score: number | null; summary: string; tone: "good" | "warn" | "bad" | "muted" };

export type Job = {
  id: string;
  title: string;
  subtitle?: string;
  page?: string; // route the job was launched from / refers to
  input?: string; // the URL/posting it processed (links inbox rows to their worker)
  kind?: string;
  batchId?: string; // groups jobs fired together (e.g. "evaluate all Anthropic")
  status: "running" | "done" | "error";
  steps: JobStep[];
  text: string;
  result?: JobResult;
  cost?: { tokens: number; usd?: number }; // per-run token cost (Claude result event) — local only
  reportN?: number | null;
  startedAt: number;
  endedAt?: number;
  /** Owned by the server (lib/live-runs.ts): its log is polled from /api/live-runs/<id>. */
  remote?: boolean;
  /** Who started a server-owned run: "web" or "chat". */
  source?: string;
};

/** The list view /api/live-runs returns (live-run-state.mjs runSummary). */
type LiveRunSummary = {
  id: string; kind: string; input: string; title: string; subtitle: string; source: string;
  status: "queued" | "running" | "done" | "error"; verdictLine: string; lastStep: string;
  startedAt: number; endedAt: number | null; tokens: number | null; costUsd: number | null; reportN: number | null; error: string | null;
};

type StartOpts = { title: string; subtitle?: string; kind: string; input: string; page?: string; batchId?: string; brief?: Record<string, string>; attempt?: number };

type Ctx = {
  jobs: Job[];
  startJob: (opts: StartOpts) => string | null;
  removeJob: (id: string) => void;
  clearFinished: () => void;
};

const JobsContext = createContext<Ctx | null>(null);
export function useJobs() {
  const c = useContext(JobsContext);
  if (!c) throw new Error("useJobs must be used within <JobsProvider>");
  return c;
}

const JOBS_KEY = "career-ops:jobs";
const DISMISSED_KEY = "career-ops:dismissed-runs";

/** A server-owned run as a Job; the step log stays on the server (/jobs/<id> polls it). */
function jobFromRun(run: LiveRunSummary): Job {
  const finished = run.status === "done" || run.status === "error";
  return {
    id: run.id,
    title: run.title,
    subtitle: run.subtitle || undefined,
    page: "/pipeline",
    input: run.input,
    kind: run.kind,
    status: run.status === "done" ? "done" : run.status === "error" ? "error" : "running",
    steps: [{ kind: "status", label: run.lastStep || (run.status === "queued" ? "Queued" : "Starting"), ts: run.endedAt ?? run.startedAt }],
    text: "",
    result: finished && run.status === "done" ? parseVerdict(run.verdictLine) : undefined,
    cost: run.tokens ? { tokens: run.tokens, usd: run.costUsd ?? undefined } : undefined,
    reportN: run.reportN,
    startedAt: run.startedAt,
    endedAt: run.endedAt ?? undefined,
    remote: true,
    source: run.source,
  };
}

function parseVerdict(text: string): JobResult {
  const m = text.match(/VERDICT:\s*([\d.]+)\s*\/\s*5\s*[—:|-]+\s*(.+)/i);
  if (m) {
    const score = parseFloat(m[1]);
    return { score, summary: m[2].trim().replace(/\s+/g, " ").slice(0, 90), tone: scoreTone(`${score}`) };
  }
  const s = text.match(/\b([0-5](?:\.\d)?)\s*\/\s*5\b/);
  if (s) {
    const score = parseFloat(s[1]);
    return { score, summary: "", tone: scoreTone(`${score}`) };
  }
  return { score: null, summary: "", tone: "muted" };
}

export function JobsProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const feedback = useRef<ReturnType<typeof createWorkerFeedback> | null>(null);
  useEffect(() => {
    const owner = createWorkerFeedback(setAnnouncement);
    feedback.current = owner;
    return () => { owner.dispose(); feedback.current = null; };
  }, []);
  const seq = useRef(0);
  const startRef = useRef<((opts: StartOpts) => string | null) | null>(null);
  const loaded = useRef(false);

  // restore history
  useEffect(() => {
    try {
      const raw = localStorage.getItem(JOBS_KEY);
      const arr = raw ? JSON.parse(raw) : null;
      if (Array.isArray(arr)) {
        // anything left "running" from a previous session is stale → mark interrupted;
        // a server-owned run is not: the poller below brings its real state.
        setJobs(arr.map((j: Job) => (j.status === "running" && !j.remote ?{ ...j, status: "error", steps: [...(j.steps || []), { kind: "status", label: "Interrupted (page reloaded)", ts: Date.now() }] } : j)));
      }
    } catch {
      /* ignore */
    }
    loaded.current = true;
  }, []);

  // persist
  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(JOBS_KEY, JSON.stringify(jobs.slice(0, 40)));
    } catch {
      /* quota */
    }
  }, [jobs]);

  const patch = useCallback((id: string, fn: (j: Job) => Job) => {
    setJobs((js) => js.map((j) => (j.id === id ? fn(j) : j)));
  }, []);

  // Server-owned runs (triage/evaluate from this page, another tab, or a chat
  // session): poll the server's list, adopt runs this page has not seen, and
  // follow their status. Fast while something runs, slow when idle.
  const dismissed = useRef<Set<string>>(new Set());
  const pollNow = useRef<() => void>(() => {});
  const jobsRef = useRef<Job[]>([]);
  jobsRef.current = jobs;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DISMISSED_KEY);
      if (raw) dismissed.current = new Set(JSON.parse(raw) as string[]);
    } catch {
      /* a fresh list */
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let running = false;
      try {
        const response = await fetch("/api/live-runs", { cache: "no-store" });
        const { runs } = (await response.json()) as { runs: LiveRunSummary[] };
        if (!alive || !Array.isArray(runs)) return;
        const before = new Map(jobsRef.current.map((j) => [j.id, j]));
        for (const run of runs) {
          if (dismissed.current.has(run.id)) continue;
          const next = jobFromRun(run);
          const previous = before.get(run.id);
          if (next.status === "running") running = true;
          if (previous && previous.status === "running" && next.status !== "running") {
            feedback.current?.push(next);
            // Tell server-snapshot surfaces (Today, pipeline) to refetch.
            if (next.status === "done") window.dispatchEvent(new CustomEvent("co-job-done", { detail: { kind: run.kind, input: run.input } }));
          }
        }
        setJobs((js) => {
          const byId = new Map(js.map((j) => [j.id, j]));
          const adopted: Job[] = [];
          for (const run of runs) {
            if (dismissed.current.has(run.id)) continue;
            const current = byId.get(run.id);
            if (!current) adopted.push(jobFromRun(run));
            else if (current.remote) byId.set(run.id, { ...current, ...jobFromRun(run), text: current.text });
          }
          return [...adopted, ...js.map((j) => byId.get(j.id) ?? j)].sort((a, b) => b.startedAt - a.startedAt);
        });
      } catch {
        // Offline or restarting: try again on the next tick.
      } finally {
        if (timer) clearTimeout(timer);
        if (alive) timer = setTimeout(poll, running ? 2000 : 8000);
      }
    };
    pollNow.current = () => void poll();
    void poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const startJob = useCallback(
    (opts: StartOpts): string | null => {
      const id = `job-${Date.now()}-${seq.current++}`;
      const job: Job = {
        id,
        title: opts.title,
        subtitle: opts.subtitle,
        page: opts.page,
        input: opts.input,
        kind: opts.kind,
        batchId: opts.batchId,
        status: "running",
        steps: [{ kind: "status", label: "Starting…", ts: Date.now() }],
        text: "",
        startedAt: Date.now(),
      };
      // A new run of the same kind on the same posting continues that work (a
      // re-run, or a retry after pasting the JD): finished earlier runs of it
      // leave the list rather than stacking up next to the new one.
      const replaced = new Set(jobsRef.current.filter((j) => j.kind === opts.kind && j.input === opts.input && j.status !== "running").map((j) => j.id));
      if (replaced.size > 0) {
        for (const old of replaced) dismissed.current.add(old);
        try {
          localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed.current].slice(-200)));
        } catch {
          /* quota */
        }
      }
      setJobs((js) => [job, ...js.filter((j) => !replaced.has(j.id))]);

      // Declared before resolveCliId() so its stale-CLI notice lands in the log
      // sent to /api/runs/save, not only in the live job.
      const steps: JobStep[] = [];
      (async () => {
        // resolveCliId() validates the saved id against what is installed; a
        // bare readSavedCliId() here would short-circuit that check and launch
        // a run against an uninstalled CLI (#4012).
        // A stale saved id is replaced silently otherwise — name the switch in
        // the job log so a transient "not installed" can't rewrite the user's
        // choice without a record.
        const cliId = await resolveCliId((stale, replacement) => {
          const label = replacement
            ? `Saved CLI '${stale}' is not installed, using '${replacement}'`
            : `Saved CLI '${stale}' is not installed`;
          const step: JobStep = { kind: "status", label, ts: Date.now() };
          steps.push(step);
          patch(id, (j) => ({ ...j, steps: [...j.steps, step] }));
        });
        if (!cliId) {
          feedback.current?.push({ ...job, status: "error" });
          patch(id, (j) => ({
            ...j,
            status: "error",
            endedAt: Date.now(),
            steps: [...j.steps, { kind: "status", label: "No CLI configured. Open Config and click Save config", ts: Date.now() }],
          }));
          return;
        }
        let text = "";
        let verdictLine = ""; // latched separately so the 8000-char tail can't drop it
        let doneTokens = 0; // per-run token cost, forwarded on the done event (#6)
        let doneCostUsd: number | null = null;
        let doneReportN: number | null = null;
        let finished = false;
        const finish = (status: "done" | "error", lastLabel?: string) => {
          if (finished) return;
          finished = true;
          feedback.current?.push({ ...job, status });
          const result = status === "done" ? parseVerdict(verdictLine || text) : undefined;
          const cost = status === "done" && doneTokens > 0 ? { tokens: doneTokens, usd: doneCostUsd ?? undefined } : undefined;
          patch(id, (j) => ({
            ...j,
            status,
            result,
            cost,
            reportN: doneReportN,
            endedAt: Date.now(),
            steps: lastLabel ? [...j.steps, { kind: "status", label: lastLabel, ts: Date.now() }] : j.steps,
          }));
          // persist a readable log file so the CLI/assistant can read past runs;
          // failed runs too, so a missing report can be diagnosed afterwards
          fetch("/api/runs/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, title: status === "done" ? opts.title : `${opts.title} (failed: ${lastLabel ?? "error"})`, subtitle: opts.subtitle, page: opts.page, input: opts.input, result, cost, steps, output: text }),
          }).catch(() => {});
          // Carlos's Haiku triage/evaluate must finish: one automatic retry when
          // the run ended with nothing to save.
          const attempt = opts.attempt ?? 0;
          if (status === "error" && shouldRetryRun(opts.kind, lastLabel, attempt)) {
            patch(id, (j) => ({ ...j, steps: [...j.steps, { kind: "status", label: "Retrying once", ts: Date.now() }] }));
            startRef.current?.({ ...opts, title: `${opts.title} (retry)`, attempt: attempt + 1 });
          }
          if (status === "done") {
            // Tell server-snapshot surfaces (Today, pipeline) to refetch — the
            // worker just wrote a real tracker row / report they don't yet see.
            if (typeof window !== "undefined" && (opts.kind === "evaluate" || opts.kind === "pdf" || opts.kind === "triage")) {
              window.dispatchEvent(new CustomEvent("co-job-done", { detail: { kind: opts.kind, input: opts.input } }));
            }
          }
        };

        // House rule 16: triage and evaluate run server-owned, so they finish
        // without this tab and show up in every browser; the poller follows them
        // and the server does the retry and the run log.
        if (HAIKU_KINDS.includes(opts.kind)) {
          try {
            const res = await fetch("/api/run", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ detach: true, runId: id, kind: opts.kind, input: opts.input, cliId, brief: opts.brief, title: opts.title, subtitle: opts.subtitle, source: "web" }),
            });
            const started = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
            if (!res.ok || !started.id) {
              finish("error", started.error || "Failed to start");
              return;
            }
            // Joined a run already going for this posting: show that one instead.
            if (started.id !== id) setJobs((js) => js.filter((j) => j.id !== id));
            else patch(id, (j) => ({ ...j, remote: true, source: "web" }));
            pollNow.current();
          } catch {
            finish("error", "Connection error");
          }
          return;
        }

        try {
          const res = await fetch("/api/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: opts.kind, input: opts.input, cliId, brief: opts.brief }),
          });
          if (!res.ok || !res.body) {
            const e = await res.json().catch(() => ({}));
            finish("error", e.error || "Failed to start");
            return;
          }
          const completion = await readJobStream(res.body, (ev) => {
            if (ev.type === "tool") {
              steps.push({ kind: "tool", label: ev.name, ts: Date.now() });
              patch(id, (j) => ({ ...j, steps: [...j.steps, { kind: "tool", label: ev.name, ts: Date.now() }] }));
            } else if (ev.type === "status") {
              steps.push({ kind: "status", label: ev.label, ts: Date.now() });
              patch(id, (j) => ({ ...j, steps: [...j.steps, { kind: "status", label: ev.label, ts: Date.now() }] }));
            } else if (ev.type === "text") {
              const full = text + ev.text;
              const vm = full.match(/VERDICT:[^\n]*/i);
              if (vm) verdictLine = vm[0];
              text = full.slice(-8000);
              patch(id, (j) => ({ ...j, text }));
            }
          });
          if (completion.status === "error") {
            finish("error", completion.message);
            return;
          }
          doneTokens = completion.tokens ?? 0;
          doneCostUsd = completion.costUsd ?? null;
          doneReportN = typeof completion.reportN === "number" ? completion.reportN : null;
          finish("done", "Done");
        } catch {
          finish("error", "Connection error");
        }
      })();

      return id;
    },
    [patch],
  );
  // Lets a finished job start its own retry without startJob depending on itself.
  startRef.current = startJob;

  // A dismissed server-owned run stays dismissed, or the poller would adopt it again.
  const dismiss = useCallback((ids: string[]) => {
    for (const id of ids) dismissed.current.add(id);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed.current].slice(-200)));
    } catch {
      /* quota */
    }
  }, []);
  const removeJob = useCallback((id: string) => {
    dismiss([id]);
    setJobs((js) => js.filter((j) => j.id !== id));
  }, [dismiss]);
  const clearFinished = useCallback(() => {
    dismiss(jobsRef.current.filter((j) => j.status !== "running").map((j) => j.id));
    setJobs((js) => js.filter((j) => j.status === "running"));
  }, [dismiss]);

  return (
    <JobsContext.Provider value={{ jobs, startJob, removeJob, clearFinished }}>
      {children}
      <div role="status" aria-label="Worker task status" aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</div>
    </JobsContext.Provider>
  );
}
