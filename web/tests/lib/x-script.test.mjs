import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { portalQueries, withQueries } from "../../src/lib/linkedin-script.mjs";
import { buildXScript } from "../../src/lib/x-script.mjs";

const lib = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/lib");

test("the X console script builds with the post filter inlined and parses", () => {
  const script = buildXScript(path.resolve(lib, "../../.."), false);
  assert.ok(!script.includes("const modules = null; // MODULES"));
  assert.match(script, /usAuthorized:(!1|false)/);
  assert.doesNotThrow(() => new Function(script));
});

test("an X post keeps its first line: the scan gives splitPost a header (pilot 2026-11-02 bug)", async () => {
  const { splitPost, judgePost } = await import("../../src/lib/linkedin-post.mjs");
  const { preTriage } = await import("../../src/lib/pre-triage.mjs");
  const source = fs.readFileSync(path.join(lib, "x-posts-scan.js"), "utf8");
  assert.match(source, /splitPost\(\[author \|\| 'x', '0m', \.\.\.lines\]\)/);
  const judge = (lines) => judgePost({ author: "a @a", body: splitPost(["a @a", "0m", ...lines]).body }, preTriage);
  assert.equal(judge(["🔎 Buscamos Sr Mobile Engineer", "Remoto LATAM, Kotlin y Compose."]).reason, null);
  assert.equal(judge(["WorkWave is hiring an AI Engineer!", "Apply: https://example.com/1"]).reason, null);
  assert.equal(judge(["WorkWave is hiring an AI Engineer!"]).title, "AI Engineer!");
  // From the first full X run: an FDE role is on stack, a design lead is not a developer role.
  assert.equal(judge(["Hiring remote: Forward Deployed Engineer, Enterprise", "Full-time, AI Engineer."]).reason, null);
  assert.match(judge(["Hiring: Product Design Lead, AI for $150k - $170k."]).reason, /not a target role/);
});

test("the X searches come from portals.yml x_post_queries, not the LinkedIn ones", () => {
  const portals = [
    "linkedin_post_queries:",
    "  queries: [android remote]",
    "x_post_queries:",
    "  max_queries_per_run: 1",
    "  queries:",
    "    - '(hiring OR \"we''re hiring\") android -filter:replies'",
    "    - kotlin remote",
  ].join("\n");
  const queries = portalQueries(portals, "x_post_queries");
  assert.deepEqual(queries, ['(hiring OR "we\'re hiring") android -filter:replies']);
  const script = withQueries(fs.readFileSync(path.join(lib, "x-posts-scan.js"), "utf8"), queries);
  assert.ok(script.includes(`const QUERIES = ${JSON.stringify(queries)}; // QUERIES`));
  assert.deepEqual(portalQueries("linkedin_post_queries:\n  queries: [a]\n", "x_post_queries"), []);
});
