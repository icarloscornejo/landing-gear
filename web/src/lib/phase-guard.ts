// Shared by /api/stage and /api/exit: the client sends the phase and round its
// buttons were drawn for. When the row has moved since (another tab, a replayed
// click after a timeout), the write is refused instead of adding a round or an
// exit at a phase Carlos never saw.

/** An error message when the row's current phase is not what the client saw, else null. */
export function expectedMismatch(
  current: { phase: string; round: number } | null,
  expected: { phase?: string; round?: number } | undefined,
): string | null {
  if (!expected || typeof expected.phase !== "string" || typeof expected.round !== "number") {
    return "Missing the phase this button was drawn for; reload the page.";
  }
  if (!current || current.phase !== expected.phase || current.round !== expected.round) {
    return "This row changed since the page loaded; reload and try again.";
  }
  return null;
}
