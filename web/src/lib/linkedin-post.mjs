// Reads one LinkedIn feed post from its text lines (house rule 18): author, body, title, location,
// and the reason it is not worth a look, if any. Pure, so it is tested in node and inlined as-is
// into the console script by linkedin-script.mjs. When in doubt a post passes (house rule 10):
// Claude judges the survivors when it processes the downloaded JSON.

import { fold, placesIn } from "./location-reach.mjs";

const NOISE_LINE = /^(Like|Comment|Repost|Send|Follow|Connect|Join|Feed post|\d+|…\s*more|more|​)$/i;
// The age ("13m", "6h", "2d") ends the author header, also inside "with X • 6h • Edited".
const AGE = /(^|•)\s*\d+\s?(s|m|h|d|w|mo|min|hr|yr)s?\b/i;
const TITLE_WINDOW = 8;
const MAX_TITLE_LINE = 120;
const LABELED_ROLE = /\b(job title|role|position|puesto|cargo)\s*:\s*(.+)/i;
// \p{Pd} is any dash, so "Hiring - Senior X" and its en/em dash spellings read the same.
const HIRING_LINE = /\b(we.?re hiring|we are hiring|now hiring|hiring|vacancy|vacante|buscamos|contratando)\b[\s:!|\p{Pd}]*(?:for\s+)?(?:an?\s+)?(.*)/iu;
const ROLE_NOUN = /\b(engineers?|developers?|devs?|programmers?|consultants?|contractors?|specialists?|experts?|swe|sde|leads?|architects?|desarrollador(a|es|as)?|programador(a|es|as)?|ingenier[oa]s?|arquitect[oa]s?)\b/;
const STACK = /(android|kotlin|mobile|movil|flutter|react native|\bios\b|\bai\b|llm|agentic)/;
// The title must name the profile's stack (2026-10-28): .NET, WordPress, Shopify or data roles often
// mention "mobile" or "AI" somewhere in the body, so a body check lets them through.
const TITLE_STACK = /(android|kotlin|jetpack|\bkmp\b|mobile|movil|\bios\b|swift|flutter|react native|\bai\b|\bia\b|llm|agent\w*|agentic|genai|machine learning)/;
const LOCATION_LINE = /(?:📍|\b(?:location|ubicaci[oó]n|work mode|modalidad)\s*:)\s*(.+)/iu;
const LOCATION_LABEL = /^(location|ubicaci[oó]n|work mode|modalidad)\s*:\s*/i;

