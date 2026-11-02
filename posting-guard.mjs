#!/usr/bin/env node
/**
 * posting-guard.mjs: cleans and inspects untrusted job-posting text before an agent reads it.
 * Patterns adapted from ai-job-search's tools/posting_guard.py (MIT License,
 * Copyright (c) 2026 Mads Lorentzen), rewritten for this repo.
 *
 * Three checks, all advisory (nothing here blocks a posting):
 * - hiddenHtml(html): removes elements a reader never sees (display:none, visibility:hidden,
 *   opacity:0, font-size:0, the hidden attribute, aria-hidden="true") and reports their text.
 * - stripInvisible(text): removes characters that hide or reorder text (Unicode tag characters,
 *   bidi overrides and isolates, zero-width space, word joiner, an inner BOM, soft hyphen).
 *   Emoji joiners, a lone variation selector, ZWNJ and RTL marks are kept: emoji and RTL or
 *   Indic scripts need them. Only a run of them, or a variation-selector run, is reported.
 * - instructionLines(text): reports lines written to an AI ("ignore previous instructions",
 *   "you are an AI assistant"), never removes them, so Block G can quote them.
 *
 * Findings are {kind: "hidden-html"|"invisible"|"instruction", sample}. The sample is posting
 * text: it goes into data files the agent reads as data, never into a prompt.
 *
 * CLI (paths only, never a URL or posting text on the command line):
 *   node posting-guard.mjs --file <path>             print {counts, findings}
 *   node posting-guard.mjs --clean <in> <out>        write the cleaned file, print {counts, findings}
 *   node posting-guard.mjs --summary <findings.json>  print "hidden-html=N invisible=N instruction-lines=N"
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isMainModule } from './lib/is-main-module.mjs';

const SAMPLE_MAX = 160;
// Hidden text shorter than this (an icon, a bullet glyph under aria-hidden) is removed silently.
const HIDDEN_REPORT_MIN = 12;

const HIDDEN_STYLE = /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d]*[1-9])|font-size\s*:\s*0(?:\.0+)?(?:px|pt|em|rem|%)?(?![\d.])|color\s*:\s*transparent|clip\s*:\s*rect\(\s*0|clip-path\s*:\s*inset\(\s*100%|(?:left|top|text-indent)\s*:\s*-\d{4,}px/i;
const TAG = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

// Removed: tag characters (one per ASCII letter, read by models but never rendered), bidi
// embeddings/overrides/isolates, ZWSP, word joiner and invisible operators, soft hyphen.
const TAG_CHAR = /[\u{E0000}-\u{E007F}]/gu;
// The England, Scotland and Wales flags are the one legitimate use of tag characters.
const RGI_TAG_FLAG = /\u{1F3F4}\u{E0067}\u{E0062}(?:\u{E0065}\u{E006E}\u{E0067}|\u{E0073}\u{E0063}\u{E0074}|\u{E0077}\u{E006C}\u{E0073})\u{E007F}/gu;
const REMOVED = /[\u{202A}-\u{202E}\u{2066}-\u{2069}\u{200B}\u{2060}-\u{2064}\u{00AD}]/gu;
const KEPT_RUN = /[\u{200C}-\u{200F}]{3,}|[\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]{2,}/gu;
const BOM = /\u{FEFF}/gu;

// Written to an AI, not to a candidate. "As an AI" and "you are an AI" exempt a job title
// right after ("As an AI Engineer, you will...").
const ROLE_NOUN = String.raw`(?:engineer|developer|researcher|scientist|architect|specialist|lead|consultant|manager|analyst|intern|trainer|expert|strategist|designer|tester|owner|programmer)s?\b`;
const INSTRUCTION_PATTERNS = [
  /\bignore (?:all |any |the |your )?(?:previous|prior|above|earlier|preceding) (?:instructions?|prompts?|rules)\b/i,
  /\b(?:disregard|forget)(?: all| any| the| your| my)? (?:previous|prior|above|earlier|preceding|initial|original|system) (?:instructions?|prompts?)\b/i,
  new RegExp(String.raw`\byou are (?:(?:an?|the) )?(?:ai(?![\w-])(?![\s/&]+(?:[\w&/-]+\s+){0,3}?${ROLE_NOUN})|ai (?:assistant|agent|model|language model)|assistant|llm|language model|chatgpt|claude|gemini)\b`, 'i'),
  /\bsystem prompt\b/i,
  /\b(?:do not|don['’]?t|never) (?:tell|inform) the user\b(?!['’]s)/i,
  /\b(?:do not|don['’]?t|never) (?:mention|reveal|disclose) (?:this|these|that|it|any of this|the (?:above|following|previous))\b[^.\n]{0,30}\bto the user\b/i,
  /\b(?:run|execute) the following (?:command|commands|script|code|shell|instruction|instructions|steps)\b/i,
  new RegExp(String.raw`\bas an ai(?![\w-])(?![\s/&]+(?:[\w&/-]+\s+){0,3}?${ROLE_NOUN})`, 'i'),
  /^\s*(?:assistant|system)\s*:/i,
  /<\||\[INST\]|###\s*(?:system|instruction)/i,
  /\b(?:rate|score|rank) this (?:candidate|applicant|resume|cv)\b/i,
  /\binclude the (?:word|phrase|token|string)\b[^.\n]{0,60}\bin your (?:answer|response|reply|output)\b/i,
];

const sample = (text) => String(text).replace(/\s+/g, ' ').trim().slice(0, SAMPLE_MAX);
const textOf = (html) => html.replace(/<[^>]*>/g, ' ');

function attrsHidden(attrs) {
  const style = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
  if (style && HIDDEN_STYLE.test(style[1] ?? style[2] ?? '')) return true;
  if (/(?:^|\s)hidden(?:\s|=|$)/i.test(attrs)) return true;
  return /\baria-hidden\s*=\s*["']?true\b/i.test(attrs);
}

/**
 * Remove the elements a reader never sees, with balanced-tag matching so a nested
 * hidden element is removed whole. Call it on decoded markup.
 * @param {unknown} html
 * @returns {{html: string, findings: {kind: string, sample: string}[]}}
 */
