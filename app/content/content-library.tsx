"use client";

import { useMemo, useState } from "react";

import type { ContentDraftRow } from "@/lib/content-agent/repository";
import {
  contentDraftFilename,
  contentDraftsAsMarkdown,
  contentDraftsForLibrary,
  contentDraftSourceDomains,
  contentDraftSourceLinks,
  type ContentDraftFormatFilter,
  type ContentDraftStatusFilter,
} from "@/lib/content-agent/library";

import s from "./content-library.module.css";

const formatLabels: Record<ContentDraftRow["format"], string> = {
  blog_outline: "Blog outline",
  blog_post: "Blog post",
  x_thread: "X thread",
  linkedin_post: "LinkedIn post",
  reddit_reply: "Reddit reply",
  hn_reply: "Hacker News reply",
  newsletter_section: "Newsletter section",
};

const statusLabels: Record<ContentDraftRow["status"], string> = {
  idea: "Idea",
  draft: "Draft",
  ready: "Ready",
};

function dateLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(date);
}

function downloadDraft(draft: ContentDraftRow): void {
  const blob = new Blob([contentDraftsAsMarkdown(draft)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = contentDraftFilename(draft.title);
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function ContentLibrary({ workspaceId, initialDrafts }: {
  workspaceId: string;
  initialDrafts: ContentDraftRow[];
}) {
  const [drafts, setDrafts] = useState(initialDrafts);
  const [statusFilter, setStatusFilter] = useState<ContentDraftStatusFilter>("all");
  const [formatFilter, setFormatFilter] = useState<ContentDraftFormatFilter>("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sourceDomains = useMemo(() => contentDraftSourceDomains(drafts), [drafts]);
  const visibleDrafts = useMemo(() => contentDraftsForLibrary(drafts, {
    status: statusFilter,
    format: formatFilter,
    source: sourceFilter,
  }), [drafts, formatFilter, sourceFilter, statusFilter]);

  const updateStatus = async (draftId: string, status: ContentDraftRow["status"]) => {
    setUpdatingId(draftId);
    setError(null);
    try {
      const response = await fetch(`/api/content/drafts/${encodeURIComponent(draftId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, status }),
      });
      if (!response.ok) throw new Error("Draft status could not be saved.");
      const result = await response.json() as {
        draft: Omit<ContentDraftRow, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };
      };
      const updatedDraft: ContentDraftRow = {
        ...result.draft,
        createdAt: new Date(result.draft.createdAt),
        updatedAt: new Date(result.draft.updatedAt),
      };
      setDrafts((current) => current.map((draft) => draft.id === draftId ? updatedDraft : draft)
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()));
    } catch {
      setError("Draft status could not be saved. Try again.");
    } finally {
      setUpdatingId(null);
    }
  };

  return <section className={s.library} aria-labelledby="content-library-heading">
    <div className={s.heading}>
      <div>
        <p className={s.eyebrow}>Your workspace</p>
        <h2 id="content-library-heading">Content library</h2>
        <p className={s.lede}>Saved writing stays here until you decide what to do with it.</p>
      </div>
      <span className={s.count}>{drafts.length} {drafts.length === 1 ? "draft" : "drafts"}</span>
    </div>

    <div className={s.controls} aria-label="Filter saved drafts">
      <label>Status
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ContentDraftStatusFilter)}>
          <option value="all">All statuses</option>
          {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>Format
        <select value={formatFilter} onChange={(event) => setFormatFilter(event.target.value as ContentDraftFormatFilter)}>
          <option value="all">All formats</option>
          {Object.entries(formatLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>Source
        <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
          <option value="all">All sources</option>
          {sourceDomains.map((source) => <option key={source} value={source}>{source}</option>)}
        </select>
      </label>
      <p className={s.resultCount} role="status">Showing {visibleDrafts.length} of {drafts.length}</p>
    </div>

    {error && <p className={s.error} role="alert">{error}</p>}
    {drafts.length === 0
      ? <p className={s.empty}>Drafts you save while writing will appear here.</p>
      : visibleDrafts.length === 0
        ? <p className={s.empty}>No saved drafts match these filters.</p>
        : <ul className={s.drafts}>
          {visibleDrafts.map((draft) => {
            const sources = contentDraftSourceLinks(draft.body);
            return <li className={s.draft} key={draft.id}>
              <div className={s.draftHeading}>
                <div className={s.draftTitle}>
                  <p className={s.meta}>{formatLabels[draft.format]} <span aria-hidden="true">·</span> Updated {dateLabel(draft.updatedAt)}</p>
                  <h3>{draft.title}</h3>
                </div>
                <button className={s.export} type="button" onClick={() => downloadDraft(draft)}>Download .md</button>
              </div>
              <p className={s.preview}>{draft.body}</p>
              {sources.length > 0 && <ul className={s.sources} aria-label={`Sources for ${draft.title}`}>
                {sources.map((source) => {
                  const url = new URL(source);
                  return <li key={source}><a href={source} target="_blank" rel="noreferrer">{url.hostname.replace(/^www\./, "")}</a></li>;
                })}
              </ul>}
              <div className={s.draftFooter}>
                <label>Status
                  <select
                    aria-label={`Status for ${draft.title}`}
                    value={draft.status}
                    disabled={updatingId === draft.id}
                    onChange={(event) => void updateStatus(draft.id, event.target.value as ContentDraftRow["status"])}
                  >
                    {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                {draft.status === "ready" && <span className={s.ready}>Ready for your review</span>}
              </div>
            </li>;
          })}
        </ul>}
  </section>;
}
