import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { careerOpsRoot, rootScript, type Application } from "@/lib/career-ops";
import { readTrackerFile } from "@/lib/core/tracker-files.mjs";
import { parseApplications } from "@/lib/tracker-table.mjs";
import { parseCliJson, clientErrorMessage } from "@/lib/status-cli.mjs";

// Shared by /api/status, /api/approve and /api/apply-cv: run root set-status.mjs
// and map its exit codes onto HTTP, so every tracker write from the web goes
// through the same locked, validated writer.

const SET_STATUS_TIMEOUT_MS = 30_000;

// The CLI waits a full minute for the tracker lock by default, which is right
// for a batch run and wrong for an HTTP request: bounding the child's wait below
// our own kill timeout lets its exit-4 path fire, so a busy tracker comes back as
// "retry shortly" instead of a killed request. An operator's own value is
// honored only while it stays under the ceiling.
const LOCK_WAIT_DEFAULT_MS = 10_000;
const LOCK_WAIT_CEILING_MS = SET_STATUS_TIMEOUT_MS - 5_000;

function boundedLockWait(): Record<string, string> {
  const raw = Number(process.env.CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS);
  const requested = Number.isFinite(raw) && raw > 0 ? raw : LOCK_WAIT_DEFAULT_MS;
  return { CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS: String(Math.min(requested, LOCK_WAIT_CEILING_MS)) };
}

// set-status.mjs exit codes (CLI_EXIT in tracker-utils.mjs) → HTTP. 3 also covers
// a failed --expect-tracker check (the tracker changed under us). 4 means another
// writer holds the lock: transient, so the caller should retry.
const EXIT_TO_HTTP: Record<number, number> = { 2: 404, 3: 409, 4: 503 };

// Exit 1 is the CLI's catch-all, and only `usage` / `invalid-state` are the
// caller's fault; anything else (or a crash with no JSON) reads as 500.
const CLIENT_ERROR_CODES = new Set(["usage", "invalid-state"]);

export type CliResult = { code: number; stdout: string; stderr: string; spawnFailed: boolean; timedOut: boolean };

/** Run a root node script with argv (never a shell). */
export function runNodeScript(script: string, args: string[], timeoutMs = SET_STATUS_TIMEOUT_MS): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [script, ...args],
      { cwd: careerOpsRoot(), timeout: timeoutMs, env: { ...process.env, ...boundedLockWait() } },
      (err, stdout, stderr) => {
        // A killed child (our timeout) carries no numeric exit code, so `killed`
        // is checked first to tell it apart from a spawn failure.
        const e = err as (NodeJS.ErrnoException & { killed?: boolean }) | null;
        const timedOut = e?.killed === true;
        const code = typeof e?.code === "number" ? e.code : e ? -1 : 0;
        resolve({ code, stdout: stdout || "", stderr: stderr || "", spawnFailed: !timedOut && code === -1, timedOut });
      },
    );
  });
}

export function runSetStatus(args: string[]): Promise<CliResult> {
  return runNodeScript(rootScript("set-status"), args);
}

/**
 * The HTTP failure for a set-status run, or null when it succeeded with JSON.
 * Child stderr is logged, never echoed: it can carry absolute server paths.
 */
export function setStatusFailure(result: CliResult, label: string): { status: number; body: Record<string, unknown>; headers?: Record<string, string> } | null {
  const { code, stdout, stderr, spawnFailed, timedOut } = result;
  const parsed = parseCliJson(stdout);
  if (spawnFailed) {
    console.error(`${label}: set-status.mjs failed to run: ${stderr.trim()}`);
    return { status: 500, body: { error: "status update failed to run" } };
  }
  if (timedOut) {
    return {
      status: 504,
      body: { error: "status update timed out; the change may or may not have been applied" },
      headers: { "Retry-After": "5" },
    };
  }
  if (code !== 0) {
    const cliCode = typeof parsed?.code === "string" ? parsed.code : undefined;
    const httpStatus = code === 1 ? (cliCode && CLIENT_ERROR_CODES.has(cliCode) ? 400 : 500) : (EXIT_TO_HTTP[code] ?? 500);
    if (!parsed && stderr.trim()) console.error(`${label}: set-status.mjs exited ${code} without JSON: ${stderr.trim()}`);
    return {
      status: httpStatus,
      body: { error: clientErrorMessage(parsed, stderr), ...(cliCode ? { code: cliCode } : {}) },
      ...(httpStatus === 503 ? { headers: { "Retry-After": "5" } } : {}),
    };
  }
  if (!parsed) return { status: 500, body: { error: "status update returned no result" } };
  return null;
}

/**
 * One tracker row plus the SHA-256 of the exact tracker text it was read from,
 * for set-status's --expect-tracker: a write only lands if nothing changed since.
 */
export function readRowWithHash(row: string): { app: Application | null; sha: string } | null {
  const md = readTrackerFile(careerOpsRoot());
  if (md == null) return null;
  const sha = createHash("sha256").update(md, "utf8").digest("hex");
  const apps = parseApplications(md, careerOpsRoot(), path.resolve(process.cwd(), "..")) as Application[];
  const app = apps.find((a) => parseInt(a.n, 10) === Number(row)) ?? null;
  return { app, sha };
}
