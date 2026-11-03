import { Suspense } from "react";
import { pipelineSummary, readReport, readStatusLog } from "@/lib/landing-gear";
import { pendingInbox } from "@/lib/inbox-pending.mjs";
import { PipelineView } from "@/components/pipeline-view";
import { GRID_TABS, inboxTabHas, pipelineTab, showsBoard, trackerTabOf } from "@/lib/pipeline-navigation.mjs";
import { jdLinksChecker } from "@/lib/jd-captures";
import { cardReason, type CardReason } from "@/lib/machine-summary.mjs";

export const dynamic = "force-dynamic"; // always read fresh local files

// Tracker tabs show the inbox only as a count, so they get the count and not
// the postings. The inbox is most of the page payload on a large pipeline.
export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ tab?: string | string[]; view?: string | string[] }> }) {
  const { tab, view } = await searchParams;
  const current = pipelineTab(tab);
  // The board shows Discovered and Triaged as columns, so it needs every pending posting.
  const board = showsBoard(Array.isArray(view) ? view[0] : view);
  const onInbox = !board && (current === "INBOX" || current === "TRIAGED");
  const { inbox, applications } = pipelineSummary();
  const pending = pendingInbox(inbox);
  const triagedCount = pending.filter((job) => inboxTabHas("TRIAGED", job)).length;
  const jdLinks = onInbox || board ? jdLinksChecker() : () => ({ jdSaved: false });
  // Only the open grid tab's reports are read, so other tabs pay nothing.
  const reasons: Record<string, CardReason> = {};
  if ((GRID_TABS as readonly string[]).includes(current)) {
    for (const app of applications.filter((row) => trackerTabOf(row) === current)) {
      const reason = cardReason(readReport(app.n)?.content ?? "");
      if (reason) reasons[app.n] = reason;
    }
  }
  return (
    <Suspense>
      <PipelineView
        applications={applications}
        inbox={onInbox ? pending.filter((job) => inboxTabHas(current, job)).map((job) => ({ ...job, ...jdLinks(job.url) })) : null}
        boardInbox={board ? pending.map((job) => ({ ...job, ...jdLinks(job.url) })) : null}
        inboxCount={pending.length - triagedCount}
        triagedCount={triagedCount}
        reasons={reasons}
        statusLog={onInbox ? [] : readStatusLog()}
      />
    </Suspense>
  );
}
