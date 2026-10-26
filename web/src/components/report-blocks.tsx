import { Check, AlertTriangle, X, HelpCircle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { ReportMarkdown } from "@/components/report-markdown";
import { cvMatchRows, keyFacts, legitimacySignals } from "@/lib/report-blocks.mjs";

// Compact views of the report's CV match, comp and legitimacy sections: one
// line per item, details on click, and nothing dropped (the notes after each
// table stay one click away). Each falls back to the section's markdown when
// the report uses a shape the parser does not know.

const MATCH = {
  strong: { icon: Check, className: "text-emerald-600 dark:text-emerald-400", label: "strong" },
  partial: { icon: AlertTriangle, className: "text-amber-600 dark:text-amber-400", label: "partial" },
  missing: { icon: X, className: "text-red-600 dark:text-red-400", label: "missing" },
  unknown: { icon: HelpCircle, className: "text-faint", label: "unknown" },
} as const;

const TONE = {
  good: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  bad: "bg-red-500/10 text-red-700 dark:text-red-400",
  muted: "bg-surface-hover text-muted",
} as const;

/** A row that opens to show its detail; no detail, no toggle. */
function Row({ head, detail }: { head: React.ReactNode; detail: string }) {
  if (!detail) return <li className="flex items-start gap-2.5 py-2">{head}</li>;
  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-start gap-2.5 py-2 hover:text-brand">
          {head}
          <ChevronRight className="mt-0.5 size-4 shrink-0 text-faint transition-transform group-open:rotate-90" />
        </summary>
        <p className="pb-3 pl-7 text-sm leading-relaxed text-muted">{detail}</p>
      </details>
    </li>
  );
}

function MoreNotes({ title, md }: { title: string; md: string }) {
  if (!md.trim()) return null;
  return (
    <details className="group mt-3 rounded-lg border border-border/70">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-muted hover:text-foreground">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" /> {title}
      </summary>
      <div className="report-prose border-t border-border/70 px-3 py-2">
        <ReportMarkdown>{md}</ReportMarkdown>
      </div>
    </details>
  );
}

export function cvMatchPreview(md: string): string | null {
  const { rows } = cvMatchRows(md);
  if (rows.length === 0) return null;
  const count = (match: string) => rows.filter((r) => r.match === match).length;
  return `${count("strong")} strong · ${count("partial")} partial · ${count("missing")} missing`;
}

export function CvMatchBlock({ md }: { md: string }) {
  const { rows, notes } = cvMatchRows(md);
  if (rows.length === 0) return <ReportMarkdown>{md}</ReportMarkdown>;
  // Problems first, so the gaps are what you see without scrolling.
  const order = { missing: 0, partial: 1, unknown: 2, strong: 3 };
  const sorted = [...rows].sort((a, b) => order[a.match] - order[b.match]);
  return (
    <div className="not-prose">
      <ul className="divide-y divide-border/60">
        {sorted.map((row) => {
          const { icon: Icon, className } = MATCH[row.match];
          return (
            <Row
              key={row.requirement}
              detail={row.evidence}
              head={
                <>
                  <Icon className={cn("mt-0.5 size-4 shrink-0", className)} />
                  <span className="min-w-0 flex-1 text-sm text-foreground">{row.requirement}</span>
                  {row.importance && <span className="shrink-0 text-[11px] uppercase tracking-wide text-faint">{row.importance}</span>}
                </>
              }
            />
          );
        })}
      </ul>
      <MoreNotes title="Gap notes and interview risks" md={notes} />
    </div>
  );
}

export function CompBlock({ md, advertised }: { md: string; advertised: string }) {
  const facts = keyFacts(md);
  if (facts.length === 0) return <ReportMarkdown>{md}</ReportMarkdown>;
  return (
    <div className="not-prose">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2.5">
          <p className="text-[11px] uppercase tracking-wide text-faint">Pay advertised</p>
          <p className="mt-0.5 text-sm font-medium text-foreground">{advertised || "Not stated"}</p>
        </div>
        {facts.map((fact) => (
          <div key={fact.key} className="rounded-lg border border-border/70 bg-background/50 px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-faint">{fact.key}</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">{fact.lead}</p>
            {fact.rest && <p className="mt-1 text-xs leading-relaxed text-muted">{fact.rest}</p>}
          </div>
        ))}
      </div>
      <MoreNotes title="Full comp notes and sources" md={md} />
    </div>
  );
}

export function legitimacyPreview(md: string): string | null {
  const { signals } = legitimacySignals(md);
  if (signals.length === 0) return null;
  const bad = signals.filter((s) => s.tone === "bad").length;
  const warn = signals.filter((s) => s.tone === "warn").length;
  return `${signals.length} signals · ${bad} concerning · ${warn} to check`;
}

export function LegitimacyBlock({ md }: { md: string }) {
  const { assessment, signals, notes } = legitimacySignals(md);
  if (signals.length === 0) return <ReportMarkdown>{md}</ReportMarkdown>;
  return (
    <div className="not-prose">
      {assessment && <p className="mb-2 text-sm font-medium text-foreground">{assessment}</p>}
      <ul className="divide-y divide-border/60">
        {signals.map((signal) => {
          // The chip keeps the weight's first words; the full weight joins the detail.
          const chip = signal.weight.split(/[:(.;,]/)[0].trim() || "n/a";
          return (
          <Row
            key={signal.signal}
            detail={chip === signal.weight ? signal.finding : `${signal.finding} (${signal.weight})`}
            head={
              <>
                <span className={cn("mt-0.5 w-28 shrink-0 truncate rounded px-1.5 py-px text-center text-[11px] font-medium", TONE[signal.tone])}>{chip}</span>
                <span className="min-w-0 flex-1 text-sm text-foreground">{signal.signal}</span>
              </>
            }
          />
          );
        })}
      </ul>
      <MoreNotes title="More checks and context" md={notes} />
    </div>
  );
}
