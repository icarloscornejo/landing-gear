import { listLiveRuns } from "@/lib/live-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Recent server-owned runs (lib/live-runs.ts) as summaries, newest first. Every
// browser polls this, so runs a chat session started show up in Workers too.
export async function GET() {
  return Response.json({ runs: listLiveRuns() });
}
