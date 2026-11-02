"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, ChevronsUpDown, X, ExternalLink, Plus, Minus } from "lucide-react";
import type { Application, InboxJob } from "@/lib/career-ops";
import { Badge } from "@/components/ui/badge";
import { isApproved } from "@/lib/home/awaiting.mjs";
import { CompanyLogo } from "@/components/company-logo";
import { scoreNum, scoreTone } from "@/lib/format";
import { applicationKey } from "@/lib/pipeline-status.mjs";
import { InboxTriage } from "@/components/inbox/inbox-triage";
import { cn } from "@/lib/cn";
import { companyPresentation, companySearchText } from "@/lib/company-presentation.mjs";
import { PipelineTableRowsSkeleton } from "@/components/page-loading-skeletons";
import { startRouteProgress } from "@/components/route-progress";
import { sortRows } from "@/lib/core/pipeline-sort.mjs";
import { PageFrame } from "@/components/page-frame";
import { BOARD_TABS, GRID_TABS, HIDE_WHEN_EMPTY, INBOX_TABS, PIPELINE_TABS, TAB_LABELS, pipelineQuery, pipelineTab, showsBoard, trackerTabOf } from "@/lib/pipeline-navigation.mjs";
import { PipelineBoard } from "@/components/pipeline-board";
import type { CardReason } from "@/lib/machine-summary.mjs";
import { LifecycleActions } from "@/components/lifecycle-actions";
import { InterviewDate } from "@/components/interview-date";
import { currentPhase, outcomeText, phaseLabel, type PhaseLogRow } from "@/lib/lifecycle.mjs";

/** The table's status cell: how a closed row ended, the phase and round of an open one. */
function rowStatusText(row: Application, statusLog: PhaseLogRow[]): string {
  const outcome = outcomeText(row, statusLog);
  if (outcome) return outcome;
  const phase = currentPhase(row);
  return phase ? phaseLabel(phase.phase, phase.round) : row.status;
}
import { COMPARE_MAX } from "@/lib/pipeline-compare.mjs";
import { postingHref, postingLabel } from "@/lib/posting-url.mjs";

type Tab = (typeof PIPELINE_TABS)[number];

const SORT_KEYS = ["tracker", "company", "role", "score", "status", "date"] as const;
type SortKey = (typeof SORT_KEYS)[number];

