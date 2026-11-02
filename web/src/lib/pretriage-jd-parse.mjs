// Pure parsing for pre-triage's free JD reader (pretriage-jd.ts): a posting's
// text and structured salary from its page HTML (JSON-LD JobPosting, else the
// itemprop="description" block) or from a Himalayas feed item. No I/O here.

/** @typedef {{max?: number, currency?: string, period?: string}} Salary */
/** @typedef {{text: string, salary?: Salary}} FreeJd */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#x27": "'" };

/** Readable text from an HTML fragment: block tags become line breaks, the rest is dropped. */
export function htmlToText(html) {
  return String(html ?? "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|li|h[1-6]|div|ul|ol|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#?\w+);/g, (whole, name) => ENTITIES[name.toLowerCase()] ?? (/^#\d+$/.test(name) ? String.fromCharCode(Number(name.slice(1))) : whole))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** "YEAR", "annual", "per month", "hourly" -> year | month | week | day | hour. */
export function salaryPeriod(raw) {
  const text = String(raw ?? "").toLowerCase();
  if (/year|annual|anual/.test(text)) return "year";
  if (/month|mensual/.test(text)) return "month";
  if (/week|semanal/.test(text)) return "week";
  if (/day|diario/.test(text)) return "day";
  if (/hour|hora/.test(text)) return "hour";
  return undefined;
}

function isJobPosting(node) {
  const type = node?.["@type"];
  return type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
}

/** Every JSON-LD node on the page, flattening arrays and @graph. */
function jsonLdNodes(html) {
  const nodes = [];
  for (const match of String(html ?? "").matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed;
    try {
      parsed = JSON.parse(match[1].trim());
    } catch {
      // A malformed block on the page is not this posting's data; try the next.
      continue;
    }
    const stack = [parsed];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) stack.push(...node);
      else if (node && typeof node === "object") {
        nodes.push(node);
        if (Array.isArray(node["@graph"])) stack.push(...node["@graph"]);
      }
    }
  }
  return nodes;
}

/** JSON-LD baseSalary as a Salary, when it has a currency and a maximum. */
function salaryFromJsonLd(base) {
  if (!base || typeof base !== "object") return undefined;
  const value = base.value && typeof base.value === "object" ? base.value : base;
  const max = Number(value.maxValue ?? value.value);
  if (!Number.isFinite(max) || !base.currency) return undefined;
  return { max, currency: String(base.currency), period: salaryPeriod(value.unitText ?? base.unitText) ?? "year" };
}

/**
 * The posting's text (and salary, when structured) from its page HTML, or null.
 * @param {string} html
 * @returns {FreeJd|null}
 */
export function jdFromHtml(html) {
  const posting = jsonLdNodes(html).find(isJobPosting);
  if (posting?.description) {
    const text = htmlToText(posting.description);
    if (text) return { text: [posting.title, text].filter(Boolean).join("\n\n"), salary: salaryFromJsonLd(posting.baseSalary) };
  }
  const start = String(html ?? "").search(/itemprop=["']description["']/i);
  if (start === -1) return null;
  const tagEnd = html.indexOf(">", start);
  const rest = html.slice(tagEnd + 1);
  const next = rest.search(/itemprop=["'](?!description)/i);
  const text = htmlToText((next === -1 ? rest : rest.slice(0, next)).slice(0, 60_000));
  return text.length > 100 ? { text: text.slice(0, 20_000) } : null;
}

/** A posting URL without query, fragment or trailing slash, for matching feed guids. */
export function bareUrl(raw) {
  try {
    const url = new URL(String(raw ?? ""));
    return `${url.host}${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * A Himalayas feed item (https://himalayas.app/jobs/api) as a FreeJd.
 * @param {{title?: string, description?: string, maxSalary?: number, currency?: string, salaryPeriod?: string, locationRestrictions?: string[]}} item
 * @returns {FreeJd|null}
 */
export function jdFromHimalayas(item) {
  const text = htmlToText(item?.description);
  if (!text) return null;
  const where = Array.isArray(item.locationRestrictions) && item.locationRestrictions.length ? `\n\nLocation restrictions: ${item.locationRestrictions.join(", ")}` : "";
  const max = Number(item.maxSalary);
  const salary = Number.isFinite(max) && max > 0 && item.currency ? { max, currency: item.currency, period: salaryPeriod(item.salaryPeriod) ?? "year" } : undefined;
  return { text: `${item.title ?? ""}\n\n${text}${where}`.trim(), salary };
}
