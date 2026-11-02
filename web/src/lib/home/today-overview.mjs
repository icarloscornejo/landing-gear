/**
 * today-overview.mjs: the lifecycle strip and the replies list on Today.
 * Pure; the page passes the tracker rows and the pending pipeline jobs.
 */
import { inboxTabHas, trackerTabOf } from "../pipeline-navigation.mjs";
import { currentMark, currentPhase, phaseLabel } from "../lifecycle.mjs";
import { isoEpoch } from "../interview-date.mjs";

// Every open hiring phase from Replied to Offer (house rule 25).
const IN_TALKS = new Set(["RESPONDED", "SCREENING", "ASSESSMENT", "TECH_INTERVIEW", "HIRING_MANAGER", "FINAL_INTERVIEW", "OFFER"]);

/** "Screening 2" for a row in talks, from its current phase. */
function phaseText(app) {
  const phase = currentPhase(app);
  return phase ? phaseLabel(phase.phase, phase.round) : "";
}

/**
 * @param {{n: string, status?: unknown, notes?: unknown, company?: string, via?: string, role?: string, date?: string}[]} applications
 * @param {{triage?: string}[]} pending pending pipeline jobs (pendingInbox)
 * @param {number} [nowMs]
 */
export function todayOverview(applications, pending, nowMs = Date.now()) {
  const byTab = (tab) => applications.filter((app) => trackerTabOf(app) === tab).length;
  const talks = applications.filter((app) => IN_TALKS.has(trackerTabOf(app)));
  const discovered = pending.filter((job) => inboxTabHas("INBOX", job)).length;
  const triaged = pending.filter((job) => inboxTabHas("TRIAGED", job)).length;
  // needsAction: the stages where the next move is the engineer's.
  const stages = [
    { key: "INBOX", label: "Discovered", count: discovered, needsAction: discovered > 0, hint: "to triage" },
    { key: "TRIAGED", label: "Triaged", count: triaged, needsAction: triaged > 0, hint: "to evaluate" },
    { key: "EVALUATED", label: "Evaluated", count: byTab("EVALUATED"), needsAction: byTab("EVALUATED") > 0, hint: "to decide" },
    { key: "APPROVED", label: "Approved", count: byTab("APPROVED"), needsAction: byTab("APPROVED") > 0, hint: "to apply" },
    { key: "APPLIED", label: "Applied", count: byTab("APPLIED"), needsAction: false, hint: "waiting" },
    { key: "RESPONDED", label: "In talks", count: talks.length, needsAction: talks.length > 0, hint: "replied" },
  ];
  const replies = talks
    .map((app) => ({ n: app.n, company: app.company ?? "", via: app.via ?? "", role: app.role ?? "", status: trackerTabOf(app), phase: phaseText(app), date: app.date ?? "" }))
    .sort((a, b) => b.date.localeCompare(a.date));
  // Dated rounds from two hours ago on (a call in progress still shows), soonest first.
  const upcoming = talks
    .map((app) => ({ app, mark: currentMark(app) }))
    .filter(({ mark }) => mark?.at && isoEpoch(mark.at) >= nowMs - 2 * HOUR)
    .map(({ app, mark }) => ({
      n: app.n,
      company: app.company ?? "",
      role: app.role ?? "",
      phase: phaseLabel(mark.phase, mark.round),
      at: /** @type {string} */ (mark.at),
      soon: isoEpoch(mark.at) - nowMs <= 24 * HOUR,
    }))
    .sort((a, b) => isoEpoch(a.at) - isoEpoch(b.at));
  return { stages, replies, upcoming };
}

const HOUR = 3_600_000;
