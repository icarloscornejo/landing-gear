// Zero-token pre-triage for Discovered rows (house rule 22): drops what is plainly
// out before any Haiku triage, from the row's own cells and, when it could be read
// for free (pretriage-jd.ts), the JD text. Every check reads English and Spanish,
// accents folded. Deliberately conservative: when in doubt a row passes, the
// triage reads the full JD.

import { fold, placesIn, readReach } from "./location-reach.mjs";

// Plainly not a developer role. Seniority words (semi senior, junior) are not here on
// purpose except intern/trainee.
const NOT_DEV = /\b(analista|analyst|product manager|project manager|program manager|product owner|scrum master|designer|disenador|product design|design lead|sales|ventas|recruiter|reclutador|marketing|account (executive|manager)|customer (success|support)|soporte|intern|internship|pasantia|trainee|data scientist|writer|teacher|tutor|tester|qa|qe|quality (assurance|engineer\w*))\b/;
const DEV = /(engineer|developer|desarrollador|programador|ingenier|architect|arquitect|\bdev\b|android|kotlin|java|mobile|movil|\bios\b|flutter|react native|\bai\b|\bia\b|\bml\b|llm|agentic|tech(nical)? lead)/;
// AI data work sold as "AI" roles: not engineering (brief Hard DQ).
const AI_GIG = /\b(data label(l)?ing|label(l)?ers?|annotat\w*|raters?|evaluators?|ai trainer|ai tutor|etiquetado de datos|anotador\w*|evaluador\w*|entrenador de ia)\b/;
// The engineer (2026-10-27): backend Java with no Android or AI work is out; backend Kotlin stays.
const BACKEND = /\b(back ?-?end|server|servidor|api)\b/;
const KEEPS_BACKEND = /\b(android|kotlin|mobile|movil|ai|ia|llm|ml)\b/;

