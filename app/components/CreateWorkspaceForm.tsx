"use client";

import { useActionState } from "react";

import {
  createWorkspaceFromForm,
  type WorkspaceFormState,
} from "@/app/actions/workspace";

const initialState: WorkspaceFormState = { error: null };

export function CreateWorkspaceForm({ compact = false }: { compact?: boolean }) {
  const [state, formAction, pending] = useActionState(
    createWorkspaceFromForm,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-2">
      <div className={compact ? "flex gap-2" : "space-y-2"}>
        <label htmlFor="workspace-name" className="sr-only">
          Workspace name
        </label>
        <input
          id="workspace-name"
          name="name"
          type="text"
          required
          minLength={2}
          maxLength={80}
          placeholder="Acme brand monitoring"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-zinc-950 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          {pending ? "Creating…" : "Create workspace"}
        </button>
      </div>
      {state.error ? (
        <p className="text-sm text-red-700 dark:text-red-300">{state.error}</p>
      ) : null}
    </form>
  );
}
