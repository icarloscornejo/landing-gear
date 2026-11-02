import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArguments } from '../run-job.mjs';

test('run-job reads kind, input and options', () => {
  assert.deepEqual(parseArguments(['evaluate', 'https://x.test/job/1', '--wait', '--title', 'Acme: Dev']), {
    kind: 'evaluate', input: 'https://x.test/job/1', port: 3000, wait: true, title: 'Acme: Dev',
  });
  assert.equal(parseArguments(['triage', 'local:jds/a.md', '--port', '3100']).port, 3100);
});

test('run-job refuses unknown kinds and stray arguments', () => {
  assert.equal(parseArguments(['pdf', 'https://x.test']), null);
  assert.equal(parseArguments(['triage']), null);
  assert.equal(parseArguments(['triage', 'a', 'b']), null);
  assert.equal(parseArguments(['triage', 'a', '--port', 'x']), null);
});
