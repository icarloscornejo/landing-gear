#!/usr/bin/env node
// JSearch (Google for Jobs) as a source: postings from LinkedIn, Indeed and company boards without
// opening a browser. Key in the data root's .env: JSEARCH_API_KEY, and JSEARCH_HOST = rapidapi
// (default) or openwebninja. Searches come from portals.yml -> jsearch.queries / countries.
// Idea from AienTech/dossier, rewritten.
// - Prefers the employer's direct link (apply_options[].is_direct). An offer whose only link is
//   LinkedIn or a host listed in data/needs-real-chrome.txt is skipped: no script reads those.
// - One run a day (data/jsearch-last-run.txt) unless --force: the daily scan also runs on "Run scan
//   now", retries and restarts, and the free plan gives 200 requests a month. Each query x country
//   is one request, so keep queries x countries x 30 under the plan's quota.
// - No key or no queries: says so and exits 0, so the daily scan keeps going.
// Usage: node scan-jsearch.mjs [--dry-run] [--force]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { localToday } from './lib/local-today.mjs';
import { admitAndWrite, loadPortals } from './lib/source-writer.mjs';

const HOSTS = {
  rapidapi: { base: 'https://jsearch.p.rapidapi.com', headers: (key) => ({ 'x-rapidapi-key': key, 'x-rapidapi-host': 'jsearch.p.rapidapi.com' }) },
  openwebninja: { base: 'https://api.openwebninja.com/jsearch', headers: (key) => ({ 'x-api-key': key }) },
};
const DEFAULTS = {
  queries: [],
  countries: ['us'],
  date_posted: '3days',
  work_from_home: true,
};

const root = getCareerOpsRoot();
const LAST_RUN_PATH = path.join(root, 'data', 'jsearch-last-run.txt');

/** Hosts no script may read, from data/needs-real-chrome.txt, plus LinkedIn. */
export function blockedHosts(text = existsSync(path.join(root, 'data', 'needs-real-chrome.txt')) ? readFileSync(path.join(root, 'data', 'needs-real-chrome.txt'), 'utf-8') : '') {
  const hosts = new Set(['linkedin.com']);
  for (const line of text.split('\n')) {
    const host = line.trim();
    if (host && !host.startsWith('#')) hosts.add(host.toLowerCase());
  }
  return hosts;
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};
const isBlocked = (url, hosts) => {
  const host = hostOf(url);
  return !host || [...hosts].some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
};

/**
 * The location string the admission gate and the web's location label read: remote results start
 * with "Remote, " so a location_filter made of allow / always_allow entries sees the remote word.
 */
export function locationOf(job) {
  if (!job.job_is_remote) return [job.job_city, job.job_state, job.job_country].filter(Boolean).join(', ');
  return ['Remote', job.job_state, job.job_country].filter(Boolean).join(', ');
}

/** One JSearch job as an offer, or null when it has no link a worker can read. */
export function offerFromJob(job, hosts) {
  if (!job?.job_id || !job.job_title || !job.employer_name) return null;
  const links = [
    ...(job.apply_options ?? []).filter((option) => option?.is_direct).map((option) => option.apply_link),
    job.job_apply_link,
    ...(job.apply_options ?? []).map((option) => option?.apply_link),
  ].filter((link) => typeof link === 'string' && /^https?:\/\//.test(link));
  const url = links.find((link) => !isBlocked(link, hosts));
  if (!url) return null;
  return {
    url,
    company: job.employer_name,
    title: job.job_title,
    location: locationOf(job),
    postedAt: typeof job.job_posted_at_timestamp === 'number' ? job.job_posted_at_timestamp * 1000 : undefined,
    note: `via JSearch (${job.job_publisher || 'Google for Jobs'})`,
  };
}

async function search(query, country, settings, key, host) {
  const url = new URL(`${host.base}/search-v2`);
  url.searchParams.set('query', query);
  url.searchParams.set('country', country);
  url.searchParams.set('date_posted', settings.date_posted);
  if (settings.work_from_home) url.searchParams.set('work_from_home', 'true');
  const response = await fetch(url, { headers: host.headers(key), signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`"${query}" -> HTTP ${response.status}`);
  const body = await response.json();
  return Array.isArray(body?.data?.jobs) ? body.data.jobs : Array.isArray(body?.data) ? body.data : [];
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('usage: node scan-jsearch.mjs [--dry-run] [--force]  (needs JSEARCH_API_KEY and portals.yml jsearch.queries)');
    return;
  }
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');
  const key = process.env.JSEARCH_API_KEY;
  if (!key) {
    console.log('scan-jsearch: JSEARCH_API_KEY is not in .env, skipped');
    return;
  }
  const host = HOSTS[process.env.JSEARCH_HOST || 'rapidapi'];
  if (!host) throw new Error(`JSEARCH_HOST must be rapidapi or openwebninja, not "${process.env.JSEARCH_HOST}"`);
  const today = localToday();
  if (!force && existsSync(LAST_RUN_PATH) && readFileSync(LAST_RUN_PATH, 'utf-8').trim() === today) {
    console.log(`scan-jsearch: already ran today (${today}), skipped. --force runs it again.`);
    return;
  }

  const config = loadPortals();
  const settings = { ...DEFAULTS, ...(config.jsearch ?? {}) };
  if (!settings.queries.length) {
    console.log('scan-jsearch: no jsearch.queries in portals.yml, skipped');
    return;
  }
  const hosts = blockedHosts();
  const offers = [];
  let calls = 0;
  let failures = 0;
  for (const query of settings.queries) {
    for (const country of settings.countries) {
      calls += 1;
      try {
        const jobs = await search(query, country, settings, key, host);
        const readable = jobs.map((job) => offerFromJob(job, hosts)).filter(Boolean);
        console.log(`JSearch "${query}" (${country}): ${jobs.length} results, ${readable.length} with a readable link`);
        offers.push(...readable);
      } catch (error) {
        failures += 1;
        console.error(`scan-jsearch: ${error.message}`);
      }
    }
  }
  await admitAndWrite(offers, { source: 'jsearch', dryRun, config });
  if (!dryRun && failures < calls) writeFileSync(LAST_RUN_PATH, `${today}\n`);
  if (failures > 0) process.exitCode = 1;
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(`scan-jsearch: ${error.message}`);
    process.exitCode = 1;
  });
}
