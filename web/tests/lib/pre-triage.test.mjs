// Zero-token pre-triage of Discovered rows.

import test from "node:test";
import assert from "node:assert/strict";
import { preTriage, trackerKeys, urlKey } from "../../src/lib/pre-triage.mjs";

const tracker = trackerKeys([
  { company: "Upgrade", role: "AI Experience Engineer (Conversational AI)", url: "" },
  { company: "Acme", role: "Android Dev", url: "[ashby](https://jobs.ashbyhq.com/acme/123/?utm=x)" },
]);
const row = (role, location, extra = {}) => ({ url: "https://example.com/job/1", company: "Co", role, location, ...extra });

test("passes target roles open to remote work from LATAM", () => {
  assert.deepEqual(preTriage(row("Android Engineer - Creative App", "Remote"), tracker), { pass: true });
  assert.deepEqual(preTriage(row("Back-end Java Developer Semisenior", "Remote"), tracker), { pass: true });
  assert.deepEqual(preTriage(row("AI Developer", undefined), tracker), { pass: true });
  assert.deepEqual(preTriage(row("Senior AI Engineer", "Northern America, LATAM, Europe"), tracker), { pass: true });
});

test("drops rows already in the tracker by URL or company and role", () => {
  assert.equal(preTriage(row("Android Dev", "Remote", { url: "https://jobs.ashbyhq.com/acme/123", company: "Other" }), tracker).reason, "already in tracker");
  assert.equal(preTriage(row("AI Experience Engineer (Conversational AI)", "Remote", { company: "upgrade" }), tracker).reason, "already in tracker");
});

test("drops non-developer titles", () => {
  assert.equal(preTriage(row("Analista de Negocios Junior - Retail e IA (LLM)", "Remote"), tracker).reason, "not a target role");
  assert.equal(preTriage(row("Principal Product Manager, Agentic AI", "Anywhere in the World"), tracker).reason, "not a target role");
  assert.equal(preTriage(row("Office Coordinator", "Remote"), tracker).reason, "not a target role");
});

test("drops locations tied to one place or region", () => {
  assert.match(preTriage(row("Android Engineer, Luxury", "Mexico City, Mexico"), tracker).reason, /^location restricted/);
  assert.match(preTriage(row("Senior Flutter/Dart Mobile Engineer", "Chile"), tracker).reason, /^location restricted/);
  assert.match(preTriage(row("Android Engineer", "Remote, US only"), tracker).reason, /^location restricted/);
});

test("urlKey reads markdown links and ignores query and trailing slash", () => {
  assert.equal(urlKey("[x](https://Jobs.Example.com/a/b/?q=1)"), "jobs.example.com/a/b");
  assert.equal(urlKey("local:jds/x.md"), "");
});
