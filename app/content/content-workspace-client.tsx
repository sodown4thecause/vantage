"use client";

import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useReducer, useRef, useState, type FormEvent } from "react";

import type { ContentBrandVoiceProfileRow, ContentDraftRow, ContentMessageRow, ContentThreadRow } from "@/lib/content-agent/repository";

import { buildContentDraftUpdatePrompt, buildContentRepurposePrompt, buildContentSectionRegenerationPrompt, contentDraftSaveReducer, contentDraftSections, contentDraftUpdateSucceeded, contentDraftsNeedingRestore, ContentToolCard, type ContentCardDraft, type ContentDraftSaveResult, type ContentSectionProposal, type ContentToolPart } from "./content-workspace-cards";
import { SuggestedPrompts } from "./suggested-prompts";
import s from "./content-workspace.module.css";

type ContentMetadata = { threadId?: string };
type ContentChatMessage = UIMessage<ContentMetadata>;

function textOf(message: ContentChatMessage): string {
  return message.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n\n");
}

function fromHistory(row: ContentMessageRow, threadId: string): ContentChatMessage {
  return {
    id: row.id,
    role: row.role,
    parts: row.content ? [{ type: "text", text: row.content }] : [],
    metadata: { threadId },
  };
}

function formatLabel(format: ContentDraftRow["format"]): string {
  return ({
    blog_outline: "Blog outline",
    blog_post: "Blog post",
    x_thread: "X thread",
    linkedin_post: "LinkedIn post",
    reddit_reply: "Reddit reply",
    hn_reply: "Hacker News reply",
    newsletter_section: "Newsletter section",
  })[format];
}

function dateLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "short" }).format(date);
}

function toolDraftId(part: ContentToolPart): string | null {
  if (part.type !== "tool-save_content_draft" || typeof part.output !== "object" || part.output === null
    || !("draftId" in part.output) || typeof part.output.draftId !== "string") return null;
  return part.output.draftId;
}

