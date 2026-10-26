/**
 * lifecycle.mjs: pure helpers for Carlos's pipeline lifecycle in the web
 * (pipeline -> triage -> evaluate -> approve -> applied with CV A/B).
 *
 * Plain module, no fs of its own: callers inject file listings and contents so
 * every rule here is testable as a value. House rules live in modes/_custom.md.
 */

/** A pipeline row that points at a saved JD instead of a URL. */
const LOCAL_JD_RE = /^local:(jds\/[A-Za-z0-9._-]+\.md)$/;

/**
 * The `jds/...` path of a `local:` row, or null when the value is not one.
 * @param {unknown} value
 * @returns {string|null}
 */
export function localJdPath(value) {
  const m = LOCAL_JD_RE.exec(String(value ?? "").trim());
  return m && !m[1].includes("..") ? m[1] : null;
}

/** Kinds that must run on Claude with Haiku at max effort. */
export const HAIKU_KINDS = Object.freeze(["evaluate", "triage"]);

// The two "the run finished but produced nothing to save" errors (route.ts).
const RETRYABLE = /didn't produce a report to save|without a TRIAGE: line/;

/**
 * Retry a Haiku triage/evaluate once when it ended without a savable result.
 * @param {string} kind
 * @param {string|undefined} message the job's final error
 * @param {number} attempt 0 for the first run
 * @returns {boolean}
 */
export function shouldRetryRun(kind, message, attempt) {
  return HAIKU_KINDS.includes(kind) && attempt < 1 && RETRYABLE.test(String(message ?? ""));
}

/**
 * Lines of `data/needs-real-chrome.txt` as lowercase hosts. Comments and blank
 * lines are ignored; a full URL on a line is reduced to its host.
 * @param {string} text
 * @returns {string[]}
 */
export function parseNeedsChrome(text) {
  const hosts = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim().toLowerCase();
    if (!line) continue;
    try {
      hosts.push(new URL(line.includes("://") ? line : `https://${line}`).hostname);
    } catch {
      // A line that is not a host cannot match anything; skip it.
    }
  }
  return hosts;
}

function hostMatches(host, listed) {
  return host === listed || host.endsWith(`.${listed}`);
}

/**
 * Decide what a triage/evaluate worker may read (house rules 13 and 18, JD Fetch
 * Recipes). LinkedIn and hosts behind a bot wall are never fetched by a script.
 *
 * @param {string} input pipeline target: http(s) URL or `local:jds/...`
 * @param {{jdFiles: string[], needsChromeHosts: string[], jdSources?: {file: string, source: string}[]}} env
 *   jdFiles: basenames in jds/; needsChromeHosts: from parseNeedsChrome;
 *   jdSources: each capture's "- Source:" URL (jdSourceLine)
 * @returns {{ok: true, jdPath: string|null} | {ok: false, error: string}}
 */
export function resolveWorkerInput(input, { jdFiles, needsChromeHosts, jdSources = [] }) {
  const value = String(input ?? "").trim();
  // A JD Carlos pasted (or captured) for this exact posting wins over fetching
  // it, for any host, including ones that block scripts.
  const pasted = jdSources.find((entry) => sameUrl(entry.source, value) && jdFiles.includes(entry.file));
  if (pasted) return { ok: true, jdPath: `jds/${pasted.file}` };
  if (value.startsWith("local:")) {
    const jdPath = localJdPath(value);
    if (!jdPath) return { ok: false, error: "That local JD path is not a plain jds/<name>.md file." };
    if (!jdFiles.includes(jdPath.slice("jds/".length))) {
      return { ok: false, error: `${jdPath} does not exist.` };
    }
    return { ok: true, jdPath };
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "The input is neither a posting URL nor a local:jds/ file." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "The input is neither a posting URL nor a local:jds/ file." };
  }
  const host = url.hostname.toLowerCase();
  if (hostMatches(host, "linkedin.com")) {
    const id = linkedinJobId(value);
    const captures = id ? jdFiles.filter((f) => f.startsWith(`linkedin-${id}-`) && f.endsWith(".md")) : [];
    if (captures.length === 1) return { ok: true, jdPath: `jds/${captures[0]}` };
    return { ok: false, error: "Needs real Chrome: capture the LinkedIn JD into jds/ first." };
  }
  if (needsChromeHosts.some((listed) => hostMatches(host, listed))) {
    return { ok: false, error: `Needs real Chrome: ${host} blocks scripts. Paste the JD into jds/ first.` };
  }
  return { ok: true, jdPath: null };
}

