"use client";

import { useActionState } from "react";

import { setSourcePaused, type SourceFormState } from "@/app/actions/source";

const initialState: SourceFormState = { error: null };

export function SourceStatusToggle({
  workspaceId,
  sourceId,
  sourceName,
  paused,
}: {
  workspaceId: string;
  sourceId: string;
  sourceName: string;
  paused: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    setSourcePaused,
    initialState,
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="sourceId" value={sourceId} />
      <input
        type="hidden"
        name="paused"
        value={paused ? "false" : "true"}
      />
      <button
        type="submit"
        disabled={pending}
        aria-label={`${paused ? "Resume" : "Pause"} ${sourceName}`}
        className="rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
      >
        {pending ? "…" : paused ? "Resume" : "Pause"}
      </button>
      {state.error ? (
        <span className="text-xs text-red-700 dark:text-red-300">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
