/**
 * Pipeline Sankey graph + layout (pure, no fs).
 *
 * A chained funnel over the hiring phases each row actually went through
 * (lifecycle.mjs phasePath, house rule 25): Tracked -> Submitted -> Replied ->
 * Screening -> Assessment -> Tech interview -> Hiring manager -> Final interview
 * -> Offer -> Hired. A row's ribbon goes from one phase of its path to the next,
 * so a skipped phase is crossed, not counted. A closed row leaves through
 * "Out at <phase>" (rejected, withdrew, ghosted, posting closed); an open row
 * simply stops at its phase, so a node is taller than its outgoing ribbons by
 * the rows still in it (the tooltip counts them). Counts match the pipeline
 * tabs and the Closed tab, which read the same helpers.
 *
 * Status folding goes through canonStatus (status-alias.mjs), the same map
 * Analytics stage bars and cumulative tiles use.
 */

import { canonStatus } from "./status-alias.mjs";
import { PHASES, exitOutcome, phaseInfo, phasePath } from "./lifecycle.mjs";

/** @typedef {{ n: string|number, status: string, notes?: string }} SankeyApp */
/** @typedef {{ num: number, from: string, to: string }} SankeyLogRow */
/** @typedef {{ id: string, label: string, rank: number, tone: string, value: number, detail?: string }} SankeyNode */
/** @typedef {{ source: string, target: string, value: number }} SankeyLink */

// The fixed nodes before the hiring phases. Phase, "active" and "out" nodes
// are built per phase below.
export const NODE_DEFS = [
  { id: "tracked", label: "Tracked", rank: 0, tone: "neutral" },
  { id: "skip", label: "SKIP", rank: 1, tone: "danger" },
  { id: "evaluated", label: "Still evaluated", rank: 1, tone: "muted" },
  { id: "discardedEarly", label: "Discarded before applying", rank: 1, tone: "muted" },
];

/** Phase key -> column. Applied is the "Submitted" column right after Tracked. */
const RANK = Object.fromEntries(PHASES.map((phase, index) => [phase.key, index + 1]));
const PHASE_TONE = { applied: "info", replied: "info", screening: "info", assessment: "info", tech: "success", manager: "success", final: "success", offer: "success", hired: "success" };
const OUT_WORDS = { rejected: "rejected", withdrawn: "withdrew", ghosted: "ghosted", closed: "posting closed", repeated: "repeated", discarded: "discarded" };

/**
 * Canonical status token via the shared alias table.
 * Trailing dates come off first (states.yml forbids them; real trackers
 * still carry "Interview 2026-08-20") so canonStatus sees an exact key,
 * same strip awaiting.mjs uses before folding.
 * @param {string} raw
 * @returns {string}
 */
export function statusToken(raw) {
  const base = String(raw ?? "")
    .replace(/\s+\d{4}-\d{2}-\d{2}\s*$/, "")
    .trim();
  const c = canonStatus(base);
  // Pass-through uppercases the raw input, so markdown bold that foldStatus
  // already stripped for alias lookup can survive on English stage names
  // ("**Rejected**" becomes "**REJECTED**"). Leaf equality needs a clean token;
  // Analytics stage bars use .includes() and tolerate the bold.
  const cleaned = c.replace(/\*\*/g, "").trim();
  return cleaned.split(/[\s/]/)[0] || "EVALUATED";
}

/**
 * Parse data/status-log.tsv. Skips a header row (non-numeric col 0).
 * @param {string} tsv
 * @returns {Array<{num: number, date: string, from: string, to: string, source: string, note: string}>}
 */
