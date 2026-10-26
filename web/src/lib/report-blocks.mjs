/**
 * report-blocks.mjs: turns the report's CV match (B), Comp (D) and Posting
 * Legitimacy (G) sections into structured rows the detail page can show
 * compactly. Pure; every parser returns empty results on a shape it does not
 * know, and the page then falls back to the section's markdown.
 */

/** Plain text of one markdown cell or line: no bold, code ticks or link syntax. */
export function plainText(text) {
  return String(text ?? "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The first markdown table in the text.
 * @param {string} md
 * @returns {{headers: string[], rows: string[][]}}
 */
export function parseTable(md) {
  const lines = String(md ?? "").split("\n");
  const start = lines.findIndex((line, i) => /^\s*\|/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? ""));
  if (start === -1) return { headers: [], rows: [] };
  const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
  const headers = cells(lines[start]).map((h) => plainText(h).toLowerCase());
  const rows = [];
  for (let i = start + 2; i < lines.length && /^\s*\|/.test(lines[i]); i++) rows.push(cells(lines[i]));
  return { headers, rows };
}

/** Text after the first table, for the notes that follow it. */
export function afterTable(md) {
  const lines = String(md ?? "").split("\n");
  let i = lines.findIndex((line) => /^\s*\|/.test(line));
  if (i === -1) return "";
  while (i < lines.length && /^\s*\|/.test(lines[i])) i++;
  return lines.slice(i).join("\n").trim();
}

const column = (headers, ...names) => headers.findIndex((h) => names.some((name) => h.includes(name)));

/**
 * @typedef {{requirement: string, importance: string, match: "strong"|"partial"|"missing"|"unknown", evidence: string}} CvMatchRow
 * @param {string} md the CV match section
 * @returns {{rows: CvMatchRow[], notes: string}}
 */
export function cvMatchRows(md) {
  const { headers, rows } = parseTable(md);
  const at = {
    requirement: column(headers, "requirement"),
    importance: column(headers, "importance"),
    match: column(headers, "match"),
    evidence: column(headers, "evidence", "gap"),
  };
  if (at.requirement === -1 || at.match === -1) return { rows: [], notes: "" };
  const matchOf = (cell) => {
    const text = cell.toLowerCase();
    if (/✅|strong|met\b/.test(text)) return "strong";
    if (/⚠️|partial/.test(text)) return "partial";
    if (/❌|missing|gap/.test(text)) return "missing";
    return "unknown";
  };
  return {
    rows: rows.map((row) => ({
      requirement: plainText(row[at.requirement]),
      importance: plainText(row[at.importance] ?? "").replace(/\s*\(.*\)$/, ""),
      match: matchOf(row[at.match] ?? ""),
      evidence: plainText(row[at.evidence] ?? ""),
    })).filter((row) => row.requirement),
    notes: afterTable(md),
  };
}

/**
 * Tone of a legitimacy weight.
 * @param {string} weight
 * @returns {"good"|"warn"|"bad"|"muted"}
 */
export function weightTone(weight) {
  const text = weight.toLowerCase();
  if (/concern|negative|red flag|fires/.test(text)) return "bad";
  if (/unconfirmed|unknown|caution|mixed|not done/.test(text)) return "warn";
  if (/positive|clear|consistent|not flagged|confirmed/.test(text)) return "good";
  return "muted";
}

/**
 * @typedef {{signal: string, finding: string, weight: string, tone: "good"|"warn"|"bad"|"muted"}} LegitimacySignal
 * @param {string} md the Posting Legitimacy section
 * @returns {{assessment: string, signals: LegitimacySignal[], notes: string}}
 */
export function legitimacySignals(md) {
  const { headers, rows } = parseTable(md);
  const at = { signal: column(headers, "signal"), finding: column(headers, "finding"), weight: column(headers, "weight") };
  const assessment = plainText(String(md ?? "").match(/\*\*Assessment:?\*\*:?\s*([^\n]+)/i)?.[1] ?? "");
  if (at.signal === -1 || at.finding === -1) return { assessment, signals: [], notes: "" };
  const notes = afterTable(md)
    .split("\n")
    .filter((line) => !/\*\*Assessment/i.test(line))
    .join("\n")
    .trim();
  return {
    assessment,
    signals: rows.map((row) => {
      const weight = plainText(row[at.weight] ?? "");
      return { signal: plainText(row[at.signal]), finding: plainText(row[at.finding]), weight, tone: weightTone(weight) };
    }).filter((s) => s.signal),
    notes,
  };
}

/**
 * "Key: value" facts from bullets ("- **Company type:** Agency...") or lines
 * ("Demand trend: no reliable trend found."), in order.
 * @param {string} md the Comp section
 * @returns {{key: string, lead: string, rest: string}[]}
 */
export function keyFacts(md) {
  const facts = [];
  for (const line of String(md ?? "").split("\n")) {
    const match = line.match(/^\s*(?:[-*]\s+)?\*\*([^*:]{2,40}):?\*\*:?\s*(.+)$/) ?? line.match(/^([A-Z][A-Za-z ]{2,30}):\s+(.+)$/);
    if (!match) continue;
    const value = plainText(match[2]);
    // The first sentence is the answer; the rest is its detail.
    const split = value.match(/^(.+?[.!?])\s+(.+)$/);
    facts.push({ key: plainText(match[1]), lead: split ? split[1] : value, rest: split ? split[2] : "" });
  }
  return facts;
}
