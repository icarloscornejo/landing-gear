#!/usr/bin/env node
// Y Combinator startup postings from the official Hacker News API (jobstories.json): only YC
// companies post there, with titles like "Acme (YC W24) Is Hiring a Founding Engineer".
// No key, no tokens. Idea from AienTech/dossier, rewritten.
// Usage: node scan-yc.mjs [--dry-run]
import { isMainModule } from './lib/is-main-module.mjs';
import { admitAndWrite } from './lib/source-writer.mjs';

const API = 'https://hacker-news.firebaseio.com/v0';
const CONCURRENCY = 6;

/**
 * "Acme (YC W24) Is Hiring a Founding Engineer (Remote)" -> company, batch, role, location.
 * Titles without the YC tag ("Acme is hiring ...") still split on "is hiring".
 * @param {string} title
 */
export function parseYcTitle(title) {
  const text = String(title ?? '').trim();
  let company = '';
  let batch = '';
  let rest = '';
  const tagged = /^(.+?)\s*\(\s*YC\s+([A-Z]\d{2,4})\s*\)\s*(.*)$/i.exec(text);
  const hiring = /^(.+?)\s+(?:is|are)\s+hiring\b\s*(.*)$/i.exec(text);
  if (tagged) [, company, batch, rest] = tagged;
  else if (hiring) [, company, rest] = hiring;
  else return { company: text, batch: '', role: '', location: '' };

  rest = rest.replace(/^[-–:|,\s]+/, '').replace(/^(?:is|are)\s+hiring\b\s*/i, '').replace(/^(?:an?|the)\s+/i, '');
  let location = '';
  const paren = /\(([^)]*)\)\s*$/.exec(rest);
  if (paren) {
    location = paren[1].trim();
    rest = rest.slice(0, paren.index).trim();
  }
  const place = /\s+(?:in|-|–)\s+([^,]+(?:,\s*[^,]+)?)$/i.exec(rest);
  if (!location && place && /^[A-Z]|remote/i.test(place[1])) {
    location = place[1].trim();
    rest = rest.slice(0, place.index).trim();
  }
  return { company: company.trim(), batch: batch.toUpperCase(), role: rest.trim(), location };
}

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
}

/** A jobstories item as an offer, or null when it is gone or isn't a hiring post. */
export function offerFromItem(item) {
  if (!item || item.dead || item.deleted || !item.title) return null;
  const { company, batch, role, location } = parseYcTitle(item.title);
  if (!company || !role) return null;
  return {
    url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
    company,
    title: role,
    location,
    postedAt: typeof item.time === 'number' ? item.time * 1000 : undefined,
    note: batch ? `YC ${batch}` : 'YC job post',
  };
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('usage: node scan-yc.mjs [--dry-run]');
    return;
  }
  const dryRun = process.argv.includes('--dry-run');
  const ids = await getJson(`${API}/jobstories.json`);
  const items = [];
  for (let index = 0; index < ids.length; index += CONCURRENCY) {
    const batch = ids.slice(index, index + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((id) => getJson(`${API}/item/${id}.json`)));
    for (const result of settled) if (result.status === 'fulfilled') items.push(result.value);
  }
  const offers = items.map(offerFromItem).filter(Boolean);
  console.log(`YC: ${ids.length} posts, ${offers.length} readable`);
  await admitAndWrite(offers, { source: 'yc-jobs', dryRun });
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(`scan-yc: ${error.message}`);
    process.exitCode = 1;
  });
}
