"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type LifecycleResult = {
  ok?: boolean;
  error?: string;
  warnings?: string[];
  warning?: string;
  steps?: { outcome?: { ok: boolean } };
  phase?: string;
  round?: number;
  at?: string | null;
};

// One write path for every lifecycle control (the card buttons, the board, the
// date field): a double-submit guard, the server's error text, a refresh on
// success, and `onDone` after every answer so client-loaded pages refetch.
export function useLifecyclePost(onDone?: () => void) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [needsCvRetry, setNeedsCvRetry] = useState(false);
  const submitting = useRef(false);

  /** Resolves to the server's answer on success, null otherwise (the error is set). */
  const post = async (kind: string, url: string, payload: Record<string, unknown>): Promise<LifecycleResult | null> => {
    if (submitting.current) return null;
    submitting.current = true;
    setBusy(kind);
    setError(null);
    let cvLogFailed = false;
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = (await response.json().catch(() => null)) as LifecycleResult | null;
      if (!response.ok || !result?.ok) {
        setError(result?.error ?? "Could not save the change. Check the pipeline and retry.");
        return null;
      }
      cvLogFailed = result.steps?.outcome?.ok === false;
      setNeedsCvRetry(cvLogFailed);
      setNote(result.warnings?.join(" ") ?? result.warning ?? null);
      router.refresh();
      return result;
    } catch {
      setError("Could not confirm the change. Check your connection, then retry.");
      return null;
    } finally {
      submitting.current = false;
      setBusy("");
      if (!cvLogFailed) onDone?.();
    }
  };

  return { busy, error, setError, note, needsCvRetry, post };
}
