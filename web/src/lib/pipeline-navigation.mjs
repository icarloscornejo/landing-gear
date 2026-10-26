import { canonStatus } from "./status-alias.mjs";
import { isApproved } from "./home/awaiting.mjs";

// Carry only the list's own filters through a report URL. Return destinations
// remain fixed to /pipeline; no arbitrary "returnTo" URL or browser storage.
const FILTER_KEYS = ["tab", "min", "sort", "dir", "q"];

/**
 * @param {string | Record<string, string | string[] | undefined>} params
 * @param {string} [search] The current local search, including an explicit clear.
 */
export function pipelineQuery(params, search) {
  const query = new URLSearchParams();
  const source = typeof params === "string" ? new URLSearchParams(params) : params;
  for (const key of FILTER_KEYS) {
    const raw = source instanceof URLSearchParams ? source.get(key) : source[key];
    // Match useSearchParams().get(): a repeated query key uses its first value.
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === "string" && value !== "") query.set(key, value);
  }
  if (search !== undefined) {
    if (search) query.set("q", search);
    else query.delete("q");
  }
  return query.toString();
}

// Carlos's lifecycle, in order. INBOX ("Discovered", the default) and TRIAGED
// read data/pipeline.md; the rest group tracker rows (trackerTabOf). ALL is last
// because it is a view of everything, not a stage.
export const PIPELINE_TABS = /** @type {const} */ ([
  "INBOX",
  "TRIAGED",
  "EVALUATED",
  "APPROVED",
  "APPLIED",
  "RESPONDED",
  "ASSESSMENT",
  "INTERVIEW",
  "OFFER",
  "CLOSED",
  "ALL",
]);

/** Tabs that read the pipeline file rather than the tracker. */
export const INBOX_TABS = /** @type {const} */ (["INBOX", "TRIAGED"]);

/** Mid-process tabs shown only while they hold a row (or are open). */
export const HIDE_WHEN_EMPTY = /** @type {const} */ (["RESPONDED", "ASSESSMENT", "INTERVIEW", "OFFER"]);

/** @type {Record<string, string>} */
export const TAB_LABELS = { INBOX: "DISCOVERED" };

/**
 * The tracker tab a row belongs to. Approved is an Evaluated row with the
 * APPROVED note; Hired sits under Offer; every closed state under Closed.
 * @param {{status?: unknown, notes?: unknown}} app
 * @returns {string}
 */
export function trackerTabOf(app) {
  const status = canonStatus(String(app.status ?? "").trim());
  if (status === "EVALUATED") return isApproved(app) ? "APPROVED" : "EVALUATED";
  if (status === "HIRED") return "OFFER";
  if (status === "REJECTED" || status === "DISCARDED" || status === "SKIP") return "CLOSED";
  return status;
}

/**
 * Whether a pending pipeline job belongs on the given inbox tab: Discovered
 * holds jobs with no triage label yet, Triaged the ones with one.
 * @param {"INBOX"|"TRIAGED"} tab
 * @param {{triage?: string}} job
 */
export function inboxTabHas(tab, job) {
  return tab === "TRIAGED" ? Boolean(job.triage) : !job.triage;
}

/**
 * The tab a `?tab=` value selects. The server page and the client view both
 * call this, so they agree on which tab shows the inbox.
 * @param {string | string[] | null | undefined} raw
 * @returns {(typeof PIPELINE_TABS)[number]}
 */
export function pipelineTab(raw) {
  const value = String((Array.isArray(raw) ? raw[0] : raw) ?? "").toUpperCase();
  return PIPELINE_TABS.find((t) => t === value) ?? "INBOX";
}
