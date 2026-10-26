"use client";

import Link from "next/link";
import { useState } from "react";
import { Bookmark, BookmarkCheck, Check, ClipboardPaste, Loader2, X } from "lucide-react";
import type { InboxJob } from "@/lib/career-ops";
import type { AtsSource } from "@/lib/explore";
import { ATS_LABEL } from "@/lib/explore";
import { unscoredInboxHref } from "@/lib/posting-url.mjs";
import { Badge } from "@/components/ui/badge";
import { CompanyLogo } from "@/components/company-logo";
import { cn } from "@/lib/cn";
import { inboxScoreTarget } from "@/lib/inbox-score-target.mjs";
import { splitTriageLabel } from "@/lib/lifecycle.mjs";
import { PasteJd } from "@/components/paste-jd";

export type RowScore = { score: number | null; tone: "good" | "warn" | "bad" | "muted"; jobId: string; running: boolean; reportN?: number | null };

function agoLabel(age: number | null): string | null {
  if (age == null) return null;
  if (age <= 0) return "today";
  if (age === 1) return "yesterday";
  if (age < 7) return `${age}d ago`;
  if (age < 30) return `${Math.floor(age / 7)}w ago`;
  return `${Math.floor(age / 30)}mo ago`;
}

// One raw posting in the triage list. Shows ONLY cheap, free signals + an honest
// "not scored" (CRUDA) — never a fake match%. Once its shortlist eval finishes it
// flips to EVALUADA (a real A–F badge). Save→shortlist / Skip→hidden are free + undoable.
export function TriageRow({
  job,
  source,
  age,
  scored,
  selected,
  shortlisted,
  onToggleSelect,
  onSave,
  onSkip,
  onTriage,
  onEvaluate,
  triageJobId,
  failedRun,
}: {
  job: InboxJob;
  source: AtsSource | null;
  age: number | null;
  scored?: RowScore;
  selected: boolean;
  shortlisted: boolean;
  onToggleSelect: () => void;
  onSave: () => void;
  onSkip: () => void;
  /** Haiku first pass; the backend saves a `triage:` label on the pipeline row. */
  onTriage: () => void;
  /** Full evaluation (report + tracker row). */
  onEvaluate: () => void;
  /** The running triage job, if any; its button then opens the live view. */
  triageJobId: string | null;
  /** The latest triage/evaluate run on this row that failed; a new run replaces it. */
  failedRun: { id: string; error: string } | null;
}) {
  const ago = agoLabel(age);
  const target = inboxScoreTarget(scored);
  const evaluated = target.evaluated;
  const postingHref = unscoredInboxHref(job.url, evaluated);
  const triage = !evaluated && job.triage ? splitTriageLabel(job.triage) : null;
  // "Paste JD": for a posting no worker can read, Carlos pastes its text once.
  const [pasteOpen, setPasteOpen] = useState(false);
  const verdictStyle =
    triage?.verdict === "PASS"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      : triage?.verdict === "MARGINAL"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        : "bg-red-500/10 text-red-700 dark:text-red-400";

  return (
    <li
      className={cn(
        // A grid card: header, then the triage verdict, actions pinned to the bottom.
        "flex flex-col gap-3 rounded-xl border border-border p-4 transition-colors",
        selected ? "bg-brand-soft/50" : "bg-surface/40 hover:bg-surface-hover",
        evaluated && "opacity-95",
      )}
    >
      <div className="flex items-start gap-3">
        <CompanyLogo name={job.company} size={32} />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold text-foreground">{job.company}</p>
          <p className="mt-0.5 break-words text-sm leading-snug text-muted">
            {postingHref ? (
              <a href={postingHref} target="_blank" rel="noreferrer" className="hover:text-brand hover:underline">
                {job.role}
              </a>
            ) : (
              job.role
            )}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
            {job.location && <span className="break-words">{job.location}</span>}
            {source && <span className="rounded bg-surface-hover px-1.5 py-px font-medium text-muted">{ATS_LABEL[source]}</span>}
            {ago && <span>{ago}</span>}
            {/* Honest "not scored": no fabricated match%. */}
            {!evaluated && !job.triage && <span className="italic text-muted">not scored</span>}
            {job.pretriaged && !job.triage && (
              <span title="Passed the free pre-triage: ready for Triage or Evaluate" className="inline-flex items-center gap-1 rounded bg-sky-500/15 px-1.5 py-px font-medium text-sky-700 dark:text-sky-400">
                <Check className="size-3" /> Pre-triaged
              </span>
            )}
            {job.jdSaved && (
              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-px font-medium text-emerald-700 dark:text-emerald-400">
                <Check className="size-3" /> JD saved
              </span>
            )}
          </p>
        </div>
        {/* multi-select, batch to shortlist */}
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`Select ${job.company} ${job.role}`}
          className="mt-1 size-4 shrink-0 accent-brand max-sm:min-h-[44px] max-sm:min-w-[24px]"
        />
      </div>

      {triage && (
        <div className="rounded-lg border border-border/70 bg-background/60 px-3 py-2.5">
          <div className="flex items-center gap-2">
            {triage.verdict && <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold tracking-wide", verdictStyle)}>{triage.verdict}</span>}
            {triage.score !== null && <span className="text-base font-semibold tabular-nums text-foreground">{triage.score.toFixed(1)}<span className="text-xs font-normal text-faint">/5</span></span>}
          </div>
          {triage.reason && <p className="mt-1.5 text-sm leading-relaxed text-muted">{triage.reason}</p>}
        </div>
      )}

      {failedRun && !triageJobId && !scored?.running && (
        <p role="alert" className="text-xs leading-snug text-red-600 dark:text-red-400">
          Last run failed: {failedRun.error}{" "}
          <Link href={`/jobs/${failedRun.id}`} className="underline hover:text-red-700 dark:hover:text-red-300">Details</Link>
        </p>
      )}

      {/* EVALUADA state (right-aligned, visually distinct from raw rows) */}
      {evaluated && target.href ? (
        <Link href={target.href} className="mt-auto flex items-center justify-end gap-1.5 text-xs">
          {scored!.running ? (
            <>
              <Loader2 className="size-3.5 animate-spin text-brand" />
              <span className="text-brand max-sm:hidden">Scoring…</span>
            </>
          ) : target.showScore ? (
            <Badge tone={scored!.tone}>{scored!.score}/5</Badge>
          ) : (
            <span className="text-brand">Report</span>
          )}
        </Link>
      ) : (
        <div className="mt-auto flex flex-wrap items-center justify-end gap-1 border-t border-border/60 pt-3">
          {triageJobId ? (
            <Link
              href={`/jobs/${triageJobId}`}
              title="Watch what Haiku is doing"
              className="inline-flex items-center justify-center gap-1 rounded-md border border-brand/40 px-2 py-1 text-xs font-medium text-brand max-sm:min-h-[44px]"
            >
              <Loader2 className="size-3.5 animate-spin" /> Triaging…
            </Link>
          ) : (
            <button
              type="button"
              onClick={onTriage}
              title="Quick triage with Haiku (PASS / MARGINAL / FAIL)"
              className="inline-flex items-center justify-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand max-sm:min-h-[44px]"
            >
              {job.triage ? "Re-triage" : "Triage"}
            </button>
          )}
          <button
            type="button"
            onClick={onEvaluate}
            title="Full evaluation with Haiku (report + tracker row)"
            className="inline-flex items-center justify-center rounded-md bg-brand-soft px-2 py-1 text-xs font-medium text-brand transition-colors hover:bg-brand/15 max-sm:min-h-[44px]"
          >
            Evaluate
          </button>
          {/^https?:\/\//i.test(job.url) && (
            <button
              type="button"
              onClick={() => setPasteOpen((open) => !open)}
              aria-expanded={pasteOpen}
              title={job.jdSaved ? "A JD is saved for this posting; paste again to replace it" : "The posting can't be read? Paste its text and evaluate from it"}
              className="inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-brand max-sm:min-h-[44px]"
            >
              <ClipboardPaste className="size-3.5" /> {job.jdSaved ? "Replace JD" : "Paste JD"}
            </button>
          )}
          <button
            type="button"
            onClick={onSave}
            title={shortlisted ? "In your shortlist" : "Save to shortlist"}
            aria-pressed={shortlisted}
            className={cn(
              "inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors max-sm:min-h-[44px] max-sm:min-w-[44px]",
              shortlisted ? "text-brand" : "text-muted hover:bg-surface-hover hover:text-brand",
            )}
          >
            {shortlisted ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
            <span className="max-sm:hidden">{shortlisted ? "Saved" : "Save"}</span>
          </button>
          <button
            type="button"
            onClick={onSkip}
            title="Skip — hide from the inbox"
            className="inline-flex items-center justify-center rounded-md p-1 text-faint transition-colors hover:bg-surface-hover hover:text-foreground max-sm:min-h-[44px] max-sm:min-w-[44px]"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
      {pasteOpen && (
        <PasteJd
          url={job.url}
          company={job.company}
          role={job.role}
          actionLabel="Save & evaluate"
          onSaved={(rerun) => {
            setPasteOpen(false);
            if (rerun) onEvaluate();
          }}
          onCancel={() => setPasteOpen(false)}
        />
      )}
    </li>
  );
}
