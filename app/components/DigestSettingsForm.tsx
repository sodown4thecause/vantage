"use client";

import { useActionState } from "react";

import {
  unsubscribeDigest,
  updateDigestPreferences,
  type DigestFormState,
} from "@/app/actions/digest";

const initialState: DigestFormState = { error: null };

export function DigestSettingsForm({
  workspaceId,
  enabled,
  email,
  hourUtc,
}: {
  workspaceId: string;
  enabled: boolean;
  email: string | null;
  hourUtc: number;
}) {
  const [state, formAction, pending] = useActionState(
    updateDigestPreferences,
    initialState,
  );
  const [unsubState, unsubAction, unsubPending] = useActionState(
    unsubscribeDigest,
    initialState,
  );

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="workspaceId" value={workspaceId} />

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="digestEnabled"
            defaultChecked={enabled}
            className="h-4 w-4 rounded border-zinc-300"
          />
          Email me a daily digest of the top conversations
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="digest-email" className="text-sm font-medium">
              Delivery address
            </label>
            <input
              id="digest-email"
              name="digestEmail"
              type="email"
              defaultValue={email ?? ""}
              placeholder="you@company.com"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="digest-hour" className="text-sm font-medium">
              Delivery hour (UTC)
            </label>
            <select
              id="digest-hour"
              name="digestHourUtc"
              defaultValue={String(hourUtc)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <option key={hour} value={hour}>
                  {String(hour).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-ink px-4 text-sm font-medium text-white hover:bg-ink/90 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save digest settings"}
          </button>
          {state.error ? (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {state.error}
            </p>
          ) : null}
          {state.saved && !state.error ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">
              Saved.
            </p>
          ) : null}
        </div>
      </form>

      {enabled ? (
        <form
          action={unsubAction}
          className="border-t border-zinc-200 pt-4 dark:border-zinc-800"
        >
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <button
            type="submit"
            disabled={unsubPending}
            className="text-sm text-ridge underline hover:text-ink dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            {unsubPending ? "Unsubscribing…" : "Unsubscribe from the digest"}
          </button>
          {unsubState.error ? (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">
              {unsubState.error}
            </p>
          ) : null}
          {unsubState.saved && !unsubState.error ? (
            <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">
              You are unsubscribed.
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
