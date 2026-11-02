/**
 * run-timeline.mjs: lays a run's narration notes and steps out on one timeline
 * for the run detail page. Consecutive tool calls collapse into one row, and a
 * finished run's last note is lifted out as the result.
 */

/**
 * @typedef {{kind: "tool"|"status", label: string, ts: number}} RunStep
 * @typedef {{text: string, ts: number}} RunNote
 * @typedef {{type: "note", text: string, ts: number}
 *   | {type: "tools", tools: {label: string, count: number}[], ts: number}
 *   | {type: "status", label: string, ts: number}} TimelineItem
 */

/**
 * @param {RunStep[]} steps
 * @param {RunNote[]} notes
 * @param {boolean} finished the run is done, so its last note is the result
 * @returns {{items: TimelineItem[], result: string}}
 */
export function buildTimeline(steps, notes, finished) {
  const kept = notes.filter((note) => note.text.trim());
  const result = finished && kept.length ? kept[kept.length - 1].text.trim() : "";
  const timelineNotes = result ? kept.slice(0, -1) : kept;
  // A step and a note with the same timestamp: the step happened first.
  const events = [
    ...steps.map((step) => ({ order: 0, ts: step.ts, step })),
    ...timelineNotes.map((note) => ({ order: 1, ts: note.ts, note })),
  ].sort((a, b) => a.ts - b.ts || a.order - b.order);

  /** @type {TimelineItem[]} */
  const items = [];
  for (const event of events) {
    if ("note" in event) {
      items.push({ type: "note", text: event.note.text.trim(), ts: event.ts });
      continue;
    }
    const { step } = event;
    if (step.kind === "status") {
      items.push({ type: "status", label: step.label, ts: step.ts });
      continue;
    }
    const last = items[items.length - 1];
    if (last?.type !== "tools") {
      items.push({ type: "tools", tools: [{ label: step.label, count: 1 }], ts: step.ts });
      continue;
    }
    const previous = last.tools[last.tools.length - 1];
    if (previous.label === step.label) previous.count += 1;
    else last.tools.push({ label: step.label, count: 1 });
  }
  return { items, result };
}

/**
 * "+8s" / "+2m 05s" from the run start, for the timeline's time column.
 * @param {number} ts
 * @param {number} start
 */
export function elapsedLabel(ts, start) {
  const seconds = Math.max(0, Math.round((ts - start) / 1000));
  if (seconds < 60) return `+${seconds}s`;
  return `+${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
