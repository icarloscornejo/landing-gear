import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { landingGearRoot } from "@/lib/landing-gear";
import { readJsonObject } from "@/lib/json-body";
import { jdSourceLine, pastedJdMarkdown, sameUrl } from "@/lib/lifecycle.mjs";
import { guardText, integritySection } from "@/lib/core/posting-guard.mjs";

export const runtime = "nodejs";

const MIN_TEXT = 200;
const MAX_TEXT = 80_000;

const slug = (value: string) =>
  value.normalize("NFKD").replace(/[^\x00-\x7F]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "unknown";

// Saves a JD the engineer pasted for a posting the workers could not read, as
// jds/pasted-<company>-<role>-<hash>.md with a "- Source:" line, so every later
// triage or evaluation of that URL (web or chat) reads it instead of the site.
// Pasting again for the same URL replaces the earlier paste.
export async function POST(req: Request) {
  const body = await readJsonObject<{ url?: string; company?: string; role?: string; text?: string }>(req);
  if (!body) return NextResponse.json({ error: "bad json" }, { status: 400 });
  const url = String(body.url ?? "").trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "url must be the posting's http(s) link" }, { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ error: "url must be the posting's http(s) link" }, { status: 400 });
  }
  const text = String(body.text ?? "").trim();
  if (text.length < MIN_TEXT) return NextResponse.json({ error: `Paste the whole job description (at least ${MIN_TEXT} characters).` }, { status: 400 });
  if (text.length > MAX_TEXT) return NextResponse.json({ error: "That is longer than a job description; paste only the posting text." }, { status: 400 });

  const dir = path.join(landingGearRoot(), "jds");
  fs.mkdirSync(dir, { recursive: true });
  // Reuse the file of an earlier paste for this URL rather than adding a second source.
  const earlier = fs
    .readdirSync(dir)
    .filter((file) => file.startsWith("pasted-") && file.endsWith(".md"))
    .find((file) => sameUrl(jdSourceLine(fs.readFileSync(path.join(dir, file), "utf8").slice(0, 1500)), url));
  const file = earlier ?? `pasted-${slug(String(body.company ?? ""))}-${slug(String(body.role ?? ""))}-${createHash("sha256").update(url).digest("hex").slice(0, 8)}.md`;
  // Pasted text is still posting text: invisible characters go, AI-directed lines are reported.
  const guarded = guardText(text);
  const markdown = pastedJdMarkdown({ url, company: String(body.company ?? ""), role: String(body.role ?? ""), text: guarded.text, date: new Date().toLocaleDateString("en-CA") }) + integritySection(guarded.findings);
  const target = path.join(dir, file);
  const temp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temp, markdown);
  fs.renameSync(temp, target);
  return NextResponse.json({ ok: true, file: `jds/${file}`, replaced: Boolean(earlier) });
}
