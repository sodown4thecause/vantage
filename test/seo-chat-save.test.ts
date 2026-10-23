import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CardView } from "@/app/seo/cards";
import { fromHistory, type ChatMessage, type MessageStatus } from "@/app/seo/chat-wire";
import type { SaveButton } from "@/components/workspace-blocks";

const state = vi.hoisted(() => ({ messages: [] as ChatMessage[], status: "ready", saves: [] as Parameters<typeof SaveButton>[0][] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@ai-sdk/react", () => ({ useChat: () => ({ messages: state.messages, status: state.status, sendMessage: vi.fn() }) }));
vi.mock("@/components/workspace-blocks", async (original) => {
  const actual = await original<typeof import("@/components/workspace-blocks")>();
  return { ...actual, SaveButton: (props: Parameters<typeof SaveButton>[0]) => {
    state.saves.push(props);
    return createElement(actual.SaveButton, props);
  } };
});

import { ChatClient } from "@/app/seo/chat-client";

const card: CardView = { tool: "backlink_summary", title: "Backlink summary", fetchedAt: "2026-10-01T12:00:00Z", cached: true, sandbox: false, data: { backlinks: 123 } };
function render(cards: CardView[] = [], status: MessageStatus = "complete", sandbox = false) {
  state.messages = [fromHistory({ id: "answer", role: "assistant", content: "Research answer", parts: { cards }, status, creditsUsed: 0, createdAt: "2026-10-01" })];
  return renderChat(sandbox);
}
function renderChat(sandbox = false) {
  return renderToStaticMarkup(createElement(ChatClient, { workspaceId: "11111111-1111-4111-8111-111111111111", conversationId: null, initialMessages: [], starters: [], sandbox }));
}

describe("research save provenance and completion", () => {
  beforeEach(() => { state.saves = []; state.status = "ready"; });

  it.each(["backlink_summary", "ranked_keywords"])("keeps the cached date for mapped %s cards", (tool) => {
    const data = tool === "ranked_keywords" ? [{ keyword: "example", position: 3 }] : card.data;
    expect(render([{ ...card, tool, data }])).toContain("Cached 2026-10-01");
    expect(render([{ ...card, tool, data, fetchedAt: null }])).toContain(">Cached</span>");
    expect(render([{ ...card, tool, data, cached: false }])).not.toContain(">Cached");
  });

  it.each(["submitted", "streaming"])("does not offer answer saves while %s, even with complete metadata", (status) => {
    state.status = status;
    expect(render([card])).not.toContain("Save answer");
    expect(state.saves).toHaveLength(0);
  });

  it("does not save an interrupted stream that has no final metadata", () => {
    state.status = "error";
    state.messages = [{ id: "partial", role: "assistant", parts: [{ type: "text", text: "Unfinished" }] }];
    expect(renderChat()).not.toContain("Save answer");
  });

  it.each(["incomplete", "needs_approval", "approved"] as const)("does not save a %s answer", (status) => {
    expect(render([], status)).not.toContain("Save answer");
  });

  it("saves a completed live answer with its live visuals", () => {
    expect(render([card])).toContain("Save answer");
    expect(state.saves[0]!.blocks).toHaveLength(2);
    expect(state.saves[0]!.blocks[0]).toEqual({ type: "text", text: "Research answer" });
  });

  it("keeps historical sandbox warnings in saved text and excludes only sandbox visuals", () => {
    const html = render([{ ...card, sandbox: true, data: { backlinks: 999 } }, card]);
    expect(html).toContain("Saved answers keep this warning and exclude sandbox visuals.");
    const blocks = state.saves[0]!.blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: "text", text: expect.stringContaining("Sandbox data: not real figures.") });
    expect(JSON.stringify(blocks)).not.toContain("999");
    expect(JSON.stringify(blocks)).toContain("123");
  });

  it("does not offer saves in the current sandbox environment", () => {
    expect(render([{ ...card, sandbox: undefined }], "complete", true)).not.toContain("Save answer");
    expect(state.saves).toHaveLength(0);
  });
});
