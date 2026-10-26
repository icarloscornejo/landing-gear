/**
 * today-overview.mjs: the lifecycle strip and the replies list on Today.
 * Pure; the page passes the tracker rows and the pending pipeline jobs.
 */
import { inboxTabHas, trackerTabOf } from "../pipeline-navigation.mjs";

const IN_TALKS = new Set(["RESPONDED", "ASSESSMENT", "INTERVIEW", "OFFER"]);

/**
 * @param {{n: string, status?: unknown, notes?: unknown, company?: string, via?: string, role?: string, date?: string}[]} applications
 * @param {{triage?: string}[]} pending pending pipeline jobs (pendingInbox)
 */
export function todayOverview(applications, pending) {
  const byTab = (tab) => applications.filter((app) => trackerTabOf(app) === tab).length;
  const talks = applications.filter((app) => IN_TALKS.has(trackerTabOf(app)));
  const discovered = pending.filter((job) => inboxTabHas("INBOX", job)).length;
  const triaged = pending.filter((job) => inboxTabHas("TRIAGED", job)).length;
  // needsAction: the stages where the next move is Carlos's.
  const stages = [
    { key: "INBOX", label: "Discovered", count: discovered, needsAction: discovered > 0, hint: "to triage" },
    { key: "TRIAGED", label: "Triaged", count: triaged, needsAction: triaged > 0, hint: "to evaluate" },
    { key: "EVALUATED", label: "Evaluated", count: byTab("EVALUATED"), needsAction: byTab("EVALUATED") > 0, hint: "to decide" },
    { key: "APPROVED", label: "Approved", count: byTab("APPROVED"), needsAction: byTab("APPROVED") > 0, hint: "to apply" },
    { key: "APPLIED", label: "Applied", count: byTab("APPLIED"), needsAction: false, hint: "waiting" },
    { key: "RESPONDED", label: "In talks", count: talks.length, needsAction: talks.length > 0, hint: "replied" },
  ];
  const replies = talks
    .map((app) => ({ n: app.n, company: app.company ?? "", via: app.via ?? "", role: app.role ?? "", status: trackerTabOf(app), date: app.date ?? "" }))
    .sort((a, b) => b.date.localeCompare(a.date));
  return { stages, replies };
}
