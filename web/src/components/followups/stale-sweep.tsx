"use client";

import { useState } from "react";
import Link from "next/link";
import { Archive } from "lucide-react";
import type { CadenceEntry } from "@/lib/followups";
import { currentPhase } from "@/lib/lifecycle.mjs";
import { STALE_DAYS, staleSweep } from "@/lib/stale-sweep.mjs";

// Applied rows silent for `days` (profile.yml followup_cadence.ghosted_after_days, default 60;
// lib/stale-sweep.mjs). "Mark all ghosted" closes only the
// bulk group, through the same /api/exit write as a row's own Ghosted button, one row at a
// time with the phase guard: a row that moved since the page loaded is refused, and the sweep
// stops there. Pinned and estimated rows are listed for one-by-one action only.
export function StaleSweep({ entries, retired, days = STALE_DAYS, onChanged }: { entries: CadenceEntry[]; retired: CadenceEntry[]; days?: number; onChanged: () => void }) {
  const { bulk, pinned, estimated } = staleSweep(entries, retired, days);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!bulk.length && !pinned.length && !estimated.length) return null;

  async function ghostAll() {
    setBusy(true);
    setMessage(null);
    let done = 0;
    for (const entry of bulk) {
      const phase = currentPhase({ status: "Applied", notes: entry.notes });
      const res = await fetch("/api/exit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ n: String(entry.num), kind: "ghosted", expected: phase ?? { phase: "applied", round: 1 } }),
      }).catch(() => null);
      if (!res?.ok) {
        const error = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : null;
        setMessage(`Stopped at #${entry.num} ${entry.company}: ${error ?? "request failed"}. ${done} closed before it.`);
        break;
      }
      done += 1;
    }
    if (done === bulk.length) setMessage(`${done} closed as ghosted.`);
    setBusy(false);
    setConfirming(false);
    onChanged();
  }

  const rowLink = (entry: CadenceEntry, note?: string) => (
    <li key={entry.num} className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <Link href={`/pipeline/${entry.num}`} className="font-medium text-foreground hover:text-brand">
        {entry.company}
      </Link>
      <span className="text-muted">{entry.role}</span>
      <span className="text-xs text-faint">
        applied {entry.daysSinceApplication}d ago{note ? `, ${note}` : ""}
      </span>
    </li>
  );

  return (
    <section className="mt-8 rounded-2xl border border-border bg-surface/40 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Archive className="size-4 text-brand" />
        <h2 className="font-display text-base text-landing">Quiet {days}+ days</h2>
        <span className="text-xs text-faint">Applied, no reply and no follow-up in {days} days</span>
      </div>
      {bulk.length > 0 && (
        <>
          <ul className="mt-3 grid gap-1.5">{bulk.map((entry) => rowLink(entry))}</ul>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {confirming ? (
              <>
                <span className="text-xs text-muted">Close {bulk.length} as ghosted?</span>
                <button type="button" disabled={busy} onClick={ghostAll} className="rounded-md border border-red-500/40 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400 max-sm:min-h-[44px]">
                  {busy ? "Closing..." : "Yes, ghosted"}
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="rounded-md px-2.5 py-1.5 text-xs text-muted hover:text-foreground max-sm:min-h-[44px]">
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirming(true)} className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface max-sm:min-h-[44px]">
                Mark all ghosted
              </button>
            )}
          </div>
        </>
      )}
      {message && <p className="mt-2 text-xs text-muted">{message}</p>}
      {pinned.length + estimated.length > 0 && (
        <>
          <p className="mt-4 text-xs text-faint">Not in the bulk action: open each one to decide.</p>
          <ul className="mt-1.5 grid gap-1.5">
            {pinned.map((entry) => rowLink(entry, `follow-up pinned for ${entry.nextOverride}`))}
            {estimated.map((entry) => rowLink(entry, "applied date estimated"))}
          </ul>
        </>
      )}
    </section>
  );
}
