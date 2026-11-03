import { rootScript } from "@/lib/landing-gear";
import { runNodeScript, type CliResult } from "@/lib/set-status-run";

// my-tools/cv-pick.mjs (the engineer's CV A/B log, house rule 6) rewrites
// data/cv-ab.tsv with no lock and one fixed temp name, so every call from this
// server goes through one queue.
// ponytail: in-process queue only; a CLI run of cv-pick at the same moment can still race.
let queue: Promise<unknown> = Promise.resolve();

function runCvPick(args: string[]): Promise<CliResult> {
  const run = queue.then(() => runNodeScript(rootScript("my-tools/cv-pick"), args, 15_000));
  queue = run.catch(() => undefined);
  return run;
}

/** URLs cv-pick accepts as a row key. */
export function cvPickUrl(url: string | undefined): string | null {
  const value = String(url ?? "").trim();
  return /^(https?:\/\/|mailto:)\S+$/i.test(value) ? value : null;
}

export function recordCvPick(cv: "a" | "b", url: string, company: string, role: string): Promise<CliResult> {
  return runCvPick([cv, url, "--company", company, "--role", role]);
}

/**
 * Record a status as the outcome of a CV pick. A URL that never went through
 * cv-pick is skipped, not an error.
 */
export async function recordCvOutcome(url: string, state: string): Promise<{ ok: boolean; skipped: boolean; error?: string }> {
  const result = await runCvPick(["--outcome", url, state]);
  if (result.code === 0) return { ok: true, skipped: false };
  // cv-pick prints "No hay registro para <url>" (exit 2) when the URL was never picked.
  if (result.code === 2 && /No hay registro para/.test(result.stderr)) return { ok: true, skipped: true };
  return { ok: false, skipped: false, error: result.stderr.trim().replace(/^ERROR:\s*/, "").slice(0, 200) || "cv-pick failed" };
}
