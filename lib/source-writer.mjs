// Shared writer for the extra daily sources (scan-yc, scan-freehire, scan-jsearch).
// Every offer goes through lib/admission-gate.mjs (blacklist, portals.yml title and location
// filters, and what scan-history, the pipeline and the tracker already hold), as scan.mjs does, and
// is written with scan.mjs's own helpers. Prints "  + Company | Role | Location" per added row: the
// form newPostingsFromLog (web/src/lib/daily-scan.ts) counts as "New postings" on Today.
import { readFileSync } from 'node:fs';
import * as yaml from 'js-yaml';
import { createAdmissionGate, formatSkipCounts } from './admission-gate.mjs';
import { appendToPipeline, appendToScanHistory, PORTALS_PATH } from '../scan.mjs';
import { localToday } from './local-today.mjs';

export function loadPortals() {
  return yaml.load(readFileSync(PORTALS_PATH, 'utf-8')) ?? {};
}

/**
 * @param {{url: string, company: string, title: string, location?: string, postedAt?: number, note?: string}[]} offers
 * @param {{source: string, dryRun?: boolean, config?: object, gate?: ReturnType<typeof createAdmissionGate>}} options
 * @returns {Promise<object[]>} the admitted offers
 */
export async function admitAndWrite(offers, { source, dryRun = false, config = loadPortals(), gate = createAdmissionGate({ config }) }) {
  const admitted = [];
  for (const offer of offers) {
    if (gate.check(offer)) continue;
    admitted.push({ ...offer, source });
  }
  for (const offer of admitted) console.log(`  + ${offer.company} | ${offer.title} | ${offer.location ?? ''}`);
  const skipped = formatSkipCounts(gate.counts);
  console.log(`${source}: ${offers.length} read, ${admitted.length} new${skipped ? `, skipped: ${skipped}` : ''}${dryRun ? ' (dry run, nothing written)' : ''}`);
  if (!dryRun && admitted.length) {
    await appendToPipeline(admitted);
    await appendToScanHistory(admitted, localToday(), 'added');
  }
  return admitted;
}
