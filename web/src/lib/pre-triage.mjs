// Zero-token pre-triage for Discovered rows: drops what is plainly out by the row's
// own cells (title and location) or already in the tracker, before any Haiku triage.
// Deliberately conservative: when in doubt a row passes, triage reads the full JD.

// Plainly not a developer role. Seniority words (semi senior, junior) are not here on
// purpose except intern/trainee: Carlos keeps Java/Kotlin backend roles regardless.
const NOT_DEV = /\b(analista|analyst|product manager|project manager|program manager|product owner|scrum master|designer|dise[nñ]ador|sales|ventas|recruiter|reclutador|marketing|account (executive|manager)|customer (success|support)|soporte|intern|internship|pasant[ií]a|trainee|data scientist|writer|teacher|tutor|tester)\b/i;
const DEV = /(engineer|developer|desarrollador|programador|ingenier|architect|arquitect|\bdev\b|android|kotlin|java|mobile|\bios\b|flutter|react native|\bai\b|\bml\b|llm|agentic|tech(nical)? lead)/i;
// A location cell that does not shut out someone working remotely from El Salvador.
const OPEN_LOCATION = /(remote|remoto|anywhere|worldwide|global|latam|latin america|am[eé]rica latina|americas|el salvador|central america|centroam[eé]rica|^n\/?a$)/i;
const CLOSED_LOCATION = /\b(us|usa|u\.s\.|united states|uk|india|europe|eu)( only)?\b.*\bonly\b|\bonly\b.*\b(us|usa|uk|india|europe)\b/i;

const key = (text) => String(text ?? "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, " ").trim();

/** Comparable form of a posting URL: no query, fragment or trailing slash. */
export function urlKey(raw) {
  const href = /\]\((https?:[^)\s]+)\)/.exec(raw ?? "")?.[1] ?? String(raw ?? "").trim();
  if (!/^https?:\/\//i.test(href)) return "";
  try {
    const url = new URL(href);
    return (url.host.toLowerCase() + url.pathname.replace(/\/+$/, "")).toLowerCase();
  } catch {
    return "";
  }
}

/**
 * @param {{url: string, company: string, role: string, location?: string}} job
 * @param {{urls: Set<string>, companyRoles: Set<string>}} tracker keys from applications.md
 * @returns {{pass: true} | {pass: false, reason: string}}
 */
export function preTriage(job, tracker) {
  const link = urlKey(job.url);
  if ((link && tracker.urls.has(link)) || tracker.companyRoles.has(`${key(job.company)}|${key(job.role)}`)) {
    return { pass: false, reason: "already in tracker" };
  }
  if (NOT_DEV.test(job.role) || !DEV.test(job.role)) return { pass: false, reason: "not a target role" };
  const location = (job.location ?? "").trim();
  if (location && (CLOSED_LOCATION.test(location) || !OPEN_LOCATION.test(location))) {
    return { pass: false, reason: `location restricted (${location})` };
  }
  return { pass: true };
}

/** Tracker keys for preTriage, from parsed applications rows. */
export function trackerKeys(applications) {
  const urls = new Set();
  const companyRoles = new Set();
  for (const app of applications) {
    const link = urlKey(app.url);
    if (link) urls.add(link);
    companyRoles.add(`${key(app.company)}|${key(app.role)}`);
  }
  return { urls, companyRoles };
}
