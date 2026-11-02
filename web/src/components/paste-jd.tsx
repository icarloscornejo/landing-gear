"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

// Paste a job description the workers could not read. It is saved to jds/ with
// the posting's URL as its Source, and every later triage or evaluation of that
// URL (web or chat) reads it instead of the site. `onSaved(rerun)` runs after a
// successful save; `rerun` is true for "Save & re-run".
export function PasteJd({
  url,
  company,
  role,
  actionLabel,
  onSaved,
  onCancel,
}: {
  url: string;
  company: string;
  role: string;
  actionLabel: string;
  onSaved: (rerun: boolean) => void;
  onCancel?: () => void;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (rerun: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/jd-paste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, company, role, text }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "Could not save the job description.");
        return;
      }
      setText("");
      onSaved(rerun);
    } catch {
      setError("Could not save the job description. Check the connection and retry.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-border bg-background/60 p-3">
      <label htmlFor={`paste-${url}`} className="block text-xs text-muted">
        Paste the whole job description. It is saved to jds/ and used for every triage or evaluation of this posting.
      </label>
      <textarea
        id={`paste-${url}`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={8}
        className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-brand/50"
      />
      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={saving} onClick={() => void save(true)} className="inline-flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-brand-foreground disabled:opacity-60 max-sm:min-h-[44px]">
          {saving && <Loader2 className="size-3.5 animate-spin" />} {actionLabel}
        </button>
        <button type="button" disabled={saving} onClick={() => void save(false)} className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted hover:text-foreground disabled:opacity-60 max-sm:min-h-[44px]">
          Save only
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="text-xs text-muted hover:text-foreground max-sm:min-h-[44px]">Cancel</button>}
      </div>
    </div>
  );
}
