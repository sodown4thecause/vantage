"use client";

import { useActionState } from "react";
import { addFeed, scanNow } from "@/lib/sources/actions";

export function ScanButton({ workspaceId }: { workspaceId: string }) {
  const [state, action, pending] = useActionState(scanNow.bind(null, workspaceId), {});
  return <div>
    <form action={action}><button disabled={pending} className="rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-60">{pending ? "Scanning…" : "Scan now"}</button></form>
    {state.error && <p role="alert" className="mt-2 text-sm text-red-600">{state.error}</p>}
    {state.message && <p role="status" className="mt-2 text-sm">{state.message}</p>}
  </div>;
}

export function FeedForm({ workspaceId }: { workspaceId: string }) {
  const [state, action, pending] = useActionState(addFeed.bind(null, workspaceId), {});
  return <form action={action} className="space-y-3">
    <label htmlFor="feed-url" className="block text-sm font-medium">RSS or Substack feed URL</label>
    <input id="feed-url" name="feedUrl" type="url" required maxLength={2000} placeholder="https://example.com/feed.xml" className="w-full rounded border p-3" />
    <button disabled={pending} className="rounded bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-60">{pending ? "Adding…" : "Add feed"}</button>
    {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
    {state.message && <p role="status" className="text-sm">{state.message}</p>}
    <p className="text-xs text-zinc-500">The pilot uses public feeds and Hacker News. Paid providers are disabled.</p>
  </form>;
}