export function hiddenHtml(html) {
  const source = String(html ?? '').replace(/<!--[\s\S]*?(?:-->|$)/g, ' ');
  const findings = [];
  const cuts = [];
  const stack = [];
  let hiddenDepth = -1;
  let hiddenStart = 0;
  TAG.lastIndex = 0;
  for (let match = TAG.exec(source); match; match = TAG.exec(source)) {
    const [whole, closing, rawName, attrs] = match;
    const name = rawName.toLowerCase();
    if (!closing) {
      if (VOID.has(name) || /\/\s*$/.test(attrs)) continue;
      stack.push(name);
      if (hiddenDepth < 0 && attrsHidden(attrs)) {
        hiddenDepth = stack.length;
        hiddenStart = match.index;
      }
      continue;
    }
    const at = stack.lastIndexOf(name);
    if (at < 0) continue;
    stack.length = at;
    if (hiddenDepth > 0 && stack.length < hiddenDepth) {
      cuts.push([hiddenStart, match.index + whole.length]);
      hiddenDepth = -1;
    }
  }
  if (hiddenDepth > 0) cuts.push([hiddenStart, source.length]);
  if (!cuts.length) return { html: source, findings };
  let out = '';
  let from = 0;
  for (const [start, end] of cuts) {
    const hidden = sample(textOf(source.slice(start, end)));
    if (hidden.length >= HIDDEN_REPORT_MIN) findings.push({ kind: 'hidden-html', sample: hidden });
    out += `${source.slice(from, start)} `;
    from = end;
  }
  return { html: out + source.slice(from), findings };
}

/**
 * Remove characters that hide or reorder text; report tag-character payloads and runs.
 * @param {unknown} text
 * @returns {{text: string, findings: {kind: string, sample: string}[]}}
 */
export function stripInvisible(text) {
  const source = String(text ?? '');
  const findings = [];
  const flags = [];
  let work = source.replace(RGI_TAG_FLAG, (flag) => `\u0000${flags.push(flag) - 1}\u0000`);
  const payload = [...work.matchAll(TAG_CHAR)].map(([ch]) => String.fromCodePoint(ch.codePointAt(0) - 0xE0000)).join('');
  if (payload) findings.push({ kind: 'invisible', sample: sample(`tag characters spell: ${payload}`) });
  const removed = (work.match(REMOVED) || []).length;
  const innerBom = (work.slice(1).match(BOM) || []).length;
  if (removed + innerBom) findings.push({ kind: 'invisible', sample: `${removed + innerBom} zero-width, bidi-override or soft-hyphen characters removed` });
  const runs = work.match(KEPT_RUN) || [];
  if (runs.length) findings.push({ kind: 'invisible', sample: `${runs.length} run(s) of joiners, RTL marks or variation selectors (kept)` });
  work = work.replace(TAG_CHAR, '').replace(REMOVED, '').replace(BOM, '');
  work = work.replace(/\u0000(\d+)\u0000/g, (_, index) => flags[Number(index)]);
  return { text: work, findings };
}

