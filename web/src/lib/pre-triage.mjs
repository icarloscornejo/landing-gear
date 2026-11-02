// Zero-token pre-triage for Discovered rows (house rule 22): drops what is plainly
// out before any Haiku triage, from the row's own cells and, when it could be read
// for free (pretriage-jd.ts), the JD text. Every check reads English and Spanish,
// accents folded. Deliberately conservative: when in doubt a row passes, the
// triage reads the full JD.

import { fold, placesIn, readReach } from "./location-reach.mjs";

// Plainly not a developer role. Seniority words (semi senior, junior) are not here on
// purpose except intern/trainee.
const NOT_DEV = /\b(analista|analyst|product manager|project manager|program manager|product owner|scrum master|designer|disenador|sales|ventas|recruiter|reclutador|marketing|account (executive|manager)|customer (success|support)|soporte|intern|internship|pasantia|trainee|data scientist|writer|teacher|tutor|tester|qa|qe|quality (assurance|engineer\w*))\b/;
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
 * @returns {{pass: true} | {pass: false, reason: string}}
 */
export function preTriage(job, tracker, jd = null) {
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

  const location = (job.location ?? "").trim();
  const reach = location ? readReach(location, job.url).kind : "unknown";
  if (reach === "limited" || reach === "onsite") {
    return { pass: false, reason: `location restricted (${location})` };
  }

  if (text) {
    const blocked = residencyBlock(text);
    if (blocked) return { pass: false, reason: `residency: "${blocked}"` };
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
