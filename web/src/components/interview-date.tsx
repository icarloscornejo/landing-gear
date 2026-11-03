"use client";

import { useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { DATED_PHASES, currentMark, isOpenApplied } from "@/lib/lifecycle.mjs";
import { formatInterviewDate, isoToWall } from "@/lib/interview-date.mjs";
import { useLifecyclePost } from "@/lib/use-lifecycle-post";
import { cn } from "@/lib/cn";
import type { Application } from "@/lib/landing-gear";

// The date of the round a row is in (house rule 25), shown and edited in place.
// `expected` overrides the phase this control was drawn for, for a card that has
// just moved (the board passes the /api/stage answer, so the first save is not
// stale). `startOpen` opens the field right away.
export function InterviewDate({
  app,
  expected,
  startOpen = false,
  onDone,
  className,
}: {
  app: Pick<Application, "n" | "status" | "notes">;
  expected?: { phase: string; round: number };
  startOpen?: boolean;
  onDone?: () => void;
  className?: string;
}) {
  const mark = currentMark(app);
  const [open, setOpen] = useState(startOpen);
  const [value, setValue] = useState(isoToWall(mark?.at));
  const { busy, error, post } = useLifecyclePost(onDone);
  const phase = expected?.phase ?? mark?.phase;
  if (!isOpenApplied(app) || !phase || !(DATED_PHASES as readonly string[]).includes(phase)) return null;
  const drawnFor = expected ?? (mark ? { phase: mark.phase, round: mark.round } : undefined);
  const at = expected ? null : mark?.at;

  const save = async (wall: string) => {
    if (await post("date", "/api/stage-date", { n: app.n, at: wall, expected: drawnFor })) setOpen(false);
  };

  return (
    <div className={cn("text-xs", className)}>
      {open ? (
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void save(value);
          }}
        >
          <input
            type="datetime-local"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-label="Interview date and time"
            className="rounded-md border border-border bg-background px-2 py-1 text-xs"
          />
          <button type="submit" disabled={!!busy || !value} className="rounded-md border border-brand/40 px-2 py-1 font-medium text-brand hover:bg-brand/10 disabled:opacity-60">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
          </button>
          {at && (
            <button type="button" disabled={!!busy} onClick={() => void save("")} className="px-1.5 py-1 text-muted hover:text-red-600 dark:hover:text-red-400">
              Clear
            </button>
          )}
          <button type="button" disabled={!!busy} onClick={() => setOpen(false)} className="px-1.5 py-1 text-muted hover:text-foreground">
            {startOpen && !at ? "Skip" : "Cancel"}
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-muted hover:text-foreground">
          <CalendarClock className="size-3.5" />
          {at ? <span className="font-medium text-foreground">{formatInterviewDate(at)}</span> : "Set date"}
          {at && <span className="text-faint">· edit</span>}
        </button>
      )}
      {error && <p role="alert" className="mt-1 text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
