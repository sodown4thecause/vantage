"use client";

import { useActionState } from "react";

import { switchWorkspace } from "./actions";

export function SwitchWorkspaceForm({ workspaceId, name, current }: { workspaceId: string; name: string; current: boolean }) {
  const [state, action, pending] = useActionState(switchWorkspace, { error: "" });

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">{name}</h2>
          {current && <p className="text-sm text-ridge">Selected workspace</p>}
        </div>
        <button type="submit" className="btn btn-quiet" disabled={pending} aria-label={`Open ${name}`}>
          {pending ? "Opening…" : "Open workspace"}
        </button>
      </div>
      {state.error && <p role="alert" className="text-stop">{state.error}</p>}
    </form>
  );
}
