"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, ChevronDown, ChevronRight, Loader2, Pin, Search, Send, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CompanyLogo } from "@/components/company-logo";
import { LogDialog } from "@/components/followups/log-dialog";
import { QuietCompanies } from "@/components/followups/quiet-companies";
import { NextDateDialog } from "@/components/followups/next-date-dialog";
import { type CadenceEntry, type CadenceMetadata, relativeDays } from "@/lib/followups";
import { cvSent, groupFollowups } from "@/lib/followup-groups.mjs";
import { LifecycleActions } from "@/components/lifecycle-actions";
import { companyPresentation } from "@/lib/company-presentation.mjs";
import { cn } from "@/lib/cn";

// Follow-ups the way Carlos works them: applying pins the first follow-up date;
// on that day he sends a message (LinkedIn or email) and marks it sent; a reply
// or a rejection moves the status forward. One list grouped by follow-up date,
// due rows first. The verdict is the core's followup-cadence.mjs (via
// /api/followups?full=1); this view only groups and records.

type CadenceResponse = { available: boolean; metadata: CadenceMetadata | null; entries: CadenceEntry[] };

function dayLabel(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function FollowupsView() {
  const [data, setData] = useState<CadenceResponse | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [dialogFor, setDialogFor] = useState<CadenceEntry | null>(null);
  const [pinFor, setPinFor] = useState<CadenceEntry | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const refetch = useCallback(() => {
    fetch("/api/followups?full=1")
      .then((r) => r.json())
      .then((d: CadenceResponse) => setData(d))
      .catch(() => setData({ available: false, metadata: null, entries: [] }));
  }, []);
  useEffect(refetch, [refetch]);

  const entries = useMemo(() => {
    const all = data?.available ? data.entries : [];
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((e) => `${e.company} ${e.role}`.toLowerCase().includes(needle)) : all;
  }, [data, q]);
  const groups = useMemo(() => groupFollowups(entries), [entries]);
  const nextBatch = groups.find((g) => !g.due && g.date);

  const removeLogged = async (num: number) => {
    setActionError(null);
    try {
      const res = await fetch("/api/followups/log", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ num }) });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError(typeof j.error === "string" ? `Couldn't remove the follow-up: ${j.error}` : "Couldn't remove the follow-up.");
      }
    } catch {
      setActionError("Couldn't remove the follow-up.");
    }
    refetch();
  };


  const toggle = (num: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(num)) next.delete(num);
      else next.add(num);
      return next;
    });

  return (
    <div className="mx-auto max-w-none px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight text-landing">Follow-ups</h1>
          <p className="mt-1 text-sm text-muted">
            {!data ? (
              <span className="inline-flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" /> Loading…</span>
            ) : !data.available || !data.metadata ? (
              "Follow-up data unavailable"
            ) : (
              <>
                <span className="tabular-nums">{data.metadata.actionable}</span> waiting on a reply
                {nextBatch?.date && <> · next batch {dayLabel(nextBatch.date)} ({nextBatch.entries.length})</>}
              </>
            )}
          </p>
        </div>
        <div className="relative w-56 max-w-[45vw]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search company or role…"
            className="w-full rounded-md border border-border bg-surface/60 py-2 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-faint focus:border-brand/50 focus-visible:ring-2 focus-visible:ring-brand/40"
          />
        </div>
      </div>

      {actionError && <p role="alert" className="mt-3 text-xs text-red-500">{actionError}</p>}

      {data && !data.available && (
        <p className="mt-8 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted">The cadence engine (followup-cadence.mjs) returned nothing; check that the core scripts are present.</p>
      )}

      {data?.available &&
        groups.map((group) => {
          if (group.due && group.entries.length === 0) {
            return (
              <p key={group.key} className="mt-6 rounded-xl border border-border bg-surface/30 px-4 py-3 text-sm text-muted">
                Nothing due today.
              </p>
            );
          }
          return (
            <section key={group.key} className="mt-7">
              <h2 className={cn("flex items-baseline gap-2 text-sm font-semibold", group.due ? "text-red-600 dark:text-red-400" : "text-foreground")}>
                {group.due ? "Due now" : group.date ? dayLabel(group.date) : "No follow-up date"}
                <span className="text-xs font-normal text-faint">
                  {group.entries.length} application{group.entries.length === 1 ? "" : "s"}
                  {!group.due && group.entries[0]?.daysUntilNext != null && ` · ${relativeDays(group.entries[0].daysUntilNext)}`}
                </span>
              </h2>
              {/* Two columns when there is room; each application is its own card. */}
              <ul className={cn("mt-2 grid gap-3 lg:grid-cols-2", group.due && "[&>li]:border-red-500/40")}>
                {group.entries.map((entry) => (
                  <FollowupRow
                    key={entry.num}
                    entry={entry}
                    expanded={expanded.has(entry.num)}
                    onToggle={() => toggle(entry.num)}
                    onLog={() => setDialogFor(entry)}
                    onPin={() => setPinFor(entry)}
                    onChanged={refetch}
                    onRemove={removeLogged}
                  />
                ))}
              </ul>
            </section>
          );
        })}

      {/* The far end of chasing: companies silent after an interview. */}
      <QuietCompanies />

      {dialogFor && <LogDialog entry={dialogFor} onClose={() => setDialogFor(null)} onLogged={refetch} />}
      {pinFor && <NextDateDialog entry={pinFor} onClose={() => setPinFor(null)} onChanged={refetch} />}
    </div>
  );
}

