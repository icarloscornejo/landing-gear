import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blockedHosts, locationOf, offerFromJob } from '../scan-jsearch.mjs';
import { buildLocationFilter } from '../scan.mjs';
import { parseInbox } from '../web/src/lib/pipeline-table.mjs';
import { formatPipelineOffer } from '../scan.mjs';
import { localToday } from '../lib/local-today.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const hosts = blockedHosts('# comment\nhimalayas.app\n');

const job = (overrides = {}) => ({
  job_id: 'j1',
  job_title: 'Senior Android Engineer',
  employer_name: 'Acme',
  job_publisher: 'LinkedIn',
  job_apply_link: 'https://www.linkedin.com/jobs/view/123',
  apply_options: [],
  job_is_remote: true,
  job_city: 'Austin',
  job_state: 'TX',
  job_country: 'US',
  ...overrides,
});

test('a result whose only link is LinkedIn or a needs-real-chrome host is skipped', () => {
  assert.equal(offerFromJob(job(), hosts), null);
  assert.equal(offerFromJob(job({ job_apply_link: 'https://himalayas.app/jobs/x' }), hosts), null);
});

test('the employer link (is_direct) wins over the aggregator link', () => {
  const offer = offerFromJob(job({ apply_options: [{ publisher: 'Indeed', apply_link: 'https://indeed.com/x', is_direct: false }, { publisher: 'Acme', apply_link: 'https://jobs.acme.dev/1', is_direct: true }] }), hosts);
  assert.equal(offer.url, 'https://jobs.acme.dev/1');
  assert.match(offer.note, /via JSearch/);
});

test('remote results read as Remote, pass a LATAM location_filter, and parse back with that location', () => {
  assert.equal(locationOf(job()), 'Remote, TX, US');
  assert.equal(locationOf(job({ job_is_remote: false })), 'Austin, TX, US');
  const allowed = buildLocationFilter({ allow: ['Remote', 'Mexico'], always_allow: ['LATAM'], block: ['US', 'United States'] });
  const latam = offerFromJob(job({ job_apply_link: 'https://jobs.acme.dev/1', job_city: 'Monterrey', job_state: null, job_country: 'MX' }), hosts);
  assert.equal(latam.location, 'Remote, MX');
  assert.equal(allowed(latam.location, latam.url, latam.title), true);
  // US-only remote stays out when the location_filter blocks US.
  const us = offerFromJob(job({ job_apply_link: 'https://jobs.acme.dev/2' }), hosts);
  assert.equal(allowed(us.location, us.url, us.title), false);
  const [row] = parseInbox(`## Pending\n${formatPipelineOffer(latam)}\n`);
  assert.equal(row.location, 'Remote, MX');
});

test('a second run the same day makes no API calls', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'jsearch-'));
  try {
    mkdirSync(path.join(root, 'data'));
    writeFileSync(path.join(root, 'data', 'jsearch-last-run.txt'), `${localToday()}\n`);
    const out = execFileSync(process.execPath, [path.join(here, '..', 'scan-jsearch.mjs')], {
      env: { ...process.env, CAREER_OPS_ROOT: root, JSEARCH_API_KEY: 'test-only', JSEARCH_HOST: 'rapidapi' },
      encoding: 'utf-8',
    });
    assert.match(out, /already ran today/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