export function PipelineView({
  applications,
  inbox,
  inboxCount,
  triagedCount,
  reasons = {},
  statusLog = [],
}: {
  applications: Application[];
  inbox: InboxJob[] | null;
  inboxCount: number;
  triagedCount: number;
  /** The report's one-line reason per tracker #, for the open grid tab's cards. */
  reasons?: Record<string, CardReason>;
  /** data/status-log.tsv rows, for legacy closed rows with no OUTCOME note. */
  statusLog?: PhaseLogRow[];
}) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startNavigation] = useTransition();
  const [pendingTab, setPendingTab] = useState<Tab | null>(null);
  // Status is read-only here: it moves only through the detail page's buttons.
  const visibleApplications = applications;
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const activeTab = useRef<HTMLButtonElement>(null);

  // The URL is the SINGLE source of truth for tab/min/sort/dir, so the home stat
  // tiles' deep links AND the assistant's filterPipeline/navigate actions drive
  // the table identically (no useState mirror → no desync).
  const tab: Tab = pipelineTab(params.get("tab"));
  const visibleTab = isPending && pendingTab ? pendingTab : tab;
  const onInboxTab = (INBOX_TABS as readonly string[]).includes(visibleTab);
  const pMin = parseFloat(params.get("min") ?? "");
  const minFilter: number | null = Number.isFinite(pMin) ? pMin : null;
  const pSort = params.get("sort") ?? "";
  const sortKey: SortKey = (SORT_KEYS as readonly string[]).includes(pSort) ? (pSort as SortKey) : "status";
  const sort = { key: sortKey, dir: (params.get("dir") === "1" ? 1 : -1) as 1 | -1 };

  // Search stays LOCAL for snappy typing; seeded from the URL and re-synced only
  // when the URL's q changes (i.e. the assistant set it) — never per keystroke.
  const [q, setQ] = useState(params.get("q") ?? "");
  // Typing stays local, so include it explicitly when leaving the list.
  const detailQuery = pipelineQuery(params.toString(), q);
  const lastUrlQ = useRef(params.get("q") ?? "");
  useEffect(() => {
    const urlQ = params.get("q") ?? "";
    if (urlQ !== lastUrlQ.current) {
      lastUrlQ.current = urlQ;
      setQ(urlQ);
    }
  }, [params]);

  const setParams = useCallback(
    (updates: Record<string, string | number | null>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v == null || v === "") sp.delete(k);
        else sp.set(k, String(v));
      }
      const qs = sp.toString();
      if (qs === params.toString()) return;
      if (Object.prototype.hasOwnProperty.call(updates, "tab")) {
        const nextTab = String(updates.tab ?? "INBOX").toUpperCase();
        if ((PIPELINE_TABS as readonly string[]).includes(nextTab)) setPendingTab(nextTab as Tab);
      }
      startRouteProgress();
      startNavigation(() => {
        router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
      });
    },
    [params, router, pathname, startNavigation],
  );

  useEffect(() => {
    if (!isPending) setPendingTab(null);
  }, [isPending]);

  const filtered = useMemo(() => {
    if ((INBOX_TABS as readonly string[]).includes(tab)) return [];
    let rows = visibleApplications;
    if (tab !== "ALL") rows = rows.filter((r) => trackerTabOf(r) === tab);
    if (minFilter != null) {
      rows = rows.filter((r) => {
        const n = scoreNum(r.score);
        return !Number.isNaN(n) && n >= minFilter;
      });
    }
    if (q.trim()) {
      const needle = q.toLowerCase();
      rows = rows.filter((r) => companySearchText(r).toLowerCase().includes(needle));
    }
    // scoreNum is the real score parser (it handles the tracker's "4.2/5"
    // cells); sortRows takes it rather than keeping a second copy (#4333).
    return sortRows(
      rows,
      sort,
      scoreNum,
      (row) => companyPresentation(row).label,
    ) as Application[];
  }, [visibleApplications, tab, q, sort, minFilter]);

  // The board shows every open phase at once, so it skips the tab filter but
  // keeps the score and search filters.
  const board = showsBoard(tab, params.get("view"));
  const boardRows = useMemo(() => {
    if (!board) return [];
    const needle = q.trim().toLowerCase();
    return visibleApplications.filter((r) => {
      if (minFilter != null) {
        const n = scoreNum(r.score);
        if (Number.isNaN(n) || n < minFilter) return false;
      }
      return !needle || companySearchText(r).toLowerCase().includes(needle);
    });
  }, [board, visibleApplications, q, minFilter]);

  const filteredKeys = filtered.map(applicationKey);
  const selectedRows = filtered.filter((r) => selected.has(applicationKey(r)));
  const allSelected = filteredKeys.length > 0 && filteredKeys.every((k) => selected.has(k));

  function toggleRow(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <PageFrame>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight text-landing">Pipeline</h1>
          <p className="mt-1 text-sm text-muted">
            <span className="tabular-nums">{inboxCount}</span> discovered ·{" "}
            <span className="tabular-nums">{visibleApplications.length}</span> tracked
          </p>
        </div>
        {/* the tracker has its own search; the inbox brings its own facet filters */}
        {!onInboxTab && (
          <div className="relative w-64 max-w-[40vw]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search company or role…"
              className="w-full rounded-md border border-border bg-surface/60 py-2 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-faint focus:border-brand/50 focus-visible:ring-2 focus-visible:ring-brand/40"
            />
          </div>
        )}
      </div>

      {/* tabs */}
      <div className="mt-6 flex flex-wrap gap-1 border-b border-border">
        {PIPELINE_TABS.map((t) => {
          const count =
            t === "INBOX"
              ? inboxCount
              : t === "TRIAGED"
                ? triagedCount
                : t === "ALL"
                  ? visibleApplications.length
                  : visibleApplications.filter((r) => trackerTabOf(r) === t).length;
          if (count === 0 && t !== visibleTab && (HIDE_WHEN_EMPTY as readonly string[]).includes(t)) return null;
          return (
            <button
              key={t}
              type="button"
              ref={tab === t ? activeTab : undefined}
              aria-pressed={visibleTab === t}
              onClick={() => setParams({ tab: t === "INBOX" ? null : t })}
              className={cn(
                // gap-1, not a whitespace text node: flex containers drop
                // whitespace-only anonymous items, which rendered "INBOX0".
                "-mb-px inline-flex items-center justify-center gap-1 border-b-2 px-3 py-2 text-xs font-medium transition-colors max-sm:min-h-[44px]",
                visibleTab === t
                  ? "border-brand text-foreground"
                  : "border-transparent text-muted hover:text-foreground",
              )}
            >
              {TAB_LABELS[t] ?? t} <span className="text-faint tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>

      {(BOARD_TABS as readonly string[]).includes(visibleTab) && (
        <div className="mt-3 inline-flex rounded-lg border border-border p-0.5 text-xs" role="group" aria-label="View">
          {(["list", "board"] as const).map((view) => (
            <button
              key={view}
              type="button"
              aria-pressed={(view === "board") === board}
              onClick={() => setParams({ view: view === "board" ? "board" : null })}
              className={cn(
                "rounded-md px-3 py-1 font-medium capitalize transition-colors",
                (view === "board") === board ? "bg-surface-hover text-foreground" : "text-muted hover:text-foreground",
              )}
            >
              {view}
            </button>
          ))}
        </div>
      )}

      {!onInboxTab && minFilter != null && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-faint">Filtered:</span>
          <button
            type="button"
            onClick={() => setParams({ min: null })}
            className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand transition-colors hover:bg-brand/15"
            title="Clear score filter"
          >
            score ≥ {minFilter.toFixed(1)}
            <X className="size-3" />
          </button>
        </div>
      )}

      {!onInboxTab && selectedRows.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface/60 px-3 py-2 text-sm">
          <span className="tabular-nums">{selectedRows.length} selected</span>
          {selectedRows.length >= 2 && selectedRows.length <= COMPARE_MAX && (
            <Link
              href={`/pipeline/compare?n=${selectedRows.map((r) => r.n).join(",")}`}
              className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:border-brand/40 hover:text-brand"
            >
              Compare
            </Link>
          )}
          <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-muted hover:text-foreground">
            Clear
          </button>
        </div>
      )}

      {onInboxTab ? (
        /* ── Inbox: the triage surface (Abundance → Triage → Shortlist → Score) ── */
        <>
          {inbox === null ? (
            <div role="status" className="mt-4 overflow-x-auto rounded-2xl border border-border">
              <span className="sr-only">Loading inbox…</span>
              <table aria-hidden="true" className="w-full min-w-[44rem] text-sm">
                <tbody className="divide-y divide-border">
                  <PipelineTableRowsSkeleton />
                </tbody>
              </table>
            </div>
          ) : (
            <>
              {/* Keyed by tab so its filters and selection reset between Discovered and Triaged. */}
              <InboxTriage key={tab} inbox={inbox} />
              {inbox.length === 0 && tab === "INBOX" && <InboxEmpty tracked={visibleApplications.length} />}
              {inbox.length === 0 && tab === "TRIAGED" && (
                <p className="mt-4 text-center text-sm text-muted">Nothing triaged yet. Run Triage on a job under Discovered.</p>
              )}
            </>
          )}
        </>
      ) : board ? (
        <PipelineBoard rows={boardRows} statusLog={statusLog} detailQuery={detailQuery} />
      ) : !isPending && filtered.length > 0 && (GRID_TABS as readonly string[]).includes(tab) ? (
        // Cards with stage and status buttons cap at 3 columns to fit them.
        <ul className={cn("mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3", (tab === "EVALUATED" || tab === "OFFER") && "2xl:grid-cols-4")}>
          {filtered.map((r) => {
            const key = applicationKey(r);
            return (
              <TrackerCard
                key={key}
                row={r}
                reason={reasons[r.n] ?? null}
                detailHref={`/pipeline/${encodeURIComponent(r.n)}${detailQuery ? `?${detailQuery}` : ""}`}
                selected={selected.has(key)}
                onToggleSelect={() => toggleRow(key)}
              />
            );
          })}
        </ul>
      ) : isPending || filtered.length > 0 ? (
        /* ── Tracker table ──
           overflow-x-auto, not overflow-hidden: the rounded corners still clip,
           but a table too wide for the viewport can now be scrolled to instead
           of being silently cut off. min-w keeps the columns readable rather
           than letting w-full crush them on a phone. */
        <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="bg-surface/60 text-left text-xs uppercase tracking-wide text-faint">
              <tr>
                <th className="w-8 px-3 py-2.5">
                  <input
                    type="checkbox"
                    aria-label="Select all shown applications"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(filteredKeys))}
                  />
                </th>
                {SORT_KEYS.map((k) => (
                  <th
                    key={k}
                    aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                    className={cn(
                      "whitespace-nowrap px-4 py-2.5 font-medium",
                      k === "date" && "hidden lg:table-cell",
                    )}
                  >
                    <button
                      type="button"
                      className="inline-flex cursor-pointer select-none items-center gap-1 uppercase tracking-wide hover:text-foreground"
                      onClick={() => setParams({ sort: k, dir: sort.key === k ? sort.dir * -1 : -1 })}
                    >
                      {k}
                      <ChevronsUpDown aria-hidden="true" className="size-3" />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            {/* Keep editors mounted while query navigation is pending: sorting
                must not discard an open editor or an in-flight status save. */}
            <tbody className="divide-y divide-border" hidden={isPending} aria-busy={false}>
              {filtered.map((r) => {
                const company = companyPresentation(r);
                const key = applicationKey(r);
                const detailHref = `/pipeline/${encodeURIComponent(r.n)}${detailQuery ? `?${detailQuery}` : ""}`;
                const posting = postingHref(r.url);
                return (
                  <tr key={key} data-application-key={key} className="group transition-colors hover:bg-surface/40">
                    <td className="w-8 px-3 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${company.label}, ${r.role} (#${r.n})`}
                        checked={selected.has(key)}
                        onChange={() => toggleRow(key)}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium tabular-nums">
                      <Link href={detailHref} tabIndex={-1} className="transition-colors group-hover:text-brand">
                        #{r.n}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      <Link href={detailHref} className="flex items-center gap-2.5 transition-colors group-hover:text-brand">
                        <CompanyLogo name={company.logoName} size={20} />
                        {company.label}
                      </Link>
                    </td>
                  <td className="px-4 py-3 text-muted">
                    <div className="flex items-center gap-2">
                      <Link href={detailHref} tabIndex={-1}>{r.role}</Link>
                      {posting && (
                        <a
                          href={posting}
                          target="_blank"
                          rel="noreferrer"
                          title={posting}
                          className="inline-flex shrink-0 items-center gap-1 text-xs text-brand hover:underline"
                        >
                          {postingLabel(posting)}
                          <ExternalLink className="size-3" />
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={scoreTone(r.score)}>{r.score || "—"}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">
                    {isApproved(r) ? <Badge tone="good">Approved</Badge> : rowStatusText(r, statusLog)}
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-3 text-faint tabular-nums lg:table-cell">{r.date}</td>
                  </tr>
                );
              })}
            </tbody>
            {isPending && (
              <tbody className="divide-y divide-border" aria-busy="true">
                <PipelineTableRowsSkeleton trackerColumn />
              </tbody>
            )}
          </table>
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-12 text-center">
          <p className="font-display text-lg">No matches</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">Try a different tab or clear the search.</p>
        </div>
      )}
    </PageFrame>
  );
}

// The tracker writes a dash (or N/A) for "direct, no agency" in the Via column.
// The long dash is built from its code point: house rules keep it out of source.
const NO_VIA = new Set(["", "-", "N/A", String.fromCharCode(0x2014)]);

// A tracker row as a card, laid out like TriageRow (inbox/triage-row.tsx) so the
// Evaluated, Approved and Responded tabs read like Discovered and Triaged: header,
// the evaluator's call in the inset box, actions pinned to the bottom.
function TrackerCard({
  row,
  reason,
  detailHref,
  selected,
  onToggleSelect,
}: {
  row: Application;
  reason: CardReason | null;
  detailHref: string;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const company = companyPresentation(row);
  const posting = postingHref(row.url);
  const score = scoreNum(row.score);
  const approved = isApproved(row);
  const tabOfRow = trackerTabOf(row);
  // Applied rows show their hiring phase with its round ("SCREENING 2").
  const phase = approved ? null : currentPhase(row);
  const label = approved
    ? "APPROVED"
    : phase
      ? phaseLabel(phase.phase, phase.round).toUpperCase()
      : (TAB_LABELS[tabOfRow] ?? tabOfRow).replace(/_/g, " ");
  const labelStyle =
    approved || tabOfRow === "OFFER"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      : tabOfRow === "RESPONDED" || tabOfRow === "SCREENING" || tabOfRow === "ASSESSMENT"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        : tabOfRow.endsWith("INTERVIEW") || tabOfRow === "HIRING_MANAGER"
          ? "bg-violet-500/15 text-violet-700 dark:text-violet-400"
          : "bg-sky-500/15 text-sky-700 dark:text-sky-400";
  const via = NO_VIA.has(row.via.trim()) ? "" : row.via;

  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border p-4 transition-colors",
        selected ? "bg-brand-soft/50" : "bg-surface/40 hover:bg-surface-hover",
      )}
    >
      <div className="flex items-start gap-3">
        <CompanyLogo name={company.logoName} size={32} />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold text-foreground">{company.label}</p>
          <p className="mt-0.5 break-words text-sm leading-snug text-muted">
            <Link href={detailHref} className="hover:text-brand hover:underline">
              {row.role}
            </Link>
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
            <span className="tabular-nums">#{row.n}</span>
            {row.location && <span className="break-words">{row.location}</span>}
            {via && <span className="rounded bg-surface-hover px-1.5 py-px font-medium text-muted">via {via}</span>}
            {row.date && <span className="tabular-nums">{row.date}</span>}
          </p>
        </div>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`Select ${company.label}, ${row.role} (#${row.n})`}
          className="mt-1 size-4 shrink-0 accent-brand max-sm:min-h-[44px] max-sm:min-w-[24px]"
        />
      </div>

      <div className="rounded-lg border border-border/70 bg-background/60 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold tracking-wide", labelStyle)}>{label}</span>
          {!Number.isNaN(score) && (
            <span className="text-base font-semibold tabular-nums text-foreground">
              {score.toFixed(1)}
              <span className="text-xs font-normal text-faint">/5</span>
            </span>
          )}
        </div>
        {reason?.decision && <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-muted">{reason.decision}</p>}
        {(reason?.plus || reason?.minus) && (
          <ul className="mt-1.5 space-y-0.5 text-xs leading-snug">
            {reason.plus && (
              <li className="flex gap-1.5 text-emerald-700 dark:text-emerald-400">
                <Plus className="mt-0.5 size-3 shrink-0" />
                <span className="line-clamp-2">{reason.plus}</span>
              </li>
            )}
            {reason.minus && (
              <li className="flex gap-1.5 text-red-700 dark:text-red-400">
                <Minus className="mt-0.5 size-3 shrink-0" />
                <span className="line-clamp-2">{reason.minus}</span>
              </li>
            )}
          </ul>
        )}
      </div>

      {/* The same buttons as the report page, so a card can Approve, mark Applied
          with CV A/B, or move a Responded row on without opening it. */}
      <InterviewDate app={row} />
      <LifecycleActions app={row} compact className="mt-auto border-t border-border/60 pt-3" />

      <div className="flex flex-wrap items-center justify-end gap-1">
        {posting && (
          <a
            href={posting}
            target="_blank"
            rel="noreferrer"
            title={posting}
            className="inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-brand max-sm:min-h-[44px]"
          >
            {postingLabel(posting)} <ExternalLink className="size-3" />
          </a>
        )}
        <Link
          href={detailHref}
          className="inline-flex items-center justify-center rounded-md bg-brand-soft px-2 py-1 text-xs font-medium text-brand transition-colors hover:bg-brand/15 max-sm:min-h-[44px]"
        >
          Report
        </Link>
      </div>
    </li>
  );
}