function FollowupRow({
  entry: e,
  expanded,
  onToggle,
  onLog,
  onPin,
  onChanged,
  onRemove,
}: {
  entry: CadenceEntry;
  expanded: boolean;
  onToggle: () => void;
  onLog: () => void;
  onPin: () => void;
  /** Reload the list after a phase move or exit: this page loads its rows client-side. */
  onChanged: () => void;
  onRemove: (num: number) => void;
}) {
  const cv = cvSent(e.notes);
  const company = companyPresentation({ company: e.company, via: e.via ?? "" });
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const action = "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors max-sm:min-h-[44px]";
  return (
    <li className="flex flex-col rounded-2xl border border-border bg-surface/30 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link href={`/pipeline/${e.num}`} className="flex min-w-0 flex-1 items-center gap-3 hover:text-brand">
          <CompanyLogo name={company.logoName} size={28} />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">{company.label}</span>
            <span className="block text-sm text-muted">{e.role}</span>
          </span>
        </Link>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
          {e.status !== "applied" && <Badge tone="info">{e.status.charAt(0).toUpperCase() + e.status.slice(1)}</Badge>}
          <span>applied {e.daysSinceApplication === 0 ? "today" : `${e.daysSinceApplication}d ago`}</span>
          {cv && <span>CV {cv}</span>}
          {e.via && e.company !== "?" && <span>via {e.via}</span>}
          {e.followupCount > 0 && <span>{e.followupCount} follow-up{e.followupCount === 1 ? "" : "s"} sent</span>}
          {e.nextOverride && <Pin className="size-3 text-brand" aria-label={`Date moved to ${e.nextOverride}`} />}
        </div>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2.5">
        <button type="button" onClick={onLog} className={cn(action, "border border-brand/40 text-brand hover:bg-brand-soft")}>
          <Send className="size-3.5" /> Follow-up sent
        </button>
        <button type="button" onClick={onPin} className={cn(action, "text-muted hover:text-foreground")}>
          <CalendarClock className="size-3.5" /> Move date
        </button>
        <button type="button" onClick={onToggle} aria-expanded={expanded} className={cn(action, "ml-auto text-faint hover:text-foreground")}>
          <Chevron className="size-3.5" /> History
        </button>
      </div>
      {/* Phase moves and exits (house rule 25), the same buttons as the report page. */}
      <LifecycleActions app={{ n: String(e.num), status: e.status, notes: e.notes }} compact onDone={onChanged} className="pt-2" />
      {expanded && <HistoryPanel entry={e} onRemove={onRemove} />}
    </li>
  );
}

function HistoryPanel({ entry: e, onRemove }: { entry: CadenceEntry; onRemove: (num: number) => void }) {
  // Tolerate an older core engine whose entries predate followups[].
  const history = e.followups ?? [];
  return (
    <div className="mt-3 space-y-2 border-t border-border/60 pt-3 text-sm">
      {history.length === 0 ? (
        <p className="text-faint">No follow-ups sent yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {history.map((f, i) => (
            <li key={`${f.num ?? "b"}-${f.date}-${i}`} className="group/item flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="tabular-nums text-muted">{f.date}</span>
              <Badge tone="muted">{f.channel}</Badge>
              {f.contact && <span className="text-muted">{f.contact}</span>}
              {f.notes && <span className="text-faint">{f.notes}</span>}
              {f.num != null && (
                <button
                  type="button"
                  onClick={() => onRemove(f.num!)}
                  title="Remove this logged follow-up (added by mistake?)"
                  aria-label={`Remove follow-up logged ${f.date}`}
                  className="rounded p-0.5 text-faint opacity-0 transition group-hover/item:opacity-100 hover:text-red-500 focus-visible:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {e.contacts.length > 0 && (
        <p className="text-xs text-faint">
          Contacts:{" "}
          {e.contacts.map((c, i) => (
            <span key={c.email}>
              {i > 0 && ", "}
              {c.name ? `${c.name} (${c.email})` : c.email}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
