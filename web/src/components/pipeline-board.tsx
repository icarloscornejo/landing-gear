"use client";

import { useState, type DragEvent, type ReactNode } from "react";
import Link from "next/link";
import { GripVertical, Loader2 } from "lucide-react";
import type { Application } from "@/lib/career-ops";
import { cn } from "@/lib/cn";
import { companyPresentation } from "@/lib/company-presentation.mjs";
import { canonStatus } from "@/lib/status-alias.mjs";
import {
  DATED_PHASES,
  EXIT_KINDS,
  currentPhase,
  exitOutcome,
  isOpenApplied,
  nextPhases,
  nextRound,
  outcomeText,
  phaseInfo,
  phaseLabel,
  type ExitKind,
  type PhaseKey,
  type PhaseLogRow,
} from "@/lib/lifecycle.mjs";
import { useLifecyclePost } from "@/lib/use-lifecycle-post";
import { EXIT_LABELS, LifecycleActions } from "@/components/lifecycle-actions";
import { InterviewDate } from "@/components/interview-date";

// The open hiring phases as columns, then Closed (house rule 25). Hired rows sit
// in Offer, as in the tabs. Idea from AienTech/dossier, written for this model.
const COLUMNS: PhaseKey[] = ["applied", "replied", "screening", "assessment", "tech", "manager", "final", "offer"];
type Target = PhaseKey | "closed";

/** What a drop asks before writing: another round, or how the process ended. */
type Prompt = { n: string; kind: "round" | "exit" } | null;

const isHired = (row: Application) => canonStatus(String(row.status ?? "").trim()) === "HIRED";

/**
 * Drag a card to a later column to move it there, the same /api/stage write the
 * card buttons make. Its own column asks for another round, Closed asks how it
 * ended; both write nothing until confirmed. Every move is also in the card's
 * Move menu, since HTML5 drag does not work on touch screens.
 */
