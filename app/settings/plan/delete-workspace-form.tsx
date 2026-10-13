"use client";

import { useActionState } from "react";

import { deleteWorkspace } from "@/lib/workspace/actions";

export function DeleteWorkspaceForm({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const [state, action, pending] = useActionState(deleteWorkspace.bind(null, workspaceId), {});

  return (
    <form action={action} className="space-y-4 rounded-xl border border-red-200 p-4 dark:border-red-900">
      <p className="text-sm text-ink">
        Deleting this workspace permanently removes its sources, collected posts, opportunities, drafts and
        monitoring profile. This cannot be undone.
      </p>
      <p className="text-sm text-ridge">
        Your sign-in account stays. Database backups keep copies until their retention window passes.
      </p>
      <div className="space-y-1.5">
        <label htmlFor="delete-workspace-confirm" className="block text-sm font-medium">
          Type <strong>{workspaceName}</strong> to confirm
        </label>
        <input
          id="delete-workspace-confirm"
          name="confirm"
          type="text"
          autoComplete="off"
          required
          className="w-full rounded-lg border border-contour bg-sheet px-3 py-2 text-sm text-ink sm:max-w-xs"
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="h-10 rounded-lg bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
        >
          {pending ? "Deleting…" : "Delete workspace"}
        </button>
        {state.error ? (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {state.error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
