/**
 * Persist inbox Skip/undo by flipping the `data/pipeline.md` checkbox for one
 * posting URL. localStorage is only a cache; this is the file write.
 *
 * The URL is a matcher, never a filesystem path. Only the checkbox on matching
 * Pending rows changes — company/role and every other line stay byte-identical.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { postingUrl } from "./posting-url.mjs";
import { localJdPath, stripEmDash } from "./lifecycle.mjs";

export { postingUrl };

/**
 * A pipeline row target: an http(s) posting URL, or a `local:jds/<name>.md`
 * capture (LinkedIn posts, pasted JDs). Anything else is refused.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function rowTarget(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return postingUrl(value) ?? (localJdPath(value) ? value : null);
}

const CHECKBOX_LINE = /^(\s*-\s*)\[([ xX])\](.*)$/;
const PENDING_HEADING = /^##\s+(Pending|Pendientes)\s*$/i;

/**
 * Job URL on a pipeline checkbox line — the first `|` cell, same rule as
 * readInbox. The whole cell must be an http(s) posting URL; a substring
 * elsewhere on the line is not a match.
 *
 * @param {string} rest text after `- [ ]` / `- [x]`
 * @returns {string | null}
 */
export function jobUrlFromRest(rest) {
  return rowTarget(rest.split("|")[0]);
}

function pendingRange(lines) {
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (PENDING_HEADING.test(t)) {
      start = i + 1;
      continue;
    }
    if (start !== -1 && t.startsWith("## ")) {
      return { start, end: i };
    }
  }
  if (start !== -1) return { start, end: lines.length };
  return null; // no Pending heading → every line is a candidate
}

function inRange(i, range) {
  return !range || (i >= range.start && i < range.end);
}

/**
 * Flip `- [ ]` ↔ `- [x]` on Pending rows whose job URL equals `url`.
 *
 * @param {string} text pipeline.md contents
 * @param {string} url posting URL already accepted by postingUrl()
 * @param {boolean} done true = Skip (`[x]`), false = undo (`[ ]`)
 * @returns {{ ok: true, text: string, matched: number, changed: number } | { ok: false, error: string }}
 */