// Tuned 2026-10-24 on the first run (88 candidates, mostly noise) and 2026-10-27. No "immediate joiner":
// recruiters write it to ask for one ("Joining: Immediate Joiner"), it is not a candidate's word (2026-10-28).
// "I'm looking for" only with what a candidate looks for: recruiters write "What I'm looking for:" and
// "I'm looking for a Senior X Engineer" (2026-10-28, a $6-8K LATAM React Native post dropped on it).
const SEEKER = /(open to work|looking for (my )?next|i( a|.)m looking for (my next|a new (role|job|position|opportunit\w*)|new (roles?|jobs?|opportunit\w*)|remote (roles?|jobs?|work|opportunit\w*)|opportunit\w*|work\b|a job)|seeking (new )?(opportunit|role)|my friend is looking|available consultants|available (now )?for (new )?(projects|freelance|remote|contract)|open (to|for) (freelance|new|my next)|new resume|on the bench|estoy en b[uú]squeda|busco una oportunidad|en b[uú]squeda (activa )?de (empleo|una oportunidad))/i;
// A freelancer selling services; a recruiter who "helps companies hire" is not one.
const SELLS_SERVICES = /\bi help (businesses|startups|companies)\b((?:\W+\w+){0,4})/i;
const HIRES = /\b(hire|hiring|recruit\w*|talent)\b/i;
const OPENING = 600;
// "opening up possibilities" in event and news posts is not a job opening (2026-10-29, Android Dev Summit).
// "Se busca: Desarrollador Mobile", "A Truelogic busca Forward Deployed Engineer", "en búsqueda de un
// Desarrollador" (2026-11-01, LATAM posts dropped as not hiring). SEEKER runs first, so "en búsqueda de empleo" stays out.
const HIRING = /(hiring|we.re looking|we are looking|looking for (a|an|experienced|senior)|join our|vacante|vacancy|buscamos|\bbusca\b|b[uú]squeda de (un|una)\b|\bvagas?\b|estamos contratando|open position|\bopenings?\b(?!\s+up)|send (your )?(cv|resume)|job title\s*:|role\s*:|position\s*:|(roles?|positions?) (are )?open|open (roles|positions))/i;
// A digest of many jobs, each with its own link.
const LIST_LINK = /(apply\s*:|👉).*https?:\/\//iu;
const NUMBERED_LINK = /^\d+[.)]\s.*https?:\/\//;
const MIN_LIST = 3;
// A list of roles with bare links. Higher bar: one offer may carry its apply link plus a few social links.
const BARE_LINK = /^https?:\/\/\S+$/;
const MIN_BARE_LINKS = 5;
// US contract and visa terms, and platforms that only farm out gigs: plainly out wherever they appear.
// micro1, mercor, remoteyeah and freelanly pass since 2026-10-29 (the engineer): micro1 and mercor pay well and are
// judged in triage, the other two repost real jobs that get confirmed at the employer. Only the copy-paste
// "WE ARE HIRING, REMOTE POSITIONS AVAILABLE | USA & UK" spam stays out.
const US_CONTRACT = /\b(only (us|usa|india|uk)|(us|usa|uk|north america) only|based in the (united states|us|usa) or canada|h1b|w2|c2c|1099|visa status|green card|us citizens?|us residents|candidates? based in (the )?(usa|us|india|uk))\b/i;
const PLATFORM = /(we are hiring . remote positions available)/i;
const WORK_MODE = /\b(onsite|on-site|hybrid|presencial)\b(?!\s+(apps?|mobile|development))/i;
// The engineer (2026-10-29): junior posts are out here. Pre-triage keeps them on purpose for Discovered rows.
const JUNIOR = /\b(junior|jr)\b/;
// Places (and Indian pay words) the old searches drowned in. A bare mention only counts when the post names
// no LATAM place or open scope ("remote from LATAM or the Philippines" stays). Residency is pre-triage's job.
// Indian cities: all the big tech hubs (the engineer, 2026-11-01, after a Coimbatore post passed).
const NOISE_PLACE = /\b(india|pakistan|bangalore|bengaluru|hyderabad|mumbai|pune|chennai|noida|gurgaon|gurugram|delhi|new delhi|kolkata|ahmedabad|jaipur|chandigarh|mohali|kochi|cochin|trivandrum|thiruvananthapuram|coimbatore|indore|bhopal|nagpur|lucknow|kanpur|surat|vadodara|rajkot|nashik|mysore|mysuru|mangalore|visakhapatnam|vizag|vijayawada|bhubaneswar|patna|ranchi|dehradun|gandhinagar|madurai|tricity|inr|lakh|lpa|crore|ctc|freshers?|nigeria|lagos|ethiopia|kenya|egypt|philippines|vietnam)\b|[₹₦]/i;
const NO_TRACKER = { urls: new Set(), companyRoles: new Set() };

