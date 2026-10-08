"use client";

import { useEffect, useState } from "react";

type Play = {
  id: string;
  kind: string;
  title: string;
  rationale: string;
  status: "suggested" | "accepted" | "done" | "dismissed";
  effortEstimate: "s" | "m" | "l";
};

const EFFORT: Record<Play["effortEstimate"], string> = {
  s: "Small effort",
  m: "Medium effort",
  l: "Large effort",
};

export function PlaysPanel({
  workspaceId,
  opportunityId,
}: {
  workspaceId: string;
  opportunityId: string;
}) {
  const [plays, setPlays] = useState<Play[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(
        `/api/plays?workspaceId=${encodeURIComponent(workspaceId)}&opportunityId=${encodeURIComponent(opportunityId)}`,
      );
      const data = (await res.json().catch(() => ({}))) as {
        plays?: Play[];
        error?: string;
      };
      if (cancelled) return;
      if (!res.ok) {
        setError(data.error ?? "Failed to load plays");
        return;
      }
      setPlays(data.plays ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, opportunityId]);

  async function suggest() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/plays", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, opportunityId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        plays?: Play[];
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Failed to suggest plays");
        return;
      }
      setPlays(data.plays ?? []);
    } finally {
      setBusy(false);
    }
  }

  async function decide(playId: string, status: "accepted" | "dismissed") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/plays", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, playId, status }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        play?: Play;
        error?: string;
      };
      if (!res.ok || !data.play) {
        setError(data.error ?? "Failed to update play");
        return;
      }
      const updated = data.play;
      setPlays((prev) => (prev ?? []).map((p) => (p.id === updated.id ? updated : p)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="plays-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="plays-heading" className="font-semibold">
          Plays
        </h2>
        <button
          type="button"
          disabled={busy}
          onClick={() => void suggest()}
          className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {plays && plays.length > 0 ? "Refresh suggestions" : "Suggest plays"}
        </button>
      </div>
      <p className="text-xs text-ridge">
        Vantage recommends; you do the action. Nothing is posted or sent for you.
      </p>
      {plays && plays.length === 0 ? (
        <p className="text-sm text-ridge">No plays yet for this opportunity.</p>
      ) : null}
      <ul className="space-y-3">
        {(plays ?? []).map((p) => (
          <li
            key={p.id}
            className="space-y-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{p.title}</span>
              <span className="text-xs capitalize text-ridge">
                {p.status} · {EFFORT[p.effortEstimate]}
              </span>
            </div>
            <p className="text-sm text-ridge">{p.rationale}</p>
            {p.status === "suggested" || p.status === "accepted" ? (
              <div className="flex gap-2">
                {p.status === "suggested" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void decide(p.id, "accepted")}
                    className="rounded-full bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950"
                  >
                    Accept
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide(p.id, "dismissed")}
                  className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
