// The jds/ captures and the posting each one was saved for. Shared by /api/run
// (which reads a saved JD instead of fetching) and the Pipeline page (which
// shows "JD saved" on a card), so both agree on what counts as saved.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { landingGearRoot, rootScript } from "@/lib/landing-gear";
import { jdSourceLine, pastedJdMarkdown, resolveWorkerInput } from "@/lib/lifecycle.mjs";
import { runNodeScript } from "@/lib/set-status-run";
import { integritySection } from "@/lib/core/posting-guard.mjs";

const FETCH_JD_TIMEOUT_MS = 30_000;

/**
 * Read a posting through root fetch-jd.mjs (Ashby, Greenhouse, Lever, Workday
 * and the other ATS APIs it knows) and save it as a jds/ capture, so the worker
 * reads the real JD instead of WebFetching a client-rendered page that shows
 * only its title. Returns the capture's repo-relative path, or null on a miss
 * (fetch-jd exits 1 with empty stdout), and the worker falls back as before.
 */
export async function fetchJdCapture(url: string, date: string): Promise<string | null> {
  const relative = path.join("jds", `fetched-${createHash("sha1").update(url).digest("hex").slice(0, 10)}.md`);
  fs.mkdirSync(path.join(landingGearRoot(), "jds"), { recursive: true });
  // fetch-jd.mjs already ran the posting guard on the text; its findings land in this file.
  const integrityFile = path.join(landingGearRoot(), `${relative}.integrity-${process.pid}.json`);
  try {
    const result = await runNodeScript(rootScript("fetch-jd"), [url, "--integrity-file", integrityFile], FETCH_JD_TIMEOUT_MS);
    const text = result.stdout.trim();
    if (result.code !== 0 || !text) return null;
    let findings: { kind: string; sample: string }[] = [];
    try {
      findings = JSON.parse(fs.readFileSync(integrityFile, "utf8")).findings ?? [];
    } catch {
      // An older fetch-jd without --integrity-file, or nothing written: no findings to add.
    }
    const role = text.split("\n")[0];
    const markdown = pastedJdMarkdown({ url, company: new URL(url).hostname, role, text, date, how: "read from the ATS API by the web server, live at that time" });
    fs.writeFileSync(path.join(landingGearRoot(), relative), markdown + integritySection(findings));
    return relative;
  } finally {
    fs.rmSync(integrityFile, { force: true });
  }
}

export function listJdFiles(): string[] {
  try {
    return fs.readdirSync(path.join(landingGearRoot(), "jds"));
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
      const head = fs.readFileSync(path.join(landingGearRoot(), "jds", file), "utf8").slice(0, 1500);
      const source = jdSourceLine(head);
      if (source) sources.push({ file, source });
    } catch (err) {
      // A capture that vanished between listing and reading just is not a source.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  return sources;
}

export type JdLinks = { jdSaved: boolean; jdFile?: string; sourceUrl?: string };

/**
 * For each inbox row: whether a JD is saved for its posting URL (pasted, Chrome or
 * LinkedIn capture), the capture file to show, and, for a `local:jds/` row, the
 * posting link from the capture's "Source:" header (LinkedIn post captures write it
 * without the leading dash), since such a row has no URL of its own.
 */
export function jdLinksChecker(): (url: string) => JdLinks {
  const jdFiles = listJdFiles();
  const jdSources = readJdSources(jdFiles);
  return (url) => {
    const target = resolveWorkerInput(url, { jdFiles, needsChromeHosts: [], jdSources });
    if (!target.ok || !target.jdPath) return { jdSaved: false };
    const local = String(url).startsWith("local:");
    const jdFile = path.basename(target.jdPath);
    if (!local) return { jdSaved: true, jdFile };
    let sourceUrl: string | undefined;
    try {
      const head = fs.readFileSync(path.join(landingGearRoot(), target.jdPath), "utf8").slice(0, 1500);
      sourceUrl = /^-?\s*Source:\s*(https?:\/\/\S+)/im.exec(head)?.[1];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    return { jdSaved: false, jdFile, ...(sourceUrl ? { sourceUrl } : {}) };
  };
}