export function PipelineBoard({ rows, statusLog, detailQuery }: { rows: Application[]; statusLog: PhaseLogRow[]; detailQuery: string }) {
  const [dragging, setDragging] = useState<Application | null>(null);
  const [over, setOver] = useState<Target | null>(null);
  const [prompt, setPrompt] = useState<Prompt>(null);
  // A card just moved into a dated phase offers its date field, drawn for the new round.
  const [justMoved, setJustMoved] = useState<{ n: string; phase: string; round: number } | null>(null);
  const { busy, error, post } = useLifecyclePost();

  const open = new Map<PhaseKey, Application[]>(COLUMNS.map((key) => [key, []]));
  const closed: Application[] = [];
  for (const row of rows) {
    if (isOpenApplied(row) || isHired(row)) {
      const phase = currentPhase(row)?.phase;
      open.get(phase === "hired" ? "offer" : (phase as PhaseKey))?.push(row);
    } else if (exitOutcome(row, statusLog)?.phase) {
      closed.push(row);
    }
  }
  closed.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));

  const accepts = (row: Application, target: Target) => {
    if (!isOpenApplied(row)) return false;
    if (target === "closed") return true;
    return nextPhases(row).includes(target);
  };

  const expectedOf = (row: Application) => {
    const phase = currentPhase(row);
    return phase ? { phase: phase.phase, round: phase.round } : undefined;
  };

  const move = async (row: Application, phase: PhaseKey) => {
    const result = await post(`move-${row.n}`, "/api/stage", { n: row.n, phase, expected: expectedOf(row) });
    setPrompt(null);
    if (result && (DATED_PHASES as readonly string[]).includes(phase) && result.phase && typeof result.round === "number") {
      setJustMoved({ n: row.n, phase: result.phase, round: result.round });
    }
  };

  const exit = async (row: Application, kind: ExitKind) => {
    if (await post(`exit-${row.n}`, "/api/exit", { n: row.n, kind, expected: expectedOf(row) })) setPrompt(null);
  };

  const drop = (target: Target) => {
    const row = dragging;
    setDragging(null);
    setOver(null);
    if (!row || !accepts(row, target)) return;
    const phase = currentPhase(row)?.phase;
    if (target === "closed") setPrompt({ n: row.n, kind: "exit" });
    else if (target === phase) setPrompt({ n: row.n, kind: "round" });
    else void move(row, target);
  };

  const zone = (target: Target) => ({
    onDragOver: (event: DragEvent) => {
      if (!dragging || !accepts(dragging, target)) return;
      event.preventDefault();
      if (over !== target) setOver(target);
    },
    onDragLeave: () => setOver((current) => (current === target ? null : current)),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      drop(target);
    },
  });

  const card = (row: Application) => {
    const phase = currentPhase(row);
    const movable = isOpenApplied(row);
    const href = `/pipeline/${encodeURIComponent(row.n)}${detailQuery ? `?${detailQuery}` : ""}`;
    const asking = prompt?.n === row.n ? prompt.kind : null;
    const moved = justMoved?.n === row.n ? justMoved : null;
    return (
      <li
        key={row.n}
        draggable={movable && !busy}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", row.n);
          setDragging(row);
          setPrompt(null);
        }}
        onDragEnd={() => {
          setDragging(null);
          setOver(null);
        }}
        className={cn(
          "rounded-xl border border-border bg-surface/60 p-3 text-sm shadow-sm",
          movable && "cursor-grab active:cursor-grabbing",
          dragging?.n === row.n && "opacity-40",
        )}
      >
        <div className="flex items-start gap-1.5">
          {movable && <GripVertical aria-hidden className="mt-0.5 size-3.5 shrink-0 text-faint" />}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-muted">{companyPresentation(row).label}</p>
            <Link href={href} draggable={false} className="line-clamp-2 font-medium text-foreground hover:text-brand">
              {row.role}
            </Link>
            <p className="mt-1 text-xs text-faint">
              #{row.n} · {movable || isHired(row) ? (isHired(row) ? "Hired" : phase ? phaseLabel(phase.phase, phase.round) : "") : outcomeText(row, statusLog)}
            </p>
          </div>
          {busy === `move-${row.n}` || busy === `exit-${row.n}` ? <Loader2 className="size-3.5 animate-spin text-muted" /> : null}
        </div>

        {movable && (
          <InterviewDate
            key={moved ? `${moved.phase}-${moved.round}` : "current"}
            app={row}
            expected={moved ? { phase: moved.phase, round: moved.round } : undefined}
            startOpen={!!moved}
            onDone={() => setJustMoved(null)}
            className="mt-2"
          />
        )}

        {asking === "round" && phase && (
          <Confirm>
            <span className="text-xs text-foreground">Add {phaseLabel(phase.phase, nextRound(row, phase.phase))}?</span>
            <BoardButton tone="brand" disabled={!!busy} onClick={() => void move(row, phase.phase)}>Yes</BoardButton>
            <BoardButton disabled={!!busy} onClick={() => setPrompt(null)}>Cancel</BoardButton>
          </Confirm>
        )}
        {asking === "exit" && (
          <Confirm>
            <span className="w-full text-xs text-foreground">How did it end?</span>
            {(Object.keys(EXIT_KINDS) as ExitKind[]).map((kind) => (
              <BoardButton key={kind} tone="danger" disabled={!!busy} onClick={() => void exit(row, kind)}>{EXIT_LABELS[kind]}</BoardButton>
            ))}
            <BoardButton disabled={!!busy} onClick={() => setPrompt(null)}>Cancel</BoardButton>
          </Confirm>
        )}

        {movable && (
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer select-none text-muted hover:text-foreground">Move</summary>
            <LifecycleActions app={row} compact className="mt-1.5" />
          </details>
        )}
      </li>
    );
  };

  const column = (target: Target, title: string, cards: Application[]) => {
    const allowed = !!dragging && accepts(dragging, target);
    return (
      <section
        key={target}
        aria-label={`${title}, ${cards.length}`}
        {...zone(target)}
        className={cn(
          "flex max-h-[75vh] w-64 flex-none flex-col rounded-2xl border p-2 transition-colors",
          over === target ? "border-brand bg-brand/10" : allowed ? "border-dashed border-brand/50 bg-surface/30" : "border-border bg-surface/20",
          dragging && !allowed && "opacity-60",
        )}
      >
        <h2 className="flex items-center justify-between px-1.5 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted">
          {title} <span className="tabular-nums text-faint">{cards.length}</span>
        </h2>
        {cards.length ? (
          <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">{cards.map(card)}</ul>
        ) : (
          <p className="px-2 py-6 text-center text-xs text-faint">Nothing here</p>
        )}
      </section>
    );
  };

  return (
    <div className="mt-4">
      {error && <p role="alert" className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="overflow-x-auto pb-3">
        <div className="flex w-max items-start gap-3">
          {COLUMNS.map((key) => column(key, phaseInfo(key).label, open.get(key) ?? []))}
          {column("closed", "Closed", closed)}
        </div>
      </div>
    </div>
  );
}

function Confirm({ children }: { children: ReactNode }) {
  return <div className="mt-2 flex flex-wrap items-center gap-1 rounded-lg border border-border bg-background/60 p-2">{children}</div>;
}

function BoardButton({ tone, disabled, onClick, children }: { tone?: "brand" | "danger"; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-md px-2 py-1 text-xs font-medium transition disabled:opacity-60",
        tone === "brand" && "border border-brand/40 text-brand hover:bg-brand/10",
        tone === "danger" && "border border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-400",
        !tone && "text-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
