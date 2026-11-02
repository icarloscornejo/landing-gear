import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildLinkedinScript, portalQueries, withModules, withQueries } from "../../src/lib/linkedin-script.mjs";

const lib = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/lib");
const read = (name) => fs.readFileSync(path.join(lib, name), "utf8");
const MARKER = "const modules = null; // MODULES";
const sources = () => ({ preTriage: read("pre-triage.mjs"), linkedinPost: read("linkedin-post.mjs"), locationReach: read("location-reach.mjs") });

test("the inlined modules run on their own and judge a post", () => {
  const modules = new Function(withModules(`${MARKER}\nreturn modules;`, sources()))();
  const post = modules.splitPost(["Acme", "6h •", "We're hiring a Senior Android Engineer, fully remote.", "Requirements: Kotlin, Jetpack Compose. Apply now."]);
  const verdict = modules.judgePost(post, modules.preTriage);
  assert.equal(verdict.reason, null);
  assert.equal(verdict.title, "Senior Android Engineer, fully remote.");
  const qa = modules.judgePost(modules.splitPost(["Acme", "6h •", "Hiring: Senior QA Engineer, remote"]), modules.preTriage);
  assert.equal(qa.reason, "fuera de stack");
  assert.equal(typeof modules.dedupKey("x", ["y"]), "string");
});

test("the real console script builds and parses", () => {
  const script = buildLinkedinScript(path.resolve(lib, "../../.."));
  assert.ok(!script.includes(MARKER));
  assert.doesNotThrow(() => new Function(script));
});

test("the searches come from portals.yml, capped at max_queries_per_run; without them the script keeps its fallback", () => {
  const portals = "linkedin_post_queries:\n  max_queries_per_run: 2\n  queries:\n    - android remote\n    - kotlin \"LATAM\"\n    - ios remote\n";
  assert.deepEqual(portalQueries(portals), ["android remote", 'kotlin "LATAM"']);
  assert.deepEqual(portalQueries("title_filter: {}\n"), []);
  const script = read("linkedin-posts-scan.js");
  const filled = withQueries(script, portalQueries(portals));
  assert.match(filled, /const QUERIES = \["android remote","kotlin \\"LATAM\\""\]; \/\/ QUERIES/);
  assert.equal(withQueries(script, []), script);
  assert.throws(() => withQueries("no line", ["x"]), /QUERIES line not found/);
});

test("a new import in either module fails loudly instead of breaking in the browser", () => {
  const changed = { ...sources(), linkedinPost: `import { other } from "./other.mjs";\n${read("linkedin-post.mjs")}` };
  assert.throws(() => withModules(MARKER, changed), /linkedinPost imports changed/);
  assert.throws(() => withModules("no marker", sources()), /MODULES line not found/);
});
