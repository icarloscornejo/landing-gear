"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CalendarClock, CircleHelp, Inbox, MessageCircle, Sparkles, ArrowRight, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/cn";

function dayLabel(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
import type { Application, InboxJob } from "@/lib/career-ops";
import { FollowUpCard, type FollowUp } from "@/components/home/follow-up-card";
import { DecisionCard } from "@/components/home/decision-card";
import { LinkedinScanReminder } from "@/components/home/linkedin-scan-reminder";
import type { LinkedinScanState } from "@/lib/linkedin-scan";
import { DailyScanCard } from "@/components/home/daily-scan-card";
import type { DailyScanStatus } from "@/lib/daily-scan";
import type { CardReason } from "@/lib/machine-summary.mjs";
import { FollowupsDueSectionSkeleton } from "@/components/page-loading-skeletons";
import { scoreNum } from "@/lib/format";
import { pickAwaitingDecision, pickApproved, groupAwaiting } from "@/lib/home/awaiting.mjs";
import { companyPresentation } from "@/lib/company-presentation.mjs";
import { formatInterviewDate } from "@/lib/interview-date.mjs";
import { resolveHeroState, mayClaimAllClear, missingSourceLabel } from "@/lib/home/hero-state.mjs";

// The retention "Today": a dual-loop action queue (the maintainer's
// "N new matches this week · M follow-ups due"). SUPPLY loop = fresh free-scan
// matches (zero tokens, /api/whats-new); DEMAND loop = follow-ups due
// (/api/followups). Each item one-tap actionable. Home stays a VIEW over the
// canonical files — every action dispatches a real registry action / route.
export function TodayDashboard({
  applications,
  reasons,
  legitimacy,
  inbox,
  inBetween,
  overview,
  linkedinScan,
  dailyScan,
}: {
  applications: Application[];
  reasons: Record<string, CardReason>;
  /** Block-G legitimacy per report number, read by the page from each report. */
  legitimacy: Record<string, string>;
  inbox: Pick<InboxJob, "url" | "done">[];
  inBetween: boolean;
  /** Lifecycle stage counts and the rows in talks (lib/home/today-overview.mjs). */
  overview: {
    stages: { key: string; label: string; count: number; needsAction: boolean; hint: string }[];
    replies: { n: string; company: string; via: string; role: string; status: string; phase: string; date: string }[];
    upcoming: { n: string; company: string; role: string; phase: string; at: string; soon: boolean }[];
  };
  linkedinScan: LinkedinScanState;
  dailyScan: DailyScanStatus;
}) {
  const [followups, setFollowups] = useState<FollowUp[]>([]);
  const [overdue, setOverdue] = useState(0);
  const [followupsLoading, setFollowupsLoading] = useState(true);
  const [followupsError, setFollowupsError] = useState(false);
  const [followupsEnabled, setFollowupsEnabled] = useState(true);
  const [upcoming, setUpcoming] = useState<FollowUp[]>([]);
  const requestGeneration = useRef(0);
  const router = useRouter();

  const refetch = useCallback(() => {
    const generation = ++requestGeneration.current;
    const isLatest = () => generation === requestGeneration.current;
    setFollowupsLoading(true);
    setFollowupsError(false);
    fetch("/api/followups")
      .then((r) => {
        if (!r.ok) throw new Error("Follow-ups request failed");
        return r.json();
      })
      .then((d) => {
        if (!isLatest()) return;
        // The cadence route reports engine failures as HTTP 200 with
        // available:false; that is unavailable, not an empty action queue.
        if (d.available === false) throw new Error("Follow-ups unavailable");
        // /api/followups already filters to urgency 'urgent'/'overdue' — due
        // now, never 'waiting'/'cold' (#86). Both count toward "due"; a
        // missing metadata.overdue must read as 0 due, never as "every entry
        // is overdue" (the old `?? d.entries?.length` fallback).
        setFollowups(Array.isArray(d.entries) ? d.entries : []);
        setOverdue((d.metadata?.overdue ?? 0) + (d.metadata?.urgent ?? 0));
        setFollowupsEnabled(d.followupsEnabled !== false);
        setUpcoming(Array.isArray(d.upcoming) ? d.upcoming : []);
      })
      .catch(() => { if (isLatest()) setFollowupsError(true); })
      .finally(() => { if (isLatest()) setFollowupsLoading(false); });
  }, []);

  useEffect(() => {
    refetch();
    // A worker (evaluate/pdf) just wrote a real tracker row — refresh the server
    // snapshot (applications/inbox props) + the client loops so the freshly-scored
    // role appears in "Awaiting your decision" without a manual reload.
    const onDone = () => {
      router.refresh();
      refetch();
    };
    window.addEventListener("co-job-done", onDone);
    return () => {
      window.removeEventListener("co-job-done", onDone);
      requestGeneration.current += 1;
    };
  }, [refetch, router]);

  // Awaiting decision: scored (Evaluated) but no terminal status yet. The
  // ordering lives in lib/home/awaiting.mjs so it can be tested — see the file
  // for why "first six in the array" was a bug waiting for #3529.
  const awaiting = useMemo(() => pickAwaitingDecision(applications, scoreNum), [applications]);
  // Approved rows (house rule 12) get their own section above, all of them.
  const approved = useMemo(() => pickApproved(applications, scoreNum), [applications]);
  // With the legitimacy, a flagged posting is grouped as the report page
  // labels it (#5300), so "Apply next" below never points at one.
  const awaitingGroups = useMemo(() => groupAwaiting(awaiting, (a) => legitimacy[a.n]), [awaiting, legitimacy]);
  const recommended = awaitingGroups.find(([label]) => label === "Recommended")?.[1] ?? [];

  // Carlos does not run the portal scans, so the fresh-matches loop is off.
  const newThisWeek = 0;
  const freshLoading = false;
  const freshError = false;
  const dataLoading = followupsLoading || freshLoading;
  const dataError = followupsError || freshError;
  // Derived from the flags refetch() already maintains — no second fetch loop
  // and no second source of truth. The only thing added is the distinction
  // dataError cannot make: a failure with known work still has a queue to show.
  const heroState = resolveHeroState({
    followupsLoading,
    freshLoading,
    followupsError,
    freshError,
    overdue,
    newThisWeek,
    awaitingCount: awaiting.length + approved.length,
  });
  const allClear = mayClaimAllClear(heroState);
  const missingSources = missingSourceLabel({ followupsError, freshError });

  // The next follow-up batch: the earliest upcoming date and how many share it.
  const nextBatch = useMemo(() => {
    const dates = upcoming.map((u) => u.nextFollowupDate).filter((d): d is string => Boolean(d)).sort();
    return dates.length ? { date: dates[0], count: dates.filter((d) => d === dates[0]).length } : null;
  }, [upcoming]);
  const waiting = overview.stages.filter((s) => s.needsAction && (s.key === "INBOX" || s.key === "TRIAGED"));
  const decisions = approved.length + awaiting.length;
  const summary = [
    followups.length > 0 && `${followups.length} follow-up${followups.length === 1 ? "" : "s"} due`,
    decisions > 0 && `${decisions} waiting on your decision`,
    nextBatch && `next follow-ups ${dayLabel(nextBatch.date)}`,
  ].filter(Boolean).join(" · ");

  return (
    <div className="px-6 py-10 max-sm:pb-24">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-faint">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
        <h1 className="mt-1 font-display text-3xl tracking-tight text-landing">Today</h1>
        {summary && <p className="mt-1 text-sm text-muted">{summary}</p>}
      </header>

      {/* The lifecycle at a glance; stages waiting on Carlos stand out. */}
      <nav aria-label="Lifecycle" className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {overview.stages.map((stage) => (
          <Link
            key={stage.key}
            href={stage.key === "INBOX" ? "/pipeline" : `/pipeline?tab=${stage.key}`}
            className={cn(
              "group rounded-2xl border px-4 py-3 transition-colors",
              stage.needsAction ? "border-brand/40 bg-brand-soft/40 hover:bg-brand-soft/70" : "border-border bg-surface/40 hover:bg-surface-hover",
            )}
          >
            <p className="text-[11px] uppercase tracking-wide text-faint">{stage.label}</p>
            <p className={cn("mt-1 font-display text-3xl tabular-nums", stage.needsAction ? "text-landing" : "text-muted")}>{stage.count}</p>
            <p className="text-xs text-faint group-hover:text-brand">{stage.hint}</p>
          </Link>
        ))}
      </nav>

      <LinkedinScanReminder state={linkedinScan} />
      <DailyScanCard initial={dailyScan} />

      {dataError && !dataLoading && (
        <div role="alert" className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface/40 px-5 py-4 text-sm text-muted">
          <p>{missingSources} could not be loaded.</p>
          <button type="button" onClick={refetch} className="font-medium text-brand hover:underline">Retry updates</button>
        </div>
      )}

      {/* A. Follow-ups due (demand loop) */}
      {followupsLoading ? (
        <FollowupsDueSectionSkeleton />
      ) : followupsError ? (
        null
      ) : followups.length > 0 ? (
        <Section icon={Bell} title="Follow-ups due" hint="Send the nudge, then mark it sent">
          <div className="grid gap-2.5 lg:grid-cols-2">
            {followups.map((f) => (
              // Refetch (not a local decrement) so the parent's followups/upcoming
              // stay in sync with the server.
              <FollowUpCard key={`${f.num}-${f.company}`} followup={f} onLogged={refetch} />
            ))}
          </div>
        </Section>
      ) : null}

      {overview.upcoming.length > 0 && (
        <Section icon={CalendarClock} title="Upcoming interviews" hint="dated rounds, soonest first">
          <ul className="grid gap-2 sm:grid-cols-2">
            {overview.upcoming.map((u) => (
              <li key={u.n}>
                <Link
                  href={`/pipeline/${u.n}`}
                  className={cn(
                    "flex items-baseline justify-between gap-3 rounded-xl border px-4 py-3 text-sm transition-colors hover:bg-surface-hover",
                    u.soon ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-surface/40",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{companyPresentation(u).label}</span>
                    <span className="block truncate text-xs text-muted">{u.phase} · {u.role}</span>
                  </span>
                  <span className={cn("shrink-0 text-xs", u.soon ? "font-semibold text-amber-700 dark:text-amber-400" : "text-muted")}>
                    {u.soon ? "Soon · " : ""}{formatInterviewDate(u.at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(nextBatch || overview.replies.length > 0 || waiting.length > 0) && (
        <div className="mt-8 grid gap-3 lg:grid-cols-3">
          {nextBatch && (
            <Link href="/followups" className="rounded-2xl border border-border bg-surface/40 px-5 py-4 transition-colors hover:bg-surface-hover">
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-faint"><CalendarClock className="size-3.5" /> Next follow-ups</p>
              <p className="mt-2 font-display text-2xl text-landing">{dayLabel(nextBatch.date)}</p>
              <p className="text-sm text-muted">{nextBatch.count} application{nextBatch.count === 1 ? "" : "s"} to nudge</p>
            </Link>
          )}
          {overview.replies.length > 0 && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-5 py-4">
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400"><MessageCircle className="size-3.5" /> In talks</p>
              <ul className="mt-2 space-y-1.5">
                {overview.replies.slice(0, 4).map((r) => (
                  <li key={r.n}>
                    <Link href={`/pipeline/${r.n}`} className="flex items-baseline justify-between gap-2 text-sm hover:text-brand">
                      <span className="min-w-0 truncate font-medium text-foreground">{companyPresentation(r).label}</span>
                      <span className="shrink-0 text-xs text-muted">{r.phase || r.status.charAt(0) + r.status.slice(1).toLowerCase()}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {waiting.length > 0 && (
            <div className="rounded-2xl border border-border bg-surface/40 px-5 py-4">
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-faint"><Inbox className="size-3.5" /> New postings</p>
              <ul className="mt-2 space-y-1.5">
                {waiting.map((s) => (
                  <li key={s.key}>
                    <Link href={s.key === "INBOX" ? "/pipeline" : `/pipeline?tab=${s.key}`} className="flex items-baseline justify-between gap-2 text-sm hover:text-brand">
                      <span className="text-foreground">{s.count} {s.label.toLowerCase()}</span>
                      <span className="text-xs text-muted">{s.hint} <ArrowRight className="inline size-3" /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Approved by Carlos, not applied yet (house rule 12) */}
      {approved.length > 0 && (
        <Section icon={ThumbsUp} title="Approved, ready to apply" hint="Pick the CV you send">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {approved.map((a) => (
              <DecisionCard key={a.n} app={a} reason={reasons[a.n]} />
            ))}
          </div>
        </Section>
      )}

      {/* B. Awaiting your decision */}
      {awaiting.length > 0 && (
        <Section icon={CircleHelp} title="Awaiting your decision" hint="Best score first">
          {recommended.length > 0 && (
            <Link
              href={`/pipeline/${recommended[0].n}`}
              className="mb-3 inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition hover:bg-brand-200 max-sm:min-h-[44px]"
            >
              Apply next · {companyPresentation(recommended[0]).label} {recommended[0].score} <ArrowRight className="size-4" />
            </Link>
          )}
          {awaitingGroups.map(([label, group]) => (
            <div key={label} className="mb-3">
              <h3 className="mb-2 text-xs font-medium text-faint">{label}</h3>
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {group.map((a) => (
                  <DecisionCard key={a.n} app={a} reason={reasons[a.n]} />
                ))}
              </div>
            </div>
          ))}
        </Section>
      )}

      {allClear && !nextBatch && overview.replies.length === 0 && waiting.length === 0 && (
        <div className="mt-8 rounded-2xl border border-border bg-surface/30 px-6 py-10 text-center">
          <Sparkles className="mx-auto size-6 text-brand" />
          <p className="mx-auto mt-3 max-w-md text-sm text-muted">
            Nothing needs you right now. Check your <Link href="/pipeline" className="text-brand hover:underline">pipeline</Link>.
          </p>
        </div>
      )}
    </div>
  );
}

function Section({ icon: Icon, title, hint, children }: { icon: React.ComponentType<{ className?: string }>; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="size-4 text-brand" />
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted">{title}</h2>
        <span className="text-xs text-faint">· {hint}</span>
      </div>
      {children}
    </section>
  );
}
