import { PageFrame } from "@/components/page-frame";

// The engineer's Analytics: one page, one section per question about the search.
// Bars are nested on purpose: applied is a subset of evaluated, so the applied
// bar sits inside the evaluated one, and every row also states its numbers in
// text so color is never the only carrier. Hover titles give the exact counts.

type Headline = { applied: number; replied: number; replyRate: number | null; avgAppliedScore: number | null };
type Stage = { label: string; count: number; pct: number };
type Week = { week: string; evaluated: number; applied: number };
type Band = { label: string; evaluated: number; applied: number };
type Group = { label: string; evaluated: number; applied: number; replied: number };
type Cv = { cv: string; applied: number; replied: number };

const EVALUATED = "bg-foreground/15";
const APPLIED = "bg-brand";

function Section({ question, children, note }: { question: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="rounded-2xl border border-border bg-surface/40 p-5">
      <h2 className="font-display text-lg tracking-tight text-landing">{question}</h2>
      {note && <p className="mt-1 text-xs text-faint">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted">
      {items.map(([label, swatch]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className={`size-2.5 rounded-sm ${swatch}`} /> {label}
        </span>
      ))}
    </div>
  );
}

/** Evaluated track with the applied part inside it. */
function NestedBar({ evaluated, applied, max, title }: { evaluated: number; applied: number; max: number; title: string }) {
  const width = (value: number) => `${max ? (value / max) * 100 : 0}%`;
  return (
    <div className="h-3 flex-1 rounded-full bg-surface" title={title}>
      <div className={`relative h-full rounded-full ${EVALUATED}`} style={{ width: width(evaluated) }}>
        {applied > 0 && <div className={`absolute inset-y-0 left-0 rounded-full ${APPLIED}`} style={{ width: evaluated ? `${(applied / evaluated) * 100}%` : "0%" }} />}
      </div>
    </div>
  );
}

const rate = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "none yet");

function GroupTable({ groups, missing, missingLabel }: { groups: Group[]; missing: number; missingLabel: string }) {
  const max = Math.max(1, ...groups.map((g) => g.evaluated));
  if (groups.length === 0) return <p className="text-sm text-faint">No data yet.</p>;
  return (
    <>
      <Legend items={[["Evaluated", EVALUATED], ["Applied", APPLIED]]} />
      <ul className="space-y-3">
        {groups.map((g) => (
          <li key={g.label} className="grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(10rem,14rem)_1fr_auto] sm:items-center">
            <span className="text-sm text-foreground">{g.label}</span>
            <NestedBar evaluated={g.evaluated} applied={g.applied} max={max} title={`${g.label}: ${g.evaluated} evaluated, ${g.applied} applied, ${g.replied} replied`} />
            <span className="text-xs tabular-nums text-muted">
              {g.evaluated} eval · {g.applied} applied · <span className={g.replied ? "font-medium text-foreground" : undefined}>{g.replied} replied</span>
              {g.applied > 0 && <span className="text-faint"> ({rate(g.replied, g.applied)})</span>}
            </span>
          </li>
        ))}
      </ul>
      {missing > 0 && <p className="mt-3 text-xs text-faint">{missing} {missingLabel}</p>}
    </>
  );
}

