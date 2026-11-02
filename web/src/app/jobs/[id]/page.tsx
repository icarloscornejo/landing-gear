"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PasteJd } from "@/components/paste-jd";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Loader2, Wrench, CircleDot, Check, X, Sparkles } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { HeroGlow } from "@/components/hero-glow";
import { Badge } from "@/components/ui/badge";
import { buildTimeline, elapsedLabel } from "@/lib/run-timeline.mjs";

type LiveRun = {
  title: string; subtitle: string; source: string; kind: string; input: string; status: "queued" | "running" | "done" | "error";
  steps: { kind: "tool" | "status"; label: string; ts: number }[]; notes?: { text: string; ts: number }[];
  text: string; verdictLine: string; startedAt: number; endedAt: number | null;
};

type TimelineItem = ReturnType<typeof buildTimeline>["items"][number];

function Markdown({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>;
}

// Narration and tool calls on one vertical line: narration reads as text, tool
// calls stay small chips, since they matter less than what the agent concluded.
function Timeline({ items, start, running }: { items: TimelineItem[]; start: number; running: boolean }) {
  return (
    <ol className="relative mt-6 space-y-5 border-l border-border pl-6">
      {items.map((item, i) => (
        <li key={i} className="relative flex items-start gap-4">
          <span
            className={`absolute -left-[29.5px] top-1.5 size-2.5 rounded-full ring-4 ring-background ${
              item.type === "note" ? "bg-brand" : item.type === "tools" ? "bg-faint" : "bg-border"
            }`}
          />
          <div className="min-w-0 flex-1">
            {item.type === "note" && (
              <div className="report-prose text-sm leading-relaxed">
                <Markdown>{item.text}</Markdown>
              </div>
            )}
            {item.type === "tools" && (
              <div className="flex flex-wrap gap-1.5">
                {item.tools.map((tool, j) => (
                  <span
                    key={j}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-surface/60 px-2 py-0.5 font-mono text-[11px] text-muted"
                  >
                    <Wrench className="size-3 text-faint" />
                    {tool.label}
                    {tool.count > 1 && <span className="text-faint">×{tool.count}</span>}
                  </span>
                ))}
              </div>
            )}
            {item.type === "status" && (
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">{item.label}</p>
            )}
          </div>
          <span className="shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-faint">{elapsedLabel(item.ts, start)}</span>
        </li>
      ))}
      {running && (
        <li className="relative flex items-center gap-2 text-sm text-muted">
          <span className="absolute -left-[29.5px] top-1.5 size-2.5 animate-pulse rounded-full bg-brand ring-4 ring-background" />
          <Loader2 className="size-3.5 animate-spin text-brand" /> thinking…
        </li>
      )}
    </ol>
  );
}

// A server-owned run (lib/live-runs.ts): poll its full log while it runs. This is
// also what makes the live view survive a reload, or a run started from chat.
function useLiveRun(id: string, enabled: boolean): LiveRun | null {
  const [run, setRun] = useState<LiveRun | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let again = true;
      try {
        const response = await fetch(`/api/live-runs/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (response.status === 404) again = false;
        else {
          const { run: next } = (await response.json()) as { run: LiveRun };
          if (alive) setRun(next);
          again = next.status === "running" || next.status === "queued";
        }
      } catch {
        // Retry on the next tick.
      }
      if (alive && again) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [id, enabled]);
  return run;
}

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { jobs, startJob } = useJobs();
  const local = jobs.find((j) => j.id === id);
  const live = useLiveRun(id, !local || local.remote === true);
  const job = live
    ? {
        title: live.title,
        subtitle: live.subtitle,
        kind: live.kind,
        input: live.input,
        status: live.status === "queued" ? "running" : live.status,
        steps: live.steps,
        notes: live.notes,
        text: live.text,
        result: local?.result,
        source: live.source,
        startedAt: live.startedAt,
        endedAt: live.endedAt,
      }
    : local;
  // Runs from before notes existed, and browser-only jobs, keep the plain step list.
  const notes = job && "notes" in job ? job.notes : undefined;
  const timeline = notes?.length ? buildTimeline(job!.steps, notes, job!.status === "done") : null;
  const start = job && "startedAt" in job && job.startedAt ? job.startedAt : job?.steps[0]?.ts ?? 0;
  const end = job && "endedAt" in job ? job.endedAt : null;
  // A failed triage/evaluation of a posting URL: offer to paste the JD here, then
  // run the same job again from it (the server now reads the pasted file).
  const canPaste = job?.status === "error" && (job.kind === "evaluate" || job.kind === "triage") && /^https?:\/\//i.test(job.input ?? "");
  const rerun = () => {
    if (!job?.kind || !job.input) return;
    const next = startJob({ title: job.title.replace(/ \(retry\)$/, ""), subtitle: job.subtitle, kind: job.kind, input: job.input, page: "/pipeline" });
    if (next) router.push(`/jobs/${next}`);
  };

  if (!job) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link href="/pipeline" className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-brand">
          <ArrowLeft className="size-4" /> Pipeline
        </Link>
        <p className="mt-8 text-sm text-muted">
          This worker is no longer in memory (it finished earlier or the page was reloaded).
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/pipeline" className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-brand">
        <ArrowLeft className="size-4" /> Pipeline
      </Link>

      <section className="dot-bg relative mt-5 overflow-hidden rounded-2xl border border-border bg-surface/40 px-6 py-7">
        {job.status === "running" && <HeroGlow />}
        <div className="relative z-10">
          <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-faint">
            {job.status === "running" ? (
              <><Loader2 className="size-3 animate-spin text-brand" /> working</>
            ) : job.status === "done" ? (
              <><Check className="size-3 text-emerald-500" /> done</>
            ) : (
              <><X className="size-3 text-red-400" /> error</>
            )}
            {end != null && start > 0 && <span className="normal-case tracking-normal">· took {elapsedLabel(end, start).slice(1)}</span>}
          </p>
          <h1 className="mt-2 font-display text-2xl tracking-tight text-landing">{job.title}</h1>
          {job.subtitle && <p className="mt-1 text-sm text-muted">{job.subtitle}</p>}
          {job.source === "chat" && <p className="mt-1 text-xs text-faint">Started from a chat session</p>}
          {job.result?.score != null && (
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <Badge tone={job.result.tone}>{job.result.score}/5</Badge>
              {job.result.summary && <span className="text-sm text-muted">{job.result.summary}</span>}
            </div>
          )}
        </div>
      </section>

      {canPaste && job.input && (
        <section className="mt-5">
          <h2 className="text-sm font-semibold text-foreground">The posting could not be read? Paste its job description</h2>
          <div className="mt-2">
            <PasteJd
              url={job.input}
              company={job.title.replace(/^(Score|Triage|Evaluate)\s*·\s*/, "").replace(/ \(retry\)$/, "")}
              role={job.subtitle ?? ""}
              actionLabel={job.kind === "triage" ? "Save & re-run triage" : "Save & re-run evaluation"}
              onSaved={(again) => {
                if (again) rerun();
              }}
            />
          </div>
        </section>
      )}

      {timeline && (
        <>
          {timeline.result && (
            <section className="mt-6 rounded-2xl border border-brand/30 bg-surface/60 p-5 shadow-sm">
              <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-brand">
                <Sparkles className="size-3.5" /> Result
              </h2>
              <div className="report-prose mt-3 text-sm leading-relaxed">
                <Markdown>{timeline.result}</Markdown>
              </div>
            </section>
          )}
          <h2 className="mt-8 text-xs font-semibold uppercase tracking-[0.2em] text-muted">How it got there</h2>
          <Timeline items={timeline.items} start={start} running={job.status === "running"} />
        </>
      )}

      {!timeline && (
      <>
      <ol className="mt-6 space-y-2">
        {job.steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm">
            {s.kind === "tool" ? (
              <Wrench className="mt-0.5 size-3.5 shrink-0 text-brand" />
            ) : (
              <CircleDot className="mt-0.5 size-3.5 shrink-0 text-faint" />
            )}
            <span className={s.kind === "tool" ? "font-medium" : "text-muted"}>
              {s.kind === "tool" ? `Using ${s.label}` : s.label}
            </span>
          </li>
        ))}
        {job.status === "running" && (
          <li className="flex items-center gap-2.5 text-sm text-muted">
            <Loader2 className="size-3.5 animate-spin text-brand" /> thinking…
          </li>
        )}
      </ol>

      {job.text && (
        <div className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Output</h2>
          <div className="report-prose mt-3 rounded-2xl border border-border bg-surface/40 p-5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{job.text}</ReactMarkdown>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
