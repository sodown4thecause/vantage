"use client";
import { FirstScanStatus } from "@/components/first-scan-status";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { ProfileDraftCard } from "@/components/profile-draft-card";
import { SafeLink } from "@/components/safe-link";
import { TopicTrends } from "@/components/topic-trends";
import { BlockList, SaveButton, type SavedArtifactSummary } from "@/components/workspace-blocks";
import { WorkspaceFrame } from "@/components/workspace-frame";
import { gtmResponseSchema } from "@/lib/gtm/schema";
import { FIELD_LABELS, PROFILE_FIELDS, type ProfileDraft, type ProfileField } from "@/lib/onboarding/draft";
import type { InterviewAnswers, InterviewPrompt, InterviewResponse, InterviewSuggestion } from "@/lib/onboarding/interview";
import type { OpportunityDetailView } from "@/lib/opportunities/types";
import { parseBlocks, type Block } from "@/lib/workspace/blocks";
import { LANE_LABELS } from "@/lib/workspace/saved-artifact-types";

import s from "./workspace.module.css";

export type NextAction = { prompt: string; reason: string };
export type Turn = { role: "user" | "assistant"; content: string; actions?: NextAction[]; evidence?: OpportunityDetailView[]; blocks?: Block[] };
/** Interview state from the server: a fresh first question, or an unfinished interview to resume. */
export type InterviewStart = { conversationId: string | null; prompt?: InterviewPrompt; turns: Turn[]; draft?: ProfileDraft; answers?: InterviewAnswers };

/** True while the derived profile card is waiting for the owner, i.e. the website is in and a profile field is open. */
export function showsDraftCard(draft: ProfileDraft | undefined, answers: InterviewAnswers): draft is ProfileDraft {
  return Boolean(draft && answers.productUrl) && PROFILE_FIELDS.some((field) => answers[field] === undefined);
}

export class WorkspaceRequestError extends Error {}

export function workspaceErrorCopy(error: unknown): string {
  return error instanceof WorkspaceRequestError ? error.message : "That didn’t work. Try again.";
}

export function starterActions(hasProfile: boolean, hasLeads: boolean): NextAction[] {
  if (!hasProfile) return [
    { prompt: "Help me define who we should reach first", reason: "A clear customer profile makes every opportunity more relevant." },
    { prompt: "What should I include in my product profile?", reason: "Identify the information we need before finding leads." },
    { prompt: "Help me choose the communities to monitor", reason: "Start where your buyers already discuss their problems." },
  ];
  if (!hasLeads) return [
    { prompt: "Help me plan my first lead search", reason: "Choose focused searches based on the product profile." },
    { prompt: "Which buying signals should I look for?", reason: "Separate active demand from general discussion." },
    { prompt: "Help me improve my targeting", reason: "Check whether the current audience and topics are specific enough." },
  ];
  return [
    { prompt: "Which conversation should I join first, and why?", reason: "Start with the strongest opportunity in your current queue." },
    { prompt: "Show me the buying intent behind these leads", reason: "Inspect the original messages before deciding what to do." },
    { prompt: "Help me plan a useful first response", reason: "Work out how to help without leading with a sales pitch." },
  ];
}

/** Always three: a failed save waiting for a retry has no question, so it offers a retry instead. */
export function interviewActions(prompt: InterviewPrompt | undefined): InterviewSuggestion[] {
  if (prompt) return prompt.suggestions.slice(0, 3);
  return [
    { kind: "answer", label: "Try saving again", reason: "Your answers are kept.", value: "Try again" },
    { kind: "ask", label: "What went wrong?", reason: "Why the save didn’t finish.", reply: "Saving your profile failed on our side. Your answers are safe; try again in a moment." },
    { kind: "ask", label: "Will I lose my answers?", reason: "Your progress is stored.", reply: "No. Your answers are stored in this workspace, so you can come back and finish later." },
  ];
}

const dateFormat = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" });

