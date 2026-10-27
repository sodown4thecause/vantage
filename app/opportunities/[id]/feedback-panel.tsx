"use client";

import { useState } from "react";

import { MarkOutcome } from "@/components/mark-outcome";
import { HANDOFF_STATE_LABEL, type HandoffState } from "@/lib/retention/handoff-state";

const FEEDBACK = [
  { event: "useful", label: "Useful" },
  { event: "not_useful", label: "Not useful" },
  { event: "saved", label: "Save for later" },
  { event: "rejected", label: "Not for me" },
] as const;

const FIELD = "w-full rounded-lg border border-contour bg-sheet px-3 py-2 text-ink placeholder:text-ridge";

export function FeedbackPanel({
  workspaceId,
  opportunityId,
  initialState,
}: {
  workspaceId: string;
  opportunityId: string;
  initialState: HandoffState | null;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState("");

  async function send(event: string, label: string, payload: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/outcomes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          opportunityId,
          event,
          payload,
          idempotencyKey: `${opportunityId}:${event}:${crypto.randomUUID()}`,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to record that");
        return;
      }
      setMessage(`Saved: ${label}.`);
    } catch {
      setError("Failed to record that");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="feedback-heading" className="space-y-6 border-t border-contour pt-8">
      <h2 id="feedback-heading" className="display text-2xl">After you reply</h2>

      <div className="space-y-2">
        <p className="text-sm font-medium">What happened? You tell Vantage; it cannot see the thread.</p>
        {initialState ? <p className="text-sm text-ridge">{HANDOFF_STATE_LABEL[initialState]}.</p> : null}
        <MarkOutcome workspaceId={workspaceId} opportunityId={opportunityId} state={initialState} />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Was this conversation worth your time?</p>
        <div className="flex flex-wrap gap-2">
          {FEEDBACK.map((a) => (
            <button key={a.event} type="button" disabled={busy} onClick={() => void send(a.event, a.label)} className="btn btn-quiet disabled:opacity-50">
              {a.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium" htmlFor="puburl">Link to your reply (optional)</label>
        <p className="text-sm text-ridge">Add it any time, now or later, so you can find it again.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="puburl"
            type="url"
            inputMode="url"
            className={FIELD}
            value={publishedUrl}
            onChange={(e) => setPublishedUrl(e.target.value)}
            placeholder="https://…"
          />
          <button
            type="button"
            disabled={busy || !publishedUrl.trim()}
            onClick={() => void send("published_url", "link to your reply", { url: publishedUrl.trim() })}
            className="btn justify-center disabled:opacity-50"
          >
            Save link
          </button>
        </div>
      </div>

      {message ? <p className="text-sm text-sage" role="status">{message}</p> : null}
      {error ? <p className="text-sm text-stop" role="alert">{error}</p> : null}
    </section>
  );
}
