#!/usr/bin/env node
// Starts a triage or a full evaluation through the web server, so the engineer watches it live in
// the web (Workers and /jobs/<id>) as if it had been started with a click there.
//   run-job.mjs <triage|evaluate> <url|local:jds/x.md> [--title "Company: Role"] [--wait] [--port 3000]
// Without --wait it prints the run id and exits; the server finishes the run on its own.
// With --wait it follows the run and exits 0 when it finished, 1 when it failed.
import { isMainModule } from './lib/is-main-module.mjs';

const KINDS = ['triage', 'evaluate'];

export function parseArguments(argv) {
  const options = { port: 3000, wait: false, title: '' };
  const positional = [];
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--wait') options.wait = true;
    else if (argument === '--port') options.port = Number(argv[++index]);
    else if (argument === '--title') options.title = String(argv[++index] ?? '');
    else positional.push(argument);
  }
  const [kind, input] = positional;
  if (!KINDS.includes(kind) || !input || positional.length !== 2) return null;
  if (!Number.isInteger(options.port) || options.port <= 0) return null;
  return { kind, input, ...options };
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options) {
    console.error('usage: run-job.mjs <triage|evaluate> <url|local:jds/x.md> [--title "..."] [--wait] [--port 3000]');
    process.exit(2);
  }
  const origin = `http://127.0.0.1:${options.port}`;
  let response;
  try {
    response = await fetch(`${origin}/api/run`, {
      method: 'POST',
      // The web's origin guard only accepts its own origin.
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ detach: true, kind: options.kind, input: options.input, cliId: 'claude', title: options.title, source: 'chat' }),
    });
  } catch (error) {
    console.error(`Could not reach the web at ${origin} (is it running?): ${error.message}`);
    process.exit(1);
  }
  const started = await response.json().catch(() => ({}));
  if (!response.ok || !started.id) {
    console.error(`Did not start: ${started.error ?? response.status}`);
    process.exit(1);
  }
  console.log(`${started.joined ? 'Already running' : 'Started'}: ${started.id}  ${origin}/jobs/${started.id}`);
  if (!options.wait) return;

  let shown = 0;
  for (;;) {
    await sleep(5000);
    const detail = await fetch(`${origin}/api/live-runs/${started.id}`).then((r) => r.json()).catch(() => null);
    const run = detail?.run;
    if (!run) continue;
    for (const step of run.steps.slice(shown)) console.log(`  ${step.kind === 'tool' ? '- ' : ''}${step.label}`);
    shown = run.steps.length;
    if (run.status === 'done') {
      console.log(`Done${run.reportN ? `, report ${run.reportN}` : ''}: ${run.verdictLine || 'no verdict'}`);
      return;
    }
    if (run.status === 'error') {
      console.error(`Failed: ${run.error}`);
      process.exit(1);
    }
  }
}

if (isMainModule(import.meta.url)) await main();
