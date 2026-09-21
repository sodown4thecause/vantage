"use client";

import { useEffect, useState } from "react";

type Draft = {
  id: string;
  originalText: string;
  editedText: string;
  citations: Array<{ label: string; url: string; documentId?: string }>;
  flags: Array<{ claim: string; reason: string }>;
  approvedAt: string | null;
};

export function DraftPanel({
  workspaceId,
  opportunityId,
}: {
  workspaceId: string;
  opportunityId: string;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [edited, setEdited] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(
        `/api/drafts?workspaceId=${encodeURIComponent(workspaceId)}&opportunityId=${encodeURIComponent(opportunityId)}`,
      );
      const data = (await res.json().catch(() => ({}))) as {
        draft?: Draft | null;
        error?: string;
      };
      if (cancelled) return;
      if (!res.ok) {
        setError(data.error ?? "Failed to load draft");
        return;
      }
      if (data.draft) {
        setDraft(data.draft);
        setEdited(data.draft.editedText);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, opportunityId]);

  async function createDraft() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          workspaceId,
          opportunityId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        draft?: Draft;
        error?: string;
      };
      if (!res.ok || !data.draft) {
        setError(data.error ?? "Create failed");
        return;
      }
      setDraft(data.draft);
      setEdited(data.draft.editedText);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "update",
          workspaceId,
          draftId: draft.id,
          editedText: edited,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        draft?: Draft;
        error?: string;
      };
      if (!res.ok || !data.draft) {
        setError(data.error ?? "Save failed");
        return;
      }
      setDraft(data.draft);
      setEdited(data.draft.editedText);
    } finally {
      setBusy(false);
    }
  }

  async function approveAndCopy() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const saveRes = await fetch("/api/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "update",
          workspaceId,
          draftId: draft.id,
          editedText: edited,
        }),
      });
      const saved = (await saveRes.json().catch(() => ({}))) as {
        draft?: Draft;
        error?: string;
      };
      if (!saveRes.ok || !saved.draft) {
        setError(saved.error ?? "Save failed");
        return;
      }
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          workspaceId,
          draftId: saved.draft.id,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        draft?: Draft;
        error?: string;
      };
      if (!res.ok || !data.draft) {
        setError(data.error ?? "Approve failed");
        return;
      }
      setDraft(data.draft);
      setEdited(data.draft.editedText);
      await navigator.clipboard.writeText(data.draft.editedText);
      setCopied(true);
    } finally {
      setBusy(false);
    }
  }

  function openConversation() {
    if (!draft?.approvedAt) {
      setError("Approve & copy before opening the conversation handoff.");
      return;
    }
    const first = draft.citations[0]?.url;
    if (first) {
      window.open(first, "_blank", "noopener,noreferrer");
    } else {
      setError("No conversation URL available in citations.");
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Grounded reply</h2>
        {!draft ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void createDraft()}
            className="rounded-full bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white dark:bg-zinc-50 dark:text-zinc-950"
          >
            Generate draft
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {draft ? (
        <>
          <div>
            <p className="text-xs font-medium text-zinc-500">Original</p>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-xs dark:bg-zinc-900">
              {draft.originalText}
            </pre>
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-500" htmlFor="edited">
              Editable
            </label>
            <textarea
              id="edited"
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white p-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              rows={10}
              value={edited}
              onChange={(e) => setEdited(e.target.value)}
            />
          </div>
          {draft.flags.length > 0 ? (
            <ul className="text-xs text-amber-800 dark:text-amber-200">
              {draft.flags.map((f) => (
                <li key={f.claim}>
                  Flagged “{f.claim}”: {f.reason}
                </li>
              ))}
            </ul>
          ) : null}
          <div>
            <p className="text-xs font-medium text-zinc-500">Citations</p>
            <ul className="mt-1 space-y-1 text-xs">
              {draft.citations.map((c) => (
                <li key={c.url}>
                  <a href={c.url} className="underline" target="_blank" rel="noreferrer">
                    {c.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveEdit()}
              className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium"
            >
              Save edits
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void approveAndCopy()}
              className="rounded-full bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white dark:bg-zinc-50 dark:text-zinc-950"
            >
              Approve &amp; copy
            </button>
            <button
              type="button"
              disabled={busy || !draft.approvedAt}
              onClick={openConversation}
              className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              Open conversation
            </button>
          </div>
          {copied ? (
            <p className="text-xs text-emerald-700">Copied to clipboard.</p>
          ) : null}
          {draft.approvedAt ? (
            <p className="text-xs text-zinc-500">
              Approved at {draft.approvedAt}. No publish endpoint exists.
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-xs text-zinc-500">
          Generate one grounded draft from the monitoring profile and evidence.
        </p>
      )}
    </section>
  );
}
