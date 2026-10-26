// Runs once when the Next server starts.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startDailyScan } = await import("@/lib/daily-scan");
  startDailyScan();
}
