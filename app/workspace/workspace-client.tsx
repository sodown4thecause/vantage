"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { FirstScanStatus } from "@/components/first-scan-status";
import { SafeLink } from "@/components/safe-link";
import { BlockList, SaveButton, type SavedArtifactSummary } from "@/components/workspace-blocks";
import { GtmChatParts } from "@/components/gtm-chat-parts";
import { WorkspaceFrame } from "@/components/workspace-frame";
import { gtmDataSchemas, validateGtmMessages, type GtmUIMessage } from "@/lib/gtm/chat/types";
import type { GtmJob } from "@/lib/gtm/chat/jobs";
import type { StrategyProposal, StrategyState } from "@/lib/gtm/proposals/types";
import type { OpportunityDetailView } from "@/lib/opportunities/types";
import type { MonitoringProfileView } from "@/lib/profile/types";
import type { Block } from "@/lib/workspace/blocks";
import { LANE_LABELS } from "@/lib/workspace/saved-artifact-types";
import s from "./workspace.module.css";

export type NextAction = { prompt: string; reason: string };
export type Turn = { role: "user" | "assistant"; content: string; actions?: NextAction[]; evidence?: OpportunityDetailView[]; blocks?: Block[] };
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

export function WorkspaceClient({ workspaceId, productName, hasProfile, profile = null, initialEvidence, initialMessages = [], initialRevision = 0, initialConversationId = null, initialTurn = null, initialJobs = [], initialProposal = null, configured, scanControl, setupOpen = false, savedArtifacts = [], conversations = [] }: {
  workspaceId: string; productName: string; hasProfile: boolean; profile?: MonitoringProfileView | null;
  initialEvidence: OpportunityDetailView[]; initialMessages?: GtmUIMessage[]; initialRevision?: number; initialConversationId?: string | null;
  configured: boolean; scanControl?: React.ReactNode; setupOpen?: boolean;
  initialTurn?: { requestId: string; state: "running" | "complete" | "interrupted" } | null;
  initialJobs?: GtmJob[];
  initialProposal?: StrategyProposal | null;
  savedArtifacts?: SavedArtifactSummary[]; conversations?: { id: string; title: string }[];
}) {
  const [draft, setDraft] = useState(setupOpen ? "Help me review and improve my product strategy" : "");
  const [notice, setNotice] = useState(initialTurn?.state === "running" ? "This turn is still finishing. Recover progress shortly." : "");
  const [saved, setSaved] = useState(savedArtifacts);
  const [jobs, setJobs] = useState(initialJobs);
  const [proposal, setProposal] = useState(initialProposal);
  const [confirmedProfile, setConfirmedProfile] = useState(profile);
  const profileReady = Boolean(confirmedProfile) || hasProfile;
  const [recovering, setRecovering] = useState(false);
  const [lastTurn, setLastTurn] = useState<{ requestId: string; state: string } | null>(initialTurn);
  const conversationId = useRef(initialConversationId), revision = useRef(initialRevision), inFlight = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const q = `?workspaceId=${encodeURIComponent(workspaceId)}`;
  const { messages, setMessages, sendMessage, stop, status, error, clearError } = useChat<GtmUIMessage>({
    id: initialConversationId ?? "new", messages: initialMessages, resume: false,
    transport: new DefaultChatTransport({ api: "/api/gtm/chat", prepareSendMessagesRequest: ({ body }) => ({ body: body ?? {} }) }),
    onFinish: async () => { await recover(); },
    onError: () => { setNotice("The answer didn’t finish. Recover saved progress before continuing."); },
  });
  const busy = status === "submitted" || status === "streaming" || recovering || lastTurn?.state === "running";
  async function recover() {
    if (!conversationId.current) return;
    setRecovering(true);
    try {
      const response = await fetch(`/api/gtm/chat?${new URLSearchParams({ workspaceId, conversationId: conversationId.current })}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const data = await response.json();
      const stored = await validateGtmMessages(data.messages);
      if (!Number.isSafeInteger(data.revision)) throw new Error();
      revision.current = data.revision;
      setLastTurn(data.turn ?? null);
      setJobs(gtmDataSchemas.job.array().max(20).parse(data.jobs ?? []));
      setProposal(data.proposal ? gtmDataSchemas.proposal.parse(data.proposal) : null);
      setMessages(stored); clearError();
      setNotice(data.turn?.state === "running" ? "This turn is still finishing. Recover progress again shortly." : "Saved progress loaded. You can retry an interrupted answer or continue with a new message.");
    } catch { setNotice("Couldn’t reload saved progress. Try again shortly; your draft is kept."); }
    finally { setRecovering(false); }
  }
  async function send(prompt: string, scanRequested = false, retryOf?: string) {
    const text = prompt.trim();
    if (!text || busy || inFlight.current || !configured) return;
    inFlight.current = true;
    const create = conversationId.current === null;
    conversationId.current ??= crypto.randomUUID();
    const requestId = crypto.randomUUID();
    setDraft(""); setNotice(""); clearError();
    window.history.replaceState(null, "", `/workspace${q}&c=${conversationId.current}`);
    try { await sendMessage(retryOf ? undefined : { text }, { body: { workspaceId, conversationId: conversationId.current, expectedRevision: revision.current, requestId, message: text, create, scanRequested, ...(retryOf ? { retryOf } : {}) } }); }
    catch { setDraft(text); setNotice("That didn’t finish. Recover saved progress before trying again."); }
    finally { inFlight.current = false; }
  }
  function onSubmit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void send(draft); }
  function onSaved(item: SavedArtifactSummary) { setSaved(items => [item, ...items.filter(saved => saved.id !== item.id)]); }
  function onConfirmed(state: StrategyState) { setConfirmedProfile(state.profile); }
  useEffect(() => { if (messages.length || busy) end.current?.scrollIntoView({ block: "end" }); }, [messages, busy]);
  const actions = starterActions(profileReady, initialEvidence.length > 0);
  return <WorkspaceFrame workspaceId={workspaceId} active="workspace" focused title={productName} subtitle="Your GTM workspace"
    tools={<nav className={s.nav} aria-label="GTM tools">
      <Link href={`/workspace${q}`}>＋ New conversation</Link>
      <Link href={`/queue${q}`}>Opportunities <small>{initialEvidence.length}</small></Link>
      <Link href={`/settings/sources${q}`}>Sources</Link>
      <button type="button" disabled={busy} onClick={() => setDraft("Help me review and improve my product strategy")}>Update product profile</button>
      <Link href={`/settings/digest${q}`}>Daily digest</Link>
      {conversations.map(conversation => <Link key={conversation.id} href={`/workspace${q}&c=${encodeURIComponent(conversation.id)}`} aria-current={initialConversationId === conversation.id ? "page" : undefined}>{conversation.title}</Link>)}
    </nav>}
    setup={<section className={s.setup} aria-label="Confirmed strategy">
      <h2>Confirmed strategy</h2><progress value={Number(profileReady) + Number(initialEvidence.length > 0)} max={2} aria-label="Setup progress" />
      {confirmedProfile ? <><p>{confirmedProfile.productDescription}</p><p>Audience: {confirmedProfile.targetCustomer}</p><p>Topics: {confirmedProfile.topics?.join(", ")}</p></> : <p>No confirmed product profile yet. Tell the assistant what you build and who it helps.</p>}
      <h3>Research gaps</h3><p>{!profileReady ? "Product, customer and source choices need confirmation." : initialEvidence.length ? "Check the supporting conversations before deciding what to do." : "No current conversation evidence. Confirm sources before requesting a scan."}</p>
    </section>}>
    <div className={s.body}><section className={s.conversation} aria-label="GTM assistant"><div className={s.scroll}>
      {messages.length === 0 && <div className={s.intro}><div className={s.eyebrow}>A little context. A better next move.</div><h1>Find your people.<br />Start the right conversation.</h1><p>Discuss your product, examine the evidence, and review proposed changes before they become your strategy.</p><div className={s.context}><span>{profileReady ? productName : "Product profile needed"}</span><span>{initialEvidence.length} current opportunities</span><span>You write every reply</span></div><div className={s.notice}>{scanControl}</div></div>}
      {profileReady && <FirstScanStatus workspaceId={workspaceId} />}
      {proposal && !messages.some(message => message.parts.some(part => part.type === "data-proposal" && part.data.id === proposal.id)) && <GtmChatParts workspaceId={workspaceId} onConfirmed={onConfirmed} message={{ id: proposal.id, role: "assistant", parts: [{ type: "data-proposal", data: proposal }] }} />}
      {jobs.filter(job => !messages.some(message => message.parts.some(part => part.type === "data-job" && part.data.id === job.id))).map(job => <GtmChatParts key={job.id} workspaceId={workspaceId} message={{ id: job.id, role: "assistant", parts: [{ type: "data-job", data: job }] }} />)}
      {messages.length > 0 && <ol className={s.turns} aria-label="Conversation">{messages.map(message => <li key={message.id} className={s.turn}>
        <div className={message.role === "user" ? s.user : s.answer}><GtmChatParts message={message} workspaceId={workspaceId} onSaved={onSaved} onConfirmed={onConfirmed} /></div>
        {message.role === "assistant" && message.parts.some(part => part.type === "text" && part.text) && <SaveButton workspaceId={workspaceId} lane="gtm" onSaved={onSaved} label="Save answer" title="GTM answer" blocks={[{ type: "text", text: message.parts.filter(part => part.type === "text").map(part => part.text).join("\n").slice(0, 12000) }]} />}
      </li>)}</ol>}
      {busy && <p role="status" className={s.notice}>{recovering ? "Recovering saved progress…" : "Working on your next move…"}</p>}
      <div ref={end} />
      <details className={s.mobileEvidence}><summary>View supporting conversations ({initialEvidence.length})</summary><Evidence evidence={initialEvidence} workspaceId={workspaceId} /></details>
      <Saved workspaceId={workspaceId} items={saved} onDelete={id => setSaved(items => items.filter(item => item.id !== id))} />
    </div><div className={s.dock}>
      {messages.length === 0 && <div className={s.actions} role="group" aria-label="Recommended next actions">{actions.map((action, index) => <button type="button" key={action.prompt} className={s.action} disabled={busy || !configured} onClick={() => void send(action.prompt)}><span><strong>{action.prompt}</strong>{index === 0 && <span className={s.recommended}>Recommended</span>}<small>{action.reason}</small></span></button>)}</div>}
      {(error || notice) && <p role={error ? "alert" : "status"} className={s.notice}>{notice || workspaceErrorCopy(error)} <button type="button" disabled={recovering || status === "streaming" || status === "submitted"} onClick={() => void recover()}>Recover saved progress</button></p>}
      {lastTurn?.state === "interrupted" && <p className={s.disclaimer}><button type="button" disabled={busy || !configured} onClick={() => void send(messages.findLast(m => m.role === "user")?.parts.filter(p => p.type === "text").map(p => p.text).join("\n") ?? "", false, lastTurn.requestId)}>Retry answer</button> · Starts a new paid attempt and keeps the original message. Background scans are not repeated.</p>}
      {!configured && <p role="status" className={s.notice}>The assistant needs an AI Gateway connection. Your sources and opportunity queue are still available.</p>}
      <form onSubmit={onSubmit} className={s.composer} aria-label="Ask your GTM assistant"><label htmlFor="gtm-message" className="sr-only">Your message</label>
        <textarea id="gtm-message" placeholder="What do you want to grow today?" maxLength={2000} rows={2} value={draft} onChange={event => setDraft(event.target.value)} disabled={!configured}
          onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(draft); } }} />
        <div className={s.composerFooter}><span>GTM assistant · Grounded in your workspace</span>{status === "streaming" || status === "submitted" ? <button type="button" onClick={() => { void stop(); setNotice("Stopped the foreground answer. Background scans continue; use Cancel scan to stop one."); }}>Stop</button> : <button type="submit" aria-label="Send message" className={s.send} disabled={busy || !configured || !draft.trim()}>↑</button>}</div>
      </form>
      {profileReady && <p className={s.disclaimer}><button type="button" disabled={busy || !configured} onClick={() => void send("Run a one-off scan of my confirmed sources and show its job status.", true)}>Scan confirmed sources</button> · Uses provider budget and continues in the background.</p>}
      <p className={s.disclaimer}>Uses your shared SEO assistant question allowance. Nothing is posted on your behalf.</p>
    </div></section><aside className={s.evidence} aria-label="Supporting evidence"><Evidence evidence={initialEvidence} workspaceId={workspaceId} /></aside></div>
  </WorkspaceFrame>;
}
