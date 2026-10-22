"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { BlockList, SaveButton } from "@/components/workspace-blocks";

import { ResultCardView, type CardView } from "./cards";
import { seoCardBlocks } from "./seo-blocks";
import s from "@/app/workspace/workspace.module.css";
import {
  buildRequestBody,
  fromHistory,
  textOf,
  viewOf,
  type Category,
  type ChatMessage,
  type HistoryMessage,
  type PlannedCall,
  type View,
} from "./chat-wire";

/*
 * The SEO chat. Client-safe: it imports no server modules. Message shapes and the wire contract live in chat-wire.ts;
 * the server page passes stored messages in as plain data.
 */

export type Chip = { category: Category; text: string; costLabel: string };
export type { HistoryMessage };

const CATEGORY_LABEL: Record<Category, string> = { seo: "SEO", geo: "GEO", content: "Content" };
const TOOL_LABEL: Record<string, string> = {
  backlink_summary: "Backlink summary",
  referring_domains: "Referring domains",
  backlink_gap: "Backlink gap",
  anchors: "Anchor texts",
  keyword_ideas: "Keyword ideas",
  keyword_overview: "Keyword overview",
  ranked_keywords: "Ranked keywords",
  competitor_domains: "Competitor domains",
  keyword_gap: "Keyword gap",
  google_serp: "Google results",
  llm_response: "AI answer",
  ai_keyword_volume: "AI search volume",
};
const RUN_TEXT = "Run the planned lookups";

function inputSummary(input: Record<string, unknown>): string {
  return Object.values(input)
    .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
    .join(" · ");
}

function ChipButton({
  category,
  text,
  costLabel,
  disabled,
  onSend,
  index,
}: {
  category: Category;
  text: string;
  costLabel?: string;
  disabled: boolean;
  onSend: (text: string) => void;
  index: number;
}) {
  // The cost is described by the button, so screen readers announce it after the question.
  const costId = useId();
  return (
    <button
      type="button"
      aria-label={`${CATEGORY_LABEL[category]} question: ${text}`}
      aria-describedby={costLabel ? costId : undefined}
      disabled={disabled}
      onClick={() => onSend(text)}
      className={s.action}
    >
      <span className={s.actionNumber}>0{index + 1}</span>
      <span><strong>{text}</strong>{index === 0 && <span className={s.recommended}>Recommended</span>}<small>{CATEGORY_LABEL[category]}</small>{costLabel && <span id={costId} className="text-xs text-ridge">{costLabel}</span>}</span>
      <span aria-hidden="true">↗</span>
    </button>
  );
}

