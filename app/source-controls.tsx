"use client";

import { useActionState, useState } from "react";
import { addCommunitySource, addFeed, scanNow, scanSource, type CommunitySourceActionState } from "@/lib/sources/actions";
import { COMMUNITY_SOURCE_CATALOG } from "@/lib/communities/catalog";
import { SafeLink } from "@/components/safe-link";

export function ScanButton({ workspaceId }: { workspaceId: string }) {
  const [state, action, pending] = useActionState(scanNow.bind(null, workspaceId), {});
  return <div>
    <form action={action}><button disabled={pending} className="btn disabled:opacity-60">{pending ? "Scanning…" : "Scan now"}</button></form>
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
    <p className="text-xs text-zinc-500">Public feeds run in scheduled scans. Sources requiring provider access are scanned individually.</p>
  </form>;
}

export function CommunitySourceForm({ workspaceId }: { workspaceId: string }) {
  const [selected, setSelected] = useState(COMMUNITY_SOURCE_CATALOG[0]!.id);
  const [state, action, pending] = useActionState<CommunitySourceActionState, FormData>(addCommunitySource.bind(null, workspaceId), { catalogId: "" });
  const entry = COMMUNITY_SOURCE_CATALOG.find(e => e.id === selected)!;
  return <form action={action} className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
    <label htmlFor="community-source" className="block text-sm font-medium">Developer community sources</label>
    <select id="community-source" name="catalogId" value={selected} onChange={e => setSelected(e.target.value)} className="w-full rounded border p-3">
      {COMMUNITY_SOURCE_CATALOG.map(e => <option key={e.id} value={e.id}>{e.name} · {e.lane === "free" ? "public" : "provider access"}</option>)}
    </select>
    <p className="text-sm">{entry.description}</p>
    <SafeLink href={entry.rulesUrl} className="text-xs underline">Source guidelines</SafeLink>
    <button disabled={pending} className="ml-3 rounded bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-60">{pending ? "Adding…" : "Add source"}</button>
    {state.catalogId === selected && state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
    {state.catalogId === selected && state.message && <p role="status" className="text-sm">{state.message}</p>}
  </form>;
}

export function SourceScanButton({ workspaceId, sourceId }: { workspaceId: string; sourceId: string }) {
  const [state, action, pending] = useActionState(scanSource.bind(null, workspaceId, sourceId), {});
  return <div className="mt-3"><form action={action}><button disabled={pending} className="btn text-xs disabled:opacity-60">{pending ? "Scanning…" : "Scan this source"}</button></form>
    {state.error && <p role="alert" className="mt-2 text-xs text-red-600">{state.error}</p>}
    {state.message && <p role="status" className="mt-2 text-xs">{state.message}</p>}
  </div>;
}
