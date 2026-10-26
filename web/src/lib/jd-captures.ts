// The jds/ captures and the posting each one was saved for. Shared by /api/run
// (which reads a saved JD instead of fetching) and the Pipeline page (which
// shows "JD saved" on a card), so both agree on what counts as saved.
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { jdSourceLine, resolveWorkerInput } from "@/lib/lifecycle.mjs";

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
