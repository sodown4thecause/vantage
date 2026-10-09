"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type RunState =
  | { kind: "idle" }
  | { kind: "running"; message: string }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

/** Runs one source's collector, then qualifies fresh documents into leads. */
export function CollectNowButton({
  workspaceId,
  sourceId,
  sourceType,
  sourceName,
  disabled = false,
}: {
  workspaceId: string;
  sourceId: string;
  sourceType: string;
  sourceName: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<RunState>({ kind: "idle" });

  async function collect() {
    setState({ kind: "running", message: `Collecting ${sourceName}…` });
    try {
      const collectResponse = await fetch(`/api/collectors/${sourceType}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, sourceId }),
      });
      const collectData = (await collectResponse.json().catch(() => ({}))) as {
        results?: Array<{ inserted?: number; skipped?: number; error?: string }>;
      };
      const first = collectData.results?.[0];
      if (first?.error) {
        setState({
          kind: "error",
          message: `Collection failed: ${first.error}`,
        });
        return;
      }

      const inserted = first?.inserted ?? 0;
      const skipped = first?.skipped ?? 0;

      const pipelineResponse = await fetch("/api/pipeline/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const pipelineData = (await pipelineResponse
        .json()
        .catch(() => ({}))) as { created?: number };

      setState({
        kind: "done",
        message:
          inserted === 0 && skipped === 0
            ? "No new posts this run."
            : `${inserted} new posts · ${pipelineData.created ?? 0} leads moved to review`,
      });
      router.refresh();
    } catch {
      setState({
        kind: "error",
        message: "Collection request failed. Try again.",
      });
    }
  }

  const running = state.kind === "running";

  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={collect}
        disabled={running || disabled}
        className="rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
      >
        {running ? "Collecting…" : "Collect now"}
      </button>
      {state.kind === "done" ? (
        <span className="text-xs text-emerald-700 dark:text-emerald-300">
          {state.message}
        </span>
      ) : null}
      {state.kind === "error" ? (
        <span className="text-xs text-red-700 dark:text-red-300">
          {state.message}
        </span>
      ) : null}
      {state.kind === "running" ? (
        <span className="text-xs text-zinc-500">{state.message}</span>
      ) : null}
    </span>
  );
}