export function ContentWorkspaceClient({
  workspaceId,
  selectedThreadId,
  initialMessages,
  threads,
  drafts,
  threadDrafts,
  brandVoiceProfile,
  suggestedPrompts,
}: {
  workspaceId: string;
  selectedThreadId: string | null;
  initialMessages: ContentMessageRow[];
  threads: ContentThreadRow[];
  drafts: ContentDraftRow[];
  threadDrafts: ContentDraftRow[];
  brandVoiceProfile: ContentBrandVoiceProfileRow | null;
  suggestedPrompts: string[];
}) {
  const router = useRouter();
  const [threadId, setThreadId] = useState<string | null>(selectedThreadId);
  const selectThread = useCallback((nextThreadId: string) => {
    if (selectedThreadId === nextThreadId) return;
    setThreadId(nextThreadId);
    void router.replace(`/content?${new URLSearchParams({ workspaceId, threadId: nextThreadId }).toString()}`);
  }, [router, selectedThreadId, workspaceId]);
  const [messages] = useState(() => selectedThreadId
    ? initialMessages.map((message) => fromHistory(message, selectedThreadId))
    : []);
  const [input, setInput] = useState("");
  const transport = useMemo(() => new DefaultChatTransport<ContentChatMessage>({
    api: "/api/content/chat",
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      if (!response.ok) {
        const body: unknown = await response.clone().json().catch(() => null);
        if (typeof body === "object" && body !== null && "threadId" in body && typeof body.threadId === "string") {
          selectThread(body.threadId);
        }
      }
      return response;
    },
    prepareSendMessagesRequest: ({ messages: requestMessages, body, trigger }) => {
      const latestUser = requestMessages.findLast((message) => message.role === "user");
      return {
        body: {
          workspaceId: typeof body?.workspaceId === "string" ? body.workspaceId : workspaceId,
          threadId: typeof body?.threadId === "string" ? body.threadId : undefined,
          message: latestUser ? textOf(latestUser) : "",
          preserveText: body?.preserveText === true,
          draftUpdate: body?.draftUpdate,
          retry: body?.retry === true || trigger === "regenerate-message",
        },
      };
    },
  }), [selectThread, workspaceId]);
  const pendingSectionProposal = useRef<Omit<ContentSectionProposal, "text"> | null>(null);
  const pendingDraftSave = useRef<Pick<ContentDraftSaveResult, "draftId" | "title" | "body"> | null>(null);
  const [sectionProposal, setSectionProposal] = useState<ContentSectionProposal | null>(null);
  const [draftSaveState, dispatchDraftSave] = useReducer(contentDraftSaveReducer, { confirmed: {}, results: {} });
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);
  const { messages: turns, sendMessage, setMessages, clearError, status, error, stop } = useChat<ContentChatMessage>({
    transport,
    messages,
    onFinish: ({ message }) => {
      const completedThreadId = message.metadata?.threadId ?? threadId;
      if (completedThreadId) selectThread(completedThreadId);
      const pendingSection = pendingSectionProposal.current;
      if (pendingSection) {
        pendingSectionProposal.current = null;
        const proposal = textOf(message).trim();
        if (proposal) setSectionProposal({ ...pendingSection, text: proposal });
      }
      const pendingSave = pendingDraftSave.current;
      if (pendingSave) {
        pendingDraftSave.current = null;
        setSavingDraftId(null);
        const saved = message.parts.some((part) => part.type === "tool-update_content_draft"
          && contentDraftUpdateSucceeded((part as ContentToolPart).output, pendingSave));
        dispatchDraftSave({ type: "finished", result: { ...pendingSave, ok: saved } });
      }
      router.refresh();
    },
    onError: () => {
      const pendingSave = pendingDraftSave.current;
      if (pendingSave) {
        setSavingDraftId(null);
        dispatchDraftSave({ type: "finished", result: { ...pendingSave, ok: false } });
      }
    },
  });

  const busy = status === "submitted" || status === "streaming";
  const latestUser = turns.findLast((message) => message.role === "user");
  const latestPrompt = latestUser ? textOf(latestUser) : "";
  const restoredDrafts = contentDraftsNeedingRestore(
    threadDrafts.map((draft): ContentCardDraft => ({ draftId: draft.id, title: draft.title, body: draft.body, format: draft.format })),
    turns.map((turn) => ({ parts: turn.parts as ContentToolPart[] })),
  );
  const send = (text: string, preserve?: "section" | "draft") => {
    const prompt = preserve === "draft" ? text : text.trim();
    if (!prompt.trim() || busy) return;
    if (preserve !== "section") pendingSectionProposal.current = null;
    if (preserve !== "draft") pendingDraftSave.current = null;
    void sendMessage({ text: prompt }, { body: {
      workspaceId,
      threadId: threadId ?? undefined,
      preserveText: preserve === "draft",
      ...(preserve === "draft" && pendingDraftSave.current ? { draftUpdate: pendingDraftSave.current } : {}),
    } });
  };
  const regenerateSection = (draft: Parameters<typeof buildContentSectionRegenerationPrompt>[0], sectionIndex: number) => {
    if (busy) return;
    const originalText = contentDraftSections(draft.body)[sectionIndex];
    if (!originalText) return;
    pendingSectionProposal.current = { draftId: draft.draftId, sectionIndex, originalText };
    try {
      send(buildContentSectionRegenerationPrompt(draft, sectionIndex), "section");
    } catch {
      pendingSectionProposal.current = null;
    }
  };
  const repurposeDraft = (draft: Parameters<typeof buildContentRepurposePrompt>[0], format: Parameters<typeof buildContentRepurposePrompt>[1]) => {
    if (busy) return;
    send(buildContentRepurposePrompt(draft, format));
  };
  const saveDraft = (draft: Parameters<typeof buildContentDraftUpdatePrompt>[0]) => {
    if (busy) return;
    pendingDraftSave.current = { draftId: draft.draftId, title: draft.title, body: draft.body };
    setSavingDraftId(draft.draftId);
    dispatchDraftSave({ type: "started", draftId: draft.draftId });
    send(buildContentDraftUpdatePrompt(draft), "draft");
  };
  const stopWriting = () => {
    pendingSectionProposal.current = null;
    const pendingSave = pendingDraftSave.current;
    if (pendingSave) {
      pendingDraftSave.current = null;
      setSavingDraftId(null);
      dispatchDraftSave({ type: "finished", result: { ...pendingSave, ok: false } });
    }
    void stop();
  };
  const retry = () => {
    if (!latestUser || !threadId || busy) return;
    const latestUserIndex = turns.findLastIndex((message) => message.role === "user");
    setMessages(turns.slice(0, latestUserIndex + 1));
    setSavingDraftId(pendingDraftSave.current?.draftId ?? null);
    clearError();
    void sendMessage({ text: latestPrompt, messageId: latestUser.id }, {
      body: {
        workspaceId,
        threadId,
        retry: true,
        preserveText: pendingDraftSave.current !== null,
        ...(pendingDraftSave.current ? { draftUpdate: pendingDraftSave.current } : {}),
      },
    });
  };
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = input.trim();
    if (!prompt || busy) return;
    send(prompt);
    setInput("");
  };

  return <div className={s.workspace}>
    <aside className={s.rail} aria-label="Content workspace">
      <div className={s.railSection}>
        <div className={s.sectionHeading}><h2>Recent writing</h2><span>{threads.length}</span></div>
        <Link className={s.newThread} href={`/content?workspaceId=${encodeURIComponent(workspaceId)}`}>Start a new draft</Link>
        {threads.length > 0 ? <nav className={s.threadList} aria-label="Resume a conversation">
          {threads.map((thread) => <Link
            key={thread.id}
            href={`/content?${new URLSearchParams({ workspaceId, threadId: thread.id }).toString()}`}
            aria-current={selectedThreadId === thread.id ? "page" : undefined}
            className={s.threadLink}
          >
            <span>{thread.title}</span><small>{dateLabel(thread.updatedAt)}</small>
          </Link>)}
        </nav> : <p className={s.railEmpty}>Your writing conversations will be kept here.</p>}
      </div>
      <div className={s.railSection}>
        <div className={s.sectionHeading}><h2>Saved drafts</h2><span>{drafts.length}</span></div>
        {drafts.length > 0 ? <ul className={s.draftList}>
          {drafts.map((draft) => <li key={draft.id}>
            <strong>{draft.title}</strong><span>{formatLabel(draft.format)} · {draft.status}</span>
          </li>)}
        </ul> : <p className={s.railEmpty}>Ask the assistant to write and save a draft.</p>}
      </div>
    </aside>

    <section className={s.canvas} aria-label="Content writing assistant">
      <div className={s.conversation}>
        {turns.length === 0 && restoredDrafts.length === 0 ? <div className={s.intro}>
          <span className={s.mark} aria-hidden="true">✳</span>
          <h2>{selectedThreadId ? "Pick up where you left off." : "What are you trying to explain?"}</h2>
          <p>Start with a rough idea, a question from your audience or a point you want to make. Vantage can shape it into a draft you can edit.</p>
          <p className={s.promise}>Your workspace keeps the drafts. You decide what happens next.</p>
        </div> : <ol className={s.turns} aria-label="Writing conversation">
          {turns.map((turn) => <li className={s.turn} key={turn.id}>
            {turn.role === "user"
              ? <p className={s.userMessage}>{textOf(turn)}</p>
              : <div className={s.assistantMessage}>
                <div className={s.assistantLabel}><span className={s.mark} aria-hidden="true">✳</span>Vantage Content</div>
                {turn.parts.map((part, index) => {
                  if (part.type === "text") return <p key={`text-${index}`}>{part.text}</p>;
                  const contentPart = part as ContentToolPart;
                  const draftId = toolDraftId(contentPart);
                  return <ContentToolCard
                    key={contentPart.toolCallId ?? `${part.type}-${index}`}
                    part={contentPart}
                    proposal={sectionProposal}
                    saveResult={draftId ? draftSaveState.results[draftId] : undefined}
                    confirmedDraft={draftId ? draftSaveState.confirmed[draftId] : undefined}
                    savingDraftId={savingDraftId}
                    onSaveDraft={saveDraft}
                    onRegenerateSection={regenerateSection}
                    onRepurpose={repurposeDraft}
                    onProposalApplied={() => setSectionProposal(null)}
                    busy={busy}
                  />;
                })}
                {turn.parts.length === 0 && <p>{busy ? "Thinking through the draft…" : "The response was interrupted. Try again when you’re ready."}</p>}
              </div>}
          </li>)}
          {restoredDrafts.length > 0 && <li className={s.turn}>
            <div className={s.assistantMessage}>
              <div className={s.assistantLabel}><span className={s.mark} aria-hidden="true">✳</span>Saved drafts from this conversation</div>
              {restoredDrafts.map((draft) => <ContentToolCard
                key={draft.draftId}
                part={{ type: "tool-save_content_draft", state: "output-available", output: { saved: true, ...draft } }}
                proposal={sectionProposal}
                saveResult={draftSaveState.results[draft.draftId]}
                confirmedDraft={draftSaveState.confirmed[draft.draftId]}
                savingDraftId={savingDraftId}
                onSaveDraft={saveDraft}
                onRegenerateSection={regenerateSection}
                onRepurpose={repurposeDraft}
                onProposalApplied={() => setSectionProposal(null)}
                busy={busy}
              />)}
            </div>
          </li>}
        </ol>}
      </div>

      {error && <div className={s.error} role="alert">
        <p>The assistant couldn’t finish that turn. Your writing is still here.</p>
        {latestPrompt && threadId && <button type="button" className={s.retry} onClick={retry}>Retry this request</button>}
      </div>}
      {busy && <div className={s.liveStatus} role="status">
        <span>Writing in progress</span><button type="button" className={s.stop} onClick={stopWriting}>Stop</button>
      </div>}
      <SuggestedPrompts prompts={suggestedPrompts} onSelect={setInput} />
      <form className={s.composer} onSubmit={onSubmit}>
        <label className={s.visuallyHidden} htmlFor="content-prompt">What would you like to write?</label>
        <textarea
          id="content-prompt"
          name="message"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Tell Vantage what you want to write…"
          rows={3}
          maxLength={4000}
          disabled={busy}
        />
        <div className={s.composerFooter}>
          <span>{brandVoiceProfile ? "Brand voice saved" : "Ask Vantage to set your brand voice"} · Australian English · Nothing is published for you</span>
          <button className={s.send} type="submit" disabled={busy || input.trim().length === 0}>Write</button>
        </div>
      </form>
    </section>
  </div>;
}
