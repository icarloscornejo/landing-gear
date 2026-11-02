#!/usr/bin/env node
// Adds one posting to Pending in data/pipeline.md, skipping URLs already there.
//   add-posting.mjs <url> [--company X] [--title Y] [--location Z]
//   add-posting.mjs --jd jds/<name>.md   (a posting already saved to jds/: company, title and location
//                                          come from the file header, never from the command line)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendToPipeline, normalizeUrlForDedup, PIPELINE_PATH } from './scan.mjs';
import { withPipelineLock } from './pipeline-lock.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const OPTION_NAMES = ['company', 'title', 'location'];
// Only names sanitizePipelineUrl leaves alone: with [ ] | or spaces the written line would no longer
// contain the text the dedup looks for.
const JD_PATH = /^jds\/(?!.*\.\.)[A-Za-z0-9._-]+\.md$/;

function parseArguments(argv) {
  const options = {};
  let url = null;
  let jd = null;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument.startsWith('--') && OPTION_NAMES.includes(argument.slice(2))) {
      options[argument.slice(2)] = argv[++index];
    } else if (argument === '--jd') {
      jd = argv[++index];
    } else if (!argument.startsWith('--') && url === null) {
      url = argument;
    } else {
      throw new Error(`Unexpected argument: ${argument}`);
    }
  }
  if (jd !== null) {
    if (url !== null || Object.keys(options).length) throw new Error('--jd takes no URL or other options; they come from the file header');
    if (!JD_PATH.test(jd ?? '')) throw new Error('--jd expects jds/<name>.md with only letters, digits, dot, dash or underscore');
    const jdFile = join(getCareerOpsRoot(), jd);
    if (!existsSync(jdFile)) throw new Error(`--jd file not found: ${jdFile}`);
    return { url: `local:${jd}`, options: readJdHeader(readFileSync(jdFile, 'utf-8')), local: true };
  }
  if (!url) throw new Error('Usage: add-posting.mjs <url> [--company X] [--title Y] [--location Z] | --jd jds/<name>.md');
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('URL must be http or https');
  return { url, options, local: false };
}

// The jds/ file header: "Company: ...", "Title: ...", "Location: ..." lines at the top.
function readJdHeader(text) {
  const header = {};
  for (const line of text.split('\n').slice(0, 30)) {
    const match = line.match(/^(Company|Title|Location):\s*(.+)$/);
    if (match) header[match[1].toLowerCase()] ??= match[2].trim();
  }
  return header;
}

// A local:jds/... reference counts as already added when any line has it (pending, processed or struck).
function localRefInPipeline(reference) {
  if (!existsSync(PIPELINE_PATH)) return false;
  return readFileSync(PIPELINE_PATH, 'utf-8').split('\n').some((line) => line.includes(reference));
}

function urlsInPipeline() {
  if (!existsSync(PIPELINE_PATH)) return new Set();
  const text = readFileSync(PIPELINE_PATH, 'utf-8');
  const found = [...text.matchAll(/^- \[[ x!]\]\s+(\S+)/gm)].map((match) => normalizeUrlForDedup(match[1]));
  return new Set(found);
}

let request;
try {
  request = parseArguments(process.argv.slice(2));
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(2);
}

const { url, options, local } = request;
const status = await withPipelineLock(`${PIPELINE_PATH}.add`, async () => {
  const alreadyThere = local ? localRefInPipeline(url) : urlsInPipeline().has(normalizeUrlForDedup(url));
  if (alreadyThere) return 'already-in-pipeline';
  await appendToPipeline([{
    url,
    company: options.company || 'Unknown',
    title: options.title || 'Unknown',
    location: options.location,
  }]);
  return 'added';
});

console.log(JSON.stringify({ status, url }));
