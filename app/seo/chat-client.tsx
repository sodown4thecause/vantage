"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { ResultCardView } from "./cards";
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
}: {
  category: Category;
  text: string;
  costLabel?: string;
  disabled: boolean;
  onSend: (text: string) => void;
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
      className="rounded-full px-3 py-1.5 text-left text-sm shadow-[inset_0_0_0_1px_var(--contour)] transition-colors hover:text-ink disabled:opacity-50"
    >
      <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-ridge">{CATEGORY_LABEL[category]}</span>
      <span>{text}</span>
      {costLabel && <span id={costId} className="ml-2 text-xs text-ridge">{costLabel}</span>}
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

function AssistantAnswer({
  view,
  busy,
  sandbox,
  approvalOpen,
  onRun,
  onCancel,
  onSend,
}: {
  view: View;
  busy: boolean;
  sandbox: boolean;
  approvalOpen: boolean;
  onRun: (messageId: string) => void;
  onCancel: (messageId: string) => void;
  onSend: (text: string) => void;
}) {
  const incomplete = view.status === "incomplete";
  const awaitingApproval = view.status === "needs_approval" && view.plan.length > 0 && Boolean(view.messageId) && approvalOpen;
  return (
    <div className="space-y-6">
      {view.text &&
        (incomplete ? (
          <p className="text-ridge">{view.text}</p>
        ) : (
          <p className="whitespace-pre-line text-lg leading-snug">{view.text}</p>
        ))}
      {view.cards.length > 0 && (
        <div className="space-y-10">
          {view.cards.map((card, i) => (
            <ResultCardView key={`${i}-${card.tool}`} card={card} sandbox={sandbox} />
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
      {awaitingApproval && view.messageId && (
        <ApprovalBox messageId={view.messageId} plan={view.plan} busy={busy} onRun={onRun} onCancel={onCancel} />
      )}
      {view.followUps && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Follow-up questions">
          <ChipButton category="seo" text={view.followUps.seo} disabled={busy} onSend={onSend} />
          <ChipButton category="geo" text={view.followUps.geo} disabled={busy} onSend={onSend} />
          <ChipButton category="content" text={view.followUps.content} disabled={busy} onSend={onSend} />
        </div>
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
  onSend,
}: {
  message: ChatMessage;
  busy: boolean;
  sandbox: boolean;
  closedPlans: ReadonlySet<string>;
  onRun: (messageId: string) => void;
  onCancel: (messageId: string) => void;
  onSend: (text: string) => void;
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
      onSend={onSend}
    />
  );
}

export function ChatClient({
  workspaceId,
  conversationId,
  initialMessages,
  starters,
  sandbox,
}: {
  workspaceId: string;
  /** The conversation in the URL, or null for a new chat. */
  conversationId: string | null;
  initialMessages: HistoryMessage[];
  starters: Chip[];
  sandbox: boolean;
}) {
  const router = useRouter();
  // The conversation this client talks to. Set from the first metadata chunk, so the next request continues it.
  const conversationRef = useRef<string | null>(conversationId);
  const [initial] = useState(() => initialMessages.map(fromHistory));
  const [draft, setDraft] = useState("");
  // Plans the owner has run or cancelled; their approval box is hidden.
  const [closedPlans, setClosedPlans] = useState<ReadonlySet<string>>(() => new Set());

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
      const id = message.metadata?.conversationId ?? conversationRef.current;
      if (!id) return;
      conversationRef.current = id;
      // Once the first answer has ended, the URL names the conversation, so a reload restores it. No full reload.
      if (id !== conversationId) router.replace(`/seo?${new URLSearchParams({ workspaceId, c: id }).toString()}`);
    },
  });

  useEffect(() => {
    const latest = [...messages].reverse().find((message) => message.metadata?.conversationId);
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

  return (
    <div className="space-y-10">
      {empty ? (
        <div role="group" aria-label="Starter questions" className="flex flex-wrap gap-2">
          {starters.map((chip) => (
            <ChipButton key={chip.category} category={chip.category} text={chip.text} costLabel={chip.costLabel} disabled={busy} onSend={send} />
          ))}
        </div>
      ) : (
        <ol aria-label="Conversation" className="space-y-12">
          {messages.map((message) => (
            <li key={message.id}>
              {message.role === "user" ? (
                <p className="ml-auto max-w-prose rounded px-4 py-3 text-right font-medium shadow-[inset_0_0_0_1px_var(--contour)]">
                  {textOf(message)}
                </p>
              ) : (
                <AssistantTurn
                  message={message}
                  busy={busy}
                  sandbox={sandbox}
                  closedPlans={closedPlans}
                  onRun={runPlan}
                  onCancel={cancelPlan}
                  onSend={send}
                />
              )}
            </li>
          ))}
        </ol>
      )}

      <p role="status" className="text-sm text-ridge">
        {busy ? "Working on it. Lookups that are already cached are free." : ""}
      </p>
      {error && (
        <p role="alert" className="text-sm text-stop">
          That did not work. Try again.
        </p>
      )}

      <form onSubmit={onSubmit} className="space-y-3" aria-label="Ask a question">
        <div className="flex gap-3">
          <label htmlFor="seo-question" className="sr-only">
            Your question
          </label>
          <input
            id="seo-question"
            name="message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={2000}
            autoComplete="off"
            placeholder="Ask about SEO, GEO or content"
            className="min-w-0 flex-1 rounded border border-contour bg-transparent p-3"
          />
          <button type="submit" className="btn" disabled={busy || draft.trim() === ""}>
            Ask
          </button>
        </div>
      </form>
    </div>
  );
}
