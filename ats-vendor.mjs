/**
 * Derive a stable ATS vendor label from a job or careers URL.
 *
 * Known platforms use their provider id so callers can route directly to the
 * matching scanner plugin. An otherwise-valid web URL returns its lower-cased
 * hostname instead of collapsing to "unknown": the long tail is useful signal
 * even before landing-gear has a provider for it.
 */

import { readFileSync } from 'node:fs';
import { isMainModule } from './lib/is-main-module.mjs';

const hostIs = (host, suffix) => host === suffix || host.endsWith(`.${suffix}`);

// domains: the real ATS hosts (a domain and its subdomains). labels: host words a look-alike
// would reuse. corporate: the vendor's own non-ATS sites, never look-alikes.
const VENDORS = [
  { id: 'greenhouse', domains: ['greenhouse.io'], labels: ['greenhouse'], corporate: ['greenhouse.com'] },
  { id: 'lever', domains: ['lever.co'], labels: ['lever'], corporate: [] },
  { id: 'ashby', domains: ['ashbyhq.com'], labels: ['ashbyhq'], corporate: [] },
  { id: 'workday', domains: ['myworkdayjobs.com', 'myworkdaysite.com'], labels: ['myworkdayjobs', 'myworkdaysite'], corporate: ['workday.com'] },
  { id: 'icims', domains: ['icims.com'], labels: ['icims'], corporate: [] },
  { id: 'successfactors', domains: ['successfactors.com', 'successfactors.eu', 'jobs2web.com'], labels: ['successfactors', 'jobs2web'], corporate: ['sap.com'] },
  { id: 'dayforce', domains: ['dayforcehcm.com'], labels: ['dayforcehcm'], corporate: ['dayforce.com', 'ceridian.com'] },
  { id: 'ultipro', domains: ['ultipro.com', 'ultipro.ca'], labels: ['ultipro'], corporate: ['ukg.com', 'ultimatesoftware.com'] },
  { id: 'taleo', domains: ['taleo.net'], labels: ['taleo'], corporate: ['oracle.com'] },
  { id: 'bamboohr', domains: ['bamboohr.com'], labels: ['bamboohr'], corporate: [] },
  { id: 'smartrecruiters', domains: ['smartrecruiters.com'], labels: ['smartrecruiters'], corporate: [] },
  { id: 'csod', domains: ['csod.com'], labels: ['csod'], corporate: ['cornerstoneondemand.com'] },
];

/** @type {Array<{ id: string, test: (host: string) => boolean }>} */
export const ATS_HOST_PATTERNS = [
  ...VENDORS.map(({ id, domains }) => ({ id, test: (h) => domains.some((domain) => hostIs(h, domain)) })),
  // Pattern-matched, so it has no fixed domain list and no look-alike check.
  {
    id: 'oraclecloud',
    test: (h) => /(^|\.)oraclecloud(?:[1-9]|[1-9]\d)?\.com$/.test(h),
  },
];

export const KNOWN_ATS_VENDORS = Object.freeze(ATS_HOST_PATTERNS.map(({ id }) => id));

/**
 * @param {unknown} rawUrl
 * @returns {string|null} provider id for a known ATS, hostname for the long
 *   tail, or null when the value is not an HTTP(S) URL.
 */
export function atsVendorOf(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  if (!host) return null;
  return ATS_HOST_PATTERNS.find(({ test }) => test(host))?.id ?? host;
}

/**
 * A posting URL whose host imitates a known ATS (idea from ai-job-search, MIT), or null.
 * Rule "a" (strong): a real ATS domain followed by more labels, greenhouse.io.evil.com.
 * Rule "b" (weak): a vendor word reused in another domain, greenhouse-io.com,
 * jobs-lever.co, ashbyhq.careers. Real ATS hosts and the vendors' own sites never match.
 * @param {unknown} rawUrl
 * @returns {{vendor: string, host: string, rule: 'a'|'b'} | null}
 */
export function lookalikeAts(rawUrl) {
  let host;
  try {
    host = new URL(String(rawUrl ?? '').trim()).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
  if (!host || ATS_HOST_PATTERNS.some(({ test }) => test(host))) return null;
  if (VENDORS.some(({ corporate }) => corporate.some((domain) => hostIs(host, domain)))) return null;
  for (const { id, domains } of VENDORS) {
    if (domains.some((domain) => host.startsWith(`${domain}.`) || host.includes(`.${domain}.`))) return { vendor: id, host, rule: 'a' };
  }
  const words = host.split(/[.-]/);
  for (const { id, labels } of VENDORS) {
    if (labels.some((label) => words.includes(label))) return { vendor: id, host, rule: 'b' };
  }
  return null;
}

/** The one-line verdict batch-runner puts in a job message: ok, lookalike-strong <vendor>, lookalike-weak <vendor>. */
export function lookalikeVerdict(rawUrl) {
  const match = lookalikeAts(rawUrl);
  if (!match) return 'ok';
  return `${match.rule === 'a' ? 'lookalike-strong' : 'lookalike-weak'} ${match.vendor}`;
}

// CLI: node ats-vendor.mjs --check <url> | --check-file <path>. The URL is untrusted, so it only
// ever arrives as one argv element or inside a file, never inside a composed shell command.
if (isMainModule(import.meta.url)) {
  const [flag, value] = process.argv.slice(2);
  const usage = 'usage: node ats-vendor.mjs --check <url> | --check-file <path>  (prints ok, lookalike-strong <vendor> or lookalike-weak <vendor>)';
  if (flag === '--help' || flag === '-h') {
    console.log(usage);
    process.exit(0);
  }
  if ((flag !== '--check' && flag !== '--check-file') || !value) {
    console.error(usage);
    process.exit(2);
  }
  const url = flag === '--check' ? value : readFileSync(value, 'utf8').trim();
  console.log(lookalikeVerdict(url));
}
