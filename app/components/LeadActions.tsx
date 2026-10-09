"use client";

import { useActionState } from "react";

import { setLeadStatus, type LeadFormState } from "@/app/actions/lead";

const initialState: LeadFormState = { error: null };

export function LeadActions({
  workspaceId,
  leadId,
}: {
  workspaceId: string;
  leadId: string;
}) {
  const [state, formAction, pending] = useActionState(
    setLeadStatus,
    initialState,
  );

  return (
    <span className="flex items-center gap-2">
      <form action={formAction}>
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="leadId" value={leadId} />
        <input type="hidden" name="status" value="approved" />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-emerald-300 px-3 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950"
        >
          Approve
        </button>
      </form>
      <form action={formAction}>
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="leadId" value={leadId} />
        <input type="hidden" name="status" value="rejected" />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          Reject
        </button>
      </form>
      {state.error ? (
        <span className="text-xs text-red-700 dark:text-red-300">
          {state.error}
        </span>
      ) : null}
    </span>
  );
}
