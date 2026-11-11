/**
 * location-reach.mjs: a readable label for a posting's location, for the engineer
 * (remote from El Salvador). Label only: nothing here drops a row, because
 * house rule 10 says a country list is not a disqualifier. Pure, no imports, so
 * the client components can use it. Idea from AienTech/dossier, rewritten for
 * rule 10 (LATAM country lists, the Workday single-pin exception).
 *
 * Kinds: open (El Salvador, LATAM, Americas, worldwide), latam-list (one or
 * more LATAM countries), unstated (remote, no region), limited (remote, only
 * places outside LATAM), onsite (a place outside LATAM, no remote word),
 * unknown (nothing usable).
 */

/** @typedef {"open"|"latam-list"|"unstated"|"limited"|"onsite"|"unknown"} ReachKind */
/** @typedef {{kind: ReachKind, label: string, places: string[], tone: "good"|"info"|"warn"|"muted"}} Reach */

const LATAM_CODES = ["AR", "BO", "BR", "BZ", "CL", "CO", "CR", "CU", "DO", "EC", "GT", "GY", "HN", "JM", "MX", "NI", "PA", "PE", "PR", "PY", "SR", "SV", "UY", "VE"];
const US_STATES = new Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" "));

// Regions that include El Salvador, and the scope word each one shows as.
const OPEN_REGIONS = [
  [/\b(worldwide|anywhere|global|everywhere|world wide|todo el mundo|cualquier pais|cualquier parte)\b/, "worldwide"],
  [/\b(latam|latin america|america latina|latinoamerica|south america|central america|centroamerica|americas|amer)\b/, "LATAM"],
];
// Regions that don't.
const OTHER_REGIONS = [
  [/\bemea\b/, "EMEA"],
  [/\bapac\b/, "APAC"],
  [/\b(europe|european union|eu)\b/, "Europe"],
  [/\bnorth america\b/, "North America"],
  [/\b(asia|middle east|africa|oceania)\b/, "Asia/Africa/Oceania"],
];
const REMOTE_RE = /\b(remote|remoto|remota|fully remote|work from home|wfh|home based|distributed|teletrabajo)\b/;
// Big LATAM cities postings name without the country ("Bogota (Remote)").
const LATAM_CITIES = [
  [/\b(bogota|medellin|cali|barranquilla)\b/, "Colombia", "CO"],
  [/\b(buenos aires|cordoba|rosario|mendoza)\b/, "Argentina", "AR"],
  [/\b(sao paulo|rio de janeiro|belo horizonte|curitiba|porto alegre|florianopolis|recife)\b/, "Brazil", "BR"],
  [/\b(cdmx|ciudad de mexico|guadalajara|monterrey|queretaro)\b/, "Mexico", "MX"],
  [/\b(lima)\b/, "Peru", "PE"],
  [/\b(montevideo)\b/, "Uruguay", "UY"],
  [/\b(quito|guayaquil)\b/, "Ecuador", "EC"],
  [/\b(caracas)\b/, "Venezuela", "VE"],
  [/\b(guatemala city|ciudad de guatemala)\b/, "Guatemala", "GT"],
  [/\b(tegucigalpa|san pedro sula)\b/, "Honduras", "HN"],
  [/\b(san salvador)\b/, "El Salvador", "SV"],
  [/\b(asuncion)\b/, "Paraguay", "PY"],
];
const HYBRID_RE = /\b(hybrid|hibrido)\b/;
const HOURS = [
  [/\b(pst|pdt|pacific time)\b/, "PST"],
  [/\b(est|edt|eastern time)\b/, "EST"],
  [/\b(cst|cdt|central time)\b/, "CST"],
  [/\b(mst|mdt|mountain time)\b/, "MST"],
  [/\b(cet|cest|central european time)\b/, "CET"],
  [/\b(us hours|us time ?zones?)\b/, "US"],
];
const US_WORDS = /\b(us|usa|u\.s\.a?\.?|united states)\b/;
const US_SCHEDULE = /\b(?:us|u\.s\.?|usa|united states)\s+(?:business\s+|working\s+|work\s+)?(?:hours|time\s?zones?)\b/gi;
const UK_WORDS = /\b(uk|united kingdom)\b/;

/** Lowercase without accents, so "México" and "Mexico" read the same. */
export const fold = (text) => String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** @type {{name: string, code: string, re: RegExp}[] | null} */
let countries = null;

/** Every country name Intl knows, in English and Spanish, built once. */
function countryTable() {
  if (countries) return countries;
  const english = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
  const spanish = new Intl.DisplayNames(["es"], { type: "region", fallback: "none" });
  const table = [];
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const first of letters) {
    for (const second of letters) {
      const code = first + second;
      const name = english.of(code);
      if (!name || name === code || /\d/.test(code)) continue;
      for (const spelled of new Set([name, spanish.of(code)].filter(Boolean))) {
        const folded = fold(spelled);
        // Short or generic names ("Chad", "Jordan") are fine; skip regions like "World" and "European Union".
        if (folded.length < 4 || /^(world|european union|eurozone|united nations|latin america|outlying oceania)/.test(folded)) continue;
        table.push({ name, code, re: new RegExp(`\\b${folded.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`) });
      }
    }
  }
  countries = table;
  return table;
}

