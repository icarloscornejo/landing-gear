import Link from "next/link";
import { ArrowLeft, FileText, ExternalLink, ChevronDown } from "lucide-react";
import type { Application } from "@/lib/career-ops";
import { Badge } from "@/components/ui/badge";
import { scoreTen, scoreTone, legitimacyTone, parseReport } from "@/lib/format";
import {
  applyLineLabel,
  cleanHeading,
  isVerdictHeading,
  sectionPreview,
  splitSections,
  verdictReason,
} from "@/lib/report-sections.mjs";
import { isApproved } from "@/lib/home/awaiting.mjs";
import { LifecycleActions } from "@/components/lifecycle-actions";
import { InterviewDate } from "@/components/interview-date";
import { CompanyLogo } from "@/components/company-logo";
import { ScoreLevers } from "@/components/score-levers";
import { readMachineSummary } from "@/lib/machine-summary.mjs";
import { CompBlock, CvMatchBlock, LegitimacyBlock, cvMatchPreview, legitimacyPreview } from "@/components/report-blocks";
import { ReportMarkdown } from "@/components/report-markdown";
import { companyPresentation } from "@/lib/company-presentation.mjs";
import { PageFrame } from "@/components/page-frame";

// One job, top to bottom in the order the engineer decides: who and what, the verdict
// with its reason, next step and the actions of the current step, the key facts,
// what is for and against him, then four collapsed sections and the full report. The tailored-CV,
// cover, apply-proxy, keyword, company-history and methodology panels are gone:
// he applies with CV A/B and drafts covers in chat.

// The Machine Summary YAML and submit logs are for scripts, not for reading.
function isMachine(heading: string): boolean {
  return /machine summary|submitted|submit[-\s]?log/i.test(heading);
}

const PINNED = [
  { label: "CV match", match: /match with cv|cv match/i },
  { label: "Compensation", match: /comp/i },
  { label: "Posting legitimacy", match: /legitimacy/i },
  { label: "Job description", match: /job description/i },
];

function Section({ title, preview, children }: { title: string; preview?: string; children: React.ReactNode }) {
  return (
    <details className="group mt-3 overflow-hidden rounded-xl border border-border bg-surface/30">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover">
        <span className="shrink-0 text-sm font-medium">{title}</span>
        {preview && <span className="hidden min-w-0 truncate text-xs text-faint sm:inline">{preview}</span>}
        <ChevronDown className="ml-auto size-4 shrink-0 text-faint transition-transform group-open:rotate-180" />
      </summary>
      <div className="report-prose border-t border-border px-4 py-3">{children}</div>
    </details>
  );
}

// The report's URL header is written by a model and sometimes carries a remark after
// the link ("https://... (the post; no employer page found)"); only the link itself counts.
function httpUrl(url?: string | null): string | undefined {
  return /^\s*<?(https?:\/\/[^\s<>]+)/i.exec(url ?? "")?.[1];
}

