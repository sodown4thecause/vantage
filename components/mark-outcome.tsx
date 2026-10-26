"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { HandoffState } from "@/lib/retention/handoff-state";

const MARKS = [
  { event: "sent", label: "Mark sent", done: ["sent", "replied"] },
  { event: "replied", label: "Mark replied", done: ["replied"] },
] as const;

export function MarkOutcome({
  workspaceId,
  opportunityId,
  state,
}: {
  workspaceId: string;
  opportunityId: string;
  state: HandoffState | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mark(event: "sent" | "replied") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/outcomes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, opportunityId, event, idempotencyKey: `${opportunityId}:${event}` }),
      });
      if (!res.ok) {
        setError("Could not save that. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not save that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {MARKS.filter((option) => !(option.done as readonly string[]).includes(state ?? "")).map((option) => (
        <button key={option.event} type="button" disabled={busy} onClick={() => void mark(option.event)} className="btn btn-quiet disabled:opacity-50">
          {option.label}
        </button>
      ))}
      {error ? <p className="text-sm text-stop" role="alert">{error}</p> : null}
    </div>
  );
}
