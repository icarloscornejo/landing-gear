import { readMachineSummary, scoreLevers } from "@/lib/machine-summary.mjs";

type Item = { text: string; tag?: string };

// Short on purpose: the few points that decide, not every requirement row.
const MAX_FOR = 4;
const MAX_AGAINST = 5;

function Column({ title, items, dot }: { title: string; items: Item[]; dot: string }) {
  return (
    <div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-faint">Nothing notable.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((item) => (
            <li key={item.text} className="flex items-start gap-2.5 text-sm leading-snug text-foreground">
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${dot}`} />
              <span className="min-w-0 flex-1">{item.text}</span>
              {item.tag && <span className="shrink-0 text-[11px] uppercase tracking-wide text-faint">{item.tag}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ScoreLevers({ report }: { report: string }) {
  const summary = readMachineSummary(report);
  if (!summary) return null;
  const { holding, close, strengths } = scoreLevers(summary);
  if (holding.length + close.length + strengths.length === 0) return null;
  // Missing requirements first, then the partly covered ones.
  const against = [
    ...holding.map((l) => ({ text: l.text, tag: l.importance ?? "blocker" })),
    ...close.map((l) => ({ text: l.text, tag: "partial" })),
  ].slice(0, MAX_AGAINST);
  return (
    <section data-testid="score-levers" className="mt-4 grid gap-6 rounded-2xl border border-border bg-surface/30 px-5 py-5 sm:grid-cols-2">
      <Column title="For you" items={strengths.slice(0, MAX_FOR).map((text) => ({ text }))} dot="bg-emerald-500" />
      <Column title="Against" items={against} dot="bg-red-500" />
    </section>
  );
}
