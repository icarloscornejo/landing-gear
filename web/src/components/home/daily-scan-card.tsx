"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Radar } from "lucide-react";
import type { DailyScanStatus } from "@/lib/daily-scan";

function when(iso: string): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return date.toDateString() === new Date().toDateString()
    ? `today ${time}`
    : `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${time}`;
}

// The zero-token portal scan (scan.mjs + mobile.career). Runs by itself every day
// from 12:00 while the web server is up; the button runs it now. Only a run that
// finished cleanly counts as "last run".
export function DailyScanCard({ initial }: { initial: DailyScanStatus }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!status.running) return;
    const timer = setInterval(async () => {
      try {
        const response = await fetch("/api/daily-scan", { cache: "no-store" });
        const next: DailyScanStatus = await response.json();
        setStatus(next);
        if (!next.running) router.refresh(); // new postings show up in the lifecycle counts
      } catch (pollError) {
        console.warn("daily scan status poll failed", pollError);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [status.running, router]);

  async function runNow() {
    setError("");
    try {
      const response = await fetch("/api/daily-scan", { method: "POST" });
      const body = await response.json();
      if (!response.ok) setError(body.error ?? `HTTP ${response.status}`);
      setStatus({ running: body.running ?? true, lastComplete: body.lastComplete ?? null, lastFailure: body.lastFailure ?? null });
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    }
  }

  const { lastComplete, lastFailure } = status;
  const added = lastComplete?.newPostings.length ?? 0;
  return (
    <div className="mt-3 rounded-2xl border border-border bg-surface/40 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Radar className="size-4 text-brand" /> Portal scan
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {status.running
              ? "Scanning the portals now (about a minute)…"
              : lastComplete
                ? `Last complete run ${when(lastComplete.finishedAt)}: ${added} new posting${added === 1 ? "" : "s"} to Discovered.`
                : "No complete run yet."}
            {!status.running && " Runs by itself every day from 8 am."}
          </p>
          {!status.running && lastFailure && (
            <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
              The run started {when(lastFailure.startedAt)} did not finish{lastFailure.exitCode !== null ? ` (exit code ${lastFailure.exitCode})` : ""}; see .landing-gear-web/daily-scan.log.
            </p>
          )}
          {error && <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>
        <button
          type="button"
          onClick={() => void runNow()}
          disabled={status.running}
          aria-busy={status.running}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand disabled:opacity-60 max-sm:min-h-[44px]"
        >
          {status.running && <Loader2 className="size-3.5 animate-spin" />}
          {status.running ? "Scanning…" : "Run scan now"}
        </button>
      </div>
      {!status.running && lastComplete && added > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-muted">
          {lastComplete.newPostings.slice(0, 8).map((line) => <li key={line}>+ {line}</li>)}
          {added > 8 && <li className="text-faint">and {added - 8} more in Discovered</li>}
        </ul>
      )}
    </div>
  );
}
