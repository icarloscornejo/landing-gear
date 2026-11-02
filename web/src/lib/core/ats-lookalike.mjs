/**
 * Look-alike ATS hosts: algorithm mirror of `lookalikeAts` in ats-vendor.mjs (root),
 * for the pre-triage route. A copy because the web cannot import the core checkout;
 * web/tests/lib/ats-lookalike.test.mjs runs both on the same URLs so they never drift.
 * Pure, no imports.
 */

const hostIs = (host, suffix) => host === suffix || host.endsWith(`.${suffix}`);

const VENDORS = [
  { id: "greenhouse", domains: ["greenhouse.io"], labels: ["greenhouse"], corporate: ["greenhouse.com"] },
  { id: "lever", domains: ["lever.co"], labels: ["lever"], corporate: [] },
  { id: "ashby", domains: ["ashbyhq.com"], labels: ["ashbyhq"], corporate: [] },
  { id: "workday", domains: ["myworkdayjobs.com", "myworkdaysite.com"], labels: ["myworkdayjobs", "myworkdaysite"], corporate: ["workday.com"] },
  { id: "icims", domains: ["icims.com"], labels: ["icims"], corporate: [] },
  { id: "successfactors", domains: ["successfactors.com", "successfactors.eu", "jobs2web.com"], labels: ["successfactors", "jobs2web"], corporate: ["sap.com"] },
  { id: "dayforce", domains: ["dayforcehcm.com"], labels: ["dayforcehcm"], corporate: ["dayforce.com", "ceridian.com"] },
  { id: "ultipro", domains: ["ultipro.com", "ultipro.ca"], labels: ["ultipro"], corporate: ["ukg.com", "ultimatesoftware.com"] },
  { id: "taleo", domains: ["taleo.net"], labels: ["taleo"], corporate: ["oracle.com"] },
  { id: "bamboohr", domains: ["bamboohr.com"], labels: ["bamboohr"], corporate: [] },
  { id: "smartrecruiters", domains: ["smartrecruiters.com"], labels: ["smartrecruiters"], corporate: [] },
  { id: "csod", domains: ["csod.com"], labels: ["csod"], corporate: ["cornerstoneondemand.com"] },
];
const ORACLE_CLOUD = /(^|\.)oraclecloud(?:[1-9]|[1-9]\d)?\.com$/;

/**
 * @param {unknown} rawUrl
 * @returns {{vendor: string, host: string, rule: "a"|"b"} | null}
 */
export function lookalikeAts(rawUrl) {
  let host;
  try {
    host = new URL(String(rawUrl ?? "").trim()).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
  if (!host || ORACLE_CLOUD.test(host)) return null;
  if (VENDORS.some(({ domains, corporate }) => [...domains, ...corporate].some((domain) => hostIs(host, domain)))) return null;
  for (const { id, domains } of VENDORS) {
    if (domains.some((domain) => host.startsWith(`${domain}.`) || host.includes(`.${domain}.`))) return { vendor: id, host, rule: "a" };
  }
  const words = host.split(/[.-]/);
  for (const { id, labels } of VENDORS) {
    if (labels.some((label) => words.includes(label))) return { vendor: id, host, rule: "b" };
  }
  return null;
}
