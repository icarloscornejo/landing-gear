import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, pipelineSummary, readApplicationStatusLog, readReport, readStatusLog } from "@/lib/career-ops";
import { canonStatus } from "@/lib/format";
import { cumulativeProgressWithHistory } from "@/lib/funnel-tiles.mjs";
import { computeProgressMetrics } from "@/lib/analytics-metrics.mjs";
import { readMachineSummary } from "@/lib/machine-summary.mjs";
import { ARCHETYPES, appFacts, archetypeOf, breakdown, cvSplit, fitBands, headline, sourceOf, weeklyActivity } from "@/lib/analytics/search-view.mjs";
import { SearchDashboard } from "@/components/analytics/search-dashboard";
import { PipelineSankey } from "@/components/analytics/pipeline-sankey";

export const dynamic = "force-dynamic";

// data/cv-ab.tsv (my-tools/cv-pick.mjs): one row per application, CV a/b and outcome.
function readCvLog(): { cv: string; outcome: string }[] {
  let text: string;
  try {
    text = fs.readFileSync(path.join(careerOpsRoot(), "data", "cv-ab.tsv"), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const [header, ...lines] = text.split(/\r?\n/).filter((line) => line.trim());
  const columns = (header ?? "").split("\t");
  const at = (name: string) => columns.indexOf(name);
  return lines.map((line) => line.split("\t")).map((cells) => ({ cv: cells[at("cv")] ?? "", outcome: cells[at("outcome")] ?? "" }));
}

// One page, one section per question the engineer asks about their search.
export default async function Analytics() {
  const { applications } = pipelineSummary();
  const achievements = await cumulativeProgressWithHistory(
    applications.map((app) => ({ n: app.n, status: canonStatus(app.status) })),
    readApplicationStatusLog(),
  );
  const progress = computeProgressMetrics(applications, achievements);
  const statusLog = readStatusLog();
  const facts = appFacts(
    applications.map((app) => {
      const report = readReport(app.n);
      return {
        n: app.n,
        date: app.date,
        status: canonStatus(app.status),
        score: app.score,
        url: app.url,
        archetype: report ? readMachineSummary(report.content)?.facts.archetype ?? "" : "",
      };
    }),
    statusLog,
  );
  return (
    <SearchDashboard
      headline={headline(facts)}
      funnel={progress.funnel}
      weeks={weeklyActivity(facts)}
      fit={fitBands(facts)}
      archetypes={breakdown(facts, archetypeOf, ARCHETYPES)}
      sources={breakdown(facts, sourceOf)}
      cvs={cvSplit(readCvLog())}
      interviews={achievements?.interviews ?? 0}
      offers={achievements?.offers ?? 0}
      flow={<PipelineSankey applications={applications} statusLog={statusLog} />}
    />
  );
}
