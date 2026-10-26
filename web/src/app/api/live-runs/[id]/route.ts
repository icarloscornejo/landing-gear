import { getLiveRun } from "@/lib/live-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One server-owned run with its step log and text tail, for /jobs/<id>.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getLiveRun(id);
  return run ? Response.json({ run }) : Response.json({ error: "run not found" }, { status: 404 });
}
