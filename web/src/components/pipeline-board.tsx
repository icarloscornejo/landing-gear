"use client";

import { useState, type DragEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, GripVertical, Loader2 } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { splitTriageLabel } from "@/lib/lifecycle.mjs";
import type { Application, InboxJob } from "@/lib/career-ops";
import { cn } from "@/lib/cn";
import { scoreTen } from "@/lib/format";
import { companyPresentation } from "@/lib/company-presentation.mjs";
import { canonStatus } from "@/lib/status-alias.mjs";
import { isApproved } from "@/lib/home/awaiting.mjs";
import { inboxTabHas } from "@/lib/pipeline-navigation.mjs";
import { readReach } from "@/lib/location-reach.mjs";
import { postingUrl } from "@/lib/posting-url.mjs";
import {
  DATED_PHASES,
  EXIT_KINDS,
  currentPhase,
  exitOutcome,
  isOpenApplied,
  nextPhases,
  nextRound,
  outcomeText,
  phaseInfo,
  phaseLabel,
  type ExitKind,
  type PhaseKey,
  type PhaseLogRow,
} from "@/lib/lifecycle.mjs";
import { useLifecyclePost } from "@/lib/use-lifecycle-post";
import { EXIT_LABELS, LifecycleActions } from "@/components/lifecycle-actions";
import { InterviewDate } from "@/components/interview-date";
import { Badge } from "@/components/ui/badge";

// The whole search as columns: the postings not yet scored (Discovered,
// Triaged), the scored rows before applying (Evaluated, Approved), the open
// hiring phases (house rule 25; Hired rows sit in Offer, as in the tabs), then
// Closed. Idea from AienTech/dossier, written for this model.
const PHASE_COLUMNS: PhaseKey[] = ["applied", "replied", "screening", "assessment", "tech", "manager", "final", "offer"];
type Stage = "evaluated" | "approved";
type Target = Stage | PhaseKey | "closed";

/** What a drop asks before writing anything. */
type Prompt = { n: string; kind: "round" | "exit" | "cv" | "discard" } | null;

const canon = (row: Application) => canonStatus(String(row.status ?? "").trim());
const isHired = (row: Application) => canon(row) === "HIRED";
/** Evaluated or Approved: scored, not applied, not closed. */
const stageOf = (row: Application): Stage | null => (canon(row) === "EVALUATED" ? (isApproved(row) ? "approved" : "evaluated") : null);

/**
 * Drag a card to move it, through the same writes as the card buttons:
 * Evaluated to Approved approves it; Approved to Applied asks which CV went
 * (house rule 6); a later phase is a /api/stage move; its own phase asks for
 * another round; Closed asks how it ended (or, before applying, to discard).
 * Discovered and Triaged cards are not dragged: they show the same pre-triage,
 * triage and evaluation state as the tabs and start those runs from buttons. Every move is also in the card's Move menu, since
 * HTML5 drag does not work on touch screens.
 */