function Evidence({ evidence, workspaceId }: { evidence: OpportunityDetailView[]; workspaceId: string }) {
  return <>
    <div className={s.evidenceHead}><h2>Behind the answer</h2><span>{evidence.length}</span></div>
    <p className={s.evidenceIntro}>Real conversations from your queue. Read the source before you reply.</p>
    {evidence.length === 0 ? <p className={s.empty}>No current opportunities yet. Add sources and run a scan to bring real conversations into this workspace.</p> : evidence.map((item) => <article className={s.opportunity} key={item.id}>
      <div className={s.source}><span>{item.evidence[0]?.platform ?? "Conversation"}</span><span>{item.evidenceCount} supporting posts</span></div>
      <h3>{item.title}</h3>
      <p>{item.whyItMatters}</p>
      <p>Evidence captured <time dateTime={item.updatedAt}>{item.updatedAt.slice(0, 10)}</time></p>
      {item.evidence.slice(0, 2).map((post) => <div key={post.documentId}>
        <blockquote>{post.contentMd.length > 420 ? `${post.contentMd.slice(0, 420)}…` : post.contentMd}</blockquote>
        <SafeLink href={post.urlCanonical}>Read original on {post.platform} ↗</SafeLink>
      </div>)}
      <div className={s.evidenceLinks}><Link href={`/opportunities/${item.id}?workspaceId=${encodeURIComponent(workspaceId)}`}>Open opportunity →</Link></div>
    </article>)}
  </>;
}

