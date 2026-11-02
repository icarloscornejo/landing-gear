import fs from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { readReport, findApplication, careerOpsRoot } from "@/lib/career-ops";
import { ReportView } from "@/components/report-view";
import { pipelineQuery } from "@/lib/pipeline-navigation.mjs";

export const dynamic = "force-dynamic";

function readJdCapture(relPath: string): string | null {
  try {
    return fs.readFileSync(path.join(careerOpsRoot(), relPath), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export default async function ReportPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = pipelineQuery(await searchParams);
  const app = findApplication(id);
  const report = readReport(id);
  if (!app && !report) notFound();
  // Triage-only rows have no report; show the JD capture their notes point at.
  // Strict filename pattern so a note can never point the read outside jds/.
  const jdPath = report ? undefined : app?.notes.match(/local:(jds\/[A-Za-z0-9._-]+\.md)/)?.[1];
  const jd = jdPath && !jdPath.includes("..") ? readJdCapture(jdPath) : null;
  return (
    <ReportView
      id={id}
      app={app}
      report={report?.content ?? null}
      jd={jd}
      backHref={`/pipeline${query ? `?${query}` : ""}`}
    />
  );
}
