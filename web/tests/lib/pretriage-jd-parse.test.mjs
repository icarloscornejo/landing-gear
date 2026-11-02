// Pure parsing behind pre-triage's free JD reader.

import test from "node:test";
import assert from "node:assert/strict";
import { bareUrl, htmlToText, jdFromHimalayas, jdFromHtml } from "../../src/lib/pretriage-jd-parse.mjs";

test("JSON-LD JobPosting: description text and structured salary, also inside @graph", () => {
  const posting = {
    "@type": "JobPosting",
    title: "Senior Android Engineer",
    description: "<p>We are looking for an <b>Android</b> engineer.</p><ul><li>Kotlin</li><li>Compose</li></ul>",
    baseSalary: { "@type": "MonetaryAmount", currency: "USD", value: { "@type": "QuantitativeValue", minValue: 60000, maxValue: 80000, unitText: "YEAR" } },
  };
  const html = `<html><script type="application/ld+json">{"@graph":[{"@type":"Organization"},${JSON.stringify(posting)}]}</script></html>`;
  const jd = jdFromHtml(html);
  assert.match(jd.text, /^Senior Android Engineer\n\nWe are looking for an Android engineer\./);
  assert.match(jd.text, /- Kotlin/);
  assert.deepEqual(jd.salary, { max: 80000, currency: "USD", period: "year" });
});

test("itemprop description when there is no JSON-LD; nothing usable is null", () => {
  const body = "Requisitos: experiencia en desarrollo de aplicaciones móviles con Kotlin. ".repeat(3);
  const html = `<div itemprop="title">Dev</div><div itemprop="description"><p>${body}</p></div><span itemprop="datePosted">x</span>`;
  assert.match(jdFromHtml(html).text, /^Requisitos: experiencia/);
  assert.equal(jdFromHtml("<html><body>Just a title</body></html>"), null);
  assert.equal(jdFromHtml('<script type="application/ld+json">{not json</script>'), null);
});

test("htmlToText decodes entities and keeps line breaks", () => {
  assert.equal(htmlToText("<p>A &amp; B</p><p>C&nbsp;D</p>"), "A & B\nC D");
});

test("Himalayas feed items match the row URL without utm and carry salary and location restrictions", () => {
  assert.equal(bareUrl("https://himalayas.app/companies/acme/jobs/dev?utm_source=api"), bareUrl("https://himalayas.app/companies/acme/jobs/dev"));
  const jd = jdFromHimalayas({ title: "AI Engineer", description: "<p>Build LLM agents.</p>", maxSalary: 2500, currency: "USD", salaryPeriod: "monthly", locationRestrictions: ["Colombia"] });
  assert.equal(jd.text, "AI Engineer\n\nBuild LLM agents.\n\nLocation restrictions: Colombia");
  assert.deepEqual(jd.salary, { max: 2500, currency: "USD", period: "month" });
  assert.equal(jdFromHimalayas({ title: "x", description: "" }), null);
});