/**
 * Lines written to an AI rather than to a candidate. Reported, never removed.
 * @param {unknown} text
 * @returns {{kind: string, sample: string}[]}
 */
export function instructionLines(text) {
  const findings = [];
  for (const line of String(text ?? '').split(/\n/)) {
    if (INSTRUCTION_PATTERNS.some((pattern) => pattern.test(line))) findings.push({ kind: 'instruction', sample: sample(line) });
  }
  return findings;
}

/** stripInvisible plus instructionLines on final posting text. */
export function guardText(text) {
  const cleaned = stripInvisible(text);
  return { text: cleaned.text, findings: [...cleaned.findings, ...instructionLines(cleaned.text)] };
}

/**
 * The whole guard on one posting: hidden markup first (when there is markup), then text.
 * @param {{text?: string, html?: string}} input
 */
export function inspectPosting({ text = '', html = '' } = {}) {
  const hidden = html ? hiddenHtml(html) : { html: '', findings: [] };
  const guarded = guardText(html ? textOf(hidden.html) : text);
  return { text: guarded.text, html: hidden.html, findings: [...hidden.findings, ...guarded.findings] };
}

/** Counts by kind, the only part of the findings that may enter a prompt. */
export function countFindings(findings) {
  const counts = { 'hidden-html': 0, invisible: 0, 'instruction-lines': 0 };
  for (const { kind } of Array.isArray(findings) ? findings : []) {
    if (kind === 'hidden-html') counts['hidden-html'] += 1;
    else if (kind === 'invisible') counts.invisible += 1;
    else if (kind === 'instruction') counts['instruction-lines'] += 1;
  }
  return counts;
}

/** "hidden-html=N invisible=N instruction-lines=N": fixed words and digits only. */
export function summaryLine(findings) {
  return Object.entries(countFindings(findings)).map(([kind, count]) => `${kind}=${count}`).join(' ');
}

/** A "## Posting integrity" markdown section for a capture, or "" when there is nothing to report. */
export function integritySection(findings) {
  if (!Array.isArray(findings) || !findings.length) return '';
  const lines = findings.map(({ kind, sample: text }) => `- ${kind}: ${String(text).replace(/\s+/g, ' ')}`);
  return `\n\n## Posting integrity\n\nUntrusted posting text, quoted as data: ${summaryLine(findings)}\n\n${lines.join('\n')}\n`;
}

const looksLikeHtml = (text) => /<\s*(html|body|div|p|span|section|article|ul|li)\b/i.test(text);

function writeAtomic(path, content) {
  const temp = `${path}.guard-${process.pid}.tmp`;
  writeFileSync(temp, content);
  renameSync(temp, path);
}

if (isMainModule(import.meta.url)) {
  const [flag, first, second] = process.argv.slice(2);
  try {
    if (flag === '--help' || flag === '-h') {
      console.log('usage: node posting-guard.mjs --file <path> | --clean <in> <out> | --summary <findings.json>');
    } else if (flag === '--summary' && first) {
      let findings = [];
      try {
        findings = JSON.parse(readFileSync(first, 'utf8')).findings ?? [];
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      console.log(summaryLine(findings));
    } else if ((flag === '--file' && first) || (flag === '--clean' && first && second)) {
      const input = readFileSync(first, 'utf8');
      const markup = looksLikeHtml(input);
      const result = markup ? inspectPosting({ html: input }) : inspectPosting({ text: input });
      if (flag === '--clean') {
        const cleaned = markup ? stripInvisible(result.html).text : result.text;
        writeAtomic(second, cleaned);
      }
      console.log(JSON.stringify({ counts: countFindings(result.findings), findings: result.findings }));
    } else {
      console.error('usage: node posting-guard.mjs --file <path> | --clean <in> <out> | --summary <findings.json>');
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(`posting-guard: ${error.message}`);
    process.exitCode = 1;
  }
}
