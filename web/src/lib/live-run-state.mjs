/**
 * live-run-state.mjs: the state of one server-owned run (triage/evaluate),
 * built from the same NDJSON events /api/run streams. Pure, so the reducer is
 * testable; lib/live-runs.ts persists the snapshots and the web polls them.
 */

/** Characters of agent text kept per run, like the browser job store. */
export const MAX_TEXT = 8000;

/**
 * @typedef {{kind: "tool"|"status", label: string, ts: number}} RunStep
 * @typedef {{id: string, kind: string, input: string, title: string, subtitle: string, source: string,
 *   status: "queued"|"running"|"done"|"error", steps: RunStep[], text: string, verdictLine: string,
 *   startedAt: number, endedAt: number|null, tokens: number|null, costUsd: number|null,
 *   reportN: number|null, error: string|null}} RunSnapshot
 */

/**
 * @param {{id: string, kind: string, input: string, title: string, subtitle?: string, source?: string}} meta
 * @param {number} now
 * @returns {RunSnapshot}
 */
export function newRunSnapshot(meta, now) {
  return {
    id: meta.id,
    kind: meta.kind,
    input: meta.input,
    title: meta.title,
    subtitle: meta.subtitle ?? "",
    source: meta.source ?? "web",
    status: "queued",
    steps: [{ kind: "status", label: "Queued", ts: now }],
    text: "",
    verdictLine: "",
    startedAt: now,
    endedAt: null,
    tokens: null,
    costUsd: null,
    reportN: null,
    error: null,
  };
}

/**
 * @param {RunSnapshot} run
 * @param {string} label
 * @param {number} now
 * @returns {RunSnapshot}
 */
export function addStatus(run, label, now) {
  return { ...run, steps: [...run.steps, { kind: /** @type {const} */ ("status"), label, ts: now }] };
}

/**
 * Applies one /api/run event (or a terminal completion from readJobStream).
 * @param {RunSnapshot} run
 * @param {Record<string, unknown>} event
 * @param {number} now
 * @returns {RunSnapshot}
 */
export function applyRunEvent(run, event, now) {
  const type = event?.type;
  if (type === "text" && typeof event.text === "string") {
    const full = run.text + event.text;
    // Latched apart from the text tail so a long run cannot drop its verdict.
    const verdict = full.match(/(?:VERDICT|TRIAGE):[^\n]*/gi);
    return { ...run, status: "running", text: full.slice(-MAX_TEXT), verdictLine: verdict ? verdict[verdict.length - 1] : run.verdictLine };
  }
  if (type === "tool" && typeof event.name === "string") {
    return { ...run, status: "running", steps: [...run.steps, { kind: "tool", label: event.name, ts: now }] };
  }
  if (type === "status" && typeof event.label === "string") {
    return { ...run, steps: [...run.steps, { kind: "status", label: event.label, ts: now }] };
  }
  if (type === "done") {
    return {
      ...run,
      status: "done",
      endedAt: now,
      tokens: typeof event.tokens === "number" ? event.tokens : run.tokens,
      costUsd: typeof event.costUsd === "number" ? event.costUsd : run.costUsd,
      reportN: typeof event.reportN === "number" ? event.reportN : run.reportN,
      error: null,
      steps: [...run.steps, { kind: "status", label: "Done", ts: now }],
    };
  }
  if (type === "error") {
    const message = typeof event.msg === "string" && event.msg ? event.msg : "Error";
    return { ...run, status: "error", endedAt: now, error: message, steps: [...run.steps, { kind: "status", label: message, ts: now }] };
  }
  return run;
}

/**
 * The list view of a run: everything but the text and step log.
 * @param {RunSnapshot} run
 */
export function runSummary(run) {
  const { text: _text, steps, ...rest } = run;
  return { ...rest, lastStep: steps.length ? steps[steps.length - 1].label : "" };
}

/**
 * A run file left "running" or "queued" by a server that has since restarted
 * is not running any more.
 * @param {RunSnapshot} run
 * @param {boolean} inMemory whether this server process owns the run
 * @param {number} now
 * @returns {RunSnapshot}
 */
export function settleOrphan(run, inMemory, now) {
  if (inMemory || (run.status !== "running" && run.status !== "queued")) return run;
  return applyRunEvent(run, { type: "error", msg: "Interrupted (the web server restarted)" }, now);
}