export function SearchDashboard({
  headline,
  funnel,
  weeks,
  fit,
  archetypes,
  sources,
  cvs,
  interviews,
  offers,
  flow,
}: {
  /** The pipeline Sankey, full width under the funnel. */
  flow?: React.ReactNode;
  headline: Headline;
  funnel: Stage[];
  weeks: Week[];
  fit: Band[];
  archetypes: { rows: Group[]; missing: number };
  sources: { rows: Group[]; missing: number };
  cvs: Cv[];
  interviews: number;
  offers: number;
}) {
  const stages = funnel.map((s) => ({ ...s, label: s.label === "Tracked" ? "Evaluated" : s.label }));
  const funnelMax = Math.max(1, stages[0]?.count ?? 1);
  const weekMax = Math.max(1, ...weeks.flatMap((w) => [w.evaluated, w.applied]));
  const fitMax = Math.max(1, ...fit.map((b) => b.evaluated));
  const appliedHigh = fit.find((b) => b.label === "4.0+")?.applied ?? 0;
  const appliedTotal = fit.reduce((sum, b) => sum + b.applied, 0);
  const tiles: [string, string, string?][] = [
    ["Applied", String(headline.applied)],
    ["Replied", String(headline.replied), headline.replyRate === null ? undefined : `${headline.replyRate}% of applied`],
    ["Interviews", String(interviews)],
    ["Offers", String(offers)],
    ["Avg score applied", headline.avgAppliedScore === null ? "-" : headline.avgAppliedScore.toFixed(1)],
  ];

  return (
    <PageFrame>
      <h1 className="font-display text-2xl tracking-tight text-landing">Analytics</h1>
      <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map(([label, value, sub]) => (
          <div key={label} className="rounded-2xl border border-border bg-surface/40 px-4 py-3">
            <dt className="text-[11px] uppercase tracking-wide text-faint">{label}</dt>
            <dd className="mt-1 font-display text-3xl tabular-nums text-landing">{value}</dd>
            {sub && <dd className="text-xs text-muted">{sub}</dd>}
          </div>
        ))}
      </dl>

      {flow && <div className="mt-6">{flow}</div>}

      <div className="mt-6 grid gap-5 xl:grid-cols-2">
        <Section question="How is the funnel moving?" note="Each step shows how many reached it, and what share of the step before got there.">
          <ul className="space-y-3">
            {stages.map((stage, i) => (
              <li key={stage.label} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3">
                <span className="text-sm text-foreground">{stage.label}</span>
                <div className="h-3 rounded-full bg-surface" title={`${stage.label}: ${stage.count}`}>
                  <div className={`h-full rounded-full ${i === 0 ? EVALUATED : APPLIED}`} style={{ width: `${(stage.count / funnelMax) * 100}%`, minWidth: stage.count ? "0.5rem" : 0 }} />
                </div>
                <span className="w-28 text-right text-xs tabular-nums text-muted">
                  <span className="font-medium text-foreground">{stage.count}</span>
                  {i > 0 && stages[i - 1].count > 0 && <span className="text-faint"> · {rate(stage.count, stages[i - 1].count)} of prev</span>}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section question="How much am I moving each week?" note="Evaluations by evaluation date, applications by the date they were sent.">
          {weeks.length === 0 ? (
            <p className="text-sm text-faint">No activity yet.</p>
          ) : (
            <>
              <Legend items={[["Evaluated", EVALUATED], ["Applied", APPLIED]]} />
              <div className="flex h-40 items-end gap-4 border-b border-border pb-1">
                {weeks.map((w) => (
                  <div key={w.week} className="flex h-full flex-1 items-end justify-center gap-1" title={`${w.week}: ${w.evaluated} evaluated, ${w.applied} applied`}>
                    {[
                      [w.evaluated, EVALUATED],
                      [w.applied, APPLIED],
                    ].map(([value, color], j) => (
                      <div key={j} className="flex h-full w-5 flex-col items-center justify-end">
                        <span className="mb-1 text-[11px] tabular-nums text-muted">{value}</span>
                        <div className={`w-full rounded-t ${color}`} style={{ height: `${((value as number) / weekMax) * 100}%`, minHeight: value ? 4 : 0 }} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div className="mt-1 flex gap-4">
                {weeks.map((w) => (
                  <span key={w.week} className="flex-1 text-center text-[11px] text-faint">{w.week.replace(/^\d{4}-/, "")}</span>
                ))}
              </div>
            </>
          )}
        </Section>

        <Section
          question="Am I applying to what is worth it?"
          note={appliedTotal ? `${appliedHigh} of ${appliedTotal} applications scored 4.0 or more.` : undefined}
        >
          <Legend items={[["Evaluated", EVALUATED], ["Applied", APPLIED]]} />
          <ul className="space-y-3">
            {fit.map((band) => (
              <li key={band.label} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3">
                <span className="text-sm text-foreground">{band.label}</span>
                <NestedBar evaluated={band.evaluated} applied={band.applied} max={fitMax} title={`${band.label}: ${band.evaluated} evaluated, ${band.applied} applied`} />
                <span className="w-28 text-right text-xs tabular-nums text-muted">{band.evaluated} eval · {band.applied} applied</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section question="CV A or CV B?" note="From the CV log: which CV went with each application, and who replied.">
          <div className="grid grid-cols-2 gap-3">
            {cvs.map((cv) => (
              <div key={cv.cv} className="rounded-xl border border-border bg-background/50 px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-faint">CV {cv.cv}</p>
                <p className="mt-1 font-display text-2xl tabular-nums text-landing">{cv.applied}</p>
                <p className="text-xs text-muted">sent · {cv.replied} replied{cv.applied > 0 && ` (${rate(cv.replied, cv.applied)})`}</p>
              </div>
            ))}
          </div>
          {cvs.some((cv) => cv.applied === 0) && (
            <p className="mt-3 text-xs text-faint">One CV has no applications yet, so there is nothing to compare. Send the other one on the next few to start the test.</p>
          )}
        </Section>

        <Section question="Which kind of role replies?" note="By the report's archetype (house rule 19).">
          <GroupTable groups={archetypes.rows} missing={archetypes.missing} missingLabel="rows have no full report, so no archetype." />
        </Section>

        <Section question="Where do my applications come from?" note="By the posting link's site.">
          <GroupTable groups={sources.rows} missing={sources.missing} missingLabel="rows have no posting link." />
        </Section>
      </div>
    </PageFrame>
  );
}
