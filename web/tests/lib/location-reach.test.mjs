import assert from "node:assert/strict";
import { test } from "node:test";
import { readReach, usAuthorizedFrom } from "../../src/lib/location-reach.mjs";

const kind = (location, url) => readReach(location, url).kind;
const label = (location, url) => readReach(location, url).label;

test("open: El Salvador, LATAM, Americas and explicit worldwide words", () => {
  assert.equal(label("El Salvador"), "El Salvador ok");
  assert.equal(label("Remote - LATAM"), "Remote, LATAM ok");
  assert.equal(kind("Americas"), "open");
  assert.equal(label("Remote, Anywhere"), "Remote, worldwide ok");
  assert.equal(kind("Northern America, LATAM, Europe, APAC"), "open");
});

test("a bare Remote does not claim LATAM is fine", () => {
  for (const loc of ["Remote", "Remoto", "Fully remote"]) assert.equal(label(loc), "Remote, region not stated", loc);
});

test("house rule 10: a LATAM country list is a list, never on-site or limited", () => {
  assert.equal(label("Costa Rica or Colombia"), "LATAM country list: Costa Rica, Colombia");
  assert.equal(kind("Mexico (Remote)"), "latam-list");
  assert.equal(kind("México"), "latam-list");
  // A big LATAM city with no country is still that country.
  assert.equal(label("Bogota (Remote)"), "LATAM country list: Colombia");
});

test("remote limited to places outside LATAM, and on-site places", () => {
  assert.equal(label("Remote (EMEA)"), "Remote, limited to EMEA");
  assert.equal(label("Home based - EMEA"), "Remote, limited to EMEA");
  assert.equal(label("Remote, US"), "Remote, limited to United States");
  assert.equal(kind("Remote (US & Canada)"), "limited");
  assert.equal(label("Austin, TX"), "On-site, United States");
  assert.equal(label("Hybrid - London, United Kingdom"), "Hybrid, United Kingdom");
});

test("house rule 10's Workday exception: Remote plus one pin is that country", () => {
  const url = "https://zillow.wd5.myworkdayjobs.com/en-US/Zillow_Group_External/job/Remote-Mexico/x";
  assert.equal(label("Remote, Mexico City", url), "Remote, limited to Mexico (Workday)");
  // Off Workday the same text is a LATAM country list.
  assert.equal(kind("Remote, Mexico City"), "latam-list");
});

test("time-zone words are an hours note, not a place", () => {
  assert.equal(label("Remote, PST hours"), "Remote, region not stated, PST hours");
  assert.equal(label("Remote (LATAM, EST overlap)"), "Remote, LATAM ok, EST hours");
});

test("nothing usable", () => {
  assert.equal(label(""), "Doesn't say");
  assert.equal(kind(undefined), "unknown");
});

test("usAuthorizedFrom: any US spelling is true, only known non-US countries are false, the rest unknown", () => {
  for (const value of [["U.S."], ["U.S. citizen"], ["Estados Unidos"], ["EE.UU."], ["Green card holder"], ["United States of America"], "USA", ["El Salvador", "US"]]) {
    assert.equal(usAuthorizedFrom(value), true, JSON.stringify(value));
  }
  assert.equal(usAuthorizedFrom(["El Salvador"]), false);
  assert.equal(usAuthorizedFrom(["El Salvador", "Mexico"]), false);
  for (const value of [["Latin America"], ["Central America"], ["Remote"], [], undefined, ""]) {
    assert.equal(usAuthorizedFrom(value), undefined, JSON.stringify(value));
  }
});
