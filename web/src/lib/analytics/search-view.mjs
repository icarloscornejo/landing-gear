/**
 * search-view.mjs: the numbers behind Carlos's single Analytics page, one
 * function per question it answers. Pure: the page reads the tracker, the
 * status log, report archetypes and the CV A/B log, and passes them in.
 */

const APPLIED = new Set(["APPLIED", "RESPONDED", "ASSESSMENT", "INTERVIEW", "OFFER", "HIRED", "REJECTED"]);
// A rejection is a reply too: the company answered.
const REPLIED = new Set(["RESPONDED", "ASSESSMENT", "INTERVIEW", "OFFER", "HIRED", "REJECTED"]);

export const ARCHETYPES = ["Senior / Lead Android Engineer", "Android Architect", "Mobile AI Engineer", "AI Engineer / Agentic Dev", "Not a target"];

/**
 * @typedef {{n: string, date: string, status: string, score: string, url?: string, archetype?: string}} AppRow
 *   status is canonical upper case (status-alias canonStatus).
 * @typedef {{num: number, date: string, to: string}} LogRow
 * @typedef {{app: AppRow, applied: boolean, replied: boolean, appliedDate: string|null, score: number|null}} AppFacts
 */

/** @param {string} value @returns {number|null} */
function scoreOf(value) {
  const match = String(value ?? "").match(/(\d+(?:\.\d+)?)\s*\/\s*5/);
  return match ? Number(match[1]) : null;
}

/**
 * Per-row facts, with the status log recovering stages a later status hides
 * (an applied row that was discarded still counts as applied).
 * @param {AppRow[]} apps
 * @param {LogRow[]} log
 * @returns {AppFacts[]}
 */
export function appFacts(apps, log) {
  const byNum = new Map();
  for (const row of log) {
    const list = byNum.get(row.num) ?? [];
    list.push(row);
    byNum.set(row.num, list);
  }
  return apps.map((app) => {
    const rows = byNum.get(Number(app.n)) ?? [];
    const firstApplied = rows.filter((r) => String(r.to).toUpperCase() === "APPLIED").map((r) => r.date).sort()[0] ?? null;
    const applied = APPLIED.has(app.status) || firstApplied !== null;
    const replied = REPLIED.has(app.status) || rows.some((r) => REPLIED.has(String(r.to).toUpperCase()));
    return { app, applied, replied: applied && replied, appliedDate: applied ? firstApplied ?? app.date : null, score: scoreOf(app.score) };
  });
}

/** @param {AppFacts[]} facts */
export function headline(facts) {
  const applied = facts.filter((f) => f.applied);
  const replied = applied.filter((f) => f.replied).length;
  const scores = applied.map((f) => f.score).filter((s) => s !== null);
  return {
    applied: applied.length,
    replied,
    replyRate: applied.length ? Math.round((replied / applied.length) * 100) : null,
    avgAppliedScore: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
  };
}

/** ISO week label "2026-W43" of a YYYY-MM-DD date, or null. */
export function isoWeek(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const day = parsed.getUTCDay() || 7;
  parsed.setUTCDate(parsed.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(parsed.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((parsed.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${parsed.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Evaluated vs applied per ISO week, the last `limit` weeks with activity.
 * @param {AppFacts[]} facts
 */
export function weeklyActivity(facts, limit = 8) {
  const weeks = new Map();
  const bump = (week, key) => {
    if (!week) return;
    const row = weeks.get(week) ?? { week, evaluated: 0, applied: 0 };
    row[key] += 1;
    weeks.set(week, row);
  };
  for (const f of facts) {
    bump(isoWeek(f.app.date), "evaluated");
    if (f.appliedDate) bump(isoWeek(f.appliedDate), "applied");
  }
  return [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week)).slice(-limit);
}

const BUCKETS = [
  { label: "4.0+", min: 4, max: Infinity },
  { label: "3.5 to 3.9", min: 3.5, max: 4 },
  { label: "3.0 to 3.4", min: 3, max: 3.5 },
  { label: "Below 3.0", min: -Infinity, max: 3 },
];

/** Scores of everything evaluated, and of what was applied to, per band. */
export function fitBands(facts) {
  return BUCKETS.map((band) => {
    const inBand = facts.filter((f) => f.score !== null && f.score >= band.min && f.score < band.max);
    return { label: band.label, evaluated: inBand.length, applied: inBand.filter((f) => f.applied).length };
  });
}

/**
 * Evaluated / applied / replied per group, groups with nothing dropped.
 * @param {AppFacts[]} facts
 * @param {(f: AppFacts) => string|null} groupOf null = no data for this row
 * @param {string[]} [order] fixed group order; otherwise by volume
 */
export function breakdown(facts, groupOf, order) {
  const groups = new Map();
  let missing = 0;
  for (const f of facts) {
    const key = groupOf(f);
    if (!key) {
      missing += 1;
      continue;
    }
    const row = groups.get(key) ?? { label: key, evaluated: 0, applied: 0, replied: 0 };
    row.evaluated += 1;
    if (f.applied) row.applied += 1;
    if (f.replied) row.replied += 1;
    groups.set(key, row);
  }
  const rows = [...groups.values()];
  rows.sort(order ? (a, b) => order.indexOf(a.label) - order.indexOf(b.label) : (a, b) => b.evaluated - a.evaluated || a.label.localeCompare(b.label));
  return { rows, missing };
}

/** The archetype group, only for the exact canonical names (house rule 19). */
export function archetypeOf(f) {
  return ARCHETYPES.includes(String(f.app.archetype ?? "")) ? String(f.app.archetype) : null;
}

/** @type {[RegExp, string][]} */
const SOURCES = [
  [/getonbrd\.com/, "Get on Board"],
  [/linkedin\.com/, "LinkedIn"],
  [/bairesdev\.com/, "BairesDev"],
  [/greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|bamboohr\.com|recruitee\.com|rippling\.com|myworkdayjobs\.com|breezy\.hr|smartrecruiters\.com/, "Company ATS"],
  [/^mailto:/, "Email to recruiter"],
  [/remoteok|weworkremotely|himalayas|workingnomads|remotive|nodesk|mobile\.career|speedrun/, "Remote job boards"],
];

/**
 * Where the posting came from, from its URL.
 * @param {AppFacts} f
 * @returns {string|null}
 */
export function sourceOf(f) {
  const url = String(f.app.url ?? "").toLowerCase();
  if (!url) return null;
  return SOURCES.find(([pattern]) => pattern.test(url))?.[1] ?? "Company site";
}

/**
 * Applied and replied per CV, from data/cv-ab.tsv rows (cv "a"/"b", outcome).
 * @param {{cv: string, outcome: string}[]} rows
 */
export function cvSplit(rows) {
  return ["a", "b"].map((cv) => {
    const sent = rows.filter((r) => String(r.cv).toLowerCase() === cv);
    const replied = sent.filter((r) => REPLIED.has(String(r.outcome).toUpperCase())).length;
    return { cv: cv.toUpperCase(), applied: sent.length, replied };
  });
}