// Not a job offer. A title written in the first person is a candidate's own post.
const SELF_TITLE = /^(i am|i'm|im|i have|i've|i build|hire me|soy (un |una )?(desarrollador|programador|ingeniero)|busco (trabajo|empleo))\b/;
const MAX_TITLE = 150;
// In a JD's opening, these only count when the text has no sign of a real posting.
const CANDIDATE = /\b(i am an? |i'm an? |i have \d+\+? years|i am looking for (a |an )?(new )?(job|role|position|work|opportunit)|open to work|available for (hire|freelance)|hire me|my (portfolio|cv|resume)|busco (trabajo|empleo)|estoy buscando (trabajo|empleo)|soy (un |una )?(desarrollador|programador|ingeniero)|disponible para (trabajar|proyectos|freelance))/;
const SERVICE = /\b(we offer [^.]{0,40}services|we provide [^.]{0,40}services|our services|hire (our team|us)\b|get a (free )?quote|free consultation|looking for (new )?(clients|projects)|offering (my|our) services|ofrecemos (servicios|desarrollo)|nuestros servicios|cotiza\w*|solicita (una )?cotizacion)/;
const POSTING = /\b(requirements|responsibilities|qualifications|what you('ll| will) do|we('re| are) (looking|hiring)|you will|apply|join (our|the) team|requisitos|responsabilidades|buscamos|postula\w*|unete|ofrecemos (un|una|salario|sueldo|beneficios|trabajo))\b/;
const OPENING = 600;

// Residency (house rule 10): only an explicit "must live there" phrase, then the places it names.
// "residents of" alone is too common in company intros ("we serve residents of..."), so it
// needs "only" in the same sentence.
const RESIDENCY = /(must (reside|live|be (based|located|resident))|residents? of\b[^.]{0,80}\bonly\b|only (open )?to residents of|only (candidates|applicants|people) (based |located |residing )?in|requisito[^.]{0,15}residir|debes? (residir|vivir|radicar)|residir en|radicar en|estar radicad[oa]|radicad[oa]s? en|(solo|unicamente) (para )?residentes|con residencia en)/;
// "Argentina BASED RESOURCES ONLY", "UK, Ireland or Germany based candidates only": the places come
// before the phrase, back to the clause start. Needs "only" or "required": "US-based candidates are
// preferred" or "must overlap with PST" set a condition, not residency.
const BASED_ONLY = /[- ]based\s+((resources|candidates|applicants|talent)\s+)?(only|required)\b/;
const CLAUSE_START = /[.;:!?()\n*|]/;

// US work eligibility as a requirement (idea from ai-job-search, MIT). Only applied when the
// profile says the user is not authorized in the US (preTriage options.usAuthorized === false).
// Every pattern needs requirement wording; folded text, so "U.S." reads "u.s.".
const US = String.raw`(?:u\.?s\.?a?\.?|united states|american)`;
const ELIGIBILITY = [
  new RegExp(String.raw`\b(must|required to|need to|have to) (be|hold) (a |an )?${US} citizen`),
  new RegExp(String.raw`\b${US} citizen(s|ship)?( is| are)? (required|only|mandatory)\b`),
  new RegExp(String.raw`\brequires? ${US} citizenship\b`),
  /\b(debe|debes|deberas|requisito|requiere|se requiere)\b[^.]{0,40}\b(ciudadan[oa]s?|ciudadania) (estadounidense|de (los )?(estados unidos|ee\.? ?uu\.?))/,
  new RegExp(String.raw`\b(must|required to) (be|hold|have) (a |an )?(green card|${US} permanent resident|lawful permanent resident)`),
  new RegExp(String.raw`\b(green card|${US} permanent residen(t|cy)|lawful permanent resident)( holders?)?( is| are)? (required|only|mandatory)\b`),
  new RegExp(String.raw`\b(must|required to) (have|hold|possess|maintain|obtain)\b[^.]{0,30}\b(ts/sci|top secret|secret|${US} (security|government)) clearance`),
  new RegExp(String.raw`\b(active |current )?(ts/sci|top secret|secret|${US} (security|government)) clearance\b[^.]{0,30}\b(required|mandatory|only)\b`),
  new RegExp(String.raw`\b(must|required to) be (legally )?(authorized|eligible|able) to work in the ${US}\b[^.]{0,60}\bwithout\b[^.]{0,30}\bsponsorship`),
  /\bw-?2 (only|employees only|candidates only)\b/,
];
const NEGATED = /\b(no|not|never|without|doesn.?t|don.?t|isn.?t|aren.?t|sin)\b/;
const NOT_REQUIRED_AFTER = /^[^.]{0,30}\b(not required|not needed|not necessary|no es necesari[oa]|no se requiere)\b/;
const SOFT = /\b(preferred|a plus|nice to have|bonus|ability to obtain|able to obtain|eligible to obtain|eligibility to obtain|willing(ness)? to obtain|deseable|valorable)\b/;

// Stack the profile covers; a JD naming none of it is outside the profile.
const PROFILE_STACK = /\b(android|kotlin|mobile|movil|moviles|ios|swift|react native|flutter|ai|ia|llm|llms|machine learning|aprendizaje automatico|inteligencia artificial|agent\w*|agente\w*|genai)\b/;
const MIN_JD = 300;

const MONTHLY_FLOOR_USD = 4000;
const PER_MONTH = { year: 1 / 12, month: 1, week: 52 / 12, day: 21.7, hour: 160 };

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
 * The residency sentence that shuts El Salvador out, or null.
 * @param {string} text JD text
 */
export function residencyBlock(text) {
  for (const sentence of String(text ?? "").split(/(?<=[.;!?])\s+|\n+/)) {
    const folded = fold(sentence);
    const match = RESIDENCY.exec(folded);
    let named = match ? sentence.slice(match.index) : null;
    const based = match ? null : BASED_ONLY.exec(folded);
    if (based) {
      const before = folded.slice(0, based.index);
      let start = before.length;
      while (start > 0 && !CLAUSE_START.test(before[start - 1])) start--;
      named = before.slice(start);
    }
    if (named === null) continue;
    const { openScope, latam, others } = placesIn(named);
    if (openScope || (!latam.length && !others.length)) continue;
    return sentence.trim().replace(/\s+/g, " ").slice(0, 120);
  }
  return null;
}

/**
 * The sentence that requires US citizenship, a green card, a US clearance, US work
 * authorization without sponsorship or W-2, or null. A sentence passes when the
 * requirement is negated, only preferred, or offered with a non-US alternative
 * ("US or Canada", "US citizens or LATAM").
 * @param {string} text JD text
 */
export function eligibilityBlock(text) {
  // No split after initials ("U.S. citizen"), where the requirement usually sits.
  for (const sentence of String(text ?? "").split(/(?<=[.;!?])(?<!\b[a-zA-Z]\.)\s+|\n+/)) {
    const folded = fold(sentence);
    let match = null;
    for (const pattern of ELIGIBILITY) {
      match = pattern.exec(folded);
      if (match) break;
    }
    if (!match) continue;
    const before = folded.slice(0, match.index);
    let start = before.length;
    while (start > 0 && !/[,;:]/.test(before[start - 1])) start--;
    if (NEGATED.test(before.slice(start)) || NOT_REQUIRED_AFTER.test(folded.slice(match.index + match[0].length))) continue;
    if (SOFT.test(folded)) continue;
    const { openScope, latam, others } = placesIn(sentence);
    if (openScope || latam.length || others.some((place) => place !== "United States")) continue;
    return sentence.trim().replace(/\s+/g, " ").slice(0, 120);
  }
  return null;
}

// Extra drops ported from the LinkedIn post script (linkedin-post.mjs judgePost), each one gated
// by the profile so a user who did not ask for it never loses a row: US contract terms ride the
// same usAuthorized gate as eligibility, the rest come from profile.yml `pre_triage`.
const US_CONTRACT = /\b(only (us|usa)|(us|usa|north america) only|h-?1b|w-?2|c2c|corp[- ]to[- ]corp|1099|us citizens?|us residents)\b/;
// Only the work arrangement of the job itself: "hybrid SDKs", "hybrid React Native apps" and "a flexible
// and hybrid working environment" are not a requirement. A line that is only the word (a label) counts.
const WORK_MODE = /\b(hybrid (role|position|model|schedule|work(ing)? (model|arrangement|schedule)|setup)|(100% )?(on-?site|in[- ]office|presencial) (role|position|job|work|only|required|requirement)|(position|role|job) is (100% )?(on-?site|in[- ]office|hybrid|presencial)|(posicion|puesto|trabajo|modalidad)\b[^.]{0,25}\b(presencial|hibrid[oa])|\d+ days? (a|per) week (in|at) (the|our|an) office|(work ?model|work ?mode|modelo|modalidad|location|ubicacion|remote|remoto)\s*:[^.\n]{0,40}\b(hybrid|on-?site|presencial|hibrid[oa])|(hybrid|on-?site|presencial|hibrid[oa]) (in|en) [a-z]+)\b|\((hybrid|on-?site|presencial|hibrid[oa])\)|^\s*(hybrid|on-?site|presencial|hibrid[oa])\s*$/;
// "Remote: Hybrid" is a label, not a remote option.
const REMOTE_OPTION = /\b(remote|remoto|remota|teletrabajo|work from (home|anywhere))\b(?!\s*:)/;
const JUNIOR = /\b(junior|jr)\b/;
// Regions named in a (folded) title. "Pacific" alone is left out: "Pacific time" is a US
// schedule, not the Asia-Pacific region.
const REGION_IN_TITLE = /\b(apac|apj|asia[- ]?pacific|asia (&|and) (the )?pacific|emea|europe only|eu only|uk only|india only)\b/;
const LATAM_IN_TITLE = /\b(latam|latin america|americas|global|worldwide|anywhere)\b/;
const escapeRe = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The sentence that asks for hybrid or on-site work with no remote option and names none of
 * `workCountries` (nor does the row's location), or null. "Remote or hybrid" and "hybrid apps" pass.
 * @param {string} text JD text
 * @param {string} location the row's location cell
 * @param {string[]} workCountries folded country names the user can work on site in
 */
export function workModeBlock(text, location, workCountries) {
  const local = (value) => {
    const { latam, others } = placesIn(value);
    return [...latam, ...others].some((place) => workCountries.includes(fold(place)));
  };
  if (local(location)) return null;
  for (const sentence of String(text ?? "").split(/(?<=[.;!?])\s+|\n+/)) {
    const folded = fold(sentence);
    if (!WORK_MODE.test(folded) || REMOTE_OPTION.test(folded) || local(sentence)) continue;
    return sentence.trim().replace(/\s+/g, " ").slice(0, 120);
  }
  return null;
}

/** Monthly USD maximum from structured salary, or null when it isn't USD or has no max. */
function monthlyMaxUsd(salary) {
  if (!salary || String(salary.currency ?? "").toUpperCase() !== "USD") return null;
  const max = Number(salary.max);
  const factor = PER_MONTH[String(salary.period ?? "year").toLowerCase()];
  return Number.isFinite(max) && max > 0 && factor ? max * factor : null;
}

/**
 * @param {{url: string, company: string, role: string, location?: string}} job
 * @param {{urls: Set<string>, companyRoles: Set<string>}} tracker keys from applications.md
 * @param {{text: string, salary?: {max?: number, currency?: string, period?: string}} | null} [jd] JD read for free, if any
 * @param {{usAuthorized?: boolean}} [options] usAuthorized from usAuthorizedFrom(profile authorized_in);
 *   only false turns on the US eligibility check
 * @returns {{pass: true} | {pass: false, reason: string}}
 */
export function preTriage(job, tracker, jd = null, options = {}) {
  const link = urlKey(job.url);
  if ((link && tracker.urls.has(link)) || tracker.companyRoles.has(`${key(job.company)}|${key(job.role)}`)) {
    return { pass: false, reason: "already in tracker" };
  }

  const role = fold(String(job.role ?? "").trim());
  const text = String(jd?.text ?? "");
  const opening = fold(text.slice(0, OPENING));
  const isPosting = POSTING.test(fold(text));
  if (SELF_TITLE.test(role) || (opening && !isPosting && CANDIDATE.test(opening))) {
    return { pass: false, reason: "not a job posting (candidate looking for work)" };
  }
  if (opening && !isPosting && SERVICE.test(opening)) return { pass: false, reason: "not a job posting (service offer)" };
  if (role.length > MAX_TITLE) return { pass: false, reason: "not a job posting" };

  if (AI_GIG.test(role)) return { pass: false, reason: "not engineering (AI gig)" };
  if (NOT_DEV.test(role) || !DEV.test(role)) return { pass: false, reason: "not a target role" };
  if (/\bjava\b/.test(role) && BACKEND.test(role) && !KEEPS_BACKEND.test(role)) return { pass: false, reason: "backend Java" };
  if (options.skipJunior && JUNIOR.test(role)) return { pass: false, reason: "junior role" };
  // A region written in the title ("Flutter Engineer (APAC - Remote)") limits the role as
  // much as the location cell does, and some boards leave that cell empty.
  const titleRegion = REGION_IN_TITLE.exec(role);
  if (titleRegion && !LATAM_IN_TITLE.test(role)) return { pass: false, reason: `region in title (${titleRegion[0]})` };

  const location = (job.location ?? "").trim();
  const reach = location ? readReach(location, job.url).kind : "unknown";
  if (reach === "limited" || reach === "onsite") {
    return { pass: false, reason: `location restricted (${location})` };
  }

  if (text) {
    const blocked = residencyBlock(text);
    if (blocked) return { pass: false, reason: `residency: "${blocked}"` };
    const ineligible = options.usAuthorized === false ? eligibilityBlock(text) : null;
    if (ineligible) return { pass: false, reason: `eligibility: "${ineligible}"` };
    const folded = fold(text);
    const contract = options.usAuthorized === false ? US_CONTRACT.exec(folded) : null;
    if (contract) return { pass: false, reason: `US contract terms: "${contract[0]}"` };
    if (options.onsiteOnlyIn?.length) {
      const onsite = workModeBlock(text, location, options.onsiteOnlyIn.map(fold));
      if (onsite) return { pass: false, reason: `hybrid or on-site: "${onsite}"` };
    }
    if (options.blockedPlaces?.length) {
      const place = new RegExp(`\\b(${options.blockedPlaces.map((word) => escapeRe(fold(word))).join("|")})\\b`).exec(`${folded}\n${fold(location)}`);
      const scope = place ? placesIn(`${text}\n${location}`) : null;
      // "Remote from LATAM or the Philippines" names an open scope, so it stays.
      if (scope && !scope.openScope && !scope.latam.length) {
        return { pass: false, reason: `blocked place: ${place[0]}` };
      }
    }
    if (text.length >= MIN_JD && !PROFILE_STACK.test(fold(text))) return { pass: false, reason: "stack outside profile" };
  }
  const monthly = monthlyMaxUsd(jd?.salary);
  if (monthly !== null && monthly < MONTHLY_FLOOR_USD) return { pass: false, reason: `pay below floor (max about ${Math.round(monthly)} USD a month)` };
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
