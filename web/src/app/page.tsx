import { readApplications, readInbox, readReport, doctorState } from "@/lib/landing-gear";
import { pickAwaitingDecision, pickApproved } from "@/lib/home/awaiting.mjs";
import { cardReason } from "@/lib/machine-summary.mjs";
import type { CardReason } from "@/lib/machine-summary.mjs";
import { todaySnapshot } from "@/lib/home/today-snapshot.mjs";
import { todayOverview } from "@/lib/home/today-overview.mjs";
import { pendingInbox } from "@/lib/inbox-pending.mjs";
import { linkedinScanState, xScanState } from "@/lib/linkedin-scan";
import { dailyScanStatus } from "@/lib/daily-scan";
import { scoreNum, parseReport } from "@/lib/format";
import { FirstRunHome } from "@/components/home/first-run-home";
import { TodayDashboard } from "@/components/home/today-dashboard";

export const dynamic = "force-dynamic"; // always read fresh local files at request time (never at build — CI has no user data)

export default function Home() {
  const snapshot = { applications: readApplications(), inbox: readInbox() };
  const { phase } = doctorState(snapshot);
  // First run (truly empty install): the CV-upload takeover IS the home — value
  // before commitment. The full dashboard returns once they have a CV or any data.
  if (phase === "first-run") return <FirstRunHome />;

  const { inbox, applications } = todaySnapshot(snapshot, scoreNum);
  const overview = todayOverview(snapshot.applications, pendingInbox(snapshot.inbox));
  const reasons: Record<string, CardReason> = {};
  const legitimacy: Record<string, string> = {};
  for (const app of [...pickApproved(applications, scoreNum), ...pickAwaitingDecision(applications, scoreNum)]) {
    const content = readReport(app.n)?.content ?? "";
    const reason = cardReason(content);
    if (reason) reasons[app.n] = reason;
    const tier = parseReport(content).legitimacy;
    if (tier) legitimacy[app.n] = tier;
  }
  // Established / in-between: the dual-loop retention dashboard. Missing setup
  // files are reported by `node doctor.mjs` in the terminal.
  return (
    <TodayDashboard applications={applications} reasons={reasons} legitimacy={legitimacy} inbox={inbox} inBetween={phase === "in-between"} overview={overview} linkedinScan={linkedinScanState()} xScan={xScanState()} dailyScan={dailyScanStatus()} />
  );
}
