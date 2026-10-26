/**
 * run-log.mjs: the readable markdown log of a finished worker run, written to
 * .career-ops-web/runs/ so the CLI assistant can read past runs. Shared by the
 * browser's /api/runs/save and the server-owned runs (lib/live-runs.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { stripEmDash } from "./lifecycle.mjs";

/**
 * @param {{id?: string, title?: string, subtitle?: string, page?: string, input?: string,
 *   result?: {score: number|null, summary?: string} | null, steps?: {kind: string, label: string}[], output?: string}} run
 * @returns {string}
 */
export function formatRunLog(run) {
  const steps = (Array.isArray(run.steps) ? run.steps : []).map((s) => `- ${s.kind === "tool" ? `🔧 ${s.label}` : s.label}`).join("\n");
  const verdict = run.result?.score != null ? `${run.result.score}/5, ${run.result.summary || ""}` : "-";
  const md = `# Web run · ${run.title || run.id}

- id: ${run.id}
- page: ${run.page || "-"}
- input: ${run.input || "-"}
- verdict: ${verdict}

## Steps
${steps}

## Output
${run.output || ""}
`;
  // House rule 15: no em-dash in written files; agent output often carries one.
  return stripEmDash(md);
}

/**
 * Writes the log; returns false on a bad id or a write failure.
 * @param {string} root career-ops root
 * @param {Parameters<typeof formatRunLog>[0]} run
 * @returns {boolean}
 */
export function writeRunLog(root, run) {
  const safeId = String(run.id ?? "").replace(/[^a-z0-9_-]/gi, "");
  if (!safeId) return false;
  const dir = path.join(root, ".career-ops-web", "runs");
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${safeId}.md`), formatRunLog(run));
    return true;
  } catch {
    return false;
  }
}
