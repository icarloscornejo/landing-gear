import Link from "next/link";
import { FileText } from "lucide-react";
import { cn } from "@/lib/cn";
import { CompanyLogo } from "@/components/company-logo";
import { scoreNum, scoreTen, scoreTone } from "@/lib/format";
import { companyPresentation } from "@/lib/company-presentation.mjs";
import type { Application } from "@/lib/career-ops";
import type { CardReason } from "@/lib/machine-summary.mjs";

const DECISION_TONE: Record<string, string> = {
  Apply: "text-emerald-600 dark:text-emerald-400",
  Consider: "text-sky-600 dark:text-sky-400",
  "Research first": "text-amber-600 dark:text-amber-400",
  Skip: "text-muted",
};

// A Today card is read-only: it summarizes the row and opens its review. Every
// action (Approve, Mark as applied with CV A/B, discard via the status select)
// lives on the detail page.
export function DecisionCard({ app, reason }: { app: Application; reason?: CardReason }) {
  const score = scoreNum(app.score);
  const tone = scoreTone(app.score);
  const company = companyPresentation(app);

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-surface/40 p-4 transition hover:border-brand/30">
      <div className="flex items-start gap-3">
        <CompanyLogo name={company.logoName} size={32} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{company.label}</p>
          <p className="text-[13px] leading-snug text-muted">{app.role}</p>
        </div>
        {Number.isFinite(score) && score > 0 && (
          <span
            className={cn(
              "shrink-0 rounded-lg px-2.5 py-1 text-sm font-semibold tabular-nums",
              tone === "good" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : tone === "warn" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-surface-hover text-muted",
            )}
          >
            {scoreTen(app.score)}
          </span>
        )}
      </div>
      {reason && (
        <div data-testid="card-reason" className="space-y-0.5 text-xs leading-snug">
          {reason.decision && <p className={cn("font-medium", DECISION_TONE[reason.decision] ?? "text-muted")}>{reason.decision}</p>}
          {reason.plus && <p className="text-muted"><span className="text-emerald-600 dark:text-emerald-400">+</span> {reason.plus}</p>}
          {reason.minus && <p className="text-muted"><span className="text-red-600 dark:text-red-400">−</span> {reason.minus}</p>}
        </div>
      )}
      <Link
        href={`/pipeline/${app.n}`}
        className="inline-flex items-center justify-center gap-1.5 rounded-md bg-brand-soft px-2.5 py-1.5 text-xs font-medium text-brand-text transition hover:bg-brand/15 max-sm:min-h-[44px]"
      >
        <FileText className="size-3.5" /> Review
      </Link>
    </div>
  );
}
