"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, History } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { WorkerCard, pillTone, TONE } from "@/components/jobs/worker-card";
import { workerDetailsLabel, workerIdentity } from "@/lib/worker-feedback.mjs";
import { cn } from "@/lib/cn";

// Back-compat re-exports (app/jobs/page.tsx imports pillTone from here).
export { pillTone, TONE };

// Collapsed "worker" pills in the sidebar — each the shared <WorkerCard> wrapped
// in a Link to its detail. Same component the assistant chat renders inline.
export function WorkerPills() {
  const { jobs, removeJob } = useJobs();
  const pathname = usePathname();
  // Only runs still going; finished and failed ones live in History (/jobs).
  const runningJobs = jobs.filter((j) => j.status === "running");
  if (runningJobs.length === 0) return null;
  const running = runningJobs.length;

  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-faint">Workers</span>
        {running > 0 && <span className="text-[10px] tabular-nums text-brand">{running} running</span>}
        <Link href="/jobs" className="ml-auto text-faint transition-colors hover:text-foreground" title="History" aria-label="Worker history">
          <History className="size-3.5" />
        </Link>
      </div>
      {/* Every worker, scrolling inside the sidebar: a bulk run starts more than fit. */}
      <ul className="max-h-[50vh] space-y-1.5 overflow-y-auto overscroll-contain pr-1">
        {runningJobs.map((j) => {
          const active = pathname === `/jobs/${j.id}`;
          return (
            <li key={j.id} className="group relative">
              <Link
                href={`/jobs/${j.id}`}
                aria-label={workerDetailsLabel(j)}
                className={cn(
                  "block rounded-lg border py-2 pl-2.5 pr-7 transition-colors",
                  active ? "border-brand/50 bg-brand-soft" : "border-border bg-surface/60 hover:bg-surface-hover",
                )}
              >
                <WorkerCard job={j} variant="tray" />
              </Link>
              <button
                onClick={() => removeJob(j.id)}
                className="absolute right-2 top-2 rounded text-faint opacity-100 [@media(hover:hover)]:opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                aria-label={`Dismiss worker: ${workerIdentity(j)}`}
              >
                <X className="size-3" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
