#!/usr/bin/env node
// Runs scan-hn.mjs (the monthly "Ask HN: Who is hiring?" thread) for the daily scan:
// - Without Gemini: GEMINI_API_KEY is emptied, because scan-hn uses (and pays for) it when it is in
//   .env, and the daily scan spends no tokens. dotenv never overrides a variable already set, even
//   an empty one.
// - Prints "  + Company | Role | Location" for each row it added to data/pipeline.md (scan-hn prints
//   another format, and Today counts only this one).
// scan-hn has no --dry-run: to try it, point LANDING_GEAR_PIPELINE / LANDING_GEAR_SCAN_HISTORY /
// LANDING_GEAR_PORTALS at copies.
// Usage: node scan-hn-daily.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PIPELINE_PATH } from './scan.mjs';
import { parseInbox } from './web/src/lib/pipeline-table.mjs';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('usage: node scan-hn-daily.mjs  (runs scan-hn.mjs without Gemini and prints the rows it added)');
  process.exit(0);
}

const repo = path.dirname(fileURLToPath(import.meta.url));
const rows = () => (existsSync(PIPELINE_PATH) ? parseInbox(readFileSync(PIPELINE_PATH, 'utf-8')) : []);

const before = new Set(rows().map((job) => job.url));
const run = spawnSync(process.execPath, [path.join(repo, 'scan-hn.mjs')], {
  cwd: repo,
  env: { ...process.env, GEMINI_API_KEY: '' },
  stdio: ['ignore', 'inherit', 'inherit'],
});
for (const job of rows()) {
  if (!before.has(job.url)) console.log(`  + ${job.company} | ${job.role} | ${job.location ?? ''}`);
}
process.exitCode = run.status ?? 1;
