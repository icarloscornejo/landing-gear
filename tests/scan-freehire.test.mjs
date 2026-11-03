import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanUrl, fallbackLocationFor, offerFromJob, onExcludedHost, searchUrl } from '../scan-freehire.mjs';

test('onExcludedHost drops a host and its subdomains, nothing else', () => {
  assert.equal(onExcludedHost('https://ar.whatjobs.com/pub_api__cpl__1', ['whatjobs.com']), true);
  assert.equal(onExcludedHost('https://whatjobs.com/x', 'whatjobs.com'), true);
  assert.equal(onExcludedHost('https://notwhatjobs.com/x', ['whatjobs.com']), false);
  assert.equal(onExcludedHost('https://jobs.lever.co/acme/1', ['whatjobs.com']), false);
  assert.equal(onExcludedHost('https://jobs.lever.co/acme/1'), false);
});

test('searchUrl sends the configured regions and work mode, one page at a time', () => {
  const url = new URL(searchUrl(2, { regions: 'latam', work_mode: 'remote' }));
  assert.equal(url.searchParams.get('regions'), 'latam');
  assert.equal(url.searchParams.get('work_mode'), 'remote');
  assert.equal(url.searchParams.get('offset'), '200');
  assert.equal(new URL(searchUrl(0, { regions: ['latam', 'europe'] })).searchParams.get('regions'), 'latam,europe');
  const bare = new URL(searchUrl(0));
  assert.equal(bare.searchParams.has('regions'), false);
  assert.equal(bare.searchParams.has('work_mode'), false);
});

test('cleanUrl drops tracking params and refuses non-web links', () => {
  assert.equal(cleanUrl('https://wellfound.com/jobs/1-x?utm_source=freehire.me&ref=a'), 'https://wellfound.com/jobs/1-x?ref=a');
  assert.equal(cleanUrl('javascript:alert(1)'), '');
  assert.equal(cleanUrl(''), '');
});

test('offerFromJob maps a row and skips rows without a link, title or company', () => {
  const offer = offerFromJob({ url: 'https://jobs.lever.co/acme/1?utm_source=freehire.me', title: 'Senior Android &amp; Kotlin Engineer', company: 'Acme', location: '', posted_at: '2026-11-02T10:00:00Z', source: 'lever' }, fallbackLocationFor({ regions: 'latam' }));
  assert.deepEqual(offer, { url: 'https://jobs.lever.co/acme/1', company: 'Acme', title: 'Senior Android & Kotlin Engineer', location: 'Remote, LATAM', postedAt: Date.parse('2026-11-02T10:00:00Z'), note: 'freehire via lever' });
  assert.equal(offerFromJob({ url: 'https://a.com/1', title: 'x', company: 'y' }).location, 'Remote');
  assert.equal(offerFromJob({ url: '', title: 'x', company: 'y' }), null);
  assert.equal(offerFromJob({ url: 'https://a.com', title: '', company: 'y' }), null);
  assert.equal(offerFromJob(null), null);
});
