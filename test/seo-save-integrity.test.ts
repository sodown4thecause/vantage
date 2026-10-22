import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CardView } from "@/app/seo/cards";
import type { ChatMessage, MessageStatus } from "@/app/seo/chat-wire";

const chat = vi.hoisted(() => ({ messages: [] as ChatMessage[], status: "ready" }));
const saved = vi.hoisted(() => [] as { blocks: unknown[] }[]);

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@ai-sdk/react", () => ({ useChat: () => ({ ...chat, sendMessage: vi.fn() }) }));
vi.mock("@/components/workspace-blocks", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/workspace-blocks")>();
  return { ...original, SaveButton: (props: { blocks: unknown[]; label: string }) => {
    saved.push(props);
    return createElement("button", null, props.label);
  } };
});

import { ChatClient } from "@/app/seo/chat-client";

const card: CardView = {
  tool: "backlink_summary", title: "Backlinks", data: { backlinks: 42 },
  cached: true, fetchedAt: "2026-10-20T12:00:00Z", sandbox: false,
};
const answer = (cards: CardView[] = [card], status: MessageStatus = "complete"): ChatMessage => ({
  id: "answer", role: "assistant", parts: [{ type: "text", text: "Full research answer" }],
  metadata: { status, cards },
});
const render = (sandbox = false) => renderToStaticMarkup(createElement(ChatClient, {
  workspaceId: "workspace-a", conversationId: null, initialMessages: [], starters: [], sandbox,
}));

beforeEach(() => {
  chat.messages = [answer()];
  chat.status = "ready";
  saved.length = 0;
});

describe("research save integrity", () => {
  it("keeps a complete live answer and its mapped figures saveable", () => {
    const html = render();
    expect(html).toContain("Save answer");
    expect(html).toContain("Save visual");
    expect(saved[0]!.blocks).toEqual([
      { type: "text", text: "Full research answer" },
      expect.objectContaining({ type: "table", title: "Backlinks" }),
    ]);
  });

  it("keeps the warning in saved historical sandbox text and excludes its visuals", () => {
    chat.messages = [answer([{ ...card, sandbox: true }])];
    const html = render();
    expect(html).toContain("Sandbox data: not real figures.");
    expect(html).toContain("Save answer");
    expect(html).not.toContain("Save visual");
    expect(saved[0]!.blocks).toEqual([{ type: "text", text: expect.stringContaining("Sandbox data: not real figures.") }]);
  });

  it("uses the page sandbox when card provenance is absent", () => {
    chat.messages = [answer([{ ...card, sandbox: undefined }])];
    expect(render(true)).not.toContain("Save answer");
    expect(render(true)).not.toContain("Save visual");
  });

  it.each(["submitted", "streaming"])("hides all latest-turn saves while %s even with complete metadata", (status) => {
    chat.status = status;
    const html = render();
    expect(html).not.toContain("Save answer");
    expect(html).not.toContain("Save visual");
  });

  it("does not treat missing final metadata as a complete answer", () => {
    chat.messages = [{ ...answer(), metadata: undefined }];
    expect(render()).not.toContain("Save answer");
  });

  it.each(["incomplete", "needs_approval", "approved"] as const)("hides answer and visual saves for %s results", (status) => {
    chat.messages = [answer([card], status)];
    const html = render();
    expect(html).not.toContain("Save answer");
    expect(html).not.toContain("Save visual");
  });

  it("keeps older completed turns saveable during a new stream", () => {
    chat.messages = [answer(), { ...answer(), id: "streaming-answer" }];
    chat.status = "streaming";
    expect(render().match(/Save answer/g)).toHaveLength(1);
  });

  it.each(["backlink_summary", "ranked_keywords"])("preserves the cached date on mapped %s cards", (tool) => {
    chat.messages = [answer([{ ...card, tool, data: tool === "ranked_keywords" ? [{ keyword: "test", position: 2 }] : card.data }])];
    expect(render()).toContain("Cached 2026-10-20");
  });

  it("preserves a cached label without a date", () => {
    chat.messages = [answer([{ ...card, fetchedAt: null }])];
    expect(render()).toContain(">Cached</span>");
  });
});