// Empty inbox. Self-sufficient for the mainstream user (a primary in-web action),
// honest for devs (the CLI/file path stays, demoted to progressive transparency).
function InboxEmpty({ tracked }: { tracked: number }) {
  return (
    <div className="dot-bg mt-4 overflow-hidden rounded-2xl border border-border bg-surface/50 bg-origin-border bg-gradient-to-tr from-brand/10 via-transparent to-transparent shadow-lg">
      <div className="flex items-center gap-2 border-b border-foreground/10 px-5 py-3">
        <span className="size-2.5 rounded-full bg-foreground/15" aria-hidden="true" />
        <span className="size-2.5 rounded-full bg-foreground/15" aria-hidden="true" />
        <span className="size-2.5 rounded-full bg-foreground/15" aria-hidden="true" />
        <span className="ml-3 font-mono text-xs tracking-wide text-muted">landing-gear · discovered</span>
      </div>
      <div className="px-6 py-10 text-center">
        <p className="font-display text-lg">
          Nothing <span className="text-brand">discovered</span> waiting for review.
        </p>
        {tracked > 0 && (
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
            New postings land here. Your{" "}
            <Link href="/pipeline?tab=ALL" className="font-medium text-brand-text underline-offset-2 hover:underline">
              {tracked} tracked role{tracked === 1 ? "" : "s"}
            </Link>{" "}
            {tracked === 1 ? "is" : "are"} under All.
          </p>
        )}
        <p className="mx-auto mt-4 max-w-sm text-xs text-muted">
          Run <code className="rounded bg-surface-hover px-1 py-0.5 font-mono">career-ops scan</code>, or add job URLs to{" "}
          <code className="rounded bg-surface-hover px-1 py-0.5 font-mono">data/pipeline.md</code>.
        </p>
      </div>
    </div>
  );
}
