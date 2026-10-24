"use client";

import { useEffect, useRef, useState } from "react";
import { SafeLink } from "@/components/safe-link";
import { safeHttpUrl } from "@/lib/http/safe-url";
import type { ContributionReview } from "@/lib/drafting/generate";
import { contributionRule } from "@/lib/drafting/rules";
import type { RuleLine } from "@/lib/reddit/subreddit-rules";

type Draft = {
  id: string;
  originalText: string;
  editedText: string;
  citations: Array<{ label: string; url: string; documentId?: string }>;
  flags: Array<{ claim: string; reason: string }>;
  approvedAt: string | null;
  quality: ContributionReview | null;
};

export type DraftConversation = {
  documentId: string;
  title: string | null;
  urlCanonical: string;
  platform: string;
  discoveryOnly?: boolean;
  ruleLine: RuleLine;
};

const FIELD = "w-full rounded-lg border border-contour bg-sheet p-3 text-ink placeholder:text-ridge";

export function DraftPanel({
  workspaceId,
  opportunityId,
  conversations,
}: {
  workspaceId: string;
  opportunityId: string;
  conversations: DraftConversation[];
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [edited, setEdited] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState(conversations[0]?.documentId ?? "");
  const requestRevision = useRef(0);
  const selected = conversations.find(c => c.documentId === target);
  const rule = contributionRule(selected?.platform ?? "", selected?.urlCanonical ?? "");
  const researchOnly = selected?.discoveryOnly === true || rule.aiText === "prohibited";
  const kind = draft?.quality?.kind;
  const draftMatchesTarget = Boolean(selected && draft?.quality?.targetDocumentId === target);
  const canCopy = draftMatchesTarget && (kind === "draft" || kind === "brief");

  function changeTarget(documentId: string) {
    requestRevision.current += 1;
    setTarget(documentId);
    setDraft(null);
    setEdited("");
    setNotice(null);
    setError(null);
    setBusy(false);
  }

  useEffect(() => {
    let cancelled = false;
    const revision = ++requestRevision.current;
    (async () => {
      const res = await fetch(
        `/api/drafts?workspaceId=${encodeURIComponent(workspaceId)}&opportunityId=${encodeURIComponent(opportunityId)}${target ? `&targetDocumentId=${encodeURIComponent(target)}` : ""}`,
        { cache: "no-store" },
      );
      const data = (await res.json().catch(() => ({}))) as {
        draft?: Draft | null;
        error?: string;
      };
      if (cancelled || revision !== requestRevision.current) return;
      setBusy(false);
      if (!res.ok) {
        setError(data.error ?? "Failed to load draft");
        return;
      }
      if (data.draft && (data.draft.quality === null || data.draft.quality?.targetDocumentId === target)) {
        setDraft(data.draft);
        setEdited(data.draft.editedText);
        setNotice(null);
      }
    })().catch(() => {
      if (!cancelled && revision === requestRevision.current) {
        setError("Draft could not be loaded. Try again.");
        setBusy(false);
      }
    });
    return () => {
      cancelled = true;
      requestRevision.current += 1;
    };
  }, [workspaceId, opportunityId, target]);

  async function postDraft(body: Record<string, unknown>): Promise<{ draft?: Draft; error?: string; ok: boolean }> {
    const res = await fetch("/api/drafts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, ...body }),
    });
    const data = (await res.json().catch(() => ({}))) as { draft?: Draft; error?: string };
    return { ...data, ok: res.ok };
  }

  async function recordEvent(event: "copy" | "open", draftId: string | null): Promise<boolean> {
    try {
      const res = await fetch("/api/outcomes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          opportunityId,
          event,
          draftId,
          payload: { documentId: target },
          idempotencyKey: `${opportunityId}:${event}:${Date.now()}`,
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function createDraft() {
    if (!selected) return;
    const revision = ++requestRevision.current;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await postDraft({ action: "create", opportunityId, targetDocumentId: target, rulesReviewed: true });
      if (revision !== requestRevision.current) return;
      if (!data.ok || !data.draft) {
        setError(data.error ?? "Create failed");
        return;
      }
      setDraft(data.draft);
      setEdited(data.draft.editedText);
    } catch {
      if (revision === requestRevision.current) setError("The draft could not be prepared. Please try again.");
    } finally {
      if (revision === requestRevision.current) setBusy(false);
    }
  }

  async function copyReply(): Promise<{ draftId: string } | null> {
    if (!draft || !draftMatchesTarget) return null;
    const revision = ++requestRevision.current;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await postDraft({ action: "update", draftId: draft.id, editedText: edited });
      if (revision !== requestRevision.current) return null;
      if (!saved.ok || !saved.draft || saved.draft.quality?.targetDocumentId !== target) {
        setError(saved.error ?? "Save failed");
        return null;
      }
      const approved = await postDraft({ action: "approve", draftId: saved.draft.id, rulesReviewed: true, factsReviewed: true });
      if (revision !== requestRevision.current) return null;
      if (!approved.ok || !approved.draft || approved.draft.quality?.targetDocumentId !== target) {
        setError(approved.error ?? "This reply cannot be copied yet.");
        return null;
      }
      setDraft(approved.draft);
      setEdited(approved.draft.editedText);
      await navigator.clipboard.writeText(approved.draft.editedText);
      const recorded = await recordEvent("copy", approved.draft.id);
      if (revision === requestRevision.current) {
        setNotice(
          `Copied to your clipboard. Paste it into the thread yourself; Vantage never posts for you.${recorded ? "" : " We could not save this copy to your history."}`,
        );
      }
      return { draftId: approved.draft.id };
    } catch {
      if (revision === requestRevision.current) setError("Could not copy. Check clipboard access and try again.");
      return null;
    } finally {
      if (revision === requestRevision.current) setBusy(false);
    }
  }

  async function copyAndOpen() {
    const threadUrl = safeHttpUrl(selected?.urlCanonical);
    if (!threadUrl) return;
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    const copied = await copyReply();
    if (!copied) {
      tab?.close();
      return;
    }
    if (!tab) {
      setNotice((current) => `${current ?? ""} Your browser blocked the new tab, so use Open thread.`.trim());
      return;
    }
    tab.location.href = threadUrl;
    await recordEvent("open", copied.draftId);
  }

  const heading = researchOnly ? "Research brief" : "Your reply";

  return (
    <section aria-labelledby="reply-heading" className="space-y-5 border-t border-contour pt-8">
      <h2 id="reply-heading" className="display text-2xl">{heading}</h2>

      {conversations.length > 1 ? (
        <div className="space-y-1.5">
          <label htmlFor="draft-conversation" className="block text-sm font-medium">Conversation</label>
          <select id="draft-conversation" value={target} disabled={busy} onChange={e => changeTarget(e.target.value)} className={FIELD}>
            {conversations.map(c => <option key={c.documentId} value={c.documentId}>{c.discoveryOnly ? `Research source (${c.platform})` : c.platform}: {c.title || c.urlCanonical}</option>)}
          </select>
        </div>
      ) : null}

      {selected ? (
        <div className="space-y-1 border-l-2 border-flag pl-4" data-testid="rule-line">
          <p className="font-medium">
            {rule.aiText === "prohibited" ? `${rule.venue} prohibits AI-written replies. Use the research brief for reference.` : selected.ruleLine.text}
          </p>
          <p className="text-sm text-ridge">
            {selected.ruleLine.checked ? `Rule checked ${selected.ruleLine.checked}. ` : ""}
            <SafeLink href={rule.url ?? selected.ruleLine.url ?? selected.urlCanonical} className="link">
              {rule.url || selected.ruleLine.url ? "Read the rules" : "Open the thread to read its rules"}
            </SafeLink>
          </p>
        </div>
      ) : null}

      {selected?.discoveryOnly ? <p className="text-sm text-ridge">This is a research source. Read the original before you reply.</p> : null}

      {error ? <p className="text-sm text-stop" role="alert">{error}</p> : null}

      {!draft ? (
        <div className="space-y-3">
          <p className="max-w-[62ch] text-ridge">
            {researchOnly
              ? "Vantage builds a research brief from the evidence. It is reference material, not a reply."
              : "Vantage writes a first draft from the evidence. You edit it and post it yourself."}
          </p>
          <button type="button" disabled={busy || !selected} onClick={() => void createDraft()} className="btn btn-lg disabled:opacity-50">
            {busy ? "Working…" : researchOnly ? "Build research brief" : "Write a draft"}
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {draft.quality ? (
            <div className="space-y-1 text-sm text-ridge">
              <p className="font-medium text-ink">{kind === "draft" ? "Draft for you to review" : kind === "brief" ? "Research brief, reference material" : "No reply recommended"}</p>
              {draft.quality.angle ? <p>What this adds: {draft.quality.angle}</p> : null}
              <p>{draft.quality.gap.note}</p>
              {draft.quality.notes.map(note => <p key={note}>{note}</p>)}
            </div>
          ) : (
            <p className="text-sm text-ridge">This saved draft has no conversation recorded. Write a new draft for this conversation before you copy it.</p>
          )}

          <div className="space-y-1.5">
            <label className="block text-sm font-medium" htmlFor="edited">{kind === "draft" ? "Edit your reply" : "Reference text"}</label>
            <textarea
              id="edited"
              className={`${FIELD} ${kind === "draft" ? "" : "text-ridge"}`}
              rows={10}
              maxLength={kind === "draft" ? 2200 : 12000}
              readOnly={kind !== "draft"}
              value={edited}
              onChange={(e) => { setEdited(e.target.value); setNotice(null); setDraft({ ...draft, approvedAt: null }); }}
            />
          </div>

          {draft.flags.length > 0 ? (
            <ul className="space-y-1 text-sm text-flag-ink">
              {draft.flags.map((f) => <li key={f.claim}>Check “{f.claim}”: {f.reason}</li>)}
            </ul>
          ) : null}

          {canCopy ? (
            <div className="space-y-3">
              <p className="max-w-[62ch] text-sm text-ridge">You post this yourself. Check the facts and the rule above first.</p>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <button type="button" disabled={busy} onClick={() => void copyAndOpen()} className="btn btn-lg justify-center disabled:opacity-50">
                  {kind === "brief" ? "Copy brief and open source" : "Copy reply and open thread"}
                </button>
                <button type="button" disabled={busy} onClick={() => void copyReply()} className="btn btn-quiet justify-center disabled:opacity-50">
                  {kind === "brief" ? "Copy research brief" : "Copy reply"}
                </button>
                <SafeLink href={selected?.urlCanonical} className="btn btn-quiet justify-center" onClick={() => void recordEvent("open", draft.id)}>
                  Open thread
                </SafeLink>
              </div>
            </div>
          ) : null}
          {notice ? <p className="text-sm text-sage" role="status">{notice}</p> : null}

          {!!draft.quality?.claims.length && (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">Evidence for the claims ({draft.quality.claims.length})</summary>
              <ul className="mt-3 space-y-4">
                {draft.quality.claims.map((claim, i) => {
                  const citation = draft.citations.find(c => c.documentId === claim.documentId);
                  return (
                    <li key={i} className="space-y-1">
                      <p>{claim.sentence}</p>
                      <blockquote className="quote border-l-2 border-contour pl-3 text-ridge">“{claim.quote}”</blockquote>
                      {citation ? <SafeLink href={citation.url} className="link">Open evidence</SafeLink> : null}
                    </li>
                  );
                })}
              </ul>
            </details>
          )}

          <details className="text-sm">
            <summary className="cursor-pointer font-medium">Original draft and citations</summary>
            <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-sheet p-3 text-ridge">{draft.originalText}</pre>
            <ul className="mt-3 space-y-1">
              {draft.citations.map((c) => (
                <li key={c.url}><SafeLink href={c.url} className="link">{c.label}</SafeLink></li>
              ))}
            </ul>
          </details>

          <div>
            <button type="button" disabled={busy || !selected} onClick={() => void createDraft()} className="btn btn-quiet disabled:opacity-50">
              {researchOnly ? "Rebuild research brief" : "Write a new draft"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
