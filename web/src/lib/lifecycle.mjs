/**
 * lifecycle.mjs: pure helpers for the engineer's pipeline lifecycle in the web
 * (pipeline -> triage -> evaluate -> approve -> applied with CV A/B).
 *
 * Plain module, no fs of its own: callers inject file listings and contents so
 * every rule here is testable as a value. House rules live in modes/_custom.md.
 */

import { canonStatus } from "./status-alias.mjs";

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
  // A JD the engineer pasted (or captured) for this exact posting wins over fetching
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
 * The markdown saved for a JD the engineer pasted in the web, or one the server read
 * from an ATS API (`how` says which).
 * @param {{url: string, company: string, role: string, text: string, date: string, how?: string}} args
 * @returns {string}
 */
export function pastedJdMarkdown({ url, company, role, text, date, how = "pasted in the web" }) {
  const oneLine = (value) => stripEmDash(String(value ?? "")).replace(/\s+/g, " ").trim();
  return `# ${oneLine(company) || "Unknown company"}: ${oneLine(role) || "Unknown role"}

- Source: ${url}
- Captured: ${date}, ${how} (untrusted posting text)

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
  parts.push("pending manual review");
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

// ── Hiring phases (house rule 25) ─────────────────────────────────────────────
// The canonical states have no screening or interview rounds, so a phase is a
// canonical status plus a "STAGE: <Phase> <round>" note, the same way Approved
// is Evaluated plus a note. set-status appends notes in order and never drops
// them, so the Notes cell is the phase history; the round lives in the note
// because set-status will not append the same note twice.

/**
 * @typedef {"applied"|"replied"|"screening"|"assessment"|"tech"|"manager"|"final"|"offer"|"hired"} PhaseKey
 * @typedef {"rejected"|"withdrawn"|"ghosted"|"closed"} ExitKind
 * @typedef {{key: PhaseKey, label: string, status: string, repeatable: boolean, noted: boolean}} Phase
 * @typedef {{num: number, from: string, to: string}} PhaseLogRow
 */

/** @type {readonly Phase[]} Phases after applying, in order. */
export const PHASES = Object.freeze([
  { key: "applied", label: "Applied", status: "Applied", repeatable: false, noted: false },
  { key: "replied", label: "Replied", status: "Responded", repeatable: false, noted: false },
  { key: "screening", label: "Screening", status: "Responded", repeatable: true, noted: true },
  { key: "assessment", label: "Assessment", status: "Assessment", repeatable: true, noted: true },
  { key: "tech", label: "Tech interview", status: "Interview", repeatable: true, noted: true },
  { key: "manager", label: "Hiring manager", status: "Interview", repeatable: true, noted: true },
  { key: "final", label: "Final interview", status: "Interview", repeatable: true, noted: true },
  { key: "offer", label: "Offer", status: "Offer", repeatable: false, noted: true },
  { key: "hired", label: "Hired", status: "Hired", repeatable: false, noted: true },
]);

const PHASE_ORDER = Object.fromEntries(PHASES.map((phase, index) => [phase.key, index]));
const PHASE_BY_KEY = Object.fromEntries(PHASES.map((phase) => [phase.key, phase]));
const PHASE_BY_LABEL = Object.fromEntries(PHASES.map((phase) => [phase.label.toLowerCase(), phase.key]));

/** Statuses of a row that was applied to and is still open (Hired is done). */
const OPEN_APPLIED = new Set(["APPLIED", "RESPONDED", "ASSESSMENT", "INTERVIEW", "OFFER"]);
/** Statuses whose presence in the ledger proves the row was applied to. */
const SUBMITTED = new Set(["APPLIED", "RESPONDED", "ASSESSMENT", "INTERVIEW", "OFFER", "HIRED", "REJECTED"]);
/** A bare status (no STAGE note) read as a phase. */
const PHASE_OF_STATUS = { APPLIED: "applied", RESPONDED: "replied", ASSESSMENT: "assessment", INTERVIEW: "tech", OFFER: "offer", HIRED: "hired" };

export const EXIT_KINDS = Object.freeze({
  rejected: { label: "Rejected", status: "Rejected" },
  withdrawn: { label: "Withdrawn", status: "Discarded" },
  ghosted: { label: "Ghosted", status: "Discarded" },
  closed: { label: "Posting closed", status: "Discarded" },
});
const EXIT_BY_LABEL = { rejected: "rejected", withdrawn: "withdrawn", ghosted: "ghosted", "posting closed": "closed" };

const PHASE_LABELS = "Applied|Replied|Screening|Assessment|Tech interview|Hiring manager|Final interview|Offer|Hired";
// The interview date sits right after the label and round, strict ISO with an
// offset, so a following "; OUTCOME: ..." or "(call)" never leaks into it.
const STAGE_AT = "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}[+-]\\d{2}:\\d{2}";
const STAGE_RE = new RegExp(`STAGE:\\s*(${PHASE_LABELS})(?:\\s+(\\d+))?(?:\\s*@\\s*(${STAGE_AT}))?`, "gi");
const STAGE_HEAD_RE = new RegExp(`(STAGE:\\s*(?:${PHASE_LABELS})(?:\\s+\\d+)?)(?:\\s*@\\s*${STAGE_AT})?`, "i");
const OUTCOME_RE = new RegExp(`OUTCOME:\\s*(Rejected|Withdrawn|Ghosted|Posting closed)\\s+at\\s+(${PHASE_LABELS})(?:\\s+(\\d+))?`, "gi");

/** @param {string} raw */
function canonOf(raw) {
  return canonStatus(String(raw ?? "").replace(/\s+\d{4}-\d{2}-\d{2}\s*$/, "").trim());
}

/** @param {PhaseKey} key */
export function phaseInfo(key) {
  return PHASE_BY_KEY[key];
}

/**
 * "Screening 2" for a repeatable phase, the bare label otherwise.
 * @param {PhaseKey} key
 * @param {number} [round]
 */
export function phaseLabel(key, round = 1) {
  const phase = PHASE_BY_KEY[key];
  return phase.repeatable ? `${phase.label} ${round}` : phase.label;
}

/**
 * Every STAGE note in the cell, in the order written. A legacy note with no
 * number ("STAGE: Screening") is round 1. `at` is the interview date, if set;
 * `text` is the whole "; "-separated note holding the mark, the unit
 * set-status --replace-note matches.
 * @param {unknown} notes
 * @returns {StageMark[]}
 */
export function stageMarks(notes) {
  const cell = String(notes ?? "");
  return [...cell.matchAll(STAGE_RE)].map((match) => {
    const start = cell.lastIndexOf("; ", match.index) + 1;
    const end = cell.indexOf("; ", match.index);
    return {
      phase: PHASE_BY_LABEL[match[1].toLowerCase()],
      round: match[2] ? Number(match[2]) : 1,
      at: match[3] ?? null,
      text: cell.slice(start, end === -1 ? undefined : end).trim(),
    };
  });
}

/** @typedef {{phase: PhaseKey, round: number, at: string|null, text: string|null}} StageMark */

/**
 * The note set-status.mjs appends for a phase, or null for a phase without one.
 * @param {PhaseKey} key
 * @param {number} [round]
 * @param {string|null} [at] interview date, canonical ISO with offset
 * @returns {string|null}
 */
export function phaseNote(key, round = 1, at = null) {
  if (!PHASE_BY_KEY[key].noted) return null;
  return at ? `STAGE: ${phaseLabel(key, round)} @ ${at}` : `STAGE: ${phaseLabel(key, round)}`;
}

/** Phases that are a meeting, so a date makes sense. */
export const DATED_PHASES = Object.freeze(["screening", "assessment", "tech", "manager", "final"]);

/**
 * A STAGE note with its date set, replaced or removed (`at` null), keeping
 * any text after the round: "STAGE: Screening 1 (call)" -> "STAGE: Screening 1 @ <ISO> (call)".
 * @param {string} text
 * @param {string|null} at
 */
export function datedNote(text, at) {
  return text.replace(STAGE_HEAD_RE, (_whole, head) => (at ? `${head} @ ${at}` : head));
}

/**
 * @param {ExitKind} kind
 * @param {PhaseKey} key
 * @param {number} [round]
 */
export function exitNote(kind, key, round = 1) {
  return `OUTCOME: ${EXIT_KINDS[kind].label} at ${phaseLabel(key, round)}`;
}

/**
 * The phase an open, applied row is in: the last STAGE note whose status the
 * row still has, else the status alone (bare Interview reads as Tech interview).
 * @param {{status?: unknown, notes?: unknown}} app
 * @returns {{phase: PhaseKey, round: number}|null}
 */
export function currentPhase(app) {
  const mark = currentMark(app);
  return mark ? { phase: mark.phase, round: mark.round } : null;
}

/**
 * The mark behind currentPhase, with its date and note text; a phase read from
 * the status alone has neither.
 * @param {{status?: unknown, notes?: unknown}} app
 * @returns {StageMark|null}
 */
export function currentMark(app) {
  const canon = canonOf(app.status);
  const marks = stageMarks(app.notes);
  for (let index = marks.length - 1; index >= 0; index -= 1) {
    if (PHASE_BY_KEY[marks[index].phase].status.toUpperCase() === canon) return marks[index];
  }
  const phase = PHASE_OF_STATUS[canon];
  return phase ? { phase, round: 1, at: null, text: null } : null;
}

/**
 * Where a row can move next: a later phase (skips allowed) or another round of
 * the current one. Only open, applied rows move; Applied itself is written only
 * by apply-cv (house rule 6), so it is never a target.
 * @param {{status?: unknown, notes?: unknown}} app
 * @returns {PhaseKey[]}
 */
export function nextPhases(app) {
  if (!OPEN_APPLIED.has(canonOf(app.status))) return [];
  const current = currentPhase(app);
  if (!current) return [];
  const order = PHASE_ORDER[current.phase];
  return PHASES.filter((phase) =>
    phase.key !== "applied" && (PHASE_ORDER[phase.key] > order || (phase.key === current.phase && phase.repeatable)),
  ).map((phase) => phase.key);
}

/**
 * The round a move to `key` writes: the next one when repeating the current phase.
 * @param {{status?: unknown, notes?: unknown}} app
 * @param {PhaseKey} key
 */
export function nextRound(app, key) {
  const current = currentPhase(app);
  return current && current.phase === key ? current.round + 1 : 1;
}

/** Whether a row was applied to and is still open. */
export function isOpenApplied(app) {
  return OPEN_APPLIED.has(canonOf(app.status));
}

/**
 * Phases the row went through, uncapped. STAGE notes first; the ledger and the
 * status only fill in a status no note covers, so a web move Screening -> Final
 * (ledger Responded -> Interview) does not invent a Tech phase.
 * @param {{n?: unknown, status?: unknown, notes?: unknown}} app
 * @param {PhaseLogRow[]} log
 * @returns {PhaseKey[]}
 */
function rawPath(app, log) {
  const canon = canonOf(app.status);
  const marks = stageMarks(app.notes);
  const num = Number(app.n);
  const ledger = new Set();
  for (const row of log) {
    if (row.num !== num) continue;
    ledger.add(canonOf(row.from));
    ledger.add(canonOf(row.to));
  }
  const outcome = lastOutcome(app.notes);
  const applied = marks.length > 0 || outcome !== null || SUBMITTED.has(canon) || [...ledger].some((status) => SUBMITTED.has(status));
  if (!applied) return [];

  const phases = new Set(/** @type {PhaseKey[]} */ (["applied"]));
  for (const mark of marks) phases.add(mark.phase);
  if (outcome) phases.add(outcome.phase);
  const covered = new Set(marks.map((mark) => PHASE_BY_KEY[mark.phase].status.toUpperCase()));
  for (const status of [...ledger, canon]) {
    const phase = PHASE_OF_STATUS[status];
    if (phase && !covered.has(status)) phases.add(phase);
  }
  const ordered = [...phases].sort((a, b) => PHASE_ORDER[a] - PHASE_ORDER[b]);
  // Any phase past Applied means the company replied.
  if (ordered.some((phase) => PHASE_ORDER[phase] > PHASE_ORDER.replied) && !phases.has("replied")) ordered.splice(1, 0, "replied");
  return ordered;
}

/** @param {unknown} notes */
function lastOutcome(notes) {
  const matches = [...String(notes ?? "").matchAll(OUTCOME_RE)];
  if (!matches.length) return null;
  const match = matches[matches.length - 1];
  return {
    kind: /** @type {ExitKind} */ (EXIT_BY_LABEL[match[1].toLowerCase()]),
    phase: /** @type {PhaseKey} */ (PHASE_BY_LABEL[match[2].toLowerCase()]),
    round: match[3] ? Number(match[3]) : 1,
  };
}

/**
 * How a closed row ended: the OUTCOME note when there is one; otherwise, for a
 * legacy row, Rejected reads as rejected, a "repeated:" note as repeated and any
 * other Discarded as closed, at the last phase it went through. A row closed
 * before applying has phase null.
 * @param {{n?: unknown, status?: unknown, notes?: unknown}} app
 * @param {PhaseLogRow[]} [log]
 * @returns {{kind: ExitKind|"repeated"|"skip"|"discarded", phase: PhaseKey|null, round: number}|null}
 */
export function exitOutcome(app, log = []) {
  const canon = canonOf(app.status);
  if (canon === "SKIP") return { kind: "skip", phase: null, round: 1 };
  if (canon !== "REJECTED" && canon !== "DISCARDED") return null;
  const noted = lastOutcome(app.notes);
  if (noted) return noted;
  const path = rawPath(app, log);
  const phase = path.length ? path[path.length - 1] : null;
  const round = phase ? stageMarks(app.notes).filter((mark) => mark.phase === phase).pop()?.round ?? 1 : 1;
  if (/\brepeated:/i.test(String(app.notes ?? ""))) return { kind: "repeated", phase, round };
  if (canon === "REJECTED") return { kind: "rejected", phase: phase ?? "applied", round };
  return { kind: phase ? "closed" : "discarded", phase, round };
}

/**
 * One line for a closed row: "Rejected after Tech interview 2", "Withdrew at
 * Screening 1", "Ghosted after Applied", "Posting closed at Offer". Null for
 * an open row.
 * @param {{n?: unknown, status?: unknown, notes?: unknown}} app
 * @param {PhaseLogRow[]} [log]
 * @returns {string|null}
 */
export function outcomeText(app, log = []) {
  const outcome = exitOutcome(app, log);
  if (!outcome) return null;
  const at = outcome.phase ? phaseLabel(outcome.phase, outcome.round) : "";
  switch (outcome.kind) {
    case "rejected": return `Rejected after ${at}`;
    case "withdrawn": return `Withdrew at ${at}`;
    case "ghosted": return `Ghosted after ${at}`;
    case "closed": return `Posting closed at ${at}`;
    case "repeated": return "Repeated posting";
    case "skip": return "SKIP";
    default: return "Discarded";
  }
}

/**
 * The phases a row actually went through, ending at its level: the current
 * phase while open, the exit phase once closed. Ledger evidence never pushes a
 * row past its level, so a backward CLI correction cannot over-count it.
 * @param {{n?: unknown, status?: unknown, notes?: unknown}} app
 * @param {PhaseLogRow[]} [log]
 * @returns {PhaseKey[]}
 */
export function phasePath(app, log = []) {
  const path = rawPath(app, log);
  const level = isOpenApplied(app) || canonOf(app.status) === "HIRED" ? currentPhase(app)?.phase : exitOutcome(app, log)?.phase;
  if (!level) return [];
  const capped = path.filter((phase) => PHASE_ORDER[phase] <= PHASE_ORDER[level]);
  if (!capped.includes(level)) capped.push(level);
  return capped;
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
