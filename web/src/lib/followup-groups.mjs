/**
 * followup-groups.mjs: the follow-up page's day groups. Pure, so the grouping
 * is testable; the page renders it.
 */

/**
 * Due-now first (overdue, urgent or a next date today or earlier), then one
 * group per upcoming next date in order, then rows with no date.
 * @template {{num: number, urgency: string, nextFollowupDate: string|null, daysUntilNext: number|null, daysSinceApplication: number}} E
 * @param {E[]} entries
 * @returns {{key: string, date: string|null, due: boolean, entries: E[]}[]}
 */
export function groupFollowups(entries) {
  const isDue = (e) => e.urgency === "overdue" || e.urgency === "urgent" || (e.daysUntilNext != null && e.daysUntilNext <= 0);
  const oldestFirst = (a, b) => b.daysSinceApplication - a.daysSinceApplication || a.num - b.num;
  const due = entries.filter(isDue).sort(oldestFirst);
  const byDate = new Map();
  const undated = [];
  for (const entry of entries) {
    if (isDue(entry)) continue;
    if (!entry.nextFollowupDate) undated.push(entry);
    else byDate.set(entry.nextFollowupDate, [...(byDate.get(entry.nextFollowupDate) ?? []), entry]);
  }
  const groups = [{ key: "due", date: null, due: true, entries: due }];
  for (const date of [...byDate.keys()].sort()) groups.push({ key: date, date, due: false, entries: byDate.get(date).sort(oldestFirst) });
  if (undated.length) groups.push({ key: "undated", date: null, due: false, entries: undated.sort(oldestFirst) });
  return groups;
}

/**
 * The CV an application was sent with, from its tracker notes ("with CV A").
 * @param {string} notes
 * @returns {"A"|"B"|null}
 */
export function cvSent(notes) {
  const match = String(notes ?? "").match(/\bCV ([AB])\b/);
  return match ? /** @type {"A"|"B"} */ (match[1]) : null;
}
