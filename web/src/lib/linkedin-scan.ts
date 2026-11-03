import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { landingGearRoot, readProfileAuthorizedIn } from "@/lib/landing-gear";
import { buildLinkedinScript } from "@/lib/linkedin-script.mjs";
import { buildXScript } from "@/lib/x-script.mjs";
import { usAuthorizedFrom } from "@/lib/location-reach.mjs";

export type LinkedinScanState = { ranToday: boolean; lastRun: string | null; script: string | null };

// A console scan downloads ~/Downloads/<prefix>-<local date>.json; that file is the only trace a run leaves.
function consoleScanState(prefix: string, build: (root: string, usAuthorized: boolean | undefined) => string): LinkedinScanState {
  const today = new Date().toLocaleDateString("en-CA");
  const file = new RegExp(`^${prefix}-(\\d{4}-\\d{2}-\\d{2})(?: \\(\\d+\\))?\\.json$`);
  let lastRun: string | null = null;
  try {
    for (const name of fs.readdirSync(path.join(os.homedir(), "Downloads"))) {
      const match = file.exec(name);
      if (match && (!lastRun || match[1] > lastRun)) lastRun = match[1];
    }
  } catch (error) {
    console.warn(`${prefix} scan: cannot read ~/Downloads`, error);
  }
  let script: string | null = null;
  try {
    script = build(landingGearRoot(), usAuthorizedFrom(readProfileAuthorizedIn()));
  } catch (error) {
    console.warn(`${prefix} scan: cannot build the script`, error);
  }
  return { ranToday: lastRun === today, lastRun, script };
}

/** The LinkedIn posts scan (web/src/lib/linkedin-posts-scan.js). */
export const linkedinScanState = () => consoleScanState("linkedin-posts", buildLinkedinScript);

/** The X posts scan (web/src/lib/x-posts-scan.js). */
export const xScanState = () => consoleScanState("x-posts", buildXScript);