export function ReportView({
  id,
  app,
  report,
  jd = null,
  backHref = "/pipeline",
}: {
  id: string;
  app: Application | null;
  report: string | null;
  /** JD capture text for a triage-only row with no report. */
  jd?: string | null;
  backHref?: string;
}) {
  const meta = report ? parseReport(report) : null;
  const field = (label: string) => meta?.fields.find((f) => f.label === label)?.value;
  const score = app?.score || field("Score");
  const date = app?.date || field("Date");
  const line = applyLineLabel(score ?? "", meta?.legitimacy);
  const recommended = line === "Recommended";
  // Triage-only rows have no report, so fall back to the tracker's own URL.
  const postingUrl = httpUrl(field("URL") ?? app?.url);
  const company = app ? companyPresentation(app) : null;
  const title = company?.label ?? meta?.title ?? `Report #${id}`;

  const { intro, sections } = report ? splitSections(meta?.body ?? report) : { intro: "", sections: [] };
  const verdictSection = sections.find((s) => isVerdictHeading(s.heading));
  const readable = sections.filter((s) => s !== verdictSection && !isMachine(s.heading));
  const reason = report ? verdictReason({ report, intro, verdictContent: verdictSection?.content }) : "";
  const summary = report ? readMachineSummary(report) : null;
  const facts = summary?.facts;
  // Four sections worth opening on their own, in reading order; every other
  // section (interview plan, keywords, cover draft, score evidence...) goes
  // into one collapsed "Full report".
  const pinned = PINNED.map((p) => ({ label: p.label, section: readable.find((s) => p.match.test(cleanHeading(s.heading))) }))
    .filter((p): p is { label: string; section: (typeof readable)[number] } => p.section !== undefined);
  const others = readable.filter((s) => !pinned.some((p) => p.section === s));

  return (
    <PageFrame>
      <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-brand">
        <ArrowLeft className="size-4" /> Pipeline
      </Link>

      <header className="mt-5 flex items-start gap-4">
        <CompanyLogo name={company?.logoName ?? meta?.title ?? `Report #${id}`} size={48} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="font-display text-3xl tracking-tight text-landing">{title}</h1>
            {app && <Badge tone={isApproved(app) ? "good" : "info"}>{isApproved(app) ? "Approved" : app.status}</Badge>}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            {app?.role && <span className="text-foreground/80">{app.role}</span>}
            {postingUrl && (
              <a href={postingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline max-sm:min-h-[44px]">
                posting <ExternalLink className="size-3" />
              </a>
            )}
            {date && <span className="tabular-nums text-faint">{date}</span>}
          </p>
        </div>
      </header>

      {/* The verdict and the actions of the current step, together: this is where the decision is made. */}
      <section className={`mt-6 rounded-2xl border px-5 py-5 ${recommended ? "border-brand/25 bg-brand-soft/50" : "border-border bg-surface/50"}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {score ? (
            <span className={`font-display text-4xl tabular-nums tracking-tight ${scoreTone(score) === "bad" ? "text-red-600 dark:text-red-400" : "text-landing"}`}>{scoreTen(score)}</span>
          ) : (
            <span className="text-sm text-muted">No score yet</span>
          )}
          {line && <Badge tone={recommended ? "good" : line === "Below the apply line" ? "muted" : "warn"}>{line}</Badge>}
          {meta?.legitimacy && <Badge tone={legitimacyTone(meta.legitimacy)}>{meta.legitimacy}</Badge>}
        </div>
        {summary?.decision && <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Evaluator: {summary.decision}</p>}
        {reason && <p className="mt-1.5 text-[15px] leading-relaxed text-foreground">{reason}</p>}
        {facts?.nextAction && (
          <p className="mt-3 text-sm leading-relaxed text-muted">
            <span className="font-medium text-foreground">Next step: </span>
            {facts.nextAction}
          </p>
        )}
        {app && <InterviewDate app={app} className="mt-4" />}
        {app && <LifecycleActions app={app} className="mt-4" />}
      </section>

      {facts && (
        <dl className="mt-4 grid gap-x-6 gap-y-3 rounded-2xl border border-border bg-surface/30 px-5 py-4 text-sm sm:grid-cols-3 lg:grid-cols-5">
          {[
            ["Archetype", facts.archetype],
            ["Location", facts.location || "Not stated"],
            ["Pay", facts.comp || "Not stated"],
            ["Work permit", facts.workAuth || "Not stated"],
            ["Risk", facts.risk || "Not stated"],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[11px] uppercase tracking-wide text-faint">{label}</dt>
              <dd className="mt-0.5 break-words text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {report ? (
        <>
          <ScoreLevers report={report} />
          {pinned.map((p) => {
            const md = p.section.content;
            if (p.label === "CV match") {
              return <Section key={p.label} title={p.label} preview={cvMatchPreview(md) ?? sectionPreview(md)}><CvMatchBlock md={md} /></Section>;
            }
            if (p.label === "Compensation") {
              return <Section key={p.label} title={p.label} preview={facts?.comp || "No pay figure in the posting"}><CompBlock md={md} advertised={facts?.comp ?? ""} /></Section>;
            }
            if (p.label === "Posting legitimacy") {
              return <Section key={p.label} title={p.label} preview={legitimacyPreview(md) ?? sectionPreview(md)}><LegitimacyBlock md={md} /></Section>;
            }
            return (
              <Section key={p.label} title={p.label} preview={sectionPreview(md)}>
                <ReportMarkdown>{md}</ReportMarkdown>
              </Section>
            );
          })}
          {others.length > 0 && (
            <Section title="Full report" preview={others.map((s) => cleanHeading(s.heading)).join(" · ")}>
              {others.map((s, i) => (
                <div key={i} className={i ? "mt-6" : undefined}>
                  <h3>{cleanHeading(s.heading)}</h3>
                  <ReportMarkdown>{s.content}</ReportMarkdown>
                </div>
              ))}
            </Section>
          )}
          {readable.length === 0 && (
            <article className="report-prose mt-6">
              <ReportMarkdown>{meta?.body ?? report}</ReportMarkdown>
            </article>
          )}
        </>
      ) : app?.notes ? (
        <section className="mt-6 rounded-2xl border border-border bg-surface/30 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Notes (no full report)</h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{app.notes}</p>
          {jd && (
            <>
              <h2 className="mt-6 text-xs font-semibold uppercase tracking-[0.16em] text-muted">Job description</h2>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{jd}</p>
            </>
          )}
        </section>
      ) : (
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-dashed border-border bg-surface/30 p-5 text-sm text-muted">
          <FileText className="size-5 shrink-0 text-faint" />
          No report file found for #{id} in <code className="text-foreground">reports/</code>.
        </div>
      )}
    </PageFrame>
  );
}
