import assert from 'node:assert/strict';
import { test } from 'node:test';
import { offerFromItem, parseYcTitle } from '../scan-yc.mjs';
import { createAdmissionGate } from '../lib/admission-gate.mjs';
import { parseBlacklist } from '../scan.mjs';

test('parseYcTitle splits company, batch, role and location', () => {
  assert.deepEqual(parseYcTitle('Acme (YC W24) Is Hiring a Founding Engineer (Remote)'), { company: 'Acme', batch: 'W24', role: 'Founding Engineer', location: 'Remote' });
  assert.deepEqual(parseYcTitle('Beta (YC S22) is hiring Senior Android Engineers in San Francisco, CA'), { company: 'Beta', batch: 'S22', role: 'Senior Android Engineers', location: 'San Francisco, CA' });
  assert.deepEqual(parseYcTitle('Gamma is hiring a Mobile Engineer'), { company: 'Gamma', batch: '', role: 'Mobile Engineer', location: '' });
  assert.equal(parseYcTitle('Show HN: something').role, '');
});

test('offerFromItem keeps the link, else the HN page, and skips dead items', () => {
  assert.equal(offerFromItem({ id: 7, title: 'Acme (YC W24) Is Hiring a Founding Engineer', url: 'https://acme.dev/jobs' }).url, 'https://acme.dev/jobs');
  assert.equal(offerFromItem({ id: 7, title: 'Acme (YC W24) Is Hiring a Founding Engineer' }).url, 'https://news.ycombinator.com/item?id=7');
  assert.equal(offerFromItem({ id: 7, title: 'Acme (YC W24) Is Hiring a Founding Engineer', dead: true }), null);
});

test('the admission gate skips a blacklisted company and a URL already tracked', () => {
  const gate = createAdmissionGate({
    titleFilter: () => true,
    locationFilter: () => true,
    blacklist: parseBlacklist('| Company | Since | Scope | Reason |\n|---|---|---|---|\n| Shady Staffing | 2026-10-27 | company | scam |\n'),
    seen: new Set(['https://acme.dev/jobs/1']),
  });
  assert.equal(gate.check({ url: 'https://acme.dev/jobs/1', company: 'Acme', title: 'Android Engineer' }), 'seen');
  assert.equal(gate.check({ url: 'https://x.dev/2', company: 'Shady Staffing', title: 'AI Solutions Engineer' }), 'blacklisted');
  assert.equal(gate.check({ url: 'https://x.dev/3', company: 'Fresh', title: 'Android Engineer' }), null);
});
