"use client";

import { useState } from "react";
import { useLifecyclePost } from "@/lib/use-lifecycle-post";
import { Check, Copy, Loader2, ThumbsUp, X } from "lucide-react";
import { EXIT_KINDS, currentPhase, isOpenApplied, nextPhases, nextRound, nextStatuses, phaseInfo, phaseLabel, type ExitKind } from "@/lib/lifecycle.mjs";
import { cn } from "@/lib/cn";
import { canonStatus } from "@/lib/status-alias.mjs";
import { isApproved } from "@/lib/home/awaiting.mjs";
import type { Application } from "@/lib/landing-gear";

// A button key while that button is saving.
type Busy = string;

/** What each exit button says, in the engineer's voice. */
export const EXIT_LABELS: Record<ExitKind, string> = {
  rejected: "They rejected me",
  withdrawn: "I withdrew",
  ghosted: "Ghosted",
  closed: "Posting closed",
};

// The engineer's lifecycle buttons for one tracker row (house rules 6, 9, 12, 25):
// Evaluated -> Approve -> "Applied with CV A" / "CV B" -> hiring phases (next
// round, later phases) -> an exit that records the phase it ended at. Applied is
// only ever written through /api/apply-cv, so the CV choice is always recorded.
// `compact` matches the pipeline cards' button size (inbox/triage-row.tsx).
// `onDone` runs after every answer, success or not, so a page that loads its
// rows client-side (Follow-ups) refetches and never keeps stale buttons.
export function LifecycleActions({ app, className, onDone, compact = false }: { app: Pick<Application, "n" | "status" | "notes">; className?: string; onDone?: () => void; compact?: boolean }) {
  const { busy, error, note, needsCvRetry, post: send } = useLifecyclePost(onDone);
  const [confirmExit, setConfirmExit] = useState<ExitKind | "discard" | null>(null);
  const [repeatOpen, setRepeatOpen] = useState(false);

  const approved = isApproved(app);
  const status = canonStatus(String(app.status ?? "").trim());
  const evaluated = status === "EVALUATED";
  const applied = isOpenApplied(app);
  const phase = currentPhase(app);
  // The phase and round these buttons are drawn for; the server refuses a write
  // when the row has moved since (house rule 25).
  const expected = phase ? { phase: phase.phase, round: phase.round } : undefined;
  const phases = applied ? nextPhases(app) : [];
  // Rows never applied to keep plain Discard and Repeated; applied rows exit
  // through the exit buttons, which record the phase.
  const canDiscard = !applied && nextStatuses(status).includes("Discarded");

  const post = async (kind: Busy, url: string, payload: Record<string, unknown>) => {
    if (await send(kind, url, payload)) {
      setConfirmExit(null);
      setRepeatOpen(false);
    }
  };

  const button = cn(
    "inline-flex items-center justify-center rounded-md text-xs font-medium transition disabled:opacity-60 max-sm:min-h-[44px]",
    compact ? "gap-1 px-2 py-1" : "gap-1.5 px-2.5 py-1.5",
  );
  const spinner = <Loader2 className="size-3.5 animate-spin" />;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className={cn("flex flex-wrap items-center", compact ? "gap-1" : "gap-2")}>
        {approved ? (
          <>
            {/* An action, not a state: click it once you have sent the application. */}
            <span className="text-xs text-muted">Mark as applied with:</span>
            <button type="button" disabled={!!busy} onClick={() => post("a", "/api/apply-cv", { n: app.n, cv: "a" })} title="I sent it with CV A" className={cn(button, "border border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400")}>
              {busy === "a" ? spinner : <Check className="size-3.5" />} CV A
            </button>
            <button type="button" disabled={!!busy} onClick={() => post("b", "/api/apply-cv", { n: app.n, cv: "b" })} title="I sent it with CV B" className={cn(button, "border border-border text-muted hover:text-foreground")}>
              {busy === "b" ? spinner : <Check className="size-3.5" />} CV B
            </button>
          </>
        ) : evaluated ? (
          <button type="button" disabled={!!busy} onClick={() => post("approve", "/api/approve", { n: app.n })} className={cn(button, "border border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400")}>
            {busy === "approve" ? spinner : <ThumbsUp className="size-3.5" />} Approve
          </button>
        ) : null}

        {phases.map((key) => {
          const repeat = phase?.phase === key;
          return (
            <button
              key={key}
              type="button"
              disabled={!!busy}
              onClick={() => post(key, "/api/stage", { n: app.n, phase: key, expected })}
              title={repeat ? `Another ${phaseInfo(key).label} round` : `Move to ${phaseInfo(key).label}`}
              className={cn(button, repeat ? "border border-border text-foreground hover:bg-surface-hover" : "border border-brand/40 text-brand hover:bg-brand/10")}
            >
              {busy === key ? spinner : null} {repeat ? `Next round (${phaseLabel(key, nextRound(app, key))})` : phaseInfo(key).label}
            </button>
          );
        })}

        {applied && (Object.keys(EXIT_KINDS) as ExitKind[]).map((kind) =>
          confirmExit === kind ? (
            <span key={kind} className="inline-flex items-center gap-1">
              <button type="button" disabled={!!busy} onClick={() => post(kind, "/api/exit", { n: app.n, kind, expected })} className={cn(button, "border border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-400")}>
                {busy === kind ? spinner : <X className="size-3.5" />} Yes, {EXIT_LABELS[kind].toLowerCase()}
              </button>
              <button type="button" disabled={!!busy} onClick={() => setConfirmExit(null)} className={cn(button, "text-muted hover:text-foreground")}>Cancel</button>
            </span>
          ) : (
            <button key={kind} type="button" disabled={!!busy} onClick={() => setConfirmExit(kind)} className={cn(button, "text-muted hover:text-red-600 dark:hover:text-red-400")}>
              {EXIT_LABELS[kind]}
            </button>
          ),
        )}

        {canDiscard && (repeatOpen ? (
          <>
            <button type="button" disabled={!!busy} onClick={() => post("repeated", "/api/repeated", { n: app.n })} className={cn(button, "border border-border text-foreground hover:bg-surface-hover")}>
              {busy === "repeated" ? spinner : <Copy className="size-3.5" />} Yes, repeated
            </button>
            <button type="button" disabled={!!busy} onClick={() => setRepeatOpen(false)} className={cn(button, "text-muted hover:text-foreground")}>Cancel</button>
          </>
        ) : (
          <button type="button" disabled={!!busy} onClick={() => setRepeatOpen(true)} title="This posting is already in the tracker as another row" className={cn(button, "text-muted hover:text-foreground")}>
            <Copy className="size-3.5" /> Repeated
          </button>
        ))}
        {canDiscard && (confirmExit === "discard" ? (
          <>
            <button type="button" disabled={!!busy} onClick={() => post("Discarded", "/api/status", { n: app.n, status: "Discarded" })} className={cn(button, "border border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-400")}>
              {busy === "Discarded" ? spinner : <X className="size-3.5" />} Yes, discard
            </button>
            <button type="button" disabled={!!busy} onClick={() => setConfirmExit(null)} className={cn(button, "text-muted hover:text-foreground")}>Cancel</button>
          </>
        ) : (
          <button type="button" disabled={!!busy} onClick={() => setConfirmExit("discard")} className={cn(button, "text-muted hover:text-red-600 dark:hover:text-red-400")}>
            <X className="size-3.5" /> Discard
          </button>
        ))}
        {needsCvRetry && (
          <button type="button" disabled={!!busy} onClick={() => post("retry", "/api/apply-cv", { n: app.n, retryOutcomeOnly: true })} className={cn(button, "border border-amber-500/40 text-amber-700 dark:text-amber-400")}>
            {busy === "retry" ? spinner : null} Retry CV log
          </button>
        )}
      </div>
      {needsCvRetry && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">Applied, but the CV log failed.</p>}
      {note && !needsCvRetry && <p role="status" className="text-xs text-muted">{note}</p>}
      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