export function applyInboxSkip(text, url, done) {
  const parsed = rowTarget(url);
  if (!parsed) return { ok: false, error: "invalid-url" };

  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const endedWithNl = /\r?\n$/.test(text);
  const lines = text.split(/\r?\n/);
  if (endedWithNl && lines[lines.length - 1] === "") lines.pop();

  const range = pendingRange(lines);
  const want = done ? "x" : " ";
  let matched = 0;
  let changed = 0;

  for (let i = 0; i < lines.length; i++) {
    if (!inRange(i, range)) continue;
    const m = lines[i].match(CHECKBOX_LINE);
    if (!m) continue;
    const rest = m[3];
    const jobUrl = jobUrlFromRest(rest);
    if (jobUrl !== parsed) continue;
    matched += 1;
    const currentlyDone = m[2].toLowerCase() === "x";
    if (currentlyDone === done) continue;
    lines[i] = `${m[1]}[${want}]${rest}`;
    changed += 1;
  }

  if (matched === 0) return { ok: false, error: "unmatched" };
  return {
    ok: true,
    text: lines.join(nl) + (endedWithNl ? nl : ""),
    matched,
    changed,
  };
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

/**
 * Read-modify-write `pipeline.md` under the core pipeline lock when available.
 *
 * @param {string} pipelinePath absolute path to data/pipeline.md
 * @param {string} url
 * @param {boolean} done
 * @param {{ lockModule?: string, timeoutMs?: number }} [options]
 */
export async function setInboxSkip(pipelinePath, url, done, options = {}) {
  const parsed = rowTarget(url);
  if (!parsed) return { ok: false, error: "invalid-url" };
  return editPipeline(pipelinePath, (md) => applyInboxSkip(md, parsed, done), options);
}

const LABEL_KEY = /^[a-z]+$/;

/**
 * Set one `key: value` label cell on Pending rows whose target equals `url`,
 * replacing an earlier cell with the same key. Company and role cells are
 * padded first, because parseInbox only reads labels from the third cell after
 * the URL; otherwise a short row would read the label as its location.
 *
 * @param {string} text pipeline.md contents
 * @param {string} url row target accepted by rowTarget()
 * @param {string} key lowercase label name, e.g. "triage"
 * @param {string} value label text (pipes, newlines and em-dashes are removed)
 * @returns {{ ok: true, text: string, matched: number, changed: number } | { ok: false, error: string }}
 */
export function applyInboxLabel(text, url, key, value) {
  const parsed = rowTarget(url);
  if (!parsed) return { ok: false, error: "invalid-url" };
  if (!LABEL_KEY.test(key)) return { ok: false, error: "invalid-label" };
  const clean = stripEmDash(value).replace(/[|\r\n]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return { ok: false, error: "invalid-label" };

  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const endedWithNl = /\r?\n$/.test(text);
  const lines = text.split(/\r?\n/);
  if (endedWithNl && lines[lines.length - 1] === "") lines.pop();

  const range = pendingRange(lines);
  const sameKey = new RegExp(`^${key}:\\s`, "i");
  let matched = 0;
  let changed = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!inRange(i, range)) continue;
    const m = lines[i].match(CHECKBOX_LINE);
    if (!m) continue;
    if (jobUrlFromRest(m[3]) !== parsed) continue;
    matched += 1;
    const cells = m[3].split("|").map((c) => c.trim());
    const kept = cells.filter((c, idx) => idx < 3 || !sameKey.test(c));
    while (kept.length < 3) kept.push("");
    kept.push(`${key}: ${clean}`);
    const next = `${m[1]}[${m[2]}] ${kept.join(" | ")}`;
    if (next !== lines[i]) {
      lines[i] = next;
      changed += 1;
    }
  }
  if (matched === 0) return { ok: false, error: "unmatched" };
  return { ok: true, text: lines.join(nl) + (endedWithNl ? nl : ""), matched, changed };
}

/**
 * Write a label cell on the matching pipeline row, under the pipeline lock.
 * @param {string} pipelinePath
 * @param {string} url
 * @param {string} key
 * @param {string} value
 * @param {{ lockModule?: string, timeoutMs?: number }} [options]
 */
export async function setInboxLabel(pipelinePath, url, key, value, options = {}) {
  const parsed = rowTarget(url);
  if (!parsed) return { ok: false, error: "invalid-url" };
  return editPipeline(pipelinePath, (md) => applyInboxLabel(md, parsed, key, value), options);
}

/** Read-modify-write pipeline.md with `apply`, under the core pipeline lock when given. */
async function editPipeline(pipelinePath, apply, options) {
  const run = () => {
    let md;
    try {
      md = fs.readFileSync(pipelinePath, "utf8");
    } catch (err) {
      if (err && err.code === "ENOENT") return { ok: false, error: "not-found" };
      throw err;
    }
    const result = apply(md);
    if (!result.ok) return result;
    if (result.changed > 0) atomicWrite(pipelinePath, result.text);
    return result;
  };

  const lockModule = options.lockModule;
  if (!lockModule) return run();

  const mod = await import(/* webpackIgnore: true */ pathToFileURL(lockModule).href);
  if (typeof mod.withPipelineLock !== "function") {
    throw new Error("pipeline-lock.mjs has no withPipelineLock");
  }
  try {
    return await mod.withPipelineLock(pipelinePath, run, {
      timeoutMs: options.timeoutMs ?? (Number(process.env.CAREER_OPS_WEB_LOCK_TIMEOUT_MS) || 5_000),
      retryMs: 50,
    });
  } catch (err) {
    if (err && err.name === "LockTimeoutError") return { ok: false, error: "busy" };
    throw err;
  }
}
