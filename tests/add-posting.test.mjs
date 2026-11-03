import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../add-posting.mjs', import.meta.url).pathname;

function freshPipeline() {
  const directory = mkdtempSync(join(tmpdir(), 'add-posting-'));
  const pipelinePath = join(directory, 'pipeline.md');
  writeFileSync(pipelinePath, '# Pipeline\n\n## Pending\n\n- [ ] https://example.com/jobs/existing | Old Co | Old Role\n\n## Processed\n');
  return pipelinePath;
}

function add(pipelinePath, url, extra = []) {
  return new Promise((resolve) => {
    const child = spawn('node', [SCRIPT, url, ...extra], { env: { ...process.env, LANDING_GEAR_PIPELINE: pipelinePath } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const countOf = (text, needle) => text.split(needle).length - 1;

test('saves a new URL under Pending and keeps existing entries', async () => {
  const pipelinePath = freshPipeline();
  const result = await add(pipelinePath, 'https://boards.greenhouse.io/acme/jobs/1', ['--company', 'Acme', '--title', 'Android Engineer']);
  assert.equal(result.code, 0, result.stderr);
  const text = readFileSync(pipelinePath, 'utf-8');
  assert.match(text, /- \[ \] https:\/\/boards\.greenhouse\.io\/acme\/jobs\/1 \| Acme \| Android Engineer/);
  assert.equal(countOf(text, 'existing | Old Co'), 1);
});

test('same URL pasted twice stays once, tracking params ignored', async () => {
  const pipelinePath = freshPipeline();
  await add(pipelinePath, 'https://boards.greenhouse.io/acme/jobs/2');
  const second = await add(pipelinePath, 'https://boards.greenhouse.io/acme/jobs/2?utm_source=x');
  assert.match(second.stdout, /already-in-pipeline/);
  assert.equal(countOf(readFileSync(pipelinePath, 'utf-8'), '/acme/jobs/2'), 1);
});

test('concurrent runs: same URL once, different URLs all kept', async () => {
  const pipelinePath = freshPipeline();
  const sameUrl = Array.from({ length: 6 }, () => add(pipelinePath, 'https://jobs.lever.co/acme/same'));
  const different = ['a', 'b', 'c'].map((slug) => add(pipelinePath, `https://jobs.lever.co/acme/${slug}`));
  const results = await Promise.all([...sameUrl, ...different]);
  assert.ok(results.every((result) => result.code === 0), results.map((result) => result.stderr).join('\n'));
  const text = readFileSync(pipelinePath, 'utf-8');
  assert.equal(countOf(text, 'lever.co/acme/same'), 1);
  for (const slug of ['a', 'b', 'c']) assert.equal(countOf(text, `lever.co/acme/${slug}`), 1);
  assert.equal(countOf(text, 'existing | Old Co'), 1);
});

test('invalid URL exits 2 and writes nothing', async () => {
  const pipelinePath = freshPipeline();
  const before = readFileSync(pipelinePath, 'utf-8');
  const result = await add(pipelinePath, 'not a url');
  assert.equal(result.code, 2);
  assert.equal(readFileSync(pipelinePath, 'utf-8'), before);
});

// --jd: a temporary root with its own jds/, so the real jds/ is never touched.
function freshRoot(pipelineBody = '# Pipeline\n\n## Pending\n\n## Processed\n') {
  const root = mkdtempSync(join(tmpdir(), 'add-posting-root-'));
  mkdirSync(join(root, 'jds'));
  const pipelinePath = join(root, 'pipeline.md');
  writeFileSync(pipelinePath, pipelineBody);
  return { root, pipelinePath };
}

function addJd(root, pipelinePath, jdArgument) {
  return new Promise((resolve) => {
    const child = spawn('node', [SCRIPT, '--jd', jdArgument], { env: { ...process.env, LANDING_GEAR_ROOT: root, LANDING_GEAR_PIPELINE: pipelinePath } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const POST_HEADER = 'Source: https://www.linkedin.com/feed/update/urn:li:activity:7001/\nCompany: Acme\nTitle: Android Developer\nLocation: LATAM\n\nWe are hiring.\n';

test('--jd adds a local:jds line once, with fields from the file header', async () => {
  const { root, pipelinePath } = freshRoot();
  writeFileSync(join(root, 'jds', 'linkedin-post-7001.md'), POST_HEADER);
  const first = await addJd(root, pipelinePath, 'jds/linkedin-post-7001.md');
  const second = await addJd(root, pipelinePath, 'jds/linkedin-post-7001.md');
  assert.equal(first.code, 0, first.stderr);
  assert.match(second.stdout, /already-in-pipeline/);
  const text = readFileSync(pipelinePath, 'utf-8');
  assert.match(text, /- \[ \] local:jds\/linkedin-post-7001\.md \| Acme \| Android Developer \| LATAM/);
  assert.equal(countOf(text, 'linkedin-post-7001.md'), 1);
  assert.equal(countOf(text, 'jds/jds/'), 0);
});

test('--jd: a processed row already blocks a re-add', async () => {
  const { root, pipelinePath } = freshRoot('# Pipeline\n\n## Pending\n\n## Processed\n\n- [x] #12 | local:jds/linkedin-post-1.md | Acme | Android | 3.5/5 | PDF ❌\n');
  writeFileSync(join(root, 'jds', 'linkedin-post-1.md'), POST_HEADER);
  const result = await addJd(root, pipelinePath, 'jds/linkedin-post-1.md');
  assert.match(result.stdout, /already-in-pipeline/);
  assert.equal(countOf(readFileSync(pipelinePath, 'utf-8'), 'linkedin-post-1.md'), 1);
});

test('--jd rejects bad paths and missing files without writing', async () => {
  const { root, pipelinePath } = freshRoot();
  writeFileSync(join(root, 'jds', 'ok.md'), POST_HEADER);
  const before = readFileSync(pipelinePath, 'utf-8');
  for (const bad of ['jds/../x.md', '/etc/passwd.md', 'jds/missing.md', 'jds/has space.md', 'jds/a[1].md', 'jds/a|b.md', 'other/ok.md', 'jds/ok.txt']) {
    const result = await addJd(root, pipelinePath, bad);
    assert.equal(result.code, 2, `${bad}: ${result.stdout}`);
  }
  assert.equal(readFileSync(pipelinePath, 'utf-8'), before);
});

test('--jd: shell-like text in the header is written literally and runs nothing', async () => {
  const { root, pipelinePath } = freshRoot();
  const marker = join(root, 'pwned');
  writeFileSync(join(root, 'jds', 'linkedin-post-9.md'), `Company: Evil\nTitle: $(touch ${marker})'"\n\nbody\n`);
  const result = await addJd(root, pipelinePath, 'jds/linkedin-post-9.md');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(existsSync(marker), false);
  assert.ok(readFileSync(pipelinePath, 'utf-8').includes(`$(touch ${marker})'"`));
});

test('lock is released: a later run still works', async () => {
  const pipelinePath = freshPipeline();
  await add(pipelinePath, 'not a url');
  const result = await add(pipelinePath, 'https://jobs.ashbyhq.com/acme/9');
  assert.equal(result.code, 0, result.stderr);
});