export function parseStatusLog(tsv) {
  const rows = [];
  for (const line of String(tsv ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line.split("\t");
    if (!/^\d+$/.test(cols[0] ?? "")) continue;
    rows.push({
      num: Number(cols[0]),
      date: cols[1] ?? "",
      from: cols[2] ?? "",
      to: cols[3] ?? "",
      source: cols[4] ?? "",
      note: cols[5] ?? "",
    });
  }
  return rows;
}

/**
 * @param {SankeyApp[]} apps
 * @param {SankeyLogRow[]} [log]
 * @returns {{ nodes: SankeyNode[], links: SankeyLink[], total: number }}
 */
export function buildPipelineSankey(apps, log = []) {
  const rows = Array.isArray(apps) ? apps : [];
  const ledger = Array.isArray(log) ? log : [];
  /** @type {Map<string, number>} */
  const flows = new Map();
  /** @type {Map<string, Record<string, number>>} why rows left at each phase */
  const outKinds = new Map();
  /** @type {Map<string, number>} open rows whose last phase is this one */
  const stillHere = new Map();
  const add = (source, target) => flows.set(`${source}>${target}`, (flows.get(`${source}>${target}`) ?? 0) + 1);

  for (const app of rows) {
    const status = statusToken(app.status);
    if (status === "SKIP") {
      add("tracked", "skip");
      continue;
    }
    const path = phasePath(app, ledger);
    if (!path.length) {
      add("tracked", status === "EVALUATED" ? "evaluated" : "discardedEarly");
      continue;
    }
    add("tracked", path[0]);
    for (let index = 1; index < path.length; index += 1) add(path[index - 1], path[index]);
    const last = path[path.length - 1];
    if (last === "hired") continue;
    const outcome = exitOutcome(app, ledger);
    if (!outcome) {
      // Still open here: no ribbon leaves the node, the tooltip counts it.
      stillHere.set(last, (stillHere.get(last) ?? 0) + 1);
      continue;
    }
    add(last, `out:${last}`);
    const kinds = outKinds.get(last) ?? {};
    kinds[outcome.kind] = (kinds[outcome.kind] ?? 0) + 1;
    outKinds.set(last, kinds);
  }

  const links = [...flows].map(([key, value]) => {
    const [source, target] = key.split(">");
    return { source, target, value };
  });
  const inflow = (id) => links.filter((link) => link.target === id).reduce((sum, link) => sum + link.value, 0);

  /** @type {SankeyNode[]} */
  const nodes = [{ ...NODE_DEFS[0], value: rows.length }, ...NODE_DEFS.slice(1).map((def) => ({ ...def, value: inflow(def.id) }))];
  for (const phase of PHASES) {
    const rank = RANK[phase.key];
    const reached = inflow(phase.key);
    const label = phase.key === "applied" ? "Submitted" : phase.label;
    nodes.push({
      id: phase.key,
      label,
      rank,
      tone: PHASE_TONE[phase.key],
      value: reached,
      // The rows still in this phase have no ribbon out; the tooltip counts them.
      detail: `${label}: ${reached} reached, ${stillHere.get(phase.key) ?? 0} still here`,
    });
    const kinds = outKinds.get(phase.key) ?? {};
    const out = inflow(`out:${phase.key}`);
    nodes.push({
      id: `out:${phase.key}`,
      label: `Out at ${phaseInfo(phase.key).label}`,
      rank: rank + 1,
      tone: "danger",
      value: out,
      detail: `Out at ${phaseInfo(phase.key).label}: ${Object.entries(kinds).map(([kind, count]) => `${count} ${OUT_WORDS[kind] ?? kind}`).join(", ")}`,
    });
  }
  const live = nodes.filter((node) => node.value > 0);
  const liveIds = new Set(live.map((node) => node.id));
  return { nodes: live, links: links.filter((link) => liveIds.has(link.source) && liveIds.has(link.target)), total: rows.length };
}

/**
 * Horizontal Sankey positions + ribbon paths. Empty nodes already dropped.
 * Nodes stack inside a column in the order the graph lists them.
 * @param {{ nodes: SankeyNode[], links: SankeyLink[] }} graph
 * @param {{ width?: number, height?: number, padding?: { top: number, right: number, bottom: number, left: number }, nodeWidth?: number, nodeGap?: number }} [opts]
 */
export function layoutSankey(graph, opts = {}) {
  const width = opts.width ?? 920;
  const height = opts.height ?? 420;
  const padding = opts.padding ?? { top: 20, right: 168, bottom: 20, left: 96 };
  const nodeWidth = opts.nodeWidth ?? 18;
  const nodeGap = opts.nodeGap ?? 14;

  const nodes = Array.isArray(graph?.nodes) ? graph.nodes.filter((n) => n.value > 0) : [];
  const links = Array.isArray(graph?.links) ? graph.links.filter((l) => l.value > 0) : [];
  if (nodes.length === 0) {
    return { nodes: [], links: [], width, height, scale: 0 };
  }

  const ranks = [...new Set(nodes.map((n) => n.rank))].sort((a, b) => a - b);
  const innerW = Math.max(1, width - padding.left - padding.right - nodeWidth);
  const innerH = Math.max(1, height - padding.top - padding.bottom);
  const rankGap = ranks.length > 1 ? innerW / (ranks.length - 1) : 0;

  let scale = Infinity;
  for (const r of ranks) {
    const group = nodes.filter((n) => n.rank === r);
    const sum = group.reduce((s, n) => s + n.value, 0);
    const gaps = Math.max(0, group.length - 1) * nodeGap;
    if (sum > 0) scale = Math.min(scale, (innerH - gaps) / sum);
  }
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;

  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const positioned = [];
  const byId = new Map();
  for (const r of ranks) {
    const group = nodes.filter((n) => n.rank === r).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    const totalH = group.reduce((s, n) => s + n.value * scale, 0) + Math.max(0, group.length - 1) * nodeGap;
    let y = padding.top + Math.max(0, innerH - totalH) / 2;
    const x = padding.left + ranks.indexOf(r) * rankGap;
    for (const n of group) {
      const h = n.value * scale;
      const node = { ...n, x, y, width: nodeWidth, height: h };
      positioned.push(node);
      byId.set(n.id, node);
      y += h + nodeGap;
    }
  }

  const srcUsed = new Map(positioned.map((n) => [n.id, 0]));
  const tgtUsed = new Map(positioned.map((n) => [n.id, 0]));
  const ordered = [...links].sort((a, b) => {
    const sa = byId.get(a.source);
    const sb = byId.get(b.source);
    const ta = byId.get(a.target);
    const tb = byId.get(b.target);
    return (sa?.y ?? 0) - (sb?.y ?? 0) || (ta?.y ?? 0) - (tb?.y ?? 0);
  });

  const laidLinks = [];
  for (const l of ordered) {
    const s = byId.get(l.source);
    const t = byId.get(l.target);
    if (!s || !t) continue;
    const thick = l.value * scale;
    const sy0 = s.y + (srcUsed.get(s.id) ?? 0);
    const ty0 = t.y + (tgtUsed.get(t.id) ?? 0);
    srcUsed.set(s.id, (srcUsed.get(s.id) ?? 0) + thick);
    tgtUsed.set(t.id, (tgtUsed.get(t.id) ?? 0) + thick);
    const x0 = s.x + s.width;
    const x1 = t.x;
    const mx = (x0 + x1) / 2;
    const sy1 = sy0 + thick;
    const ty1 = ty0 + thick;
    const d = `M${x0},${sy0} C${mx},${sy0} ${mx},${ty0} ${x1},${ty0} L${x1},${ty1} C${mx},${ty1} ${mx},${sy1} ${x0},${sy1} Z`;
    laidLinks.push({ ...l, d, thickness: thick });
  }

  return { nodes: positioned, links: laidLinks, width, height, scale };
}

/** Columns get at least this much room, so side labels never overlap the next column. */
export const SANKEY_COLUMN_WIDTH = 200;

/**
 * The chart width for a graph: one column per rank in use, at least 920.
 * @param {{ nodes: SankeyNode[] }} graph
 * @param {{ left: number, right: number }} padding
 */
export function sankeyWidth(graph, padding) {
  const columns = new Set((graph?.nodes ?? []).map((n) => n.rank)).size;
  return Math.max(920, Math.max(0, columns - 1) * SANKEY_COLUMN_WIDTH + padding.left + padding.right);
}
