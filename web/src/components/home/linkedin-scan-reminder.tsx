"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon, Megaphone } from "lucide-react";
import type { LinkedinScanState } from "@/lib/linkedin-scan";

// Daily nudge for the LinkedIn hiring-posts scan (rule 18): Carlos pastes the
// script into the DevTools console on linkedin.com; it disappears once today's
// result file is in ~/Downloads.
export function LinkedinScanReminder({ state }: { state: LinkedinScanState }) {
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  if (state.ranToday) return null;

  async function copyScript() {
    if (!state.script) return;
    try {
      await navigator.clipboard.writeText(state.script);
      setCopied("ok");
    } catch (error) {
      console.warn("clipboard write failed", error);
      setCopied("failed");
    }
    setTimeout(() => setCopied(null), 2500);
  }

  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand/40 bg-brand-soft/40 px-5 py-4">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Megaphone className="size-4 text-brand" /> LinkedIn posts scan not run today
        </p>
        <p className="mt-0.5 text-xs text-muted">
          Copy the script, open linkedin.com, paste it in the console (Cmd+Opt+J). When it downloads its file, tell Claude in chat to process it: the good posts land in Discovered.
          {state.lastRun ? ` Last run: ${state.lastRun}.` : ""}
        </p>
      </div>
      {state.script ? (
        <button
          type="button"
          onClick={copyScript}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground transition hover:bg-brand/90 max-sm:min-h-[44px]"
        >
          {copied === "ok" ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          {copied === "ok" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy script"}
        </button>
      ) : (
        <p className="text-xs text-muted">Script not found in my-tools/.</p>
      )}
    </div>
  );
}
