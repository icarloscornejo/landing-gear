// Stale sweep (idea from ai-job-search, MIT): Applied rows silent for 60+ days, from
// followup-cadence.mjs --json entries plus its retiredEntries. Only `bulk` may be closed in one
// go; a pinned follow-up date is the user's intent to keep chasing, and an applied date
// estimated from the evaluation date may overstate the silence, so those are listed apart.
// Shared by the /followups "Quiet 60+ days" group and modes/followup.md Step 1c.

export const STALE_DAYS = 60;

/**
 * @template {{status?: string, daysSinceApplication?: number|null, daysSinceLastFollowup?: number|null, nextOverride?: string|null, appDateSource?: string}} E
 * @param {E[]} entries
 * @param {E[]} [retired]
 * @param {number} [days]
 * @returns {{bulk: E[], pinned: E[], estimated: E[]}}
 */
export function staleSweep(entries, retired = [], days = STALE_DAYS) {
  const quiet = [...entries, ...retired].filter((entry) =>
    String(entry.status ?? "").toLowerCase() === "applied"
    && (entry.daysSinceApplication ?? 0) >= days
    && (entry.daysSinceLastFollowup == null || entry.daysSinceLastFollowup >= days));
  const pinned = quiet.filter((entry) => entry.nextOverride);
  const estimated = quiet.filter((entry) => !entry.nextOverride && entry.appDateSource === "evaluation-date-fallback");
  const bulk = quiet.filter((entry) => !entry.nextOverride && entry.appDateSource !== "evaluation-date-fallback");
  return { bulk, pinned, estimated };
}
