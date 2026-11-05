"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Undo2 } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import type { InboxJob } from "@/lib/landing-gear";
import type { AtsSource } from "@/lib/explore";
import { daysSince, sourceFromUrl } from "@/lib/inbox";
import { TriageRow, type RowScore } from "./triage-row";
import { ShortlistTray, type ShortItem } from "./shortlist-tray";
import { cn } from "@/lib/cn";
import { estimateRunCost } from "@/lib/run-cost-estimate.mjs";
import { createInboxSkipActions, queueInboxSkip } from "@/lib/inbox-skip-client.mjs";

const SHORTLIST_KEY = "landing-gear:shortlist";
const HIDDEN_KEY = "landing-gear:hidden";
const CONFIG_KEY = "landing-gear:config";
type UndoNotice = { label: string; fn: () => Promise<void>; busy?: boolean; error?: string };

// The inbox as a TRIAGE surface: Abundance → Triage → Shortlist → Opt-in Score.
// Default is a small fresh batch (never the full wall); free facets + Save/Skip narrow
// it; only "Score shortlist" spends tokens. 🔴 The shell is agnostic to what makes a
// role relevant — order is freshness with a single documented plug point.
export function InboxTriage({ inbox }: { inbox: InboxJob[] }) {
  const router = useRouter();
  const { jobs, startJob } = useJobs();
  // Serialize skip/undo per URL so a fast Undo cannot lose the race to Skip.
  const skipChain = useRef(new Map<string, Promise<void>>());
  const undoRunning = useRef(new Set<UndoNotice["fn"]>());
  const restoreRunning = useRef(false);

  // company/role search, the only filter
  const [kw, setKw] = useState("");

  // persisted triage state + ephemeral selection/undo
  const [shortlist, setShortlist] = useState<ShortItem[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [undo, setUndo] = useState<UndoNotice | null>(null);
  const [writeError, setWriteError] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [hasCli, setHasCli] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const s = localStorage.getItem(SHORTLIST_KEY);
      if (s) setShortlist(JSON.parse(s));
      const h = localStorage.getItem(HIDDEN_KEY);
      if (h) {
        const parsed = JSON.parse(h) as unknown;
        const urls = Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === "string") : [];
        const pending = new Set(inbox.map((j) => j.url));
        setHidden(urls.filter((u) => pending.has(u)));
      }
      const c = localStorage.getItem(CONFIG_KEY);
      setHasCli(!!(c && JSON.parse(c).cliId));
    } catch {
      /* ignore */
    }
    setLoaded(true);
    // First SSR inbox only — later refreshes prune via the inbox effect below.
  }, []);
  useEffect(() => {
    if (loaded) try { localStorage.setItem(SHORTLIST_KEY, JSON.stringify(shortlist)); } catch { /* quota */ }
  }, [shortlist, loaded]);
  useEffect(() => {
    if (loaded) try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden)); } catch { /* quota */ }
  }, [hidden, loaded]);
  // After SSR refresh, pipeline.md [x] rows are already gone from `inbox`.
  // Drop them from the localStorage cache so "N hidden" does not linger.
  useEffect(() => {
    const pending = new Set(inbox.map((j) => j.url));
    setHidden((h) => {
      const next = h.filter((u) => pending.has(u));
      return next.length === h.length ? h : next;
    });
  }, [inbox]);
  // A triage label or an evaluation's [x] mark was just written to pipeline.md.
  useEffect(() => {
    const onDone = () => router.refresh();
    window.addEventListener("co-job-done", onDone);
    return () => window.removeEventListener("co-job-done", onDone);
  }, [router]);
  // auto-dismiss the undo toast
  useEffect(() => {
    if (!undo || undo.busy || undo.error) return;
    const t = setTimeout(() => setUndo((current) => current?.fn === undo.fn && !current.busy && !current.error ? null : current), 5000);
    return () => clearTimeout(t);
  }, [undo]);

  // stable "now" for freshness (per mount)
  const now = useMemo(() => Date.now(), []);

  // Dedupe by URL — pipeline.md can list the same posting twice; it's one job, so it
  // triages once (and Save/Skip/score, all keyed by URL, act on it coherently).
  const enriched = useMemo(() => {
    const seen = new Set<string>();
    const out: { job: InboxJob; source: AtsSource | null; age: number | null; order: number }[] = [];
    for (const job of inbox) {
      if (seen.has(job.url)) continue;
      seen.add(job.url);
      out.push({ job, source: sourceFromUrl(job.url), age: daysSince(job.postedAt, now), order: out.length });
    }
    return out;
  }, [inbox, now]);

  // EVALUADA lookup: the latest evaluate worker per posting URL (running → badge).
  const scoreByUrl = useMemo(() => {
    const best = new Map<string, (typeof jobs)[number]>();
    for (const j of jobs) {
      if (!j.input || j.kind !== "evaluate") continue;
      const ex = best.get(j.input);
      if (!ex || j.startedAt > ex.startedAt) best.set(j.input, j);
    }
    const m = new Map<string, RowScore>();
    for (const [url, j] of best) {
      m.set(url, { score: j.result?.score ?? null, tone: j.result?.tone ?? "muted", jobId: j.id, running: j.status === "running", reportN: j.reportN });
    }
    return m;
  }, [jobs]);

  const filtered = useMemo(
    () =>
      enriched.filter((e) => {
        if (hidden.includes(e.job.url)) return false;
        if (kw.trim() && !`${e.job.company} ${e.job.role}`.toLowerCase().includes(kw.trim().toLowerCase())) return false;
        return true;
      }),
    [enriched, hidden, kw],
  );

  // 🔴 SINGLE ORDER PLUG POINT — freshness only (newest first_seen first; unknown last).
  // A smarter ranker replaces ONLY this comparator; facets/triage/shortlist/score never
  // touch relevance. This is the whole firewall in one line.
  // Every tab lists newest first (the engineer's choice, 2026-11-06): by posting date,
  // then by pipeline.md order, where later lines were added later. Rows with no posting
  // date sort after dated ones, newest added first.
  const ordered = useMemo(
    () => [...filtered].sort((a, b) => (a.age ?? Infinity) - (b.age ?? Infinity) || b.order - a.order),
    [filtered],
  );

  const visible = ordered;
  const hiddenCount = hidden.length;

  const isShortlisted = (url: string) => shortlist.some((s) => s.url === url);
  // Rows with a triage worker still running (url -> job id for the live view);
  // the label lands in pipeline.md when it ends.
  const triagingJobs = new Map(jobs.filter((j) => j.kind === "triage" && j.status === "running" && j.input).map((j) => [j.input as string, j.id]));
  // The latest failed triage/evaluate per row (jobs are newest first). Workers lists
  // only running jobs, so without this a run that fails at once looks like nothing happened.
  const failedJobs = new Map<string, { id: string; error: string }>();
  for (const j of jobs) {
    if ((j.kind !== "triage" && j.kind !== "evaluate") || !j.input || j.status !== "error" || failedJobs.has(j.input)) continue;
    failedJobs.set(j.input, { id: j.id, error: j.steps.at(-1)?.label ?? "Run failed" });
  }

  const persistSkip = async (url: string, done: boolean) => {
    await queueInboxSkip(skipChain.current, url, done);
    router.refresh();
  };
  const handleUndo = async (notice: UndoNotice) => {
    if (undoRunning.current.has(notice.fn)) return;
    undoRunning.current.add(notice.fn);
    setUndo((current) => current?.fn === notice.fn ? { ...current, busy: true, error: undefined } : current);
    try {
      await notice.fn();
      setUndo((current) => current?.fn === notice.fn ? null : current);
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : "Could not undo this skip. Please try again.";
      setUndo((current) => current?.fn === notice.fn ? { ...current, busy: false, error } : current);
    } finally {
      undoRunning.current.delete(notice.fn);
    }
  };

  const save = (job: InboxJob) => {
    if (isShortlisted(job.url)) return;
    setShortlist((s) => [...s, { url: job.url, company: job.company, role: job.role }]);
  };
  const skip = (job: InboxJob) => {
    setWriteError("");
    setHidden((h) => (h.includes(job.url) ? h : [...h, job.url]));
    const actions = createInboxSkipActions((done) => persistSkip(job.url, done), () => {
      setHidden((h) => h.filter((u) => u !== job.url));
      setUndo((current) => current?.fn === notice.fn && !current.busy ? null : current);
      setWriteError(`Could not skip ${job.company}. Please try Skip again.`);
    });
    const notice: UndoNotice = {
      label: `Skipped ${job.company}`,
      fn: async () => {
        await actions.undo();
        setHidden((h) => h.filter((u) => u !== job.url));
      },
    };
    setUndo(notice);
    void actions.skip();
  };
  const restoreHidden = async () => {
    if (restoreRunning.current) return;
    restoreRunning.current = true;
    setRestoring(true);
    const urls = hidden;
    setWriteError("");
    try {
      await Promise.all(urls.map((url) => persistSkip(url, false).then(() => {
        setHidden((h) => h.filter((u) => u !== url));
      }).catch(() => setWriteError("Some jobs could not be restored. Try restore again."))));
    } finally {
      restoreRunning.current = false;
      setRestoring(false);
    }
  };
  const toggleSelect = (url: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(url)) n.delete(url);
      else n.add(url);
      return n;
    });
  const saveSelected = () => {
    const add = enriched
      .filter((e) => selected.has(e.job.url) && !isShortlisted(e.job.url))
      .map((e) => ({ url: e.job.url, company: e.job.company, role: e.job.role }));
    if (add.length) setShortlist((s) => [...s, ...add]);
    setSelected(new Set());
  };

  const estimate = useMemo(() => {
    if (shortlist.length === 0) return {};
    return estimateRunCost(jobs, "evaluate", shortlist.length);
  }, [jobs, shortlist.length]);

  const scoreShortlist = () => {
    const batchId = `shortlist-${Date.now()}`;
    for (const it of shortlist) {
      startJob({ title: `Score · ${it.company}`, subtitle: it.role, kind: "evaluate", input: it.url, page: "/pipeline", batchId });
    }
    setShortlist([]); // sent — the rows flip to Scoring… → badge via scoreByUrl
  };

  // "Triage all" covers shown rows with no triage yet; "Evaluate all" every shown
  // row. Rows with a run already going are left out; the server runs 6 at a time.
  const [confirmBulk, setConfirmBulk] = useState<"triage" | "evaluate" | null>(null);
  const runningFor = (kind: string, url: string) => jobs.some((j) => j.kind === kind && j.input === url && j.status === "running");
  const bulkTargets = (kind: "triage" | "evaluate") =>
    visible.filter((e) => (kind === "evaluate" || !e.job.triage) && !runningFor(kind, e.job.url) && !scoreByUrl.get(e.job.url)?.running);
  // Zero-token pre-triage: closes plainly-out rows, marks the rest so it never reruns on them.
  const pretriageCount = inbox.filter((job) => !job.done && !job.pretriaged && !job.triage).length;
  // Re-check runs the current rules again on rows already pre-triaged (but not triaged).
  const recheckCount = inbox.filter((job) => !job.done && job.pretriaged && !job.triage).length;
  const [pretriaging, setPretriaging] = useState(false);
  const [pretriageResult, setPretriageResult] = useState<{ passed: number; withoutJd?: number; dropped: { company: string; role: string; reason: string }[]; failed: string[] } | null>(null);
  const runPretriage = async (recheck = false) => {
    setPretriaging(true);
    setWriteError("");
    try {
      const response = await fetch("/api/pretriage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recheck }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setPretriageResult(body);
      router.refresh();
    } catch (error) {
      setWriteError(`Pre-triage failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setPretriaging(false);
    }
  };

  const startBulk = (kind: "triage" | "evaluate") => {
    const batchId = `${kind}-all-${Date.now()}`;
    for (const e of bulkTargets(kind)) {
      startJob({ title: `${kind === "triage" ? "Triage" : "Score"} · ${e.job.company}`, subtitle: e.job.role, kind, input: e.job.url, page: "/pipeline", batchId });
    }
    setConfirmBulk(null);
  };

  return (
    <div className={cn("mt-4", shortlist.length > 0 && "pb-28 sm:pb-24")}>
      {writeError && <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">{writeError}</p>}
      {/* Keep recovery mounted when the last Skip refreshes to an empty inbox. */}
      <div hidden={inbox.length === 0}>
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            placeholder="Filter by company or role…"
            className="w-full rounded-lg border border-border bg-surface/60 py-2 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-faint focus:border-brand/50 focus-visible:ring-2 focus-visible:ring-brand/40 max-sm:min-h-[44px]"
          />
        </div>
        <span className="shrink-0 text-xs text-muted">
          <span className="tabular-nums text-foreground">{filtered.length}</span>
          <span className="text-faint">/{enriched.length - hiddenCount}</span>
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {pretriageCount > 0 && (
          <button
            type="button"
            onClick={() => void runPretriage()}
            disabled={pretriaging}
            aria-busy={pretriaging}
            title="Free check (no tokens) by title, location, tracker and, when it can be read for free, the JD: closes what is plainly out, marks the rest as pre-triaged"
            className="rounded-md border border-brand/40 bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-text transition-colors hover:bg-brand/15 disabled:opacity-50 max-sm:min-h-[44px]"
          >
            {pretriaging ? "Pre-triaging…" : `Pre-triage all (${pretriageCount})`}
          </button>
        )}
        {recheckCount > 0 && (
          <button
            type="button"
            onClick={() => void runPretriage(true)}
            disabled={pretriaging}
            aria-busy={pretriaging}
            title="Run the current pre-triage rules again on rows already pre-triaged but not triaged"
            className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand disabled:opacity-50 max-sm:min-h-[44px]"
          >
            {pretriaging ? "Checking…" : `Re-check (${recheckCount})`}
          </button>
        )}
        {(["triage", "evaluate"] as const).map((kind) => {
          const targets = bulkTargets(kind);
          if (targets.length === 0) return null;
          const label = kind === "triage" ? "Triage" : "Evaluate";
          return confirmBulk === kind ? (
            <span key={kind} className="inline-flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted">Start {targets.length} {kind === "triage" ? "triages" : "full evaluations"} (6 at a time)?</span>
              <button type="button" onClick={() => startBulk(kind)} className="rounded-md bg-brand px-2.5 py-1 font-medium text-brand-foreground max-sm:min-h-[44px]">Start</button>
              <button type="button" onClick={() => setConfirmBulk(null)} className="text-muted hover:text-foreground max-sm:min-h-[44px]">Cancel</button>
            </span>
          ) : (
            <button
              key={kind}
              type="button"
              onClick={() => setConfirmBulk(kind)}
              className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand max-sm:min-h-[44px]"
            >
              {label} all ({targets.length})
            </button>
          );
        })}
        {hiddenCount > 0 && (
          <button type="button" onClick={() => void restoreHidden()} disabled={restoring} aria-busy={restoring} className="text-xs text-faint transition-colors hover:text-foreground disabled:opacity-50 max-sm:min-h-[44px]">
            {hiddenCount} hidden · {restoring ? "restoring…" : "restore"}
          </button>
        )}
      </div>

      {pretriageResult && (
        <div className="mt-2 rounded-lg border border-border bg-surface/40 px-4 py-3 text-xs text-muted">
          <div className="flex items-start justify-between gap-3">
            <p>
              <span className="font-medium text-foreground">Pre-triage:</span> {pretriageResult.passed} kept{pretriageResult.withoutJd ? ` (${pretriageResult.withoutJd} without a readable JD)` : ""}, {pretriageResult.dropped.length} closed
              {pretriageResult.failed.length > 0 && <span className="text-red-600 dark:text-red-400">, {pretriageResult.failed.length} not written ({pretriageResult.failed.join("; ")})</span>}
            </p>
            <button type="button" onClick={() => setPretriageResult(null)} className="shrink-0 text-faint hover:text-foreground">Dismiss</button>
          </div>
          {pretriageResult.dropped.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {pretriageResult.dropped.map((drop, index) => (
                <li key={index}><span className="text-foreground">{drop.company}</span>, {drop.role}: <span className="text-faint">{drop.reason}</span></li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* multi-select action bar */}
      {selected.size > 0 && (
        <div className="mt-2 flex items-center gap-3 rounded-lg border border-brand/30 bg-brand-soft px-3 py-2 text-sm">
          <span className="font-medium text-brand tabular-nums">{selected.size} selected</span>
          <button type="button" onClick={saveSelected} className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-brand-foreground max-sm:min-h-[44px]">
            Save to shortlist
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-muted hover:text-foreground max-sm:min-h-[44px]">
            Clear
          </button>
        </div>
      )}

      {visible.length > 0 ? (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visible.map((e) => (
            <TriageRow
              key={e.job.url}
              job={e.job}
              source={e.source}
              age={e.age}
              scored={scoreByUrl.get(e.job.url)}
              selected={selected.has(e.job.url)}
              shortlisted={isShortlisted(e.job.url)}
              onToggleSelect={() => toggleSelect(e.job.url)}
              onSave={() => save(e.job)}
              onSkip={() => skip(e.job)}
              onTriage={() => startJob({ title: `Triage · ${e.job.company}`, subtitle: e.job.role, kind: "triage", input: e.job.url, page: "/pipeline" })}
              onEvaluate={() => startJob({ title: `Score · ${e.job.company}`, subtitle: e.job.role, kind: "evaluate", input: e.job.url, page: "/pipeline" })}
              triageJobId={triagingJobs.get(e.job.url) ?? null}
              failedRun={failedJobs.get(e.job.url) ?? null}
            />
          ))}
        </ul>
      ) : (
        <div className="mt-3 rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-10 text-center">
          <p className="font-display text-lg">No matches</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">No company or role matches that search.</p>
        </div>
      )}

      {/* empty-shortlist guidance (only once there's nothing saved) */}
      {shortlist.length === 0 && (
        <p className="mt-4 text-center text-xs text-faint">Save roles worth a look, then score them together: one token spend.</p>
      )}
      </div>

      {/* undo toast (sits above the tray) */}
      {undo && (
        <div className={cn("fixed inset-x-0 z-40 flex justify-center px-4", shortlist.length > 0 ? "bottom-24 sm:bottom-24" : "bottom-20 sm:bottom-6")}>
          <div className="inline-flex max-w-full flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-2 text-sm shadow-lg">
            <div className="min-w-0 flex-1 break-words">
              <span className="text-muted" role="status">{undo.label}</span>
              {undo.error && <p role="alert" className="text-red-600 dark:text-red-400">{undo.error}</p>}
            </div>
            <button type="button" onClick={() => void handleUndo(undo)} disabled={undo.busy} aria-busy={Boolean(undo.busy)} className="inline-flex shrink-0 items-center gap-1 font-medium text-brand disabled:opacity-50 max-sm:min-h-[44px]">
              <Undo2 className="size-3.5" /> {undo.busy ? "Undoing…" : undo.error ? "Retry undo" : "Undo"}
            </button>
          </div>
        </div>
      )}

      <ShortlistTray
        items={shortlist}
        estimate={estimate}
        hasCli={hasCli}
        onRemove={(url) => setShortlist((s) => s.filter((x) => x.url !== url))}
        onClear={() => setShortlist([])}
        onScore={scoreShortlist}
      />
    </div>
  );
}
