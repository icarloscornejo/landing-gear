import { Suspense } from "react";
import { pipelineSummary } from "@/lib/career-ops";
import { pendingInbox } from "@/lib/inbox-pending.mjs";
import { PipelineView } from "@/components/pipeline-view";
import { inboxTabHas, pipelineTab } from "@/lib/pipeline-navigation.mjs";
import { savedJdChecker } from "@/lib/jd-captures";

export const dynamic = "force-dynamic"; // always read fresh local files

// Tracker tabs show the inbox only as a count, so they get the count and not
// the postings. The inbox is most of the page payload on a large pipeline.
export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const { tab } = await searchParams;
  const current = pipelineTab(tab);
  const onInbox = current === "INBOX" || current === "TRIAGED";
  const { inbox, applications } = pipelineSummary();
  const pending = pendingInbox(inbox);
  const triagedCount = pending.filter((job) => inboxTabHas("TRIAGED", job)).length;
  const hasSavedJd = onInbox ? savedJdChecker() : () => false;
  return (
    <Suspense>
      <PipelineView
        applications={applications}
        inbox={onInbox ? pending.filter((job) => inboxTabHas(current, job)).map((job) => ({ ...job, jdSaved: hasSavedJd(job.url) })) : null}
        inboxCount={pending.length - triagedCount}
        triagedCount={triagedCount}
      />
    </Suspense>
  );
}