/** Two posting URLs name the same page: case-insensitive host, no trailing slash. */
export function sameUrl(a, b) {
  const norm = (value) => {
    try {
      const url = new URL(String(value ?? "").trim());
      return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, "")}${url.search}`;
    } catch {
      return null;
    }
  };
  const left = norm(a);
  return left !== null && left === norm(b);
}

/**
 * The posting URL a jds/ file was saved for, from its "- Source: <url>" line.
 * @param {string} text
 * @returns {string|null}
 */
export function jdSourceLine(text) {
  return /^-\s*Source:\s*(https?:\/\/\S+)/im.exec(String(text ?? ""))?.[1] ?? null;
}

/**
 * The markdown saved for a JD Carlos pasted in the web.
 * @param {{url: string, company: string, role: string, text: string, date: string}} args
 * @returns {string}
 */
export function pastedJdMarkdown({ url, company, role, text, date }) {
  const oneLine = (value) => stripEmDash(String(value ?? "")).replace(/\s+/g, " ").trim();
  return `# ${oneLine(company) || "Unknown company"}: ${oneLine(role) || "Unknown role"}

- Source: ${url}
- Captured: ${date}, pasted by Carlos in the web (untrusted posting text)

## Job description (verbatim)

${stripEmDash(String(text)).trim()}
`;
}

function linkedinJobId(url) {
  return /linkedin\.com\/jobs\/view\/(?:[^/?#]*-)?(\d+)/i.exec(url)?.[1]
    ?? /[?&]currentJobId=(\d+)/i.exec(url)?.[1]
    ?? null;
}

/** Per-host posting id patterns (rule 16: the id comes from the URL). */
const URL_ID_PATTERNS = [
  (u) => linkedinJobId(u),
  (u) => /greenhouse\.io\/.*\/jobs\/(\d+)/i.exec(u)?.[1] ?? /[?&]gh_jid=(\d+)/i.exec(u)?.[1],
  (u) => /jobs\.(?:lever\.co|ashbyhq\.com)\/[^/]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(u)?.[1],
  (u) => /myworkdayjobs\.com\/.*_([A-Z]{1,4}-?\d+[A-Za-z0-9-]*)(?:[/?#]|$)/.exec(u)?.[1],
  (u) => /bairesdev\.com\/job\/\d+\/(\d+)/i.exec(u)?.[1],
];

const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * The tracker `job id` for a persisted evaluation, derived deterministically.
 * Order: the LinkedIn post file name, then any known URL pattern, then the
 * model's own id only if it is a plain token.
 *
 * @param {{jdPath?: string|null, urls?: string[], modelId?: string|null}} args
 * @returns {string|null}
 */
export function deriveJobId({ jdPath, urls = [], modelId }) {
  const post = /^jds\/linkedin-post(?:-share)?-(\d+)\.md$/.exec(jdPath ?? "")?.[1];
  if (post) return post;
  for (const url of urls) {
    if (!url) continue;
    for (const pattern of URL_ID_PATTERNS) {
      const id = pattern(url);
      if (id) return id;
    }
  }
  const model = String(modelId ?? "").trim();
  return SAFE_ID.test(model) ? model : null;
}

/** `**URL:** <url>` from a report header, or null. */
export function reportUrlField(markdown) {
  return /^\*\*URL:\*\*\s*<?(\S+?)>?\s*$/m.exec(String(markdown ?? ""))?.[1] ?? null;
}

/** `**Job ID:**` (or Posting ID / Req ID) from a report header, or null. */
export function reportJobIdField(markdown) {
  return /^\*\*(?:Job|Posting|Req(?:uisition)?)\s+ID:\*\*\s*(\S+)/im.exec(String(markdown ?? ""))?.[1] ?? null;
}

/** `Source: <url>` from a jds capture header, or null. */
export function jdSourceUrl(text) {
  return /^Source:\s*(https?:\/\/\S+)/m.exec(String(text ?? ""))?.[1] ?? null;
}

// Built from the code point so this file itself never contains the character.
const EM_DASH = new RegExp(`\\s*${String.fromCharCode(0x2014)}\\s*`, "g");

/**
 * Replace the em-dash (U+2014) with a comma (house rule 15). Files written by
 * the backend never pass through the Claude Code hook that enforces it.
 * @param {string} text
 * @returns {string}
 */
export function stripEmDash(text) {
  return String(text ?? "").replace(EM_DASH, ", ");
}

const TRIAGE_LINE = /^TRIAGE:\s*(PASS|MARGINAL|FAIL|SKIP)\s*\|([^|\n]*)\|([^|\n]*)\|\s*(\d+(?:\.\d+)?)\s*\/\s*5\s*\|(.*)$/gim;

/**
 * The LAST `TRIAGE: VERDICT | Company | Role | N/5 | reason` line in a run's text.
 * @param {string} text
 * @returns {{verdict: string, score: string, reason: string} | null}
 */
export function parseTriageLine(text) {
  let last = null;
  for (const m of String(text ?? "").matchAll(TRIAGE_LINE)) last = m;
  if (!last) return null;
  const n = Number(last[4]);
  if (!Number.isFinite(n) || n < 0 || n > 5) return null;
  const reason = stripEmDash(last[5]).replace(/[|\r\n]/g, " ").replace(/\s+/g, " ").trim().replace(/^,\s*/, "");
  return { verdict: last[1].toUpperCase(), score: `${n.toFixed(1)}/5`, reason };
}

/** The label cell value written on the pipeline row. */
export function triageLabel({ verdict, score, reason }) {
  return `${verdict} ${score}${reason ? ` ${reason}` : ""}`.slice(0, 200);
}

/**
 * Tracker notes for a persisted web evaluation (rules 7, 16, 18).
 * @param {{jobId: string|null, postedAt?: string|null, isPost: boolean, finalUrl: string}} args
 * @returns {string}
 */
export function evaluationNotes({ jobId, postedAt, isPost, finalUrl }) {
  const parts = [];
  if (jobId) parts.push(`job id ${jobId}`);
  parts.push("pending Carlos manual review");
  let host = "";
  try { host = finalUrl ? new URL(finalUrl).hostname.toLowerCase() : ""; } catch { host = ""; }
  if (isPost && (!host || hostMatches(host, "linkedin.com"))) parts.push("LinkedIn post, not on employer site");
  if (postedAt && /^20\d{2}-\d{2}-\d{2}$/.test(postedAt)) parts.push(`posted: ${postedAt}`);
  return parts.join("; ");
}

// Forward-only status moves, one step at a time. Evaluated has no entry here:
// it moves through /api/approve and /api/apply-cv. Discarded is added for every
// open row; closed rows (Hired, Rejected, Discarded, SKIP) move nowhere.
const NEXT_STATUSES = Object.freeze({
  APPLIED: ["Responded", "Rejected"],
  RESPONDED: ["Assessment", "Interview", "Rejected"],
  ASSESSMENT: ["Interview", "Rejected"],
  INTERVIEW: ["Offer", "Rejected"],
  OFFER: ["Hired", "Rejected"],
});
const CLOSED = new Set(["HIRED", "REJECTED", "DISCARDED", "SKIP"]);

/**
 * The status buttons a row may show, in order, given its canonical status id
 * (status-alias.mjs `canonStatus`, e.g. "APPLIED").
 * @param {string} canon
 * @returns {string[]}
 */
export function nextStatuses(canon) {
  if (CLOSED.has(canon)) return [];
  return [...(NEXT_STATUSES[canon] ?? []), "Discarded"];
}

/**
 * Splits a saved triage label ("PASS 3.6/5 reason...") back into its parts,
 * the inverse of triageLabel. Unknown shapes come back as the reason alone.
 * @param {string} label
 * @returns {{verdict: string|null, score: number|null, reason: string}}
 */
export function splitTriageLabel(label) {
  const match = String(label ?? "").trim().match(/^(PASS|MARGINAL|FAIL)\s+(\d+(?:\.\d+)?)\/5\s*(.*)$/i);
  if (!match) return { verdict: null, score: null, reason: String(label ?? "").trim() };
  return { verdict: match[1].toUpperCase(), score: Number(match[2]), reason: match[3] };
}
