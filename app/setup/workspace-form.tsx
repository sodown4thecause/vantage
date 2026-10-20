"use client";

import Link from "next/link";
import { useActionState } from "react";

import { startWorkspace } from "./actions";

export function WorkspaceForm({ additional = false }: { additional?: boolean }) {
  const [state, action, pending] = useActionState(startWorkspace, { error: "" });

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="additional" value={String(additional)} />
      <div className="space-y-2">
        <label htmlFor="workspace-name" className="block font-semibold">Workspace name</label>
        <input
          id="workspace-name"
          name="name"
          required
          maxLength={100}
          autoComplete="organization"
          placeholder="Acme Analytics"
          aria-describedby={state.error ? "workspace-error" : "workspace-help"}
          aria-invalid={!!state.error}
          className="w-full rounded-md border border-contour bg-sheet px-3.5 py-3"
        />
        <p id="workspace-help" className="text-sm text-ridge">Your company or product name works well.</p>
      </div>
      {state.error && <p id="workspace-error" role="alert" className="text-stop">{state.error}</p>}
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Creating workspace…" : "Create workspace"}
      </button>
      {state.error && <p className="text-sm text-ridge"><Link className="link" href="/workspaces">Open your workspaces</Link> or <Link className="link" href="/auth/sign-in">sign in again</Link>.</p>}
    </form>
  );
}
