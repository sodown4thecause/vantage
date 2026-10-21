"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { SafeLink } from "@/components/safe-link";
import { WorkspaceFrame } from "@/components/workspace-frame";
import { gtmResponseSchema } from "@/lib/gtm/schema";
import type { OpportunityDetailView } from "@/lib/opportunities/types";

import s from "./workspace.module.css";

export type NextAction = { prompt: string; reason: string };
export type Turn = { role: "user" | "assistant"; content: string; actions?: NextAction[]; evidence?: OpportunityDetailView[] };

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

export function WorkspaceClient({ workspaceId, productName, hasProfile, initialEvidence, initialTurns = [], initialConversationId = null, configured, scanControl }: {
  workspaceId: string;
  productName: string;
  hasProfile: boolean;
  initialEvidence: OpportunityDetailView[];
  initialTurns?: Turn[];
  initialConversationId?: string | null;
  configured: boolean;
  scanControl?: React.ReactNode;
}) {
  const [turns, setTurns] = useState(initialTurns);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showSetup, setShowSetup] = useState(true);
  const conversationId = useRef(initialConversationId);
  const requestInFlight = useRef(false);
  const scroll = useRef<HTMLDivElement>(null);
  const q = `?workspaceId=${encodeURIComponent(workspaceId)}`;
  const latest = turns.findLast((turn) => turn.role === "assistant");
  const evidence = latest?.evidence ?? initialEvidence;
  const actions = latest?.actions?.length === 3 ? latest.actions : starterActions(hasProfile, evidence.length > 0);

  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [turns, busy]);

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
        if (response.status === 429) throw new Error("The assistant allowance or provider budget is currently exhausted. Try again later or check your plan.");
        if (response.status === 403 || response.status === 401) throw new Error("Unable to access this workspace. Sign in again to continue.");
        throw new Error("The assistant couldn't complete that request. Your question is back in the composer so you can retry.");
      }
      const parsed = gtmResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("The assistant returned an invalid response. Your question is back in the composer so you can retry.");
      const result = parsed.data;
      conversationId.current = result.conversationId;
      setTurns([...previous, { role: "user", content: message }, { role: "assistant", content: result.answer, actions: result.actions, evidence: result.evidence }]);
      window.history.replaceState(null, "", `/workspace?${new URLSearchParams({ workspaceId, c: result.conversationId })}`);
    } catch (err) {
      setTurns(previous);
      setDraft(message);
      setError(err instanceof Error ? err.message : "That didn't work. Try again.");
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(draft);
  }

  return <WorkspaceFrame workspaceId={workspaceId} title="GTM" subtitle={productName} focused
    tools={<nav className={s.nav} aria-label="GTM tools">
          <button type="button" disabled={busy} onClick={() => {
            setTurns([]); setDraft(""); setError(""); conversationId.current = null;
            window.history.replaceState(null, "", `/workspace${q}`);
          }}>＋ New conversation</button>
          <Link href={`/queue${q}`}>Opportunities <small>{initialEvidence.length}</small></Link>
          <Link href={`/settings/sources${q}`}>Sources</Link>
          <Link href={`/onboarding${q}`}>Product profile</Link>
        </nav>}
    setup={showSetup ? <section className={s.setup} aria-label="Finish setting up">
        <div className="flex items-start justify-between gap-2"><h2>Finish setting up</h2><button type="button" aria-label="Dismiss setup checklist" onClick={() => setShowSetup(false)}>×</button></div>
        <progress value={Number(hasProfile) + Number(initialEvidence.length > 0)} max={4} aria-label="Setup progress" />
        <Link href={`/onboarding${q}`}>{hasProfile ? "✓" : "○"} Set up your product</Link>
        <p>○ Connect Search Console<small>Coming with SEO integration</small></p>
        <Link href={`/settings/sources${q}`}>{initialEvidence.length > 0 ? "✓" : "○"} Find your first leads</Link>
        <p>○ Write your first blog<small>Coming with Content</small></p>
      </section> : <button type="button" className={s.setup} onClick={() => setShowSetup(true)}>Show setup checklist</button>}>
      <div className={s.body}>
        <section className={s.conversation} aria-label="GTM assistant">
          <div className={s.scroll} ref={scroll}>
            {turns.length === 0 ? <div className={s.intro}>
              <div className={s.eyebrow}><span className={s.spark} aria-hidden="true">✳</span> A little context. A better next move.</div>
              <h1>Find your people.<br />Start the right conversation.</h1>
              <p>Your GTM assistant connects the signals to the next step. Discover who needs what you build, understand the evidence, and decide where to show up.</p>
              <div className={s.context}><span>{hasProfile ? productName : "Product profile needed"}</span><span>{initialEvidence.length} current opportunities</span><span>You write every reply</span></div>
              <div className={s.notice}>{scanControl}</div>
            </div> : <ol className={s.turns} aria-label="Conversation">{turns.map((turn, index) => <li key={index} className={s.turn}>
              {turn.role === "user" ? <p className={s.user}>{turn.content}</p> : <><div className={s.turnLabel}><span className={s.spark} aria-hidden="true">✳</span> Your GTM assistant</div><div className={s.answer}>{turn.content}</div></>}
            </li>)}</ol>}
            {busy && <p role="status" className={s.notice}>Reading your current opportunities and planning the next step…</p>}
            <details className={s.mobileEvidence}><summary>View supporting conversations ({evidence.length})</summary><div className="mt-5"><Evidence evidence={evidence} workspaceId={workspaceId} /></div></details>
          </div>
          <div className={s.dock}>
            <div className={s.nextLabel}><span>Your next move</span><span>Three ways forward</span></div>
            <div className={s.actions} role="group" aria-label="Recommended next actions">{actions.map((action, index) => <button type="button" key={action.prompt} className={s.action} disabled={busy || !configured} onClick={() => void send(action.prompt)}>
              <span className={s.actionNumber}>0{index + 1}</span><span><strong>{action.prompt}</strong>{index === 0 && <span className={s.recommended}>Recommended</span>}<small>{action.reason}</small></span><span aria-hidden="true">↗</span>
            </button>)}</div>
            {error && <p role="alert" className={s.error}>{error}</p>}
            {!configured && <p role="status" className={s.notice}>The assistant needs an AI Gateway connection. Your sources and opportunity queue are still available.</p>}
            <form onSubmit={onSubmit} className={s.composer} aria-label="Ask your GTM assistant">
              <label htmlFor="gtm-message" className="sr-only">Your message</label>
              <textarea id="gtm-message" placeholder="What do you want to grow today?" maxLength={2000} rows={2} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={busy || !configured} />
              <div className={s.composerFooter}><span>GTM assistant · Grounded in your workspace</span><button type="submit" aria-label="Send message" className={s.send} disabled={busy || !configured || !draft.trim()}>↑</button></div>
            </form>
            <p className={s.disclaimer}>Uses your shared SEO assistant question allowance. Nothing is posted on your behalf.</p>
          </div>
        </section>
        <aside className={s.evidence} aria-label="Supporting evidence"><Evidence evidence={evidence} workspaceId={workspaceId} /></aside>
      </div>
  </WorkspaceFrame>;
}
