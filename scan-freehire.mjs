#!/usr/bin/env node
// Recent postings from freehire.me (public API, no key), which collects postings from ~50 ATSs and
// job boards. Idea from ai-job-search (MIT), rewritten. Opt-in: it runs only when portals.yml has a
// `freehire:` block, e.g. `freehire: { regions: latam, work_mode: remote }`. Offers go through
// admitAndWrite, so the portals.yml filters apply as in scan.mjs. `exclude_hosts: [whatjobs.com]`
// drops postings whose link is on one of those hosts (or a subdomain), such as repost boards.
// Usage: node scan-freehire.mjs [--dry-run]
import { isMainModule } from './lib/is-main-module.mjs';
import { admitAndWrite, loadPortals } from './lib/source-writer.mjs';

const API = 'https://freehire.me/api/v1/jobs/search';
const PAGE_SIZE = 100;
const MAX_PAGES = 5;
// Meant to run daily; 2 days also cover one failed run.
const POSTED_WITHIN_DAYS = 2;

/** The search URL for one page, with the regions and work mode from portals.yml when set. */
export function searchUrl(page, settings = {}) {
  const params = new URLSearchParams();
  for (const key of ['regions', 'work_mode']) {
    const value = [settings[key]].flat().filter(Boolean).join(',');
    if (value) params.set(key, value);
  }
  params.set('posted_within_days', String(POSTED_WITHIN_DAYS));
  params.set('limit', String(PAGE_SIZE));
  params.set('offset', String(page * PAGE_SIZE));
  return `${API}?${params}`;
}

/** The posting URL without freehire's tracking params, so dedup sees the same link as other scans. */
export function cleanUrl(raw) {
  try {
    const url = new URL(String(raw ?? ''));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return '';
  }
}

/** One API row as an offer, or null when it has no usable link or title. */
export function offerFromJob(job, fallbackLocation = 'Remote') {
  const url = cleanUrl(job?.url);
  const title = String(job?.title ?? '').replace(/&amp;/g, '&').trim();
  if (!url || !title || !job?.company) return null;
  const postedAt = Date.parse(job.posted_at ?? '');
  return {
    url,
    company: String(job.company).trim(),
    title,
    location: String(job.location ?? '').trim() || fallbackLocation,
    postedAt: Number.isFinite(postedAt) ? postedAt : undefined,
    note: job.source ? `freehire via ${job.source}` : 'freehire',
  };
}

/** Whether a posting link is on one of the excluded hosts or their subdomains. */
export function onExcludedHost(url, hosts = []) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return [hosts].flat().some((excluded) => {
    const domain = String(excluded ?? '').trim().toLowerCase();
    return domain && (host === domain || host.endsWith(`.${domain}`));
  });
}

/** A blank location reads as "Remote, <regions>" so a location_filter that allows the region sees it. */
export function fallbackLocationFor(settings = {}) {
  const regions = [settings.regions].flat().filter(Boolean).join(', ').toUpperCase();
  return regions ? `Remote, ${regions}` : 'Remote';
}

async function getPage(page, settings) {
  const response = await fetch(searchUrl(page, settings), { signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (!response.ok) throw new Error(`freehire page ${page} -> HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body?.data)) throw new Error('freehire: unexpected response (no data array)');
  return { rows: body.data, total: Number(body.meta?.total) || 0 };
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('usage: node scan-freehire.mjs [--dry-run]  (needs a freehire: block in portals.yml)');
    return;
  }
  const dryRun = process.argv.includes('--dry-run');
  const config = loadPortals();
  if (!config.freehire) {
    console.log('scan-freehire: no freehire: block in portals.yml, skipped');
    return;
  }
  const settings = typeof config.freehire === 'object' ? config.freehire : {};
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { rows: pageRows, total } = await getPage(page, settings);
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE || rows.length >= total) break;
  }
  const fallback = fallbackLocationFor(settings);
  const readable = rows.map((row) => offerFromJob(row, fallback)).filter(Boolean);
  const offers = readable.filter((offer) => !onExcludedHost(offer.url, settings.exclude_hosts));
  console.log(`freehire: ${rows.length} postings, ${readable.length} readable, ${readable.length - offers.length} on excluded hosts`);
  await admitAndWrite(offers, { source: 'freehire', dryRun, config });
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(`scan-freehire: ${error.message}`);
    process.exitCode = 1;
  });
}
