// Pre-triage's free JD reader (house rule 22): the JD text of a Discovered row
// with no LLM tokens, so the zero-token checks can read residency, stack and pay.
// In order: a saved jds/ capture, fetch-jd.mjs (the ATS APIs it knows), the
// page's own HTML (JSON-LD or itemprop description), then Himalayas' search API
// for himalayas.app rows (the pages are Cloudflare-only, the API is public). Every
// JD read here is saved as a jds/ capture, so the Haiku triage reuses it instead
// of WebFetching. A miss is "no JD", never a drop.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { careerOpsRoot } from "@/lib/career-ops";
import { fetchJdCapture, listJdFiles, readJdSources } from "@/lib/jd-captures";
import { pastedJdMarkdown, parseNeedsChrome, resolveWorkerInput } from "@/lib/lifecycle.mjs";
import { bareUrl, jdFromHimalayas, jdFromHtml, type FreeJd } from "@/lib/pretriage-jd-parse.mjs";

const PAGE_TIMEOUT_MS = 15_000;
const HIMALAYAS_SEARCH = "https://himalayas.app/jobs/api/search";
const HIMALAYAS_MAX_PAGES = 3;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

type Job = { url: string; company: string; role: string };

function readNeedsChromeHosts(): string[] {
  try {
    return parseNeedsChrome(fs.readFileSync(path.join(careerOpsRoot(), "data", "needs-real-chrome.txt"), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};
const onHost = (host: string, listed: string) => host === listed || host.endsWith(`.${listed}`);

/** The JD body of a saved capture: everything after its "## Job description" heading. */
function captureText(relative: string): string {
  const markdown = fs.readFileSync(path.join(careerOpsRoot(), relative), "utf8");
  const heading = markdown.search(/^## Job description/m);
  return (heading === -1 ? markdown : markdown.slice(markdown.indexOf("\n", heading) + 1)).trim();
}

function saveCapture(job: Job, jd: FreeJd, how: string): void {
  const relative = path.join("jds", `fetched-${createHash("sha1").update(job.url).digest("hex").slice(0, 10)}.md`);
  const date = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(path.join(careerOpsRoot(), "jds"), { recursive: true });
  fs.writeFileSync(path.join(careerOpsRoot(), relative), pastedJdMarkdown({ url: job.url, company: job.company, role: job.role, text: jd.text, date, how }));
}

async function fetchPage(url: string): Promise<string | null> {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" }, signal: AbortSignal.timeout(PAGE_TIMEOUT_MS), redirect: "follow" });
  return response.ok ? response.text() : null;
}

/** A reader for one pre-triage run: the jds/ listing and needs-chrome hosts are read once. */
export function createJdReader() {
  const jdFiles = listJdFiles();
  const jdSources = readJdSources(jdFiles);
  const needsChrome = readNeedsChromeHosts();

  /** The row's posting from Himalayas' search API, matched on its guid (the browse feed is far too long to page). */
  const himalayasSearch = async (job: Job): Promise<FreeJd | null> => {
    const wanted = bareUrl(job.url);
    for (let page = 1; page <= HIMALAYAS_MAX_PAGES; page += 1) {
      const url = `${HIMALAYAS_SEARCH}?q=${encodeURIComponent(`${job.role} ${job.company}`)}&page=${page}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
      if (!response.ok) return null;
      const body = (await response.json()) as { jobs?: Record<string, unknown>[] };
      const item = (body.jobs ?? []).find((entry) => bareUrl(entry.guid ?? entry.applicationLink) === wanted);
      if (item) return jdFromHimalayas(item);
      if ((body.jobs ?? []).length < 20) return null;
    }
    return null;
  };

  /** The JD of one row, or null. Never throws: a failed read is "no JD". */
  return async function readJdFree(job: Job): Promise<(FreeJd & { source: string }) | null> {
    try {
      const saved = resolveWorkerInput(job.url, { jdFiles, needsChromeHosts: [], jdSources });
      if (saved.ok && saved.jdPath) return { text: captureText(saved.jdPath), source: "saved capture" };

      const host = hostOf(job.url);
      if (!host) return null;
      if (onHost(host, "himalayas.app")) {
        const jd = await himalayasSearch(job);
        if (jd) saveCapture(job, jd, "read from the Himalayas public search API by pre-triage");
        return jd ? { ...jd, source: "Himalayas search" } : null;
      }
      if (needsChrome.some((listed) => onHost(host, listed))) return null;

      const date = new Date().toISOString().slice(0, 10);
      const captured = await fetchJdCapture(job.url, date);
      if (captured) return { text: captureText(captured), source: "ATS API" };

      const html = await fetchPage(job.url);
      const jd = html ? jdFromHtml(html) : null;
      if (jd) saveCapture(job, jd, "read from the posting page by pre-triage");
      return jd ? { ...jd, source: "posting page" } : null;
    } catch {
      // Network errors, timeouts and odd pages all mean the JD stays unread.
      return null;
    }
  };
}
