import test from 'node:test';
import assert from 'node:assert/strict';
import { remoteBoardEmployer } from '../providers/getro.mjs';

test('remoteBoardEmployer reads the real employer from a remote.com job URL', () => {
  assert.equal(remoteBoardEmployer('https://remote.com/jobs/binance-c1iaam3i/flutter-engineer-ios-apac-remote-j1nu8gl9'), 'Binance');
  assert.equal(remoteBoardEmployer('https://remote.com/jobs/aisles-abroad-c167gayv/remote-entry-level-customer-care-coordinator-j17k5hlq'), 'Aisles Abroad');
  assert.equal(remoteBoardEmployer('https://jobs.lever.co/acme/1'), null);
  assert.equal(remoteBoardEmployer('https://notremote.com/jobs/acme-c167gayv/x'), null);
  assert.equal(remoteBoardEmployer('not a url'), null);
});
