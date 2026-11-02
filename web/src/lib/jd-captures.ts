// The jds/ captures and the posting each one was saved for. Shared by /api/run
// (which reads a saved JD instead of fetching) and the Pipeline page (which
// shows "JD saved" on a card), so both agree on what counts as saved.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { jdSourceLine, pastedJdMarkdown, resolveWorkerInput } from "@/lib/lifecycle.mjs";
import { runNodeScript } from "@/lib/set-status-run";

const FETCH_JD_TIMEOUT_MS = 30_000;

/**
 * Read a posting through root fetch-jd.mjs (Ashby, Greenhouse, Lever, Workday
 * and the other ATS APIs it knows) and save it as a jds/ capture, so the worker
 * reads the real JD instead of WebFetching a client-rendered page that shows
 * only its title. Returns the capture's repo-relative path, or null on a miss
 * (fetch-jd exits 1 with empty stdout), and the worker falls back as before.
 */
export async function fetchJdCapture(url: string, date: string): Promise<string | null> {
  const result = await runNodeScript(rootScript("fetch-jd"), [url], FETCH_JD_TIMEOUT_MS);
  const text = result.stdout.trim();
  if (result.code !== 0 || !text) return null;
  const relative = path.join("jds", `fetched-${createHash("sha1").update(url).digest("hex").slice(0, 10)}.md`);
  const role = text.split("\n")[0];
  const markdown = pastedJdMarkdown({ url, company: new URL(url).hostname, role, text, date, how: "read from the ATS API by the web server, live at that time" });
  fs.mkdirSync(path.join(careerOpsRoot(), "jds"), { recursive: true });
  fs.writeFileSync(path.join(careerOpsRoot(), relative), markdown);
  return relative;
}

export function listJdFiles(): string[] {
  try {
    return fs.readdirSync(path.join(careerOpsRoot(), "jds"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/** Each capture's "- Source:" URL. Only the head of each file is read. */
export function readJdSources(files: string[]): { file: string; source: string }[] {
  const sources: { file: string; source: string }[] = [];
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    try {
      const head = fs.readFileSync(path.join(careerOpsRoot(), "jds", file), "utf8").slice(0, 1500);
      const source = jdSourceLine(head);
      if (source) sources.push({ file, source });
    } catch (err) {
      // A capture that vanished between listing and reading just is not a source.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  return sources;
}

/** A checker for "this posting URL already has a saved JD" (pasted, Chrome or LinkedIn capture). */
export function savedJdChecker(): (url: string) => boolean {
  const jdFiles = listJdFiles();
  const jdSources = readJdSources(jdFiles);
  return (url) => {
    const target = resolveWorkerInput(url, { jdFiles, needsChromeHosts: [], jdSources });
    return target.ok && target.jdPath !== null && !String(url).startsWith("local:");
  };
}