function Saved({ workspaceId, items, onDelete }: { workspaceId: string; items: SavedArtifactSummary[]; onDelete: (id: string) => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function remove(id: string) {
    setPending(id);
    setError("");
    try {
      const response = await fetch(`/api/workspace/artifacts/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(workspaceId)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) throw new Error("delete failed");
      onDelete(id);
    } catch {
      setError("Couldn’t delete that item. Try again.");
    } finally {
      setPending(null);
    }
  }
  return <section className={s.saved} aria-labelledby="saved-heading">
    <div className={s.savedHead}><h2 id="saved-heading">Saved</h2><span>{items.length}</span></div>
    {error && <p role="alert" className={s.error}>{error}</p>}
    {items.length === 0 ? <p className={s.empty}>Nothing saved yet. Use Save on any answer, table or chart to keep it here.</p>
      : <ol className={s.savedList}>{items.map((item) => <li key={item.id} className={s.savedItem}>
        <div className={s.savedRow}>
          <div className={s.savedMeta}>
            <strong>{item.title}</strong>
            <span><span className={s.lane}>{LANE_LABELS[item.lane]}</span> <time dateTime={item.createdAt}>{dateFormat.format(new Date(item.createdAt))}</time></span>
          </div>
          <div className={s.savedButtons}>
            <button type="button" aria-expanded={openId === item.id} onClick={() => setOpenId(openId === item.id ? null : item.id)}>{openId === item.id ? "Close" : "Open"}</button>
            <button type="button" disabled={pending === item.id} onClick={() => void remove(item.id)} aria-label={`Delete ${item.title}`}>{pending === item.id ? "Deleting…" : "Delete"}</button>
          </div>
        </div>
        {openId === item.id && <BlockList blocks={item.blocks} />}
      </li>)}</ol>}
  </section>;
}

export function WorkspaceClient({ workspaceId, productName: initialProductName, hasProfile, initialEvidence, initialTurns = [], initialConversationId = null, configured, scanControl, interview, interviewOpen = false, savedArtifacts = [], conversations = [] }: {
  workspaceId: string;
  productName: string;
  hasProfile: boolean;
  initialEvidence: OpportunityDetailView[];
  initialTurns?: Turn[];
  initialConversationId?: string | null;
  configured: boolean;
  scanControl?: React.ReactNode;
  interview?: InterviewStart;
  /** Open the interview on load (the "Set up your product" link from other workspace pages). */
  interviewOpen?: boolean;
  savedArtifacts?: SavedArtifactSummary[];
  conversations?: { id: string; title: string }[];
}) {
  const [turns, setTurns] = useState(initialTurns);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showSetup, setShowSetup] = useState(true);
  const [profileSaved, setProfileSaved] = useState(false);
  const [productName, setProductName] = useState(initialProductName);
  const [saved, setSaved] = useState(savedArtifacts);
  const [setupOpen, setSetupOpen] = useState(Boolean(interview) && (interviewOpen || !hasProfile));
  const [setupPrompt, setSetupPrompt] = useState(interview?.prompt);
  const [setupTurns, setSetupTurns] = useState<Turn[]>(() => interview
    ? interview.turns.length ? interview.turns : interview.prompt ? [{ role: "assistant", content: interview.prompt.question }] : []
    : []);
  const [setupDraft, setSetupDraft] = useState(interview?.draft);
  const [setupAnswers, setSetupAnswers] = useState<InterviewAnswers>(interview?.answers ?? {});
  const conversationId = useRef(initialConversationId);
  const setupConversationId = useRef(interview?.conversationId ?? null);
  const requestInFlight = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const q = `?workspaceId=${encodeURIComponent(workspaceId)}`;
  const profileReady = hasProfile || profileSaved;
  const latest = turns.findLast((turn) => turn.role === "assistant");
  const evidence = latest?.evidence ?? initialEvidence;
  const actions = latest?.actions?.length === 3 ? latest.actions : starterActions(profileReady, evidence.length > 0);
  const visibleTurns = setupOpen ? setupTurns : turns;

  useEffect(() => {
    if (visibleTurns.length || busy) end.current?.scrollIntoView({ block: "end" });
  }, [visibleTurns, busy]);

  function openSetup() {
    // A fresh interview comes from the server so it can offer the current profile's answers. A full load is deliberate:
    // a client push to the same route would keep this component's finished-interview state.
    if (!interview || profileSaved) {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/workspace?${new URLSearchParams({ workspaceId, setup: "1" })}`);
      return;
    }
    setError("");
    setSetupOpen(true);
  }

  async function answerSetup(answer: string, shown = answer, confirm?: Partial<Record<ProfileField, string>>) {
    const message = answer.trim();
    if (!message || requestInFlight.current) return;
    requestInFlight.current = true;
    setBusy(true);
    setError("");
    const previous = setupTurns;
    setSetupTurns([...previous, { role: "user", content: shown }]);
    if (!confirm) setDraft("");
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const response = await fetch("/api/workspace/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, conversationId: setupConversationId.current ?? undefined, ...(confirm ? { confirm } : { answer: message }), timeZone }),
      });
      if (response.status === 403 || response.status === 401) throw new WorkspaceRequestError("Unable to access this workspace. Sign in again to continue.");
      if (response.status === 409) throw new WorkspaceRequestError("This setup was already finished in another tab. Reload the page to see your saved profile.");
      if (!response.ok) throw new WorkspaceRequestError("I couldn’t save that answer. It’s back in the composer so you can try again.");
      const result = await response.json() as InterviewResponse;
      if (result.rejected) {
        setSetupTurns([...previous, { role: "user", content: shown }, { role: "assistant", content: result.message }]);
        if (!confirm) setDraft(answer === shown ? message : "");
        return;
      }
      setupConversationId.current = result.conversationId;
      setSetupDraft(result.draft);
      setSetupAnswers(result.answers ?? {});
      const next: Turn[] = [...previous, { role: "user", content: shown }, { role: "assistant", content: result.message }];
      setSetupPrompt(result.prompt);
      if (result.profileSaved) {
        setProfileSaved(true);
        if (result.productName) setProductName(result.productName);
      }
      if (result.complete) {
        setProfileSaved(true);
        if (result.productName) setProductName(result.productName);
        setSetupOpen(false);
        setTurns(next);
        conversationId.current = null;
        window.history.replaceState(null, "", `/workspace${q}`);
      } else {
        setSetupTurns(next);
      }
    } catch (err) {
      setSetupTurns(previous);
      if (!confirm) setDraft(message);
      setError(workspaceErrorCopy(err));
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  }

  function chooseSuggestion(suggestion: InterviewSuggestion) {
    if (suggestion.kind === "answer") {
      void answerSetup(suggestion.value, suggestion.label);
      return;
    }
    setSetupTurns([...setupTurns, { role: "user", content: suggestion.label }, { role: "assistant", content: suggestion.reply }]);
  }

  async function send(prompt: string) {
    const message = prompt.trim();
    if (!message || requestInFlight.current || !configured) return;
    requestInFlight.current = true;
    setBusy(true);
    setError("");
    const previous = turns;
    setTurns([...previous, { role: "user", content: message }]);
    setDraft("");
    try {
      const response = await fetch("/api/gtm/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, conversationId: conversationId.current ?? undefined, message }),
      });
      if (!response.ok) {
        if (response.status === 429) throw new WorkspaceRequestError("The assistant allowance or provider budget is currently exhausted. Try again later or check your plan.");
        if (response.status === 403 || response.status === 401) throw new WorkspaceRequestError("Unable to access this workspace. Sign in again to continue.");
        throw new WorkspaceRequestError("The assistant couldn’t complete that request. Your question is back in the composer so you can retry.");
      }
      const parsed = gtmResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new WorkspaceRequestError("The assistant returned an invalid response. Your question is back in the composer so you can retry.");
      const result = parsed.data;
      conversationId.current = result.conversationId;
      setTurns([...previous, { role: "user", content: message }, { role: "assistant", content: result.answer, actions: result.actions, evidence: result.evidence, blocks: parseBlocks(result.blocks) }]);
      window.history.replaceState(null, "", `/workspace?${new URLSearchParams({ workspaceId, c: result.conversationId })}`);
    } catch (err) {
      setTurns(previous);
      setDraft(message);
      setError(workspaceErrorCopy(err));
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (setupOpen) void answerSetup(draft);
    else void send(draft);
  }

  const onSaved = (artifact: SavedArtifactSummary) => setSaved((items) => [artifact, ...items.filter((item) => item.id !== artifact.id)]);
  const composerEnabled = setupOpen || configured;

  return <WorkspaceFrame workspaceId={workspaceId} title="GTM" subtitle={productName} focused
    tools={<nav className={s.nav} aria-label="GTM tools">
          <button type="button" disabled={busy} onClick={() => {
            setTurns([]); setDraft(""); setError(""); conversationId.current = null;
            if (profileReady) setSetupOpen(false);
            window.history.replaceState(null, "", `/workspace${q}`);
          }}>＋ New conversation</button>
          <Link href={`/queue${q}`}>Opportunities <small>{initialEvidence.length}</small></Link>
          <Link href={`/settings/sources${q}`}>Sources</Link>
          <button type="button" disabled={busy} onClick={openSetup} aria-pressed={setupOpen}>{profileReady ? "Update product profile" : "Product profile"}</button>
          <Link href={`/settings/digest${q}`}>Daily digest</Link>
          {conversations.map((conversation) => <Link key={conversation.id}
            href={`/workspace${q}&c=${encodeURIComponent(conversation.id)}`}
            aria-current={initialConversationId === conversation.id ? "page" : undefined}
          >{conversation.title}</Link>)}
        </nav>}
    setup={showSetup ? <section className={s.setup} aria-label="Finish setting up">
        <div className="flex items-start justify-between gap-2"><h2>Finish setting up</h2><button type="button" aria-label="Dismiss setup checklist" onClick={() => setShowSetup(false)}>×</button></div>
        <progress value={Number(profileReady) + Number(initialEvidence.length > 0)} max={4} aria-label="Setup progress" />
        <button type="button" className={s.setupItem} onClick={openSetup} disabled={busy}>{profileReady ? "✓" : "○"} Set up your product</button>
        <p>○ Connect Search Console<small>Coming with SEO integration</small></p>
        <Link href={`/settings/sources${q}`}>{initialEvidence.length > 0 ? "✓" : "○"} Find your first leads</Link>
        <p>○ Write your first blog<small>Coming with Content</small></p>
      </section> : <button type="button" className={s.setup} onClick={() => setShowSetup(true)}>Show setup checklist</button>}>
      <div className={s.body}>
        <section className={s.conversation} aria-label="GTM assistant">
          <div className={s.scroll}>
            <TopicTrends workspaceId={workspaceId} />
            {setupOpen ? <div className={s.setupIntro}>
              <div className={s.eyebrow}><span className={s.spark} aria-hidden="true">✳</span> Set up your product{setupPrompt ? ` · Question ${setupPrompt.position} of ${setupPrompt.total}` : ""}</div>
              <p>A few quick questions so I can find conversations worth joining. You write every reply; nothing is posted on your behalf.</p>
              {profileReady && <button type="button" className={s.exitSetup} onClick={() => { setSetupOpen(false); setError(""); }}>Exit setup</button>}
            </div> : turns.length === 0 && <div className={s.intro}>
              <div className={s.eyebrow}><span className={s.spark} aria-hidden="true">✳</span> A little context. A better next move.</div>
              <h1>Find your people.<br />Start the right conversation.</h1>
              <p>Your GTM assistant connects the signals to the next step. Discover who needs what you build, understand the evidence, and decide where to show up.</p>
              <div className={s.context}><span>{profileReady ? productName : "Product profile needed"}</span><span>{initialEvidence.length} current opportunities</span><span>You write every reply</span></div>
              <div className={s.notice}>{scanControl}</div>
            </div>}
            {profileReady && <FirstScanStatus key={profileSaved ? "confirmed" : "existing"} workspaceId={workspaceId} />}
            {visibleTurns.length > 0 && <ol className={s.turns} aria-label={setupOpen ? "Product setup" : "Conversation"}>{visibleTurns.map((turn, index) => <li key={index} className={s.turn}>
              {turn.role === "user" ? <p className={s.user}>{turn.content}</p> : <>
                <div className={s.turnLabel}><span className={s.spark} aria-hidden="true">✳</span> Your GTM assistant</div>
                <div className={s.answer}>{turn.content}</div>
                {!setupOpen && turn.blocks && <BlockList blocks={turn.blocks} workspaceId={workspaceId} lane="gtm" onSaved={onSaved} />}
                {!setupOpen && turn.actions && <div className={s.answerTools}>
                  <SaveButton workspaceId={workspaceId} lane="gtm" onSaved={onSaved} label="Save answer"
                    title={visibleTurns[index - 1]?.role === "user" ? visibleTurns[index - 1]!.content : "GTM answer"}
                    blocks={[{ type: "text", text: turn.content.slice(0, 12000) }, ...(turn.blocks ?? []).filter((block) => block.type !== "text")]} />
                </div>}
              </>}
            </li>)}</ol>}
            {setupOpen && showsDraftCard(setupDraft, setupAnswers) && <ProfileDraftCard draft={setupDraft} answers={setupAnswers} busy={busy}
              onConfirm={(values) => void answerSetup("confirm", Object.keys(values).length > 1 ? "Looks right" : `Confirmed: ${FIELD_LABELS[Object.keys(values)[0] as ProfileField]}`, values)} />}
            {busy && <p role="status" className={s.notice}>{setupOpen
              ? setupPrompt?.step === "productUrl" ? "Reading your website and drafting your profile…" : "Saving your answer…"
              : "Reading your current opportunities and planning the next step…"}</p>}
            <div ref={end} />
            {!setupOpen && <details className={s.mobileEvidence}><summary>View supporting conversations ({evidence.length})</summary><div className="mt-5"><Evidence evidence={evidence} workspaceId={workspaceId} /></div></details>}
            <Saved workspaceId={workspaceId} items={saved} onDelete={(id) => setSaved((items) => items.filter((item) => item.id !== id))} />
          </div>
          <div className={s.dock}>
            <div className={s.nextLabel}><span>{setupOpen ? "Quick answers" : "Your next move"}</span><span>Three ways forward</span></div>
            <div className={s.actions} role="group" aria-label={setupOpen ? "Suggested answers" : "Recommended next actions"}>
              {setupOpen ? interviewActions(setupPrompt).map((suggestion, index) => <button type="button" key={suggestion.label} className={s.action} disabled={busy} onClick={() => chooseSuggestion(suggestion)}>
                <span className={s.actionNumber}>0{index + 1}</span><span><strong>{suggestion.label}</strong><small>{suggestion.reason}</small></span><span aria-hidden="true">{suggestion.kind === "answer" ? "↵" : "?"}</span>
              </button>) : actions.map((action, index) => <button type="button" key={action.prompt} className={s.action} disabled={busy || !configured} onClick={() => void send(action.prompt)}>
                <span className={s.actionNumber}>0{index + 1}</span><span><strong>{action.prompt}</strong>{index === 0 && <span className={s.recommended}>Recommended</span>}<small>{action.reason}</small></span><span aria-hidden="true">↗</span>
              </button>)}
            </div>
            {error && <p role="alert" className={s.error}>{error}</p>}
            {!configured && !setupOpen && <p role="status" className={s.notice}>The assistant needs an AI Gateway connection. Your sources and opportunity queue are still available.</p>}
            <form onSubmit={onSubmit} className={s.composer} aria-label={setupOpen ? "Answer the setup question" : "Ask your GTM assistant"}>
              <label htmlFor="gtm-message" className="sr-only">{setupOpen ? "Your answer" : "Your message"}</label>
              <textarea id="gtm-message" placeholder={setupOpen ? "Type your answer…" : "What do you want to grow today?"} maxLength={setupOpen ? 8000 : 2000} rows={2} value={draft}
                onChange={(event) => setDraft(event.target.value)} disabled={busy || !composerEnabled}
                onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && setupOpen) { event.preventDefault(); void answerSetup(draft); } }} />
              <div className={s.composerFooter}><span>{setupOpen ? "Product setup · Saved as you go" : "GTM assistant · Grounded in your workspace"}</span><button type="submit" aria-label={setupOpen ? "Send answer" : "Send message"} className={s.send} disabled={busy || !composerEnabled || !draft.trim()}>↑</button></div>
            </form>
            <p className={s.disclaimer}>{setupOpen ? "Setup answers don’t use your question allowance. Nothing is posted on your behalf." : "Uses your shared SEO assistant question allowance. Nothing is posted on your behalf."}</p>
          </div>
        </section>
        <aside className={s.evidence} aria-label="Supporting evidence"><Evidence evidence={evidence} workspaceId={workspaceId} /></aside>
      </div>
  </WorkspaceFrame>;
}
