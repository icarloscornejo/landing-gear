"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, ThumbsUp, X } from "lucide-react";
import { nextStatuses } from "@/lib/lifecycle.mjs";
import { cn } from "@/lib/cn";
import { canonStatus } from "@/lib/status-alias.mjs";
import { isApproved } from "@/lib/home/awaiting.mjs";
import type { Application } from "@/lib/career-ops";

// A status name while that status button is saving.
type Busy = string;

// Carlos's lifecycle buttons for one tracker row (house rules 6, 9, 12):
// Evaluated -> Approve -> "Applied with CV A" / "CV B". Applied is only ever
// written through /api/apply-cv, so the CV choice is always recorded.
export function LifecycleActions({ app, className, onDone }: { app: Pick<Application, "n" | "status" | "notes">; className?: string; onDone?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>("");
  const [error, setError] = useState<string | null>(null);
  const [needsCvRetry, setNeedsCvRetry] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const submitting = useRef(false);

  const approved = isApproved(app);
  const current = canonStatus(String(app.status ?? "").trim());
  const evaluated = current === "EVALUATED";
  // The next statuses in order (lifecycle.mjs); /api/status enforces the same list.
  const allowed = nextStatuses(current);
  const forward = allowed.filter((status) => status !== "Discarded");
  const canDiscard = allowed.includes("Discarded");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [repeatOpen, setRepeatOpen] = useState(false);

  const post = async (kind: Busy, url: string, payload: Record<string, unknown>) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(kind);
    setError(null);
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; warnings?: string[]; warning?: string; steps?: { outcome?: { ok: boolean } } } | null;
      if (!response.ok || !result?.ok) {
        setError(result?.error ?? "Could not save the change. Check the pipeline and retry.");
        return;
      }
      const cvLogFailed = result.steps?.outcome?.ok === false;
      setNeedsCvRetry(cvLogFailed);
      setNote(result.warnings?.join(" ") ?? result.warning ?? null);
      setConfirmDiscard(false);
      setRepeatOpen(false);
      if (!cvLogFailed) onDone?.();
      router.refresh();
    } catch {
      setError("Could not confirm the change. Check your connection, then retry.");
    } finally {
      submitting.current = false;
      setBusy("");
    }
  };

  const button = "inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-60 max-sm:min-h-[44px]";

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {approved ? (
          <>
            {/* An action, not a state: click it once you have sent the application. */}
            <span className="text-xs text-muted">Mark as applied with:</span>
            <button type="button" disabled={!!busy} onClick={() => post("a", "/api/apply-cv", { n: app.n, cv: "a" })} title="I sent it with CV A" className={cn(button, "border border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400")}>
              {busy === "a" ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} CV A
            </button>
            <button type="button" disabled={!!busy} onClick={() => post("b", "/api/apply-cv", { n: app.n, cv: "b" })} title="I sent it with CV B" className={cn(button, "border border-border text-muted hover:text-foreground")}>
              {busy === "b" ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} CV B
            </button>
          </>
        ) : evaluated ? (
          <button type="button" disabled={!!busy} onClick={() => post("approve", "/api/approve", { n: app.n })} className={cn(button, "border border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400")}>
            {busy === "approve" ? <Loader2 className="size-3.5 animate-spin" /> : <ThumbsUp className="size-3.5" />} Approve
          </button>
        ) : null}
        {forward.map((status) => (
          <button key={status} type="button" disabled={!!busy} onClick={() => post(status, "/api/status", { n: app.n, status })} className={cn(button, status === "Rejected" ? "border border-border text-muted hover:text-foreground" : "border border-brand/40 text-brand hover:bg-brand/10")}>
            {busy === status ? <Loader2 className="size-3.5 animate-spin" /> : null} {status === "Rejected" ? "They rejected me" : status}
          </button>
        ))}
        {canDiscard && (repeatOpen ? (
          <>
            <button type="button" disabled={!!busy} onClick={() => post("repeated", "/api/repeated", { n: app.n })} className={cn(button, "border border-border text-foreground hover:bg-surface-hover")}>
              {busy === "repeated" ? <Loader2 className="size-3.5 animate-spin" /> : <Copy className="size-3.5" />} Yes, repeated
            </button>
            <button type="button" disabled={!!busy} onClick={() => setRepeatOpen(false)} className={cn(button, "text-muted hover:text-foreground")}>Cancel</button>
          </>
        ) : (
          <button type="button" disabled={!!busy} onClick={() => setRepeatOpen(true)} title="This posting is already in the tracker as another row" className={cn(button, "text-muted hover:text-foreground")}>
            <Copy className="size-3.5" /> Repeated
          </button>
        ))}
        {canDiscard && (confirmDiscard ? (
          <>
            <button type="button" disabled={!!busy} onClick={() => post("Discarded", "/api/status", { n: app.n, status: "Discarded" })} className={cn(button, "border border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-400")}>
              {busy === "Discarded" ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />} Yes, discard
            </button>
            <button type="button" disabled={!!busy} onClick={() => setConfirmDiscard(false)} className={cn(button, "text-muted hover:text-foreground")}>Cancel</button>
          </>
        ) : (
          <button type="button" disabled={!!busy} onClick={() => setConfirmDiscard(true)} className={cn(button, "text-muted hover:text-red-600 dark:hover:text-red-400")}>
            <X className="size-3.5" /> Discard
          </button>
        ))}
        {needsCvRetry && (
          <button type="button" disabled={!!busy} onClick={() => post("retry", "/api/apply-cv", { n: app.n, retryOutcomeOnly: true })} className={cn(button, "border border-amber-500/40 text-amber-700 dark:text-amber-400")}>
            {busy === "retry" ? <Loader2 className="size-3.5 animate-spin" /> : null} Retry CV log
          </button>
        )}
      </div>
      {needsCvRetry && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">Applied, but the CV log failed.</p>}
      {note && !needsCvRetry && <p role="status" className="text-xs text-muted">{note}</p>}
      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
