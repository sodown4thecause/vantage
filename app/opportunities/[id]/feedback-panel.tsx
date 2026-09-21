"use client";

import { useState } from "react";

const ACTIONS = [
  { event: "useful", label: "Useful" },
  { event: "not_useful", label: "Not useful" },
  { event: "saved", label: "Saved" },
  { event: "rejected", label: "Rejected" },
  { event: "acted_on", label: "Acted on" },
] as const;

export function FeedbackPanel({
  workspaceId,
  opportunityId,
}: {
  workspaceId: string;
  opportunityId: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState("");

  async function send(event: string, payload: Record<string, unknown> = {}) {
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
          idempotencyKey: `${opportunityId}:${event}:${Date.now()}`,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to record outcome");
        return;
      }
      setMessage(`Recorded “${event}”.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-sm font-semibold">Feedback &amp; outcomes</h2>
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map((a) => (
          <button
            key={a.event}
            type="button"
            disabled={busy}
            onClick={() => void send(a.event)}
            className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {a.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1">
          <label className="text-xs text-zinc-500" htmlFor="puburl">
            Published URL (optional correction via new event)
          </label>
          <input
            id="puburl"
            className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            value={publishedUrl}
            onChange={(e) => setPublishedUrl(e.target.value)}
            placeholder="https://…"
          />
        </div>
        <button
          type="button"
          disabled={busy || !publishedUrl.trim()}
          onClick={() =>
            void send("published_url", { url: publishedUrl.trim() })
          }
          className="rounded-full bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950"
        >
          Record URL
        </button>
      </div>
      {message ? <p className="text-xs text-emerald-700">{message}</p> : null}
      {error ? (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
