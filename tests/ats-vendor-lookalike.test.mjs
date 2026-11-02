// Look-alike ATS hosts (ats-vendor.mjs lookalikeAts): real and corporate hosts never match,
// a real domain followed by more labels is strong, a reused vendor word is weak.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ATS_HOST_PATTERNS, lookalikeAts, lookalikeVerdict } from '../ats-vendor.mjs';
import { ROOT } from './helpers.mjs';

test('real ATS hosts, vendor sites and unrelated hosts with a vendor word inside are not look-alikes', () => {
  for (const url of [
    'https://boards.greenhouse.io/acme/jobs/1', 'https://job-boards.greenhouse.io/acme', 'https://www.greenhouse.com/careers',
    'https://jobs.lever.co/acme/1', 'https://jobs.ashbyhq.com/acme', 'https://acme.wd5.myworkdayjobs.com/x',
    'https://acme.myworkdaysite.com/x', 'https://www.workday.com', 'https://careers-acme.icims.com/jobs',
    'https://career5.successfactors.com/x', 'https://acme.jobs2web.com', 'https://www.sap.com', 'https://jobs.dayforcehcm.com/x',
    'https://www.dayforce.com', 'https://recruiting.ultipro.com/x', 'https://www.ukg.com', 'https://acme.taleo.net/x',
    'https://www.oracle.com', 'https://acme.bamboohr.com/careers', 'https://jobs.smartrecruiters.com/acme',
    'https://acme.csod.com/ux', 'https://www.cornerstoneondemand.com', 'https://acme.fa.oraclecloud.com/hcm',
    'https://careers.unilever.com/job/1', 'https://clever.com/about/careers', 'not a url',
  ]) assert.equal(lookalikeAts(url), null, url);
  // Every vendor with a fixed domain list is covered by the table above.
  assert.equal(ATS_HOST_PATTERNS.length, 13);
});

test('a real domain followed by more labels is strong; a reused vendor word is weak', () => {
  assert.deepEqual(lookalikeAts('https://greenhouse.io.evil.com/jobs/1'), { vendor: 'greenhouse', host: 'greenhouse.io.evil.com', rule: 'a' });
  assert.deepEqual(lookalikeAts('https://apply.jobs.lever.co.example.net/x'), { vendor: 'lever', host: 'apply.jobs.lever.co.example.net', rule: 'a' });
  assert.equal(lookalikeAts('https://greenhouse-io.com/j')?.rule, 'b');
  assert.equal(lookalikeAts('https://jobs-lever.co/a')?.rule, 'b');
  assert.equal(lookalikeAts('https://ashbyhq.careers/b')?.vendor, 'ashby');
  assert.equal(lookalikeVerdict('https://greenhouse.io.evil.com/'), 'lookalike-strong greenhouse');
  assert.equal(lookalikeVerdict('https://jobs-lever.co/a'), 'lookalike-weak lever');
  assert.equal(lookalikeVerdict('https://jobs.lever.co/a'), 'ok');
});

test('the CLI takes the URL as one argv element or from a file, never through a shell', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ats-lookalike-'));
  const marker = join(dir, 'pwn');
  const url = `https://x.com/$(touch ${marker})`;
  const direct = spawnSync(process.execPath, [join(ROOT, 'ats-vendor.mjs'), '--check', url], { encoding: 'utf8' });
  assert.equal(direct.stdout.trim(), 'ok');
  const file = join(dir, 'url.txt');
  writeFileSync(file, 'https://greenhouse.io.evil.com/x\n');
  const fromFile = spawnSync(process.execPath, [join(ROOT, 'ats-vendor.mjs'), '--check-file', file], { encoding: 'utf8' });
  assert.equal(fromFile.stdout.trim(), 'lookalike-strong greenhouse');
  assert.equal(existsSync(marker), false);
});
