import { NextResponse } from "next/server";
import { landingGearRoot } from "@/lib/landing-gear";
import { readJsonObject } from "@/lib/json-body";
import { writeRunLog } from "@/lib/run-log.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  id?: string;
  title?: string;
  subtitle?: string;
  page?: string;
  input?: string;
  result?: { score: number | null; summary: string };
  steps?: { kind: string; label: string }[];
  output?: string;
};

// Persist a finished worker's log as markdown under a web-managed dir so the CLI
// assistant can read past runs ("what did we find on that Anthropic role?").
export async function POST(req: Request) {
  const b = await readJsonObject<Body>(req);
  if (!b) return NextResponse.json({ error: "bad json" }, { status: 400 });
  if (!String(b.id ?? "").replace(/[^a-z0-9_-]/gi, "")) return NextResponse.json({ error: "id required" }, { status: 400 });
  return writeRunLog(landingGearRoot(), b)
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "write failed" }, { status: 500 });
}
