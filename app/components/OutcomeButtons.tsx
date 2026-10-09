"use client";

import { useActionState } from "react";

import {
  recordOutcomeFromForm,
  type OutcomeFormState,
} from "@/app/actions/outcome";
import { OUTCOME_TYPES } from "@/lib/outcomes/record";

const initialState: OutcomeFormState = { error: null };

const LABELS: Record<string, string> = {
  useful: "Useful",
  not_useful: "Not useful",
  acted_on: "Acted on",
};

export function OutcomeButtons({
  workspaceId,
  leadId,
}: {
  workspaceId: string;
  leadId: string;
}) {
  const [state, formAction, pending] = useActionState(
    recordOutcomeFromForm,
    initialState,
  );

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-zinc-500">Was this useful?</span>
      {OUTCOME_TYPES.map((type) => (
        <form action={formAction} key={type}>
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="leadId" value={leadId} />
          <input type="hidden" name="outcomeType" value={type} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {LABELS[type]}
          </button>
        </form>
      ))}
      {state.error ? (
        <span className="text-xs text-red-700 dark:text-red-300">
          {state.error}
        </span>
      ) : null}
      {state.recorded && !state.error ? (
        <span className="text-xs text-emerald-700 dark:text-emerald-300">
          Recorded.
        </span>
      ) : null}
    </span>
  );
}