export function PipelineBoard({ rows, inbox, statusLog, detailQuery }: { rows: Application[]; inbox: InboxJob[]; statusLog: PhaseLogRow[]; detailQuery: string }) {
  const [dragging, setDragging] = useState<Application | null>(null);
  const [over, setOver] = useState<Target | null>(null);
  const [prompt, setPrompt] = useState<Prompt>(null);
  // A card just moved into a dated phase offers its date field, drawn for the new round.
  const [justMoved, setJustMoved] = useState<{ n: string; phase: string; round: number } | null>(null);
  const { busy, error, post } = useLifecyclePost();
  const { jobs, startJob } = useJobs();
  const router = useRouter();

  const staged = new Map<Stage, Application[]>([["evaluated", []], ["approved", []]]);
  const open = new Map<PhaseKey, Application[]>(PHASE_COLUMNS.map((key) => [key, []]));
  const closed: Application[] = [];
  for (const row of rows) {
    const stage = stageOf(row);
    if (stage) staged.get(stage)?.push(row);
    else if (isOpenApplied(row) || isHired(row)) {
      const phase = currentPhase(row)?.phase;
      open.get(phase === "hired" ? "offer" : (phase as PhaseKey))?.push(row);
    } else if (exitOutcome(row, statusLog)?.phase) {
      closed.push(row);
    }
  }
  closed.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  const discovered = inbox.filter((job) => inboxTabHas("INBOX", job));
  const triaged = inbox.filter((job) => inboxTabHas("TRIAGED", job));

  const accepts = (row: Application, target: Target) => {
    const stage = stageOf(row);
    if (stage === "evaluated") return target === "approved" || target === "closed";
    if (stage === "approved") return target === "applied" || target === "closed";
    if (!isOpenApplied(row)) return false;
    if (target === "closed") return true;
    return (nextPhases(row) as Target[]).includes(target);
  };

  const expectedOf = (row: Application) => {
    const phase = currentPhase(row);
    return phase ? { phase: phase.phase, round: phase.round } : undefined;
  };

  const move = async (row: Application, phase: PhaseKey) => {
    const result = await post(`move-${row.n}`, "/api/stage", { n: row.n, phase, expected: expectedOf(row) });
    setPrompt(null);
    if (result && (DATED_PHASES as readonly string[]).includes(phase) && result.phase && typeof result.round === "number") {
      setJustMoved({ n: row.n, phase: result.phase, round: result.round });
    }
  };

  const write = async (row: Application, url: string, payload: Record<string, unknown>) => {
    if (await post(`move-${row.n}`, url, { n: row.n, ...payload })) setPrompt(null);
  };

  const drop = (target: Target) => {
    const row = dragging;
    setDragging(null);
    setOver(null);
    if (!row || !accepts(row, target)) return;
    const stage = stageOf(row);
    if (stage === "evaluated" && target === "approved") void write(row, "/api/approve", {});
    else if (stage && target === "applied") setPrompt({ n: row.n, kind: "cv" });
    else if (stage && target === "closed") setPrompt({ n: row.n, kind: "discard" });
    else if (target === "closed") setPrompt({ n: row.n, kind: "exit" });
    else if (target === currentPhase(row)?.phase) setPrompt({ n: row.n, kind: "round" });
    else void move(row, target as PhaseKey);
  };

  const zone = (target: Target) => ({
    onDragOver: (event: DragEvent) => {
      if (!dragging || !accepts(dragging, target)) return;
      event.preventDefault();
      if (over !== target) setOver(target);
    },
    onDragLeave: () => setOver((current) => (current === target ? null : current)),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      drop(target);
    },
  });

  const statusLine = (row: Application) => {
    const stage = stageOf(row);
    if (stage) return `${scoreTen(row.score) || "unscored"}${stage === "approved" ? " · Approved" : ""}`;
    if (isHired(row)) return "Hired";
    if (isOpenApplied(row)) {
      const phase = currentPhase(row);
      return phase ? phaseLabel(phase.phase, phase.round) : "";
    }
    return outcomeText(row, statusLog) ?? "";
  };

  const card = (row: Application) => {
    const phase = currentPhase(row);
    const movable = isOpenApplied(row) || stageOf(row) !== null;
    const href = `/pipeline/${encodeURIComponent(row.n)}${detailQuery ? `?${detailQuery}` : ""}`;
    const asking = prompt?.n === row.n ? prompt.kind : null;
    const moved = justMoved?.n === row.n ? justMoved : null;
    return (
      <li
        key={row.n}
        draggable={movable && !busy}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", row.n);
          setDragging(row);
          setPrompt(null);
        }}
        onDragEnd={() => {
          setDragging(null);
          setOver(null);
        }}
        className={cn(
          "rounded-xl border border-border bg-surface/60 p-3 text-sm shadow-sm",
          movable && "cursor-grab active:cursor-grabbing",
          dragging?.n === row.n && "opacity-40",
        )}
      >
        <div className="flex items-start gap-1.5">
          {movable && <GripVertical aria-hidden className="mt-0.5 size-3.5 shrink-0 text-faint" />}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-muted">{companyPresentation(row).label}</p>
            <Link href={href} draggable={false} className="line-clamp-2 font-medium text-foreground hover:text-brand">
              {row.role}
            </Link>
            <p className="mt-1 text-xs text-faint">#{row.n} · {statusLine(row)}</p>
          </div>
          {busy === `move-${row.n}` ? <Loader2 className="size-3.5 animate-spin text-muted" /> : null}
        </div>

        {isOpenApplied(row) && (
          <InterviewDate
            key={moved ? `${moved.phase}-${moved.round}` : "current"}
            app={row}
            expected={moved ? { phase: moved.phase, round: moved.round } : undefined}
            startOpen={!!moved}
            onDone={() => setJustMoved(null)}
            className="mt-2"
          />
        )}

        {asking === "round" && phase && (
          <Confirm>
            <span className="text-xs text-foreground">Add {phaseLabel(phase.phase, nextRound(row, phase.phase))}?</span>
            <BoardButton tone="brand" disabled={!!busy} onClick={() => void move(row, phase.phase)}>Yes</BoardButton>
            <BoardButton disabled={!!busy} onClick={() => setPrompt(null)}>Cancel</BoardButton>
          </Confirm>
        )}
        {asking === "exit" && (
          <Confirm>
            <span className="w-full text-xs text-foreground">How did it end?</span>
            {(Object.keys(EXIT_KINDS) as ExitKind[]).map((kind) => (
              <BoardButton key={kind} tone="danger" disabled={!!busy} onClick={() => void write(row, "/api/exit", { kind, expected: expectedOf(row) })}>{EXIT_LABELS[kind]}</BoardButton>
            ))}
            <BoardButton disabled={!!busy} onClick={() => setPrompt(null)}>Cancel</BoardButton>
          </Confirm>
        )}
        {asking === "cv" && (
          <Confirm>
            <span className="w-full text-xs text-foreground">Applied with which CV?</span>
            <BoardButton tone="brand" disabled={!!busy} onClick={() => void write(row, "/api/apply-cv", { cv: "a" })}>CV A</BoardButton>
            <BoardButton tone="brand" disabled={!!busy} onClick={() => void write(row, "/api/apply-cv", { cv: "b" })}>CV B</BoardButton>
            <BoardButton disabled={!!busy} onClick={() => setPrompt(null)}>Cancel</BoardButton>
          </Confirm>
        )}
        {asking === "discard" && (
          <Confirm>
            <span className="text-xs text-foreground">Discard it?</span>
            <BoardButton tone="danger" disabled={!!busy} onClick={() => void write(row, "/api/status", { status: "Discarded" })}>Yes, discard</BoardButton>
            <BoardButton disabled={!!busy} onClick={() => setPrompt(null)}>Cancel</BoardButton>
          </Confirm>
        )}

        {movable && (
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer select-none text-muted hover:text-foreground">Move</summary>
            <LifecycleActions app={row} compact className="mt-1.5" />
          </details>
        )}
      </li>
    );
  };

  // The same worker state the tabs show: the latest triage or evaluate run per posting.
  const latestRun = (kind: "triage" | "evaluate", url: string) => {
    let latest: (typeof jobs)[number] | undefined;
    for (const run of jobs) if (run.kind === kind && run.input === url && (!latest || run.startedAt > latest.startedAt)) latest = run;
    return latest;
  };
  const startRun = (kind: "triage" | "evaluate", job: InboxJob) =>
    startJob({ title: `${kind === "triage" ? "Triage" : "Score"} · ${job.company}`, subtitle: job.role, kind, input: job.url, page: "/pipeline" });

  const [pretriaging, setPretriaging] = useState(false);
  const [pretriageNote, setPretriageNote] = useState("");
  const pretriageCount = discovered.filter((job) => !job.pretriaged && !job.triage).length;
  const runPretriage = async () => {
    setPretriaging(true);
    setPretriageNote("");
    try {
      const response = await fetch("/api/pretriage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recheck: false }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setPretriageNote(`Pre-triage: ${body.passed} kept, ${body.dropped?.length ?? 0} closed`);
      router.refresh();
    } catch (err) {
      setPretriageNote(`Pre-triage failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPretriaging(false);
    }
  };

  /** A posting not scored yet, with the pre-triage, triage and evaluation state the tabs show. */
  const postingCard = (job: InboxJob) => {
    const reach = job.location ? readReach(job.location, job.url) : null;
    // A local:jds/ row links to the post its capture came from.
    const href = postingUrl(job.url) ?? postingUrl(job.sourceUrl);
    const triage = job.triage ? splitTriageLabel(job.triage) : null;
    const triageRun = latestRun("triage", job.url);
    const evaluateRun = latestRun("evaluate", job.url);
    const running = triageRun?.status === "running" ? triageRun : evaluateRun?.status === "running" ? evaluateRun : null;
    const failed = !running && [triageRun, evaluateRun].filter((run) => run?.status === "error").sort((a, b) => b!.startedAt - a!.startedAt)[0];
    return (
      <li key={job.url} className="rounded-xl border border-border bg-surface/40 p-3 text-sm">
        <p className="truncate text-xs text-muted">{job.company}</p>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="line-clamp-2 font-medium text-foreground hover:text-brand">
            {job.role} <ExternalLink className="inline size-3 text-faint" />
          </a>
        ) : (
          <p className="line-clamp-2 font-medium text-foreground">{job.role}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs">
          {reach && <Badge tone={reach.tone}>{reach.label}</Badge>}
          {job.pretriaged && !job.triage && (
            <span title="Passed the free pre-triage" className="inline-flex items-center gap-1 rounded bg-sky-500/15 px-1.5 py-px font-medium text-sky-700 dark:text-sky-400">
              <Check className="size-3" /> Pre-triaged
            </span>
          )}
          {job.pretriageNoJd && !job.jdSaved && !job.triage && (
            <span title="Pre-triage could not read the JD for free" className="rounded bg-amber-500/15 px-1.5 py-px font-medium text-amber-700 dark:text-amber-400">no JD</span>
          )}
          {job.jdFile && (
            <a href={`/api/jd?file=${encodeURIComponent(job.jdFile)}`} target="_blank" rel="noreferrer" className="text-muted hover:text-brand hover:underline">
              View JD
            </a>
          )}
        </div>
        {triage && (
          <p className="mt-1.5 line-clamp-3 text-xs text-faint">
            <span className="font-semibold text-foreground">{triage.verdict}{triage.score !== null ? ` ${scoreTen(triage.score)}` : ""}</span> {triage.reason}
          </p>
        )}
        {failed && (
          <p role="alert" className="mt-1.5 text-xs text-red-600 dark:text-red-400">
            {failed.kind === "triage" ? "Triage" : "Evaluation"} failed. <Link href={`/jobs/${failed.id}`} className="underline">Details</Link>
          </p>
        )}
        <div className="mt-2 flex items-center justify-end gap-1">
          {running ? (
            <Link href={`/jobs/${running.id}`} className="inline-flex items-center gap-1 rounded-md border border-brand/40 px-2 py-0.5 text-xs font-medium text-brand">
              <Loader2 className="size-3 animate-spin" /> {running.kind === "triage" ? "Triaging…" : "Scoring…"}
            </Link>
          ) : (
            <>
              <button type="button" onClick={() => startRun("triage", job)} className="rounded-md border border-border px-2 py-0.5 text-xs font-medium text-muted hover:border-brand/40 hover:text-brand">
                {job.triage ? "Re-triage" : "Triage"}
              </button>
              <button type="button" onClick={() => startRun("evaluate", job)} className="rounded-md bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand hover:bg-brand/15">
                Evaluate
              </button>
            </>
          )}
        </div>
      </li>
    );
  };

  const shell = (target: Target | "discovered" | "triaged", title: string, count: number, children: ReactNode, action?: ReactNode) => {
    const droppable = target !== "discovered" && target !== "triaged";
    const allowed = droppable && !!dragging && accepts(dragging, target as Target);
    return (
      <section
        key={target}
        aria-label={`${title}, ${count}`}
        {...(droppable ? zone(target as Target) : {})}
        className={cn(
          "flex min-h-0 w-64 flex-none flex-col rounded-2xl border p-2 transition-colors",
          over === target ? "border-brand bg-brand/10" : allowed ? "border-dashed border-brand/50 bg-surface/30" : "border-border bg-surface/20",
          dragging && !allowed && "opacity-60",
        )}
      >
        <h2 className="flex items-center justify-between px-1.5 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted">
          {title} <span className="tabular-nums text-faint">{count}</span>
        </h2>
        {action}
        {count ? (
          <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">{children}</ul>
        ) : (
          <p className="px-2 py-6 text-center text-xs text-faint">Nothing here</p>
        )}
      </section>
    );
  };
  const column = (target: Target, title: string, cards: Application[]) => shell(target, title, cards.length, cards.map(card));

  return (
    // Takes the height the page header leaves (PageFrame is a full-height column here); each column scrolls on its own.
    <div className="mt-4 flex min-h-0 flex-1 flex-col">
      {error && <p role="alert" className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {/* Heights come from flex stretching only, never h-full: a percentage height inside
          a flex item does not resolve in every browser, and the columns then grow with their cards. */}
      <div className="flex min-h-0 flex-1 overflow-x-auto pb-1">
        <div className="flex min-h-0 w-max items-stretch gap-3">
          {shell(
            "discovered",
            "Discovered",
            discovered.length,
            discovered.map(postingCard),
            (pretriageCount > 0 || pretriageNote) && (
              <div className="mb-2 px-1.5 text-xs">
                {pretriageCount > 0 && (
                  <button
                    type="button"
                    onClick={runPretriage}
                    disabled={pretriaging}
                    aria-busy={pretriaging}
                    title="Free first pass: closes postings that clearly do not fit, no tokens"
                    className="w-full rounded-md border border-border px-2 py-1 font-medium text-muted hover:border-brand/40 hover:text-brand disabled:opacity-60"
                  >
                    {pretriaging ? "Pre-triaging…" : `Pre-triage all (${pretriageCount})`}
                  </button>
                )}
                {pretriageNote && <p role="status" className="mt-1 text-faint">{pretriageNote}</p>}
              </div>
            ),
          )}
          {shell("triaged", "Triaged", triaged.length, triaged.map(postingCard))}
          {column("evaluated", "Evaluated", staged.get("evaluated") ?? [])}
          {column("approved", "Approved", staged.get("approved") ?? [])}
          {PHASE_COLUMNS.map((key) => column(key, phaseInfo(key).label, open.get(key) ?? []))}
          {column("closed", "Closed", closed)}
        </div>
      </div>
    </div>
  );
}

function Confirm({ children }: { children: ReactNode }) {
  return <div className="mt-2 flex flex-wrap items-center gap-1 rounded-lg border border-border bg-background/60 p-2">{children}</div>;
}

function BoardButton({ tone, disabled, onClick, children }: { tone?: "brand" | "danger"; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-md px-2 py-1 text-xs font-medium transition disabled:opacity-60",
        tone === "brand" && "border border-brand/40 text-brand hover:bg-brand/10",
        tone === "danger" && "border border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-400",
        !tone && "text-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
