// Parity for the web's look-alike ATS host mirror: the core's lookalikeAts (ats-vendor.mjs)
// and web/src/lib/core/ats-lookalike.mjs must agree on every URL.

import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { lookalikeAts as webLookalike } from "../../src/lib/core/ats-lookalike.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const { lookalikeAts: coreLookalike } = await import(pathToFileURL(join(ROOT, "ats-vendor.mjs")).href);

test("web mirror matches core on real, corporate and look-alike hosts", () => {
  for (const url of [
    "https://boards.greenhouse.io/acme", "https://www.greenhouse.com", "https://jobs.lever.co/a", "https://jobs.ashbyhq.com/a",
    "https://acme.wd5.myworkdayjobs.com/x", "https://www.workday.com", "https://www.dayforce.com", "https://acme.fa.oraclecloud.com/x",
    "https://careers.unilever.com", "https://clever.com", "https://greenhouse.io.evil.com/x", "https://greenhouse-io.com/j",
    "https://jobs-lever.co/a", "https://ashbyhq.careers/b", "https://apply.jobs.lever.co.example.net/x", "not a url", "",
  ]) assert.deepEqual(webLookalike(url), coreLookalike(url), url);
});
