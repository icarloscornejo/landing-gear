export type SankeyApp = { n: string | number; status: string; notes?: string };
export type SankeyLogRow = { num: number; from: string; to: string };
export type SankeyNode = {
  id: string;
  label: string;
  rank: number;
  tone: string;
  value: number;
  /** Tooltip text, e.g. the rejected / ghosted breakdown of an "Out" node. */
  detail?: string;
};
export type SankeyLink = { source: string; target: string; value: number };
export type SankeyGraph = { nodes: SankeyNode[]; links: SankeyLink[]; total: number };
export type SankeyLayoutOpts = {
  width?: number;
  height?: number;
  padding?: { top: number; right: number; bottom: number; left: number };
  nodeWidth?: number;
  nodeGap?: number;
};
export type LaidSankeyNode = SankeyNode & { x: number; y: number; width: number; height: number };
export type LaidSankeyLink = SankeyLink & { d: string; thickness: number };

export const NODE_DEFS: Omit<SankeyNode, "value">[];
export const SANKEY_COLUMN_WIDTH: number;

export function statusToken(raw: string): string;
export function parseStatusLog(
  tsv: string,
): Array<{ num: number; date: string; from: string; to: string; source: string; note: string }>;
export function buildPipelineSankey(apps: SankeyApp[], log?: SankeyLogRow[]): SankeyGraph;
export function sankeyWidth(graph: { nodes: SankeyNode[] }, padding: { left: number; right: number }): number;
export function layoutSankey(
  graph: Pick<SankeyGraph, "nodes" | "links">,
  opts?: SankeyLayoutOpts,
): { nodes: LaidSankeyNode[]; links: LaidSankeyLink[]; width: number; height: number; scale: number };