function ApprovalBox({
  messageId,
  plan,
  busy,
  onRun,
  onCancel,
}: {
  messageId: string;
  plan: PlannedCall[];
  busy: boolean;
  onRun: (messageId: string) => void;
  onCancel: (messageId: string) => void;
}) {
  const total = plan.reduce((sum, call) => sum + call.credits, 0);
  return (
    <section aria-label="Planned lookups" className="space-y-3 rounded border border-contour p-4">
      <p className="text-sm font-semibold">These lookups need your approval before they run.</p>
      <ul className="space-y-1 text-sm">
        {plan.map((call, i) => (
          <li key={`${i}-${call.tool}`}>
            <span className="font-medium">{TOOL_LABEL[call.tool] ?? call.tool}</span>
            <span className="ml-2 text-ridge">{inputSummary(call.input)}</span>
            <span className="ml-2 text-ridge">
              {call.credits} {call.credits === 1 ? "credit" : "credits"}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-sm">
        Total: {total} {total === 1 ? "credit" : "credits"}
      </p>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn" disabled={busy} onClick={() => onRun(messageId)}>
          Run it
        </button>
        <button type="button" className="btn-quiet" onClick={() => onCancel(messageId)}>
          Cancel
        </button>
      </div>
    </section>
  );
}

/** Backlink and ranking cards render as a table plus a chart, each with Save; other cards keep their own view. */
function SeoResult({ card, sandbox, workspaceId, lane, saveAllowed }: { card: CardView; sandbox: boolean; workspaceId: string; lane: "seo" | "geo"; saveAllowed: boolean }) {
  const blocks = seoCardBlocks(card);
  if (!blocks.length) return <ResultCardView card={card} sandbox={sandbox} />;
  const isSandbox = card.sandbox ?? sandbox;
  const cachedLabel = card.cached ? (card.fetchedAt ? `Cached ${card.fetchedAt.slice(0, 10)}` : "Cached") : null;
  return (
    <section className="space-y-3" data-tool={card.tool}>
      {(cachedLabel || isSandbox) && <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ridge">
        {cachedLabel && <span className="rounded-full px-2.5 py-0.5 shadow-[inset_0_0_0_1px_var(--contour)]">{cachedLabel}</span>}
        {isSandbox && <span className="font-semibold">Sandbox data: not real figures.</span>}
      </p>}
      <BlockList blocks={blocks} workspaceId={isSandbox || !saveAllowed ? undefined : workspaceId} lane={lane} />
    </section>
  );
}

function AssistantAnswer({
  view,
  busy,
  sandbox,
  approvalOpen,
  onRun,
  onCancel,
  showCards,
  workspaceId,
  lane,
  saveAllowed,
}: {
  workspaceId: string;
  lane: "seo" | "geo";
  view: View;
  busy: boolean;
  sandbox: boolean;
  approvalOpen: boolean;
  onRun: (messageId: string) => void;
  onCancel: (messageId: string) => void;
  showCards: boolean;
  saveAllowed: boolean;
}) {
  const incomplete = view.status === "incomplete";
  const hasSandboxCards = view.cards.some((card) => card.sandbox ?? sandbox);
  const answerText = hasSandboxCards ? `Sandbox data: not real figures. This answer includes illustrative sandbox research.

${view.text}` : view.text;
  const awaitingApproval = view.status === "needs_approval" && view.plan.length > 0 && Boolean(view.messageId) && approvalOpen;
  return (
    <div className="space-y-6">
      {view.text &&
        (incomplete ? (
          <p className="text-ridge">{view.text}</p>
        ) : (
          <p className={s.answer}>{view.text}</p>
        ))}
      {showCards && view.cards.length > 0 && (
        <div className="space-y-10">
          {view.cards.map((card, i) => (
            <SeoResult key={`${i}-${card.tool}`} card={card} sandbox={sandbox} workspaceId={workspaceId} lane={lane} saveAllowed={saveAllowed} />
          ))}
        </div>
      )}
      {view.notices.length > 0 && (
        <ul className="space-y-1 text-sm text-ridge">
          {view.notices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      )}
      {hasSandboxCards && !sandbox && <p className="text-xs font-semibold text-ridge">This answer includes sandbox data: not real figures. Saved answers keep this warning and exclude sandbox visuals.</p>}
      {view.text && saveAllowed && !sandbox && (
        <SaveButton workspaceId={workspaceId} lane={lane} label="Save answer" title={view.text.split(/\r?\n/)[0]!.slice(0, 120) || "Research answer"}
          blocks={[{ type: "text" as const, text: answerText.slice(0, 12000) }, ...view.cards.filter((card) => !(card.sandbox ?? sandbox)).flatMap((card) => seoCardBlocks(card))].slice(0, 12)} />
      )}
      {awaitingApproval && view.messageId && (
        <ApprovalBox messageId={view.messageId} plan={view.plan} busy={busy} onRun={onRun} onCancel={onCancel} />
      )}
      <p className="text-xs text-ridge">Credits used: {view.creditsUsed}</p>
    </div>
  );
}

function AssistantTurn({
  message,
  busy,
  sandbox,
  closedPlans,
  onRun,
  onCancel,
  showCards,
  workspaceId,
  lane,
  streaming,
}: {
  workspaceId: string;
  lane: "seo" | "geo";
  message: ChatMessage;
  busy: boolean;
  sandbox: boolean;
  closedPlans: ReadonlySet<string>;
  onRun: (messageId: string) => void;
  onCancel: (messageId: string) => void;
  showCards: boolean;
  streaming: boolean;
}) {
  const view = viewOf(message);
  return (
    <AssistantAnswer
      view={view}
      busy={busy}
      sandbox={sandbox}
      approvalOpen={!closedPlans.has(view.messageId ?? "")}
      onRun={onRun}
      onCancel={onCancel}
      showCards={showCards}
      workspaceId={workspaceId}
      lane={lane}
      saveAllowed={!streaming && message.metadata?.status === "complete"}
    />
  );
}

export function ChatClient({
  workspaceId,
  conversationId,
  initialMessages,
  starters,
  sandbox,
  focus = "seo",
}: {
  workspaceId: string;
  /** The conversation in the URL, or null for a new chat. */
  conversationId: string | null;
  initialMessages: HistoryMessage[];
  starters: Chip[];
  sandbox: boolean;
  focus?: "seo" | "geo";
}) {
  const router = useRouter();
  // The conversation this client talks to. Set from the first metadata chunk, so the next request continues it.
  const conversationRef = useRef<string | null>(conversationId);
  const [initial] = useState(() => initialMessages.map(fromHistory));
  const [draft, setDraft] = useState("");
  const scroll = useRef<HTMLDivElement>(null);
  // Plans the owner has run or cancelled; their approval box is hidden.
  const [closedPlans, setClosedPlans] = useState<ReadonlySet<string>>(() => new Set());
  // The plan whose Run it request is in flight. Its box reopens only when the server says the plan went back.
  const runningPlan = useRef<string | null>(null);
  const reopenPlan = () => {
    const ran = runningPlan.current;
    runningPlan.current = null;
    if (!ran) return;
    setClosedPlans((closed) => {
      const next = new Set(closed);
      next.delete(ran);
      return next;
    });
  };

  const [transport] = useState(
    () =>
      new DefaultChatTransport<ChatMessage>({
        api: "/seo/chat",
        // The conversation id arrives per request in `body`, read by the event handlers, so this closure reads no refs.
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: buildRequestBody({
            workspaceId,
            conversationId: typeof body?.conversationId === "string" ? body.conversationId : undefined,
            messages,
            body,
          }),
        }),
      }),
  );

  const { messages, sendMessage, status, error } = useChat<ChatMessage>({
    transport,
    messages: initial,
    onFinish: ({ message }) => {
      if (message.metadata?.planReturned) reopenPlan();
      else runningPlan.current = null;
      const id = message.metadata?.conversationId ?? conversationRef.current;
      if (!id) return;
      conversationRef.current = id;
      // Once the first answer has ended, the URL names the conversation, so a reload restores it. No full reload.
      if (id !== conversationId) router.replace(`/seo?${new URLSearchParams({ workspaceId, c: id, ...(focus === "geo" ? { focus } : {}) }).toString()}`);
    },
  });

  useEffect(() => {
    const latest = messages.findLast((message) => message.metadata?.conversationId);
    if (latest?.metadata?.conversationId) conversationRef.current = latest.metadata.conversationId;
  }, [messages]);

  const busy = status === "submitted" || status === "streaming";

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    void sendMessage({ text: trimmed }, { body: { conversationId: conversationRef.current ?? undefined } });
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || draft.trim() === "") return;
    send(draft);
    setDraft("");
  };

  const runPlan = (messageId: string) => {
    runningPlan.current = messageId;
    setClosedPlans((closed) => new Set(closed).add(messageId));
    void sendMessage(
      { text: RUN_TEXT },
      { body: { approvePlan: messageId, conversationId: conversationRef.current ?? undefined } },
    );
  };

  const cancelPlan = (messageId: string) => {
    setClosedPlans((closed) => new Set(closed).add(messageId));
  };

  const empty = messages.length === 0;
  const latest = messages.findLast((message) => message.role === "assistant");
  const latestView = latest ? viewOf(latest) : null;
  const categories: Category[] = focus === "geo" ? ["geo", "seo", "content"] : ["seo", "geo", "content"];
  const fallback: Record<Category, string> = {
    seo: "Help me choose a focused search research question",
    geo: "Help me plan research into AI answers about my product",
    content: "Help me turn the research into a useful content brief",
  };
  const actions = categories.map((category) => latestView?.followUps
    ? { category, text: latestView.followUps[category], costLabel: undefined }
    : starters.find((chip) => chip.category === category) ?? { category, text: fallback[category], costLabel: undefined });
  const evidence = <>
    <div className={s.evidenceHead}><h2>Behind the answer</h2><span>{latestView?.cards.length ?? 0}</span></div>
    <p className={s.evidenceIntro}>{sandbox ? "Sandbox data: not real figures." : "Research results from this conversation. Check the source and capture date before making a decision."}</p>
    {latestView?.cards.length ? latestView.cards.map((card, index) => <div className={s.opportunity} key={`${index}-${card.tool}`}><SeoResult card={card} sandbox={sandbox} workspaceId={workspaceId} lane={focus} saveAllowed={!busy && latest?.metadata?.status === "complete"} /></div>) : <p className={s.empty}>No research results in this answer yet. Ask a question to plan the next step; any results will appear here.</p>}
  </>;

  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "instant" });
  }, [messages, status]);

  return (
    <div className={s.body}>
      <section className={s.conversation} aria-label={`${CATEGORY_LABEL[focus]} assistant`}>
      <div className={s.scroll} ref={scroll}>
      {empty ? (
        <div className={s.intro}>
          <div className={s.eyebrow}><span className={s.spark} aria-hidden="true">✳</span>Research with context. Decide with evidence.</div>
          <h1>{focus === "geo" ? "Understand your AI visibility." : "Find your search opportunity."}</h1>
          <p>Ask about search, AI answers and content. Explore the data behind the answer and review planned lookups before approving them.</p>
          <div className={s.context}><span>{sandbox ? "Sandbox data · Not real figures" : "Workspace research"}</span><span>You approve planned lookups</span><span>Nothing is published</span></div>
        </div>
      ) : (
        <ol aria-label="Conversation" className={s.turns}>
          {messages.map((message) => (
            <li key={message.id} className={s.turn}>
              {message.role === "user" ? (
                <p className={s.user}>
                  {textOf(message)}
                </p>
              ) : (
                <><div className={s.turnLabel}><span className={s.spark} aria-hidden="true">✳</span>Your research assistant</div><AssistantTurn
                  message={message}
                  busy={busy}
                  streaming={busy && message.id === latest?.id}
                  sandbox={sandbox}
                  closedPlans={closedPlans}
                  onRun={runPlan}
                  onCancel={cancelPlan}
                  showCards={message.id !== latest?.id}
                  workspaceId={workspaceId}
                  lane={focus}
                /></>
              )}
            </li>
          ))}
        </ol>
      )}

      <p role="status" className={s.notice}>
        {busy ? "Working on it. Lookups that are already cached are free." : ""}
      </p>
      <details className={s.mobileEvidence}><summary>View supporting research ({latestView?.cards.length ?? 0})</summary><div className="mt-5">{evidence}</div></details>
      </div>
      <div className={s.dock}>
      <div className={s.nextLabel}><span>Your next move</span><span>Three ways forward</span></div>
      <div className={s.actions} role="group" aria-label="Recommended next actions">{actions.map((chip, index) => <ChipButton key={chip.category} category={chip.category} text={chip.text} costLabel={chip.costLabel} disabled={busy} onSend={send} index={index} />)}</div>
      {error && (
        <p role="alert" className={s.error}>
          That did not work. Try again.
        </p>
      )}

      <form onSubmit={onSubmit} className={s.composer} aria-label="Ask a question">
          <label htmlFor="seo-question" className="sr-only">
            Your question
          </label>
          <textarea
            id="seo-question"
            name="message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={2000}
            autoComplete="off"
            rows={2}
            placeholder="Ask about SEO, GEO or content"
          />
          <div className={s.composerFooter}><span>{CATEGORY_LABEL[focus]} research · Grounded in your workspace</span><button type="submit" className={s.send} aria-label="Send question" disabled={busy || draft.trim() === ""}>↑</button></div>
      </form>
      <p className={s.disclaimer}>{sandbox ? "Sandbox data is illustrative, not real figures. " : ""}Lookup costs appear with planned approvals. Nothing is published on your behalf.</p>
      </div>
      </section>
      <aside className={s.evidence} aria-label="Supporting research">{evidence}</aside>
    </div>
  );
}
