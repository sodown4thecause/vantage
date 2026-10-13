"use client";

import { useActionState, useState } from "react";
import { addCommunitySource, addFeed, addSearchSource, scanNow, scanSource, type CommunitySourceActionState } from "@/lib/sources/actions";
import { SEARCH_PLATFORMS, type SearchPlatform } from "@/lib/sources/search";
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

const SEARCH_HINTS: Record<SearchPlatform, string> = {
  hn: "Searches Hacker News stories from the past week, then new ones on each scan.",
  reddit: "Searches Reddit, or one subreddit. Needs provider access set up by the site operator.",
  stackoverflow: "Searches Stack Overflow questions active in the past week, optionally within one tag.",
  github: "Searches open public GitHub issues updated in the past week.",
  forums: "Searches public developer forums such as DEV, Indie Hackers, Lobsters and public Discourse communities. Needs provider access set up by the site operator.",
  blogs: "Searches recent blog posts across the web, leaving out social networks and forums. Needs provider access set up by the site operator.",
};

export function SearchSourceForm({ workspaceId }: { workspaceId: string }) {
  const [platform, setPlatform] = useState<SearchPlatform>("hn");
  const [state, action, pending] = useActionState(addSearchSource.bind(null, workspaceId), {});
  return <form action={action} className="space-y-4" data-testid="search-source-form">
    <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
      <div className="space-y-1.5">
        <label htmlFor="search-platform" className="block text-sm font-semibold">Where</label>
        <select id="search-platform" name="platform" value={platform} onChange={e => setPlatform(e.target.value as SearchPlatform)} className="w-full rounded border p-3">
          {(Object.keys(SEARCH_PLATFORMS) as SearchPlatform[]).map(key => <option key={key} value={key}>{SEARCH_PLATFORMS[key].label}</option>)}
        </select>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="search-query" className="block text-sm font-semibold">Search for</label>
        <input id="search-query" name="query" required minLength={2} maxLength={100} placeholder="e.g. track brand mentions in ChatGPT" className="w-full rounded border p-3" />
      </div>
    </div>
    {platform === "reddit" && <div className="space-y-1.5">
      <label htmlFor="search-subreddit" className="block text-sm font-semibold">Subreddit <span className="font-normal text-ridge">(optional)</span></label>
      <input id="search-subreddit" name="subreddit" maxLength={23} pattern="(r/)?[A-Za-z0-9_]{2,21}" placeholder="SaaS" className="w-full rounded border p-3 sm:max-w-xs" />
    </div>}
    {platform === "stackoverflow" && <div className="space-y-1.5">
      <label htmlFor="search-tag" className="block text-sm font-semibold">Tag <span className="font-normal text-ridge">(optional)</span></label>
      <input id="search-tag" name="tag" maxLength={35} placeholder="seo" className="w-full rounded border p-3 sm:max-w-xs" />
    </div>}
    <p className="text-sm text-ridge">{SEARCH_HINTS[platform]}</p>
    <button disabled={pending} className="btn disabled:opacity-60">{pending ? "Searching…" : "Search and add"}</button>
    {state.error && <p role="alert" className="text-sm text-stop">{state.error}</p>}
    {state.message && <p role="status" className="text-sm">{state.message}</p>}
  </form>;
}

/** One click adds a subreddit-scoped Reddit search for `query`, then scans it, like the search form does. */
export function TrackSubredditButton({ workspaceId, subreddit, query }: { workspaceId: string; subreddit: string; query: string }) {
  const [state, action, pending] = useActionState(addSearchSource.bind(null, workspaceId), {});
  return <form action={action} className="space-y-2" data-testid="track-subreddit-form">
    <input type="hidden" name="platform" value="reddit" />
    <input type="hidden" name="subreddit" value={subreddit} />
    <input type="hidden" name="query" value={query} />
    <button disabled={pending} className="btn text-xs disabled:opacity-60">{pending ? "Tracking…" : `Track r/${subreddit}`}</button>
    {state.error && <p role="alert" className="text-sm text-stop">{state.error}</p>}
    {state.message && <p role="status" className="text-sm">{state.message}</p>}
  </form>;
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
