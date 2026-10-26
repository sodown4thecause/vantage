import { describe, expect, it } from "vitest";

import { contentAgentHistory } from "@/lib/content-agent/history";

describe("Content agent history", () => {
  it("keeps the newest completed context within message and character budgets", () => {
    const messages = Array.from({ length: 30 }, (_, index) => ({
      id: String(index),
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      status: "complete" as const,
      content: `${index}: ${"x".repeat(1200)}`,
    }));

    const result = contentAgentHistory(messages);

    expect(result.length).toBeLessThanOrEqual(20);
    expect(result.reduce((total, message) => total + message.content.length, 0)).toBeLessThanOrEqual(32_000);
    expect(result.at(-1)?.id).toBe("29");
    expect(result[0]?.id).not.toBe("0");
  });

  it("keeps the newest card-action instructions intact when older history fills the budget", () => {
    const action = `Save my edits. Use update_content_draft exactly once. Exact body:\n${"x".repeat(24_000)}`;
    const messages = [
      { id: "older", role: "assistant" as const, status: "complete" as const, content: "Earlier context." },
      { id: "action", role: "user" as const, status: "complete" as const, content: action },
    ];

    const result = contentAgentHistory(messages);

    expect(result.find((message) => message.id === "action")?.content).toBe(action);
  });

  it("keeps user turns but excludes incomplete assistant output", () => {
    const messages = [
      { id: "user", role: "user" as const, status: "complete" as const, content: "Write a draft" },
      { id: "failed", role: "assistant" as const, status: "failed" as const, content: "Partial answer" },
    ];

    expect(contentAgentHistory(messages).map((message) => message.id)).toEqual(["user"]);
  });
});