// A profile's authorized_in entry that means the US, after punctuation folds to spaces ("U.S." -> "u s").
const US_AUTHORIZED = /\b(us|usa|u s|u s a|united states|estados unidos|ee uu|eeuu|eua|etats unis|green card)\b/;

/**
 * Whether the profile's `location.authorized_in` covers the US: true for any US entry,
 * false only when every entry is a known non-US country, undefined otherwise (missing,
 * empty, a region like "Latin America", or text it cannot read). Pre-triage only runs
 * its US eligibility check on false.
 * @param {unknown} authorizedIn a list or a bare string
 * @returns {boolean | undefined}
 */
export function usAuthorizedFrom(authorizedIn) {
  const entries = (Array.isArray(authorizedIn) ? authorizedIn : [authorizedIn])
    .map((entry) => fold(entry).replace(/[^a-z0-9]+/g, " ").trim())
    .filter(Boolean);
  if (!entries.length) return undefined;
  if (entries.some((entry) => US_AUTHORIZED.test(entry))) return true;
  const table = countryTable();
  return entries.every((entry) => table.some((country) => country.code !== "US" && country.re.test(entry))) ? false : undefined;
}

/**
 * @param {unknown} location
 * @param {string} [url] the posting URL, for house rule 10's Workday exception
 * @returns {Reach}
 */
export function readReach(location, url = "") {
  const raw = String(location ?? "").trim();
  const text = fold(raw);
  const remote = REMOTE_RE.test(text);
  const hours = HOURS.find(([re]) => re.test(text))?.[1];
  const withHours = (label) => (hours ? `${label}, ${hours} hours` : label);
  // "US hours" or "US time zones" is a schedule, not a place: without this, "Remote, US time
  // zones" read as remote limited to the United States and pre-triage closed the row.
  const { openScope, latam, others } = placesIn(raw.replace(US_SCHEDULE, " "));
  const list = (names) => (names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", "));

  // House rule 10 exception: on Workday, "Remote" plus one pin means remote from inside that country.
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    // No URL or not a URL: the exception does not apply.
  }
  const pins = [...latam, ...others];
  if (host.endsWith(".myworkdayjobs.com") && remote && pins.length === 1 && pins[0] !== "El Salvador" && !openScope) {
    return { kind: "limited", label: withHours(`Remote, limited to ${pins[0]} (Workday)`), places: pins, tone: "warn" };
  }

  if (openScope) {
    const label = remote ? `Remote, ${openScope} ok` : `${openScope} ok`;
    return { kind: "open", label: withHours(label), places: pins, tone: "good" };
  }
  if (latam.length) {
    return { kind: "latam-list", label: withHours(`LATAM country list: ${list(latam)}`), places: pins, tone: "info" };
  }
  if (others.length) {
    if (remote && !HYBRID_RE.test(text)) return { kind: "limited", label: withHours(`Remote, limited to ${list(others)}`), places: others, tone: "warn" };
    return { kind: "onsite", label: withHours(`${HYBRID_RE.test(text) ? "Hybrid" : "On-site"}, ${list(others)}`), places: others, tone: "warn" };
  }
  if (remote) return { kind: "unstated", label: withHours("Remote, region not stated"), places: [], tone: "info" };
  return { kind: "unknown", label: withHours("Doesn't say"), places: [], tone: "muted" };
}

/**
 * The places a piece of text names, in its order: `openScope` when it includes
 * El Salvador (El Salvador, LATAM, Americas, worldwide), `latam` countries, and
 * `others` (countries and regions outside LATAM). Shared with pre-triage's
 * residency check, which reads it over a JD sentence.
 * @param {unknown} rawText
 * @returns {{openScope: string|null, latam: string[], others: string[]}}
 */
export function placesIn(rawText) {
  const raw = String(rawText ?? "");
  const text = fold(raw);
  /** @type {Map<string, {code: string, at: number}>} name -> code and where it appears, so lists keep the posting's order */
  const found = new Map();
  const note = (name, code, at) => {
    if (!found.has(name) || found.get(name).at > at) found.set(name, { code, at });
  };
  for (const { name, code, re } of countryTable()) {
    const match = re.exec(text);
    if (match) note(name, code, match.index);
  }
  for (const [re, name, code] of LATAM_CITIES) {
    const match = re.exec(text);
    if (match) note(name, code, match.index);
  }
  const us = US_WORDS.exec(text);
  if (us) note("United States", "US", us.index);
  const uk = UK_WORDS.exec(text);
  if (uk) note("United Kingdom", "GB", uk.index);
  // "Austin, TX" style pins are US places.
  for (const match of raw.matchAll(/,\s*([A-Z]{2})\b/g)) if (US_STATES.has(match[1])) note("United States", "US", match.index);

  const ordered = [...found].sort((a, b) => a[1].at - b[1].at);
  const openScope = OPEN_REGIONS.find(([re]) => re.test(text))?.[1] ?? (found.has("El Salvador") ? "El Salvador" : null);
  const latam = ordered.filter(([, { code }]) => LATAM_CODES.includes(code)).map(([name]) => name);
  const regions = OTHER_REGIONS.filter(([re]) => re.test(text)).map(([, name]) => name);
  const others = [...ordered.filter(([, { code }]) => !LATAM_CODES.includes(code)).map(([name]) => name), ...regions];
  return { openScope, latam, others };
}
