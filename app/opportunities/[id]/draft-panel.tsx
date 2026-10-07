"use client";

import { useEffect, useRef, useState } from "react";
import { SafeLink } from "@/components/safe-link";
import type { ContributionReview } from "@/lib/drafting/generate";
import { contributionRule } from "@/lib/drafting/rules";

type Draft = {
  id: string;
  originalText: string;
  editedText: string;
  citations: Array<{ label: string; url: string; documentId?: string }>;
  flags: Array<{ claim: string; reason: string }>;
  approvedAt: string | null;
  quality: ContributionReview | null;
};

export function DraftPanel({
  workspaceId,
  opportunityId,
  conversations,
}: {
  workspaceId: string;
  opportunityId: string;
  conversations: Array<{ documentId: string; title: string | null; urlCanonical: string; platform: string; discoveryOnly?: boolean }>;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [edited, setEdited] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [target, setTarget] = useState(conversations[0]?.documentId ?? "");
  const [rulesReviewed, setRulesReviewed] = useState(false);
  const [factsReviewed, setFactsReviewed] = useState(false);
  const requestRevision = useRef(0);
  const selected = conversations.find(c => c.documentId === target);
  const rule = contributionRule(selected?.platform ?? "", selected?.urlCanonical ?? "");
  const researchOnly = selected?.discoveryOnly === true || rule.aiText === "prohibited";
  const kind = draft?.quality?.kind;
  const draftMatchesTarget = Boolean(selected && draft?.quality?.targetDocumentId === target);

  function changeTarget(documentId: string) {
    requestRevision.current += 1;
    setTarget(documentId);
    setDraft(null);
    setEdited("");
    setCopied(false);
    setRulesReviewed(false);
    setFactsReviewed(false);
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
        setCopied(false);
        setRulesReviewed(false);
        setFactsReviewed(false);
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

  async function createDraft() {
    if (!selected) return;
    const revision = ++requestRevision.current;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          workspaceId,
          opportunityId,
          targetDocumentId: target,
          rulesReviewed,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        draft?: Draft;
        error?: string;
      };
      if (revision !== requestRevision.current) return;
      if (!res.ok || !data.draft) {
        setError(data.error ?? "Create failed");
        return;
      }
      setDraft(data.draft);
      setEdited(data.draft.editedText);
      setFactsReviewed(false);
      setCopied(false);
    } catch {
      if (revision === requestRevision.current) setError("Contribution could not be prepared. Please try again.");
    } finally {
      if (revision === requestRevision.current) setBusy(false);
    }
  }

  async function saveEdit() {
    if (!draft || !draftMatchesTarget) return;
    const revision = ++requestRevision.current;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "update",
          workspaceId,
          draftId: draft.id,
          editedText: edited,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        draft?: Draft;
        error?: string;
      };
      if (revision !== requestRevision.current) return;
      if (!res.ok || !data.draft) {
        setError(data.error ?? "Save failed");
        return;
      }
      setDraft(data.draft);
      setEdited(data.draft.editedText);
    } catch {
      if (revision === requestRevision.current) setError("Edits could not be saved. Please try again.");
    } finally {
      if (revision === requestRevision.current) setBusy(false);
    }
  }

  async function approveAndCopy() {
    if (!draft || !draftMatchesTarget) return;
    const revision = ++requestRevision.current;
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const saveRes = await fetch("/api/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "update",
          workspaceId,
          draftId: draft.id,
          editedText: edited,
        }),
      });
      const saved = (await saveRes.json().catch(() => ({}))) as {
        draft?: Draft;
        error?: string;
      };
      if (revision !== requestRevision.current) return;
      if (!saveRes.ok || !saved.draft || saved.draft.quality?.targetDocumentId !== target) {
        setError(saved.error ?? "Save failed");
        return;
      }
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          workspaceId,
          draftId: saved.draft.id,
          rulesReviewed,
          factsReviewed,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        draft?: Draft;
        error?: string;
      };
      if (revision !== requestRevision.current) return;
      if (!res.ok || !data.draft || data.draft.quality?.targetDocumentId !== target) {
        setError(data.error ?? "Approve failed");
        return;
      }
      setDraft(data.draft);
      setEdited(data.draft.editedText);
      await navigator.clipboard.writeText(data.draft.editedText);
      if (revision === requestRevision.current) setCopied(true);
    } catch {
      if (revision === requestRevision.current) setError("Handoff could not be completed. Check clipboard access and try again.");
    } finally {
      if (revision === requestRevision.current) setBusy(false);
    }
  }

  function openConversation() {
    if (!draftMatchesTarget || !draft?.approvedAt) {
      setError("Approve & copy before opening the conversation handoff.");
      return;
    }
    const first = draft.citations.find(c => c.documentId === draft.quality?.targetDocumentId)?.url;
    if (first) {
      window.open(first, "_blank", "noopener,noreferrer");
    } else {
      setError("No conversation URL available in citations.");
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{researchOnly ? "Research brief" : "Contribution draft"}</h2>
        {(
          <button
            type="button"
            disabled={busy || !selected}
            onClick={() => void createDraft()}
            className="rounded-full bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white dark:bg-zinc-50 dark:text-zinc-950"
          >
            {researchOnly ? "Build research brief" : draft ? "Regenerate contribution" : "Generate contribution"}
          </button>
        )}
      </div>

      <div className="space-y-2">
        <label htmlFor="draft-conversation" className="block text-xs font-medium">Conversation or research source</label>
        <select id="draft-conversation" value={target} disabled={busy} onChange={e => changeTarget(e.target.value)} className="w-full rounded border p-2 text-sm">
          {conversations.map(c => <option key={c.documentId} value={c.documentId}>{c.discoveryOnly ? `Research source (${c.platform})` : c.platform}: {c.title || c.urlCanonical}</option>)}
        </select>
        {selected?.discoveryOnly ? <p className="text-sm">This is a research source. Read the original source before preparing a contribution.</p> :
          rule.aiText === "prohibited" ? <p className="text-sm">{rule.venue} prohibits AI-written contributions. Research briefs are for reference.</p> :
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={rulesReviewed} onChange={e => setRulesReviewed(e.target.checked)} />I reviewed the current community rules and AI assistance is permitted here.</label>}
        {selected && <SafeLink href={selected.discoveryOnly ? selected.urlCanonical : rule.url || selected.urlCanonical} className="text-xs underline">{selected.discoveryOnly ? "Open research source" : rule.url ? "Community policy" : "Open the thread to review its rules"}</SafeLink>}
      </div>

      {error ? (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {draft ? (
        <>
          {draft.quality ? <div className="space-y-2 text-xs">
            <p className="font-medium">{kind === "draft" ? "Draft for human review" : kind === "brief" ? "Research brief · reference material" : "No reply recommended"}</p>
            {draft.quality.angle && <p><strong>What this adds:</strong> {draft.quality.angle}</p>}
            <p>{draft.quality.gap.note}</p>
            {draft.quality.notes.map(note => <p key={note}>{note}</p>)}
          </div> : <p className="text-xs">Legacy draft · conversation not recorded. Review this saved text or regenerate for the selected conversation before handoff.</p>}
          <div>
            <p className="text-xs font-medium text-zinc-500">Original</p>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-xs dark:bg-zinc-900">
              {draft.originalText}
            </pre>
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-500" htmlFor="edited">
              {kind === "draft" ? "Review and edit" : "Reference text"}
            </label>
            <textarea
              id="edited"
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white p-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              rows={10}
              maxLength={kind === "draft" ? 2200 : 12000}
              readOnly={kind !== "draft"}
              value={edited}
              onChange={(e) => { setEdited(e.target.value); setFactsReviewed(false); setCopied(false); setDraft({ ...draft, approvedAt: null }); }}
            />
          </div>
          {!!draft.quality?.claims.length && <details className="text-xs"><summary className="cursor-pointer font-medium">Evidence for claims ({draft.quality.claims.length})</summary>
            <ul className="mt-2 space-y-3">{draft.quality.claims.map((claim, i) => {
              const citation = draft.citations.find(c => c.documentId === claim.documentId);
              return <li key={i}><p>{claim.sentence}</p><blockquote className="mt-1 border-l-2 pl-2">“{claim.quote}”</blockquote>
                {citation && <SafeLink href={citation.url} className="mt-1 inline-block underline">Open evidence</SafeLink>}
              </li>;
            })}</ul>
          </details>}
          {draft.flags.length > 0 ? (
            <ul className="text-xs text-amber-800 dark:text-amber-200">
              {draft.flags.map((f) => (
                <li key={f.claim}>
                  Flagged “{f.claim}”: {f.reason}
                </li>
              ))}
            </ul>
          ) : null}
          <div>
            <p className="text-xs font-medium text-zinc-500">Citations</p>
            <ul className="mt-1 space-y-1 text-xs">
              {draft.citations.map((c) => (
                <li key={c.url}>
                  <SafeLink href={c.url} className="underline">
                    {c.label}
                  </SafeLink>
                </li>
              ))}
            </ul>
          </div>
          {kind === "draft" && <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={factsReviewed} onChange={e => setFactsReviewed(e.target.checked)} />I verified the facts and checked that this adds something useful to the thread.</label>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !draftMatchesTarget || kind !== "draft"}
              onClick={() => void saveEdit()}
              className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium"
            >
              Save edits
            </button>
            <button
              type="button"
              disabled={busy || !draftMatchesTarget || !kind || kind === "abstain" || (kind === "draft" && (!factsReviewed || !rulesReviewed))}
              onClick={() => void approveAndCopy()}
              className="rounded-full bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white dark:bg-zinc-50 dark:text-zinc-950"
            >
              {kind === "brief" ? "Copy research brief" : "Approve & copy draft"}
            </button>
            <button
              type="button"
              disabled={busy || !draftMatchesTarget || !draft.approvedAt}
              onClick={openConversation}
              className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              {selected?.discoveryOnly ? "Open research source" : "Open conversation"}
            </button>
          </div>
          {copied ? (
            <p className="text-xs text-emerald-700">Copied to clipboard.</p>
          ) : null}
          {draft.approvedAt ? (
            <p className="text-xs text-zinc-500">
              Reviewed at {draft.approvedAt}. {kind === "brief" ? "Reference material only." : "Review again in the thread before posting."}
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-xs text-zinc-500">
          Prepare a useful contribution from verified evidence, or a research brief when drafting is unavailable.
        </p>
      )}
    </section>
  );
}
