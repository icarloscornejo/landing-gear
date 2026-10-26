import { NextResponse } from "next/server";
import { dailyScanStatus, runDailyScan } from "@/lib/daily-scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Status of the zero-token portal scan, and "Run scan now" from Today.
export async function GET() {
  return NextResponse.json(dailyScanStatus());
}

export async function POST() {
  if (!runDailyScan()) {
    const status = dailyScanStatus();
    return NextResponse.json({ error: status.running ? "A scan is already running" : "Scan script not found", ...status }, { status: 409 });
  }
  return NextResponse.json(dailyScanStatus());
}
