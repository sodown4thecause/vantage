import { describe, expect, it } from "vitest";

import {
  contentChatRequestSchema,
  contentDraftInputSchema,
  contentThreadTitle,
} from "@/lib/content-agent/contracts";

const workspaceId = "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a11";
const threadId = "019b4a1e-f2cc-7f3a-9e2d-a8fb50481a12";

describe("Content agent contracts", () => {
  it("accepts a trimmed user message scoped to a workspace and optional thread", () => {
    expect(contentChatRequestSchema.parse({ workspaceId, threadId, message: "  Draft a useful post  " })).toEqual({
      workspaceId,
      threadId,
      message: "Draft a useful post",
    });
  });

  it.each([
    { workspaceId, message: "  " },
    { workspaceId, message: "x".repeat(4001) },
    { workspaceId: "not-a-uuid", message: "Write a post" },
  ])("rejects an invalid or empty chat request: %j", (request) => {
    expect(contentChatRequestSchema.safeParse(request).success).toBe(false);
  });

  it("limits generated drafts to the private Content formats", () => {
    expect(contentDraftInputSchema.parse({
      title: "A useful post",
      body: "A clear introduction.\n\nThen the main idea.",
      format: "blog_post",
    })).toEqual({
      title: "A useful post",
      body: "A clear introduction.\n\nThen the main idea.",
      format: "blog_post",
    });
    expect(contentDraftInputSchema.safeParse({ title: "Post", body: "Text", format: "published" }).success).toBe(false);
  });

  it("derives a readable title from a new thread prompt", () => {
    expect(contentThreadTitle("  How do I explain our product?\nwith evidence ")).toBe("How do I explain our product? with evidence");
    expect(contentThreadTitle(" ")).toBe("New content draft");
    expect(contentThreadTitle("x".repeat(100))).toHaveLength(80);
  });
});
