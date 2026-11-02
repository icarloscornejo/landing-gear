import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, isRegularContainedFile } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A plain jds/<name>.md file only: no directories, no "..", no other extension.
const JD_NAME = /^(?!.*\.\.)[A-Za-z0-9._-]+\.md$/;

/** GET /api/jd?file=<name>.md: a saved capture as plain text, so a card without a posting link can show its JD. */
export async function GET(req: Request) {
  const file = new URL(req.url).searchParams.get("file") ?? "";
  if (!JD_NAME.test(file)) return new Response("bad file name", { status: 400 });
  const jdDir = path.join(careerOpsRoot(), "jds");
  const full = path.join(jdDir, file);
  if (!isRegularContainedFile(full, jdDir)) return new Response("not found", { status: 404 });
  // Posting text is untrusted: served as plain text, never rendered as HTML.
  return new Response(fs.readFileSync(full, "utf8"), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" },
  });
}