/** Splits #CamelCase hashtags into words: "#SeniorMobileDeveloper" -> "Senior Mobile Developer". */
const splitHashtags = (line) => line.replace(/#([A-Za-z][A-Za-z0-9]*)/g, (_, tag) => tag.replace(/([a-z0-9])([A-Z])/g, "$1 $2"));
const cleanTitle = (text) => text.replace(/^[^\p{L}\p{N}]+/u, "").trim().slice(0, 150);

/**
 * Author and body from a post container's text lines. Without an age line, everything but the
 * first line (the author) is the body.
 * @param {string[]} rawLines
 * @returns {{author: string, body: string[]}}
 */
export function splitPost(rawLines) {
  // NFKC turns "decorative" Unicode letters (𝐐𝐀 𝐄𝐧𝐠𝐢𝐧𝐞𝐞𝐫, 2026-10-28) into plain ones, so every regex can read them.
  const lines = rawLines.map((line) => line.normalize("NFKC").trim()).filter((line) => line && !NOISE_LINE.test(line));
  const ageIndex = lines.findIndex((line) => AGE.test(line));
  return { author: lines[0] ?? "", body: lines.slice(ageIndex >= 0 ? ageIndex + 1 : 1) };
}

/**
 * The role the post hires for: a "Role:" line, then a hiring line that names a role, both anywhere in
 * the post (some put the role at the bottom), then the first short line with a role noun near the top.
 * Hashtag lines ("#Hiring #AIAgents") never give a title. Empty when none.
 * @param {string[]} body
 */
export function postTitle(body) {
  const lines = body.filter((line) => !line.startsWith("#")).map(splitHashtags);
  const window = body.slice(0, TITLE_WINDOW).map(splitHashtags);
  const namesRole = (text) => ROLE_NOUN.test(fold(text)) || STACK.test(fold(text));
  for (const line of lines) {
    const labeled = LABELED_ROLE.exec(line);
    if (labeled && namesRole(labeled[2])) return cleanTitle(labeled[2]);
  }
  for (const line of lines) {
    const hiring = HIRING_LINE.exec(line);
    // "We're hiring. I'm looking for a Senior X": a new sentence is not the title (it reads as first person).
    if (hiring && !/^[.?]/.test(hiring[2]) && namesRole(hiring[2])) return cleanTitle(hiring[2]);
  }
  const nounLine = window.find((line) => line.length < MAX_TITLE_LINE && ROLE_NOUN.test(fold(line)));
  return nounLine ? cleanTitle(nounLine) : "";
}

/**
 * Labeled location values only ("📍 Location: Poland", "Work mode: Remote"), joined. Never prose:
 * "Join us" or "a US client" is not where the candidate must be.
 * @param {string[]} body
 */
export function postLocation(body) {
  const values = [];
  for (const line of body) {
    const match = LOCATION_LINE.exec(line);
    if (match) values.push(match[1].replace(LOCATION_LABEL, "").trim());
  }
  return values.filter(Boolean).join(" | ");
}

/** Comparable form of a post, so the same text reposted by another author is one candidate. */
export function dedupKey(title, body) {
  const alnum = fold(body.join(" ")).replace(/[^a-z0-9]+/g, "").slice(0, 120);
  return `${fold(title).replace(/[^a-z0-9]+/g, " ").trim()}|${alnum}`;
}

/**
 * Why the post is not worth a look, or null. `kind` names the counter it goes to.
 * @param {{author: string, body: string[]}} post
 * @param {(job: object, tracker: object, jd: object) => {pass: boolean, reason?: string}} preTriage
 * @returns {{title: string, location: string, kind: string|null, reason: string|null}}
 */
export function judgePost(post, preTriage) {
  const text = post.body.join("\n");
  const title = postTitle(post.body);
  const location = postLocation(post.body);
  const out = (kind, reason) => ({ title, location, kind, reason });

  const seeker = SEEKER.exec(text);
  if (seeker) return out("seeker", `busca trabajo: ${seeker[0]}`);
  const services = SELLS_SERVICES.exec(text.slice(0, OPENING));
  if (services && !HIRES.test(services[2])) return out("seeker", `ofrece servicios: ${services[0].slice(0, 40)}`);
  if (!HIRING.test(text)) return out("notHiring", "sin frase de contratacion");
  if (!title) return out("noRole", "no es oferta (sin rol)");
  const listLines = post.body.filter((line) => LIST_LINK.test(line) || NUMBERED_LINK.test(line)).length;
  const bareLinks = post.body.filter((line) => BARE_LINK.test(line)).length;
  if (listLines >= MIN_LIST || bareLinks >= MIN_BARE_LINKS) return out("jobList", "no es oferta (lista de empleos)");

  const blocked = US_CONTRACT.exec(text) ?? PLATFORM.exec(text) ?? WORK_MODE.exec(text);
  if (blocked) return out("blocked", `bloqueado: ${blocked[0]}`);
  const place = NOISE_PLACE.exec(text);
  if (place) {
    const { openScope, latam } = placesIn(text);
    if (!openScope && !latam.length) return out("blocked", `bloqueado: ${place[0]}`);
  }

  // After the more specific reasons (job list, blocked terms), so those still name the real cause.
  if (!TITLE_STACK.test(fold(title))) return out("offStack", "fuera de stack");
  if (JUNIOR.test(fold(title))) return out("offStack", "junior");
  const verdict = preTriage({ url: "", company: post.author, role: title, location }, NO_TRACKER, { text });
  return verdict.pass ? out(null, null) : out("preTriage", `pre-triage: ${verdict.reason}`);
}
