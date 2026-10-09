"use client";

import { useActionState, useState } from "react";

import {
  createSource,
  type SourceFormState,
} from "@/app/actions/source";
import {
  SOURCE_TYPE_LABELS,
  SOURCE_TYPE_VALUES,
} from "@/lib/collectors/config";

const initialState: SourceFormState = { error: null };

/** Config field shown for each collector type. */
const PRIMARY_FIELD: Record<string, { name: string; label: string; hint?: string }> = {
  hn: {
    name: "query",
    label: "Search query",
    hint: "e.g. looking for a CRM alternative",
  },
  rss: {
    name: "feedUrl",
    label: "Feed URL",
    hint: "https://example.com/feed.xml",
  },
  substack: {
    name: "publication",
    label: "Publication or feed URL",
    hint: "acme or https://acme.substack.com/feed",
  },
  reddit: { name: "query", label: "Search query", hint: 'e.g. subreddit:saas' },
  web_search: { name: "query", label: "Search query" },
  x: { name: "query", label: "Search query", hint: "e.g. \"need a scheduler\"" },
  youtube: {
    name: "videoIds",
    label: "Video IDs (comma-separated)",
    hint: "Leave empty to use the search query below",
  },
  producthunt: { name: "query", label: "Topic query (optional)" },
  other: { name: "", label: "" },
};

export function SourceForm({ workspaceId }: { workspaceId: string }) {
  const [state, formAction, pending] = useActionState(
    createSource,
    initialState,
  );
  const [type, setType] = useState("rss");
  const field = PRIMARY_FIELD[type] ?? { name: "", label: "" };
  const showQueryFallback = type === "youtube" || type === "producthunt";

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="workspaceId" value={workspaceId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="source-name" className="text-sm font-medium">
            Source name
          </label>
          <input
            id="source-name"
            name="name"
            type="text"
            required
            minLength={2}
            maxLength={60}
            placeholder="Acme blog"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="source-type" className="text-sm font-medium">
            Type
          </label>
          <select
            id="source-type"
            name="type"
            value={type}
            onChange={(event) => setType(event.target.value)}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            {SOURCE_TYPE_VALUES.map((value) => (
              <option key={value} value={value}>
                {SOURCE_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {field.name ? (
        <div className="space-y-1">
          <label htmlFor={`source-${field.name}`} className="text-sm font-medium">
            {field.label}
          </label>
          <input
            id={`source-${field.name}`}
            name={field.name}
            type="text"
            placeholder={field.hint}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
      ) : null}

      {showQueryFallback ? (
        <div className="space-y-1">
          <label htmlFor="source-query" className="text-sm font-medium">
            Search query
          </label>
          <input
            id="source-query"
            name="query"
            type="text"
            placeholder="e.g. project management tool"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-zinc-950 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          {pending ? "Saving…" : "Add source"}
        </button>
        {state.error ? (
          <p className="text-sm text-red-700 dark:text-red-300">{state.error}</p>
        ) : null}
        {state.saved && !state.error ? (
          <p className="text-sm text-emerald-700 dark:text-emerald-300">
            Source added.
          </p>
        ) : null}
      </div>
    </form>
  );
}
