// Daily zero-token portal scan (my-tools/daily-scan.sh), run by this web server
// instead of launchd: a launchd job cannot read ~/Desktop (macOS privacy), the
// server started from the terminal can. Runs once a day from 12:00 local time, or
// at the first check after the server starts if that day has no complete run.
// Today's "Run scan now" button starts the same run on demand.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { careerOpsRoot } from "@/lib/career-ops";

const START_HOUR = 12;
const CHECK_EVERY_MS = 10 * 60 * 1000;
// A failed or interrupted run is retried, but not more than once an hour.
const RETRY_AFTER_MS = 60 * 60 * 1000;

/** Only a run that finished with exit code 0 counts as a run. */
export type CompleteRun = {
  /** Local date (YYYY-MM-DD) the run finished. */
  date: string;
  finishedAt: string;
  /** "Company | Role | Location" lines for the postings it added to Discovered. */
  newPostings: string[];
};

export type DailyScanStatus = {
  running: boolean;
  lastComplete: CompleteRun | null;
  /** The latest attempt, when it did not complete (error or server stopped mid-run). */
  lastFailure: { startedAt: string; exitCode: number | null } | null;
};

type State = {
  lastComplete?: CompleteRun;
  attempt?: { startedAt: string; finishedAt?: string; exitCode?: number | null };
};

type Holder = { __careerOpsDailyScanV3?: { timer: NodeJS.Timeout | null; running: boolean } };

function holder(): { timer: NodeJS.Timeout | null; running: boolean } {
  const g = globalThis as Holder;
  g.__careerOpsDailyScanV3 ??= { timer: null, running: false };
  return g.__careerOpsDailyScanV3;
}

const stateDir = () => path.join(careerOpsRoot(), ".career-ops-web");
const statePath = () => path.join(stateDir(), "daily-scan.json");
const logPath = () => path.join(stateDir(), "daily-scan.log");

function readState(): State {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn("daily scan: unreadable state", error);
    return {};
  }
}

function writeState(state: State): void {
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
}

/** New postings in the scan output: `  + Company | Role | Location` lines from both scanners. */
export function newPostingsFromLog(log: string): string[] {
  return log.split("\n").filter((line) => /^\s+\+ /.test(line)).map((line) => line.replace(/^\s+\+ /, "").trim());
}

export function dailyScanStatus(): DailyScanStatus {
  const state = readState();
  const running = holder().running;
  const attempt = state.attempt;
  const failed = !running && attempt && !(attempt.finishedAt && attempt.exitCode === 0);
  return {
    running,
    lastComplete: state.lastComplete ?? null,
    lastFailure: failed ? { startedAt: attempt.startedAt, exitCode: attempt.exitCode ?? null } : null,
  };
}

/** Start a scan unless one is running. Returns false when it could not start. */
export function runDailyScan(): boolean {
  const scan = holder();
  if (scan.running) return false;
  const root = careerOpsRoot();
  const script = path.join(root, "my-tools", "daily-scan.sh");
  if (!fs.existsSync(script)) {
    console.warn("daily scan: my-tools/daily-scan.sh not found");
    return false;
  }
  const previous = readState();
  const startedAt = new Date().toISOString();
  writeState({ ...previous, attempt: { startedAt } });
  // The log holds the last attempt only; complete runs are summarized in the state file.
  const log = fs.openSync(logPath(), "w");
  scan.running = true;
  const child = spawn("/bin/bash", [script], { cwd: root, stdio: ["ignore", log, log] });
  let settled = false;
  const finish = (exitCode: number | null) => {
    if (settled) return;
    settled = true;
    scan.running = false;
    fs.closeSync(log);
    const finished = new Date();
    const state: State = { ...readState(), attempt: { startedAt, finishedAt: finished.toISOString(), exitCode } };
    if (exitCode === 0) {
      let output = "";
      try {
        output = fs.readFileSync(logPath(), "utf8");
      } catch (error) {
        console.warn("daily scan: log unreadable", error);
      }
      state.lastComplete = { date: finished.toLocaleDateString("en-CA"), finishedAt: finished.toISOString(), newPostings: newPostingsFromLog(output) };
    } else {
      console.warn(`daily scan: exited with code ${exitCode}, see .career-ops-web/daily-scan.log`);
    }
    writeState(state);
  };
  child.on("error", (error) => {
    console.warn("daily scan: could not start", error);
    finish(null);
  });
  child.on("close", (code) => finish(code));
  return true;
}

/** Whether the 12:00 checker should start a run now. */
export function scanDue(state: State, now: Date): boolean {
  if (now.getHours() < START_HOUR) return false;
  if (state.lastComplete?.date === now.toLocaleDateString("en-CA")) return false;
  const lastStart = state.attempt ? Date.parse(state.attempt.startedAt) : NaN;
  return !(now.getTime() - lastStart < RETRY_AFTER_MS);
}

/** Start the 12:00 checker once per server process (dev reloads reuse it). */
export function startDailyScan(): void {
  const scan = holder();
  // Opt-out for scratch copies and tests, which must not scan with real network calls.
  if (scan.timer || process.env.CAREER_OPS_NO_DAILY_SCAN === "1") return;
  const check = () => {
    try {
      if (!scan.running && scanDue(readState(), new Date())) runDailyScan();
    } catch (error) {
      console.warn("daily scan: check failed", error);
    }
  };
  scan.timer = setInterval(check, CHECK_EVERY_MS);
  check();
}
