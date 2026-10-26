import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

export type LinkedinScanState = { ranToday: boolean; lastRun: string | null; script: string | null };

// The console script (my-tools/linkedin-posts-scan.js) downloads
// ~/Downloads/linkedin-posts-<local date>.json; that file is the only trace a run leaves.
export function linkedinScanState(): LinkedinScanState {
  const today = new Date().toLocaleDateString("en-CA");
  let lastRun: string | null = null;
  try {
    for (const name of fs.readdirSync(path.join(os.homedir(), "Downloads"))) {
      const match = /^linkedin-posts-(\d{4}-\d{2}-\d{2})(?: \(\d+\))?\.json$/.exec(name);
      if (match && (!lastRun || match[1] > lastRun)) lastRun = match[1];
    }
  } catch (error) {
    console.warn("linkedin scan: cannot read ~/Downloads", error);
  }
  let script: string | null = null;
  try {
    script = fs.readFileSync(path.join(careerOpsRoot(), "my-tools", "linkedin-posts-scan.js"), "utf8");
  } catch (error) {
    console.warn("linkedin scan: script not found", error);
  }
  return { ranToday: lastRun === today, lastRun, script };
}
